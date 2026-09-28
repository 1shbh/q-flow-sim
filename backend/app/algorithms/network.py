"""NetworkX graph construction shared by routing algorithms."""

from __future__ import annotations

from typing import Any

import networkx as nx

from ..graph_model import Edge, edge_cost_min, incident_multiplier, weather_multiplier


def edge_from_dict(data: dict[str, Any]) -> Edge:
    return Edge(
        id=data["id"],
        from_node=data["from"],
        to=data["to"],
        lengthM=float(data["lengthM"]),
        lanes=int(data["lanes"]),
        laneWidthM=float(data["laneWidthM"]),
        speedLimitKph=float(data["speedLimitKph"]),
        oneWay=bool(data["oneWay"]),
        incident=data.get("incident"),
        backgroundLoad=float(data.get("backgroundLoad", 0.0)),
    )


def build_graph(scenario: dict[str, Any]) -> nx.DiGraph:
    """Build a directed graph; ordinary roads get an arc in both directions."""
    graph = nx.DiGraph()
    for node in scenario["nodes"]:
        graph.add_node(node["id"], x=float(node["x"]), y=float(node["y"]))

    weather = scenario["weather"]
    for raw_edge in scenario["edges"]:
        edge = edge_from_dict(raw_edge)
        cost = edge_cost_min(edge, 0, weather["type"], float(weather["intensity"]))
        if cost is None:
            continue
        arc = {"weight": cost, "edge_id": edge.id}
        graph.add_edge(edge.from_node, edge.to, **arc)
        if not edge.oneWay:
            graph.add_edge(edge.to, edge.from_node, **arc)
    return graph


def edge_by_id(scenario: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {edge["id"]: edge for edge in scenario["edges"]}


def edge_ids_for_path(graph: nx.DiGraph, path: list[str]) -> list[str]:
    return [graph[source][target]["edge_id"] for source, target in zip(path, path[1:])]


def route_distances(
    scenario: dict[str, Any], graph: nx.DiGraph, path: list[str]
) -> tuple[float, float]:
    """Return free-flow travel minutes and route kilometres for a path."""
    edges = edge_by_id(scenario)
    time_min = sum(graph[u][v]["weight"] for u, v in zip(path, path[1:]))
    distance_km = sum(edges[edge_id]["lengthM"] for edge_id in edge_ids_for_path(graph, path)) / 1000.0
    return time_min, distance_km


def route_time_min(
    scenario: dict[str, Any], graph: nx.DiGraph, path: list[str], *, include_background: bool
) -> float:
    edges = edge_by_id(scenario)
    weather = scenario["weather"]
    total = 0.0
    for edge_id in edge_ids_for_path(graph, path):
        edge = edge_from_dict(edges[edge_id])
        load = edge.backgroundLoad if include_background else 0.0
        cost = edge_cost_min(edge, load, weather["type"], float(weather["intensity"]))
        if cost is None:
            raise ValueError(f"Route contains closed road '{edge_id}'")
        total += cost
    return total


def astar_heuristic(graph: nx.DiGraph, scenario: dict[str, Any]):
    maximum_speed = max(float(edge["speedLimitKph"]) for edge in scenario["edges"])
    weather = scenario["weather"]
    base_multiplier = weather_multiplier(weather["type"], float(weather["intensity"]))
    multipliers = [
        base_multiplier * (incident_multiplier(edge.get("incident")) or 1.0)
        for edge in scenario["edges"]
        if not edge.get("incident") or edge["incident"].get("type") != "closure"
    ]
    # Slowdown factors below 1 are accepted by the incident contract, so the
    # geometric time lower bound must include the smallest legal edge modifier.
    minimum_multiplier = min(multipliers, default=base_multiplier)

    def estimate(node: str, destination: str) -> float:
        dx = graph.nodes[node]["x"] - graph.nodes[destination]["x"]
        dy = graph.nodes[node]["y"] - graph.nodes[destination]["y"]
        # §7 defines 2.5 metres per coordinate pixel; convert metres to km and minutes.
        straight_line_m = (dx * dx + dy * dy) ** 0.5 * 2.5
        return (straight_line_m / 1000.0) / maximum_speed * 60.0 * minimum_multiplier

    return estimate
