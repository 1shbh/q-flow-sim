"""Shared static-cost candidate-path setup for PSO and QPSO."""

from __future__ import annotations

from typing import Any

import networkx as nx

from .network import build_graph

K = 8


def generate_candidate_paths(
    scenario: dict[str, Any], graph: nx.DiGraph | None = None
) -> list[list[str]]:
    graph = graph or build_graph(scenario)
    origin = scenario["egoVehicle"]["origin"]
    destination = scenario["egoVehicle"]["destination"]
    if origin not in graph or destination not in graph:
        raise ValueError("Ego origin and destination must exist in the network")
    if origin == destination:
        raise ValueError("Ego origin and destination must be different for optimization")

    candidates: list[list[str]] = []
    shortest_cost: float | None = None
    try:
        paths = nx.shortest_simple_paths(graph, origin, destination, weight="weight")
        for path in paths:
            cost = sum(graph[u][v]["weight"] for u, v in zip(path, path[1:]))
            if shortest_cost is None:
                shortest_cost = cost
            elif cost > 2.0 * shortest_cost:
                break
            candidates.append(path)
            if len(candidates) == K:
                break
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        pass

    if not candidates:
        raise ValueError(f"No open path exists from '{origin}' to '{destination}'")
    return candidates
