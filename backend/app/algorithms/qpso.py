"""Quantum-behaved particle swarm optimization with the specified equations."""

from __future__ import annotations

import time
from typing import Any

import networkx as nx
import numpy as np

from .candidate_paths import generate_candidate_paths
from .fitness import evaluate_position
from .network import build_graph

SWARM_SIZE = 30
MAX_ITERATIONS = 60
BETA_START = 1.0
BETA_END = 0.5


def run_qpso(
    scenario: dict[str, Any], rng: np.random.Generator | None = None, *, include_loads: bool = False
) -> dict[str, Any]:
    started_at = time.perf_counter()
    rng = rng or np.random.default_rng()
    graph = build_graph(scenario)
    candidates = generate_candidate_paths(scenario, graph)
    dimensions = len(candidates) + 1
    positions = rng.uniform(0.0, 1.0, size=(SWARM_SIZE, dimensions))
    personal_positions = positions.copy()
    personal_fitness = np.array([
        evaluate_position(position, candidates, graph, scenario)["fitness"]
        for position in positions
    ])
    best_index = int(np.argmin(personal_fitness))
    best_position = personal_positions[best_index].copy()
    best_fitness = float(personal_fitness[best_index])
    convergence_curve = [{"iteration": 0, "bestFitness": best_fitness}]
    no_improvement = 0
    iterations = 0

    for iteration in range(1, MAX_ITERATIONS + 1):
        beta = BETA_START - (BETA_START - BETA_END) * (iteration / MAX_ITERATIONS)
        mbest = np.mean(personal_positions, axis=0)
        iteration_best_position = best_position.copy()
        iteration_best_fitness = best_fitness
        for particle in range(SWARM_SIZE):
            phi = rng.uniform(0.0, 1.0, size=dimensions)
            local_attractor = (
                phi * personal_positions[particle]
                + (1.0 - phi) * best_position
            )
            u = rng.uniform(0.0, 1.0, size=dimensions)
            while np.any(u == 0.0):
                zero_indices = np.where(u == 0.0)[0]
                u[zero_indices] = rng.uniform(0.0, 1.0, size=len(zero_indices))
            sign = np.where(rng.uniform(0.0, 1.0, size=dimensions) > 0.5, 1.0, -1.0)
            positions[particle] = np.clip(
                local_attractor
                + sign * beta * np.abs(mbest - positions[particle]) * np.log(1.0 / u),
                0.0,
                1.0,
            )
            fitness = evaluate_position(positions[particle], candidates, graph, scenario)["fitness"]
            if fitness < personal_fitness[particle]:
                personal_fitness[particle] = fitness
                personal_positions[particle] = positions[particle].copy()
                if fitness < iteration_best_fitness:
                    iteration_best_fitness = float(fitness)
                    iteration_best_position = positions[particle].copy()

        if iteration_best_fitness < best_fitness:
            best_fitness = iteration_best_fitness
            best_position = iteration_best_position
            no_improvement = 0
        else:
            no_improvement += 1
        iterations = iteration
        convergence_curve.append({"iteration": iteration, "bestFitness": best_fitness})
        if no_improvement >= 10:
            break

    result = evaluate_position(best_position, candidates, graph, scenario)
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    response = {
        "algorithm": "qpso",
        "route": result["route"],
        "time": result["time"],
        "distance": result["distance"],
        "objective_score": result["objective_score"],
        "congestion": result["congestion"],
        "iterations": iterations,
        "optimization_time_ms": elapsed_ms,
        "convergence_curve": convergence_curve,
    }
    if include_loads:
        response["_edge_loads"] = result["edge_loads"]
    return response
