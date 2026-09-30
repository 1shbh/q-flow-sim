"""FastAPI entry point and in-memory scenario editing routes."""

import asyncio
import json
import math
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import networkx as nx

from .algorithms.runner import ALGORITHMS, run_algorithm
from .algorithms.network import edge_from_dict, build_graph, route_time_min
from .graph_model import congestion_multiplier, edge_cost_min
from .scenario import empty_scenario

app = FastAPI(title="QIRA API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_ROUTE_DURATION_SEC = 10.0
TICK_RATE = 10

scenario = empty_scenario()
animation_run_cache: dict[tuple[str, tuple[str, ...], str], dict[str, float]] = {}
ANIMATION_CACHE_LIMIT = 32
next_ids = {"N": 1, "E": 1}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/scenario")
def get_scenario() -> dict:
    return scenario


@app.put("/scenario")
async def replace_scenario(request: Request) -> dict[str, Any]:
    global scenario
    replacement = await _json_object(request)
    _validate_import_shape(replacement)
    scenario = _normalize_scenario(replacement)
    _reset_id_counters(scenario)
    return scenario


@app.get("/scenario/export")
def export_scenario() -> Response:
    content = json.dumps(scenario, indent=2, ensure_ascii=False) + "\n"
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="scenario.json"'},
    )


def _validate_import_shape(payload: dict[str, Any]) -> None:
    expected = {"nodes", "edges", "vehicles", "egoVehicle", "weather", "weights"}
    if set(payload) != expected:
        raise HTTPException(status_code=400, detail="Scenario fields must match the §4 schema")
    if not isinstance(payload["nodes"], list) or not isinstance(payload["edges"], list):
        raise HTTPException(status_code=400, detail="Scenario nodes and edges must be arrays")
    if len(payload["nodes"]) > 60 or len(payload["edges"]) > 150:
        raise HTTPException(status_code=400, detail="Scenario exceeds the 60-node or 150-edge cap")

    node_ids: set[str] = set()
    node_by_id: dict[str, dict[str, Any]] = {}
    for raw in payload["nodes"]:
        if not isinstance(raw, dict) or set(raw) != {"id", "x", "y", "signal", "greenSplit"}:
            raise HTTPException(status_code=400, detail="Scenario node does not match the §4 schema")
        node_id = raw["id"]
        if not isinstance(node_id, str) or not node_id or node_id in node_ids:
            raise HTTPException(status_code=400, detail="Scenario node ids must be unique strings")
        node_ids.add(node_id)
        node_by_id[node_id] = raw
        _validate_node_fields({key: raw[key] for key in ("x", "y", "signal", "greenSplit")})

    edge_ids: set[str] = set()
    pairs: set[frozenset[str]] = set()
    for raw in payload["edges"]:
        edge_fields = {"from", "to", "lengthM", "lanes", "laneWidthM", "speedLimitKph", "oneWay"}
        if not isinstance(raw, dict) or set(raw) not in (edge_fields | {"id", "incident"}, edge_fields | {"id", "incident", "backgroundLoad"}):
            raise HTTPException(status_code=400, detail="Scenario edge does not match the §4 schema")
        edge_id = raw["id"]
        if not isinstance(edge_id, str) or not edge_id or edge_id in edge_ids:
            raise HTTPException(status_code=400, detail="Scenario edge ids must be unique strings")
        edge_ids.add(edge_id)
        _validate_edge_fields({key: raw[key] for key in edge_fields} | ({"backgroundLoad": raw["backgroundLoad"]} if "backgroundLoad" in raw else {}))
        if raw["from"] not in node_ids or raw["to"] not in node_ids or raw["from"] == raw["to"]:
            raise HTTPException(status_code=400, detail=f"Road '{edge_id}' has invalid endpoints")
        _validate_edge_heuristic_length(raw, node_by_id)
        pair = frozenset((raw["from"], raw["to"]))
        if pair in pairs:
            raise HTTPException(status_code=400, detail="Scenario contains duplicate roads")
        pairs.add(pair)
        incident = raw["incident"]
        if incident is not None:
            if (
                not isinstance(incident, dict)
                or not isinstance(incident.get("type"), str)
                or incident["type"] not in {"closure", "slowdown"}
            ):
                raise HTTPException(status_code=400, detail=f"Road '{edge_id}' has an invalid incident")
            if incident["type"] == "closure" and set(incident) != {"type"}:
                raise HTTPException(status_code=400, detail="A closure incident only accepts type")
            if incident["type"] == "slowdown":
                if set(incident) - {"type", "factor"}:
                    raise HTTPException(status_code=400, detail="A slowdown incident accepts type and factor")
                if "factor" in incident and _number(incident["factor"], "factor") <= 0:
                    raise HTTPException(status_code=400, detail="factor must be greater than 0")

    vehicles = payload["vehicles"]
    if not isinstance(vehicles, dict) or set(vehicles) != {"cars", "trucks", "buses"}:
        raise HTTPException(status_code=400, detail="Scenario vehicles must contain cars, trucks, and buses")
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in vehicles.values()):
        raise HTTPException(status_code=400, detail="Scenario vehicle counts must be non-negative integers")
    if sum(vehicles.values()) > 1000:
        raise HTTPException(status_code=400, detail="Scenario cannot exceed 1,000 vehicles")

    ego = payload["egoVehicle"]
    if ego is not None:
        if not isinstance(ego, dict) or set(ego) != {"origin", "destination"}:
            raise HTTPException(status_code=400, detail="Scenario egoVehicle must contain origin and destination")
        if any(not isinstance(ego[key], str) or ego[key] not in node_ids for key in ("origin", "destination")):
            raise HTTPException(status_code=400, detail="Scenario ego endpoints must reference existing nodes")
        if ego["origin"] == ego["destination"]:
            raise HTTPException(status_code=400, detail="Ego origin and destination must be different intersections")

    weather = payload["weather"]
    if not isinstance(weather, dict) or set(weather) != {"type", "intensity"}:
        raise HTTPException(status_code=400, detail="Scenario weather must contain type and intensity")
    if not isinstance(weather["type"], str) or weather["type"] not in {"clear", "rain", "fog"}:
        raise HTTPException(status_code=400, detail="Scenario weather type must be clear, rain, or fog")
    _validate_weather_intensity(weather["intensity"])

    weights = payload["weights"]
    if not isinstance(weights, dict) or set(weights) != {"wT", "wD", "wC"}:
        raise HTTPException(status_code=400, detail="Scenario weights must contain wT, wD, and wC")
    for key, value in weights.items():
        _number(value, key)


