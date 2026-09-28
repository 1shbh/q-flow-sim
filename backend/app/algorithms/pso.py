"""Classical particle swarm optimization with the specified hyperparameters."""

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
INERTIA = 0.7
COGNITIVE = 1.5
SOCIAL = 1.5
VELOCITY_MIN = -0.5
VELOCITY_MAX = 0.5


def run_pso(
    scenario: dict[str, Any], rng: np.random.Generator | None = None, *, include_loads: bool = False
) -> dict[str, Any]:
    started_at = time.perf_counter()
    rng = rng or np.random.default_rng()
    graph = build_graph(scenario)
    candidates = generate_candidate_paths(scenario, graph)
    dimensions = len(candidates) + 1
    positions = rng.uniform(0.0, 1.0, size=(SWARM_SIZE, dimensions))
    velocities = np.zeros((SWARM_SIZE, dimensions), dtype=float)
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
        iteration_best_position = best_position.copy()
        iteration_best_fitness = best_fitness
        for particle in range(SWARM_SIZE):
            r1 = rng.uniform(0.0, 1.0, size=dimensions)
            r2 = rng.uniform(0.0, 1.0, size=dimensions)
            velocities[particle] = (
                INERTIA * velocities[particle]
                + COGNITIVE * r1 * (personal_positions[particle] - positions[particle])
                + SOCIAL * r2 * (best_position - positions[particle])
            )
            velocities[particle] = np.clip(velocities[particle], VELOCITY_MIN, VELOCITY_MAX)
            positions[particle] = np.clip(positions[particle] + velocities[particle], 0.0, 1.0)
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
        "algorithm": "pso",
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
