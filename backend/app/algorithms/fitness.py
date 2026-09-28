"""Fitness calculation shared by the hand-written PSO and QPSO solvers."""

from __future__ import annotations

from typing import Any

import numpy as np
import networkx as nx

from ..graph_model import Edge, congestion_multiplier, edge_cost_min
from .network import edge_by_id, edge_from_dict, edge_ids_for_path


def softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exponentials = np.exp(shifted)
    return exponentials / np.sum(exponentials)


def evaluate_position(
    position: np.ndarray,
    candidates: list[list[str]],
    graph: nx.DiGraph,
    scenario: dict[str, Any],
) -> dict[str, Any]:
    candidate_count = len(candidates)
    weights = softmax(position[:candidate_count])
    vehicle_counts = scenario["vehicles"]
    total_load = (
        2 * vehicle_counts["trucks"]
        + 2 * vehicle_counts["buses"]
        + vehicle_counts["cars"]
    )

    loads: dict[str, float] = {}
    path_edge_ids = [edge_ids_for_path(graph, path) for path in candidates]
    for candidate_index, edge_ids in enumerate(path_edge_ids):
        if not edge_ids:
            raise ValueError("Candidate routes must contain at least one road")
        per_edge_load = float(weights[candidate_index]) * total_load / len(edge_ids)
        for edge_id in edge_ids:
            loads[edge_id] = loads.get(edge_id, 0.0) + per_edge_load

    raw_edges = edge_by_id(scenario)
    typed_edges: dict[str, Edge] = {edge_id: edge_from_dict(raw) for edge_id, raw in raw_edges.items()}
    weather = scenario["weather"]
    costs: dict[str, float] = {}
    congestion: dict[str, float] = {}
    effective_loads: dict[str, float] = {}
    for edge_id, load in loads.items():
        edge = typed_edges[edge_id]
        effective_load = load + edge.backgroundLoad
        effective_loads[edge_id] = effective_load
        if effective_load <= 0:
            continue
        cost = edge_cost_min(edge, effective_load, weather["type"], float(weather["intensity"]))
        if cost is None:
            raise ValueError("Candidate paths cannot include closed roads")
        costs[edge_id] = cost
        congestion[edge_id] = congestion_multiplier(effective_load, edge.lanes)

    path_index = round(float(position[candidate_count]) * (candidate_count - 1))
    ego_path = candidates[path_index]
    ego_edge_ids = edge_ids_for_path(graph, ego_path)
    time_min = 0.0
    distance_km = 0.0
    for edge_id in ego_edge_ids:
        edge = typed_edges[edge_id]
        if edge_id not in costs:
            cost = edge_cost_min(edge, edge.backgroundLoad, weather["type"], float(weather["intensity"]))
            if cost is None:
                raise ValueError("Ego route cannot include a closed road")
            time_min += cost
        else:
            time_min += costs[edge_id]
        distance_km += edge.lengthM / 1000.0

    # With no background vehicles, use the specified load-zero free-flow value.
    mean_congestion = float(np.mean(list(congestion.values()))) if congestion else 1.0
    objective = scenario["weights"]
    objective_score = (
        objective["wT"] * time_min
        + objective["wD"] * distance_km
        + objective["wC"] * mean_congestion
    )
    return {
        "fitness": float(objective_score),
        "route": ego_path,
        "time": float(time_min),
        "distance": float(distance_km),
        "objective_score": float(objective_score),
        "congestion": float(mean_congestion),
        "edge_loads": loads,
        "effective_edge_loads": effective_loads,
    }