@app.post("/scenario/import")
async def import_scenario(request: Request) -> dict[str, Any]:
    global scenario
    imported = await _json_object(request)
    _validate_import_shape(imported)
    scenario = _normalize_scenario(imported)
    _reset_id_counters(scenario)
    errors = _validation_errors()
    return {"scenario": scenario, "valid": not errors, "errors": errors}


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc.detail)})


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


async def _json_object(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    return value


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=400, detail=f"{field} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise HTTPException(status_code=400, detail=f"{field} must be finite")
    return number


def _validate_weather_intensity(value: Any) -> float:
    intensity = _number(value, "intensity")
    if not 0 <= intensity <= 1:
        raise HTTPException(status_code=400, detail="Weather intensity must be between 0 and 1")
    return intensity


def _validate_edge_heuristic_length(edge: dict[str, Any], nodes: dict[str, dict[str, Any]]) -> None:
    source, target = nodes[edge["from"]], nodes[edge["to"]]
    minimum = math.hypot(target["x"] - source["x"], target["y"] - source["y"]) * 2.5
    if edge["lengthM"] + 1e-9 < minimum:
        raise HTTPException(
            status_code=400,
            detail=f"Road lengthM must be at least the endpoint distance × 2.5 ({minimum:.3f} m)",
        )


def _validate_node_fields(payload: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    allowed = {"x", "y", "signal", "greenSplit"}
    if not payload or set(payload) - allowed:
        raise HTTPException(status_code=400, detail="Node fields must be x, y, signal, or greenSplit")
    if not partial and set(payload) != allowed:
        raise HTTPException(status_code=400, detail="Node requires x, y, signal, and greenSplit")
    result: dict[str, Any] = {}
    for field in ("x", "y"):
        if field in payload:
            result[field] = _number(payload[field], field)
    if "signal" in payload:
        if not isinstance(payload["signal"], bool):
            raise HTTPException(status_code=400, detail="signal must be a boolean")
        result["signal"] = payload["signal"]
    if "greenSplit" in payload:
        split = _number(payload["greenSplit"], "greenSplit")
        if split < 0 or split > 1:
            raise HTTPException(status_code=400, detail="greenSplit must be between 0 and 1")
        result["greenSplit"] = split
    return result


def _validate_edge_fields(payload: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    required = {"from", "to", "lengthM", "lanes", "laneWidthM", "speedLimitKph", "oneWay"}
    allowed = required | {"backgroundLoad"}
    if not payload or set(payload) - allowed:
        raise HTTPException(status_code=400, detail="Edge fields do not match the edge API contract")
    if not partial and set(payload) not in (required, allowed):
        raise HTTPException(status_code=400, detail="Edge is missing required fields")
    result: dict[str, Any] = {}
    for field in ("from", "to"):
        if field in payload:
            if not isinstance(payload[field], str) or not payload[field]:
                raise HTTPException(status_code=400, detail=f"{field} must be a node id")
            result[field] = payload[field]
    for field in ("lengthM", "laneWidthM", "speedLimitKph"):
        if field in payload:
            number = _number(payload[field], field)
            if number <= 0:
                raise HTTPException(status_code=400, detail=f"{field} must be greater than 0")
            result[field] = number
    if "lanes" in payload:
        lanes = payload["lanes"]
        if isinstance(lanes, bool) or not isinstance(lanes, int) or lanes <= 0:
            raise HTTPException(status_code=400, detail="lanes must be a positive integer")
        result["lanes"] = lanes
    if "oneWay" in payload:
        if not isinstance(payload["oneWay"], bool):
            raise HTTPException(status_code=400, detail="oneWay must be a boolean")
        result["oneWay"] = payload["oneWay"]
    if "backgroundLoad" in payload:
        background_load = _number(payload["backgroundLoad"], "backgroundLoad")
        if background_load < 0:
            raise HTTPException(status_code=400, detail="backgroundLoad must be non-negative")
        result["backgroundLoad"] = background_load
    return result


def _normalize_scenario(value: dict[str, Any]) -> dict[str, Any]:
    return {
        **value,
        "edges": [{**edge, "backgroundLoad": float(edge.get("backgroundLoad", 0.0))} for edge in value["edges"]],
    }


def _new_id(prefix: str, records: list[dict[str, Any]]) -> str:
    suffix = next_ids[prefix]
    used = {str(record.get("id")) for record in records}
    while f"{prefix}{suffix}" in used:
        suffix += 1
    next_ids[prefix] = suffix + 1
    return f"{prefix}{suffix}"


def _reset_id_counters(value: dict[str, Any]) -> None:
    for prefix, key in (("N", "nodes"), ("E", "edges")):
        maximum = 0
        for record in value[key]:
            match = re.fullmatch(rf"{prefix}(\d+)", str(record.get("id")))
            if match:
                maximum = max(maximum, int(match.group(1)))
        next_ids[prefix] = maximum + 1


def _find_node(node_id: str) -> dict[str, Any]:
    for node in scenario["nodes"]:
        if node["id"] == node_id:
            return node
    raise HTTPException(status_code=400, detail=f"Node '{node_id}' does not exist")


def _find_edge(edge_id: str) -> dict[str, Any]:
    for edge in scenario["edges"]:
        if edge["id"] == edge_id:
            return edge
    raise HTTPException(status_code=400, detail=f"Edge '{edge_id}' does not exist")


@app.post("/scenario/nodes")
async def create_node(request: Request) -> dict[str, Any]:
    payload = _validate_node_fields(await _json_object(request))
    if len(scenario["nodes"]) >= 60:
        raise HTTPException(status_code=400, detail="The network cannot exceed 60 nodes")
    node = {"id": _new_id("N", scenario["nodes"]), **payload}
    scenario["nodes"].append(node)
    return node


@app.patch("/scenario/nodes/{node_id}")
async def update_node(node_id: str, request: Request) -> dict[str, Any]:
    node = _find_node(node_id)
    patch = _validate_node_fields(await _json_object(request), partial=True)
    updated = {**node, **patch}
    node_map = {item["id"]: item for item in scenario["nodes"]}
    node_map[node_id] = updated
    if "x" in patch or "y" in patch:
        for edge in scenario["edges"]:
            if node_id in (edge["from"], edge["to"]):
                source, target = node_map[edge["from"]], node_map[edge["to"]]
                required_length = math.hypot(target["x"] - source["x"], target["y"] - source["y"]) * 2.5
                edge["lengthM"] = max(float(edge["lengthM"]), required_length)
    node.update(patch)
    return node


@app.delete("/scenario/nodes/{node_id}", status_code=204)
def delete_node(node_id: str) -> None:
    _find_node(node_id)
    scenario["nodes"] = [node for node in scenario["nodes"] if node["id"] != node_id]
    scenario["edges"] = [
        edge for edge in scenario["edges"] if edge["from"] != node_id and edge["to"] != node_id
    ]
    ego = scenario["egoVehicle"]
    if ego and node_id in (ego["origin"], ego["destination"]):
        scenario["egoVehicle"] = None


@app.post("/scenario/edges")
async def create_edge(request: Request) -> dict[str, Any]:
    payload = _validate_edge_fields(await _json_object(request))
    if len(scenario["edges"]) >= 150:
        raise HTTPException(status_code=400, detail="The network cannot exceed 150 edges")
    if payload["from"] not in {node["id"] for node in scenario["nodes"]}:
        raise HTTPException(status_code=400, detail=f"Node '{payload['from']}' does not exist")
    if payload["to"] not in {node["id"] for node in scenario["nodes"]}:
        raise HTTPException(status_code=400, detail=f"Node '{payload['to']}' does not exist")
    if payload["from"] == payload["to"]:
        raise HTTPException(status_code=400, detail="An edge cannot connect a node to itself")
    pair = {payload["from"], payload["to"]}
    if any({edge["from"], edge["to"]} == pair for edge in scenario["edges"]):
        raise HTTPException(status_code=400, detail="An edge already connects these nodes")
    edge = {"id": _new_id("E", scenario["edges"]), **payload, "backgroundLoad": payload.get("backgroundLoad", 0.0), "incident": None}
    _validate_edge_heuristic_length(edge, {node["id"]: node for node in scenario["nodes"]})
    scenario["edges"].append(edge)
    return edge


@app.patch("/scenario/edges/{edge_id}")
async def update_edge(edge_id: str, request: Request) -> dict[str, Any]:
    edge = _find_edge(edge_id)
    patch = _validate_edge_fields(await _json_object(request), partial=True)
    updated = {**edge, **patch}
    node_ids = {node["id"] for node in scenario["nodes"]}
    for endpoint in ("from", "to"):
        if updated[endpoint] not in node_ids:
            raise HTTPException(status_code=400, detail=f"Node '{updated[endpoint]}' does not exist")
    if updated["from"] == updated["to"]:
        raise HTTPException(status_code=400, detail="An edge cannot connect a node to itself")
    pair = {updated["from"], updated["to"]}
    if any(other["id"] != edge_id and {other["from"], other["to"]} == pair for other in scenario["edges"]):
        raise HTTPException(status_code=400, detail="An edge already connects these nodes")
    _validate_edge_heuristic_length(updated, {node["id"]: node for node in scenario["nodes"]})
    edge.update(patch)
    return edge


@app.delete("/scenario/edges/{edge_id}", status_code=204)
def delete_edge(edge_id: str) -> None:
    _find_edge(edge_id)
    scenario["edges"] = [edge for edge in scenario["edges"] if edge["id"] != edge_id]


@app.put("/scenario/ego")
async def update_ego(request: Request) -> dict[str, str]:
    payload = await _json_object(request)
    if set(payload) != {"origin", "destination"}:
        raise HTTPException(status_code=400, detail="Ego vehicle requires origin and destination")
    origin, destination = payload["origin"], payload["destination"]
    if not isinstance(origin, str) or not isinstance(destination, str):
        raise HTTPException(status_code=400, detail="Ego origin and destination must be node ids")
    node_ids = {node["id"] for node in scenario["nodes"]}
    if origin not in node_ids:
        raise HTTPException(status_code=400, detail=f"Node '{origin}' does not exist")
    if destination not in node_ids:
        raise HTTPException(status_code=400, detail=f"Node '{destination}' does not exist")
    if origin == destination:
        raise HTTPException(status_code=400, detail="Ego origin and destination must be different intersections")
    scenario["egoVehicle"] = {"origin": origin, "destination": destination}
    return scenario["egoVehicle"]


@app.put("/scenario/vehicles")
async def update_vehicles(request: Request) -> dict[str, int]:
    payload = await _json_object(request)
    if set(payload) != {"cars", "trucks", "buses"}:
        raise HTTPException(status_code=400, detail="Vehicles requires cars, trucks, and buses")
    counts: dict[str, int] = {}
    for kind in ("cars", "trucks", "buses"):
        value = payload[kind]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise HTTPException(status_code=400, detail=f"{kind} must be a non-negative integer")
        counts[kind] = value
    if sum(counts.values()) > 1000:
        raise HTTPException(status_code=400, detail="The scenario cannot exceed 1,000 vehicles")
    scenario["vehicles"] = counts
    return scenario["vehicles"]


@app.put("/scenario/weather")
async def update_weather(request: Request) -> dict[str, Any]:
    payload = await _json_object(request)
    if set(payload) != {"type", "intensity"}:
        raise HTTPException(status_code=400, detail="Weather requires type and intensity")
    weather_type = payload["type"]
    if not isinstance(weather_type, str) or weather_type not in {"clear", "rain", "fog"}:
        raise HTTPException(status_code=400, detail="Weather type must be clear, rain, or fog")
    intensity = _validate_weather_intensity(payload["intensity"])
    scenario["weather"] = {"type": weather_type, "intensity": intensity}
    return scenario["weather"]


@app.put("/scenario/weights")
async def update_weights(request: Request) -> dict[str, float]:
    payload = await _json_object(request)
    if set(payload) != {"wT", "wD", "wC"}:
        raise HTTPException(status_code=400, detail="Weights require wT, wD, and wC")
    scenario["weights"] = {key: _number(payload[key], key) for key in ("wT", "wD", "wC")}
    return scenario["weights"]


@app.put("/scenario/edges/{edge_id}/incident")
async def update_incident(edge_id: str, request: Request) -> dict[str, Any]:
    edge = _find_edge(edge_id)
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON") from exc
    if payload is None:
        edge["incident"] = None
        return edge
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Incident must be an object or null")
    incident_type = payload.get("type")
    if incident_type == "closure":
        if set(payload) != {"type"}:
            raise HTTPException(status_code=400, detail="A closure incident only accepts type")
        edge["incident"] = {"type": "closure"}
    elif incident_type == "slowdown":
        if set(payload) - {"type", "factor"}:
            raise HTTPException(status_code=400, detail="A slowdown incident accepts type and factor")
        factor = _number(payload.get("factor", 3.0), "factor")
        if factor <= 0:
            raise HTTPException(status_code=400, detail="factor must be greater than 0")
        edge["incident"] = {"type": "slowdown", "factor": factor}
    else:
        raise HTTPException(status_code=400, detail="Incident type must be closure or slowdown")
    return edge


def _validation_errors() -> list[str]:
    node_ids = {node["id"] for node in scenario["nodes"]}
    incident_nodes: set[str] = set()
    errors: list[str] = []
    for edge in scenario["edges"]:
        source, target = edge["from"], edge["to"]
        if source not in node_ids:
            errors.append(f"Road '{edge['id']}' references missing intersection '{source}'")
        if target not in node_ids:
            errors.append(f"Road '{edge['id']}' references missing intersection '{target}'")
        if source == target:
            errors.append(f"Road '{edge['id']}' connects an intersection to itself")
        incident_nodes.update((source, target))
    errors.extend(
        f"Intersection '{node_id}' has no connected road"
        for node_id in sorted(node_ids - incident_nodes)
    )
    ego = scenario["egoVehicle"]
    if ego and ego["origin"] in node_ids and ego["destination"] in node_ids:
        editable_scenario = {
            **scenario,
            "edges": [
                {**edge, "incident": None} if (edge.get("incident") or {}).get("type") == "closure" else edge
                for edge in scenario["edges"]
            ],
        }
        editable_graph = build_graph(editable_scenario)
        if not nx.has_path(editable_graph, ego["origin"], ego["destination"]):
            errors.append(
                f"No editable road path exists from ego origin '{ego['origin']}' "
                f"to destination '{ego['destination']}'"
            )
    return errors


@app.post("/scenario/validate")
def validate_scenario() -> dict[str, Any]:
    errors = _validation_errors()
    return {"valid": not errors, "errors": errors}


def _scenario_fingerprint() -> str:
    return json.dumps(scenario, sort_keys=True, separators=(",", ":"))


def _execute_algorithm(algorithm: str) -> dict[str, Any]:
    try:
        detailed = run_algorithm(algorithm, scenario, include_loads=True)
        graph = build_graph(scenario)
        detailed["free_flow_time"] = route_time_min(scenario, graph, detailed["route"], include_background=False)
        detailed["actual_time"] = route_time_min(scenario, graph, detailed["route"], include_background=True)
        actual_multipliers = []
        for source, target in zip(detailed["route"], detailed["route"][1:]):
            edge_id = graph[source][target]["edge_id"]
            raw_edge = next(edge for edge in scenario["edges"] if edge["id"] == edge_id)
            actual_multipliers.append(congestion_multiplier(float(raw_edge.get("backgroundLoad", 0.0)), raw_edge["lanes"]))
        detailed["actual_congestion"] = sum(actual_multipliers) / len(actual_multipliers) if actual_multipliers else 1.0
        edge_loads = detailed.pop("_edge_loads", {})
        if not edge_loads:
            edge_loads = {edge["id"]: 0.0 for edge in scenario["edges"]}
        cache_key = (algorithm, tuple(detailed["route"]), _scenario_fingerprint())
        animation_run_cache[cache_key] = edge_loads
        while len(animation_run_cache) > ANIMATION_CACHE_LIMIT:
            animation_run_cache.pop(next(iter(animation_run_cache)))
        return detailed
    except (nx.NetworkXException, ValueError, KeyError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _route_edges(route: list[str]) -> list[tuple[dict[str, Any], bool]]:
    if len(route) < 2:
        raise ValueError("Animation route must contain at least two nodes")
    node_ids = {node["id"] for node in scenario["nodes"]}
    if any(node_id not in node_ids for node_id in route):
        raise ValueError("Animation route contains an unknown node")
    by_pair: dict[tuple[str, str], tuple[dict[str, Any], bool]] = {}
    for raw in scenario["edges"]:
        if raw.get("incident") and raw["incident"].get("type") == "closure":
            continue
        by_pair[(raw["from"], raw["to"])] = (raw, False)
        if not raw["oneWay"]:
            by_pair[(raw["to"], raw["from"])] = (raw, True)
    result: list[tuple[dict[str, Any], bool]] = []
    for source, target in zip(route, route[1:]):
        edge = by_pair.get((source, target))
        if edge is None:
            raise ValueError(f"Animation route has no open road from '{source}' to '{target}'")
        result.append(edge)
    return result


def _animation_tick(
    sim_time: float,
    status: str,
    run_id: str,
    algorithm: str,
    route: list[str],
    route_edges: list[tuple[dict[str, Any], bool]],
    route_edge_times: list[float],
    route_total_time_min: float,
    route_index: int,
    progress: float,
    edge_loads: dict[str, float],
) -> dict[str, Any]:
    edge_load_rows = []
    for raw in scenario["edges"]:
        if raw.get("incident") and raw["incident"].get("type") == "closure":
            continue
        background_load = float(raw.get("backgroundLoad", 0.0))
        optimizer_load = edge_loads.get(raw["id"], 0.0)
        edge_load_rows.append({
            "edgeId": raw["id"],
            "load": background_load,
            "backgroundLoad": background_load,
            "optimizerLoad": optimizer_load,
            "effectivePlanningLoad": background_load + optimizer_load,
            "congestionMultiplier": congestion_multiplier(background_load, raw["lanes"]),
        })

    raw, reversed_direction = route_edges[route_index]
    source_id, target_id = (raw["to"], raw["from"]) if reversed_direction else (raw["from"], raw["to"])
    nodes = {node["id"]: node for node in scenario["nodes"]}
    source, target = nodes[source_id], nodes[target_id]
    x = source["x"] + (target["x"] - source["x"]) * progress
    y = source["y"] + (target["y"] - source["y"]) * progress
    heading = math.degrees(math.atan2(target["y"] - source["y"], target["x"] - source["x"]))
    return {
        "type": "tick",
        "runId": run_id,
        "algorithm": algorithm,
        "route": route,
        "routeEdgeIds": [raw["id"] for raw, _ in route_edges],
        "routeEdgeTimesMin": route_edge_times,
        "actualRouteTimeMin": route_total_time_min,
        "simTimeSec": sim_time,
        "status": status,
        "ego": {
            "edgeId": raw["id"],
            "forward": not reversed_direction,
            "progressOnEdge": progress,
            "x": x,
            "y": y,
            "headingDeg": heading,
        },
        "edgeLoads": edge_load_rows,
    }


def _route_cursor(
    route_edges: list[tuple[dict[str, Any], bool]], overall_progress: float, edge_times: list[float]
) -> tuple[int, float]:
    """Map normalized traffic-adjusted route progress to the current edge."""
    if not route_edges:
        raise ValueError("Animation route has no edges")
    total_time = sum(edge_times)
    if total_time <= 0:
        raise ValueError("Animation route length must be positive")
    if overall_progress >= 1.0:
        return len(route_edges) - 1, 1.0
    remaining = max(0.0, overall_progress) * total_time
    for index, duration in enumerate(edge_times):
        if remaining < duration or index == len(route_edges) - 1:
            return index, min(1.0, remaining / duration)
        remaining -= duration
    return len(route_edges) - 1, 1.0


@app.websocket("/ws/animation")
async def animate(websocket: WebSocket) -> None:
    await websocket.accept()
    route: list[str] = []
    route_edges: list[tuple[dict[str, Any], bool]] = []
    route_edge_times: list[float] = []
    route_total_time_min = 0.0
    edge_loads: dict[str, float] = {}
    run_id = ""
    algorithm = ""
    overall_progress = 0.0
    sim_time = 0.0
    speed_multiplier = 1.0
    running = False

    async def receive_message() -> dict[str, Any]:
        message = await websocket.receive_json()
        if not isinstance(message, dict) or not isinstance(message.get("type"), str):
            raise ValueError("Animation messages require a type")
        return message

    async def send_tick(status: str) -> None:
        if not route_edges:
            return
        route_index, edge_progress = _route_cursor(route_edges, overall_progress, route_edge_times)
        await websocket.send_json(
            _animation_tick(sim_time, status, run_id, algorithm, route, route_edges, route_edge_times, route_total_time_min, route_index, edge_progress, edge_loads)
        )

    try:
        while True:
            if not running:
                message = await receive_message()
            else:
                try:
                    message = await asyncio.wait_for(receive_message(), timeout=1 / TICK_RATE)
                except asyncio.TimeoutError:
                    tick_seconds = 1 / TICK_RATE
                    overall_progress = min(1.0, overall_progress + tick_seconds / BASE_ROUTE_DURATION_SEC * speed_multiplier)
                    sim_time = overall_progress * route_total_time_min * 60.0
                    if overall_progress >= 1.0:
                        running = False
                        await send_tick("complete")
                        continue
                    await send_tick("running")
                    continue

            kind = message["type"]
            if kind == "start":
                raw_route = message.get("route")
                algorithm = message.get("algorithm")
                run_id = message.get("runId")
                multiplier = message.get("speedMultiplier")
                if (
                    not isinstance(raw_route, list)
                    or not all(isinstance(node_id, str) for node_id in raw_route)
                    or algorithm not in ALGORITHMS
                    or not isinstance(run_id, str)
                    or not run_id
                    or isinstance(multiplier, bool)
                    or not isinstance(multiplier, (int, float))
                    or not math.isfinite(multiplier)
                    or multiplier not in (1.0, 2.0, 4.0)
                ):
                    raise ValueError("Invalid animation start message")
                route = raw_route
                route_edges = _route_edges(route)
                route_edge_times = []
                for raw, _ in route_edges:
                    cost = edge_cost_min(
                        edge_from_dict(raw),
                        float(raw.get("backgroundLoad", 0.0)),
                        scenario["weather"]["type"],
                        float(scenario["weather"]["intensity"]),
                    )
                    if cost is None:
                        raise ValueError("Animation route contains a closed road")
                    route_edge_times.append(float(cost))
                route_total_time_min = sum(route_edge_times)
                overall_progress = 0.0
                sim_time = 0.0
                speed_multiplier = float(multiplier)
                edge_loads = animation_run_cache.get(
                    (algorithm, tuple(route), _scenario_fingerprint()),
                    {edge["id"]: 0.0 for edge in scenario["edges"]},
                )
                running = True
                await send_tick("running")
            elif kind == "pause":
                if running:
                    running = False
                    await send_tick("paused")
            elif kind == "resume":
                if route_edges and overall_progress < 1.0:
                    running = True
                    await send_tick("running")
            elif kind == "setSpeed":
                multiplier = message.get("speedMultiplier")
                if (
                    not route_edges
                    or isinstance(multiplier, bool)
                    or not isinstance(multiplier, (int, float))
                    or not math.isfinite(multiplier)
                    or multiplier not in (1.0, 2.0, 4.0)
                ):
                    raise ValueError("setSpeed requires an active route and a multiplier of 1, 2, or 4")
                speed_multiplier = float(multiplier)
            elif kind == "reset":
                running = False
                route = []
                route_edges = []
                route_edge_times = []
                route_total_time_min = 0.0
                edge_loads = {}
                overall_progress = 0.0
                sim_time = 0.0
            else:
                raise ValueError(f"Unsupported animation message '{kind}'")
    except WebSocketDisconnect:
        return
    except (ValueError, KeyError, TypeError) as exc:
        await websocket.close(code=1008, reason=str(exc))


@app.post("/run")
async def run(request: Request) -> dict[str, Any]:
    payload = await _json_object(request)
    if set(payload) != {"algorithm"} or not isinstance(payload["algorithm"], str):
        raise HTTPException(status_code=400, detail="Run requires one algorithm name")
    algorithm = payload["algorithm"]
    if algorithm not in ALGORITHMS:
        raise HTTPException(status_code=400, detail=f"Algorithm must be one of: {', '.join(ALGORITHMS)}")
    _ensure_runnable()
    return _execute_algorithm(algorithm)


@app.post("/run/compare-all")
def compare_all() -> dict[str, Any]:
    _ensure_runnable()
    return {algorithm: _execute_algorithm(algorithm) for algorithm in ALGORITHMS}


def _ensure_runnable() -> None:
    if not scenario["nodes"] or scenario["egoVehicle"] is None:
        raise HTTPException(status_code=400, detail="Create a network and set an ego route before running algorithms")
    graph = build_graph(scenario)
    origin, destination = scenario["egoVehicle"]["origin"], scenario["egoVehicle"]["destination"]
    if origin not in graph or destination not in graph or not nx.has_path(graph, origin, destination):
        raise HTTPException(status_code=400, detail="No open route — clear or change a closure")


# Locate frontend build directory if present (production / Docker)
_FRONTEND_DIST_CANDIDATES = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend/dist")),
    os.path.abspath(os.path.join(os.getcwd(), "frontend/dist")),
    "/app/frontend/dist",
]
FRONTEND_DIST = next((d for d in _FRONTEND_DIST_CANDIDATES if os.path.isdir(d)), None)

if FRONTEND_DIST:
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    scenarios_dir = os.path.join(FRONTEND_DIST, "scenarios")
    if os.path.isdir(scenarios_dir):
        app.mount("/scenarios", StaticFiles(directory=scenarios_dir), name="scenarios")

    @app.get("/")
    def serve_root() -> Response:
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend build index.html not found")

    @app.get("/{full_path:path}")
    def serve_frontend_spa(full_path: str) -> Response:
        if full_path in ("scenario", "run", "health") or full_path.startswith(("scenario/", "run/", "health/", "ws/")):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend build index.html not found")
