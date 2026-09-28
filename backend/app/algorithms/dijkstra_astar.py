"""NetworkX Dijkstra and A* implementations using static load-zero costs."""

from __future__ import annotations

import time
from typing import Any

import networkx as nx

from .network import astar_heuristic, build_graph, route_distances


def _static_result(
    algorithm: str,
    scenario: dict[str, Any],
    graph: nx.DiGraph,
    route: list[str],
    started_at: float,
) -> dict[str, Any]:
    time_min, distance_km = route_distances(scenario, graph, route)
    weights = scenario["weights"]
    objective_score = weights["wT"] * time_min + weights["wD"] * distance_km + weights["wC"] * 1.0
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    return {
        "algorithm": algorithm,
        "route": route,
        "time": float(time_min),
        "distance": float(distance_km),
        "objective_score": float(objective_score),
        "congestion": 1.0,
        "iterations": 1,
        "optimization_time_ms": elapsed_ms,
        "convergence_curve": [{"iteration": 0, "bestFitness": float(objective_score)}],
    }


def run_dijkstra(scenario: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    graph = build_graph(scenario)
    origin = scenario["egoVehicle"]["origin"]
    destination = scenario["egoVehicle"]["destination"]
    route = nx.dijkstra_path(graph, origin, destination, weight="weight")
    return _static_result("dijkstra", scenario, graph, route, started_at)


def run_astar(scenario: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    graph = build_graph(scenario)
    origin = scenario["egoVehicle"]["origin"]
    destination = scenario["egoVehicle"]["destination"]
    route = nx.astar_path(
        graph,
        origin,
        destination,
        heuristic=astar_heuristic(graph, scenario),
        weight="weight",
    )
    return _static_result("astar", scenario, graph, route, started_at)
