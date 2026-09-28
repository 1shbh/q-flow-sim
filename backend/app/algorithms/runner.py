"""Dispatch the four Phase 4 algorithms against the current scenario."""

from __future__ import annotations

from typing import Any

from .dijkstra_astar import run_astar, run_dijkstra
from .pso import run_pso
from .qpso import run_qpso

ALGORITHMS = ("dijkstra", "astar", "pso", "qpso")


def run_algorithm(
    algorithm: str, scenario: dict[str, Any], *, include_loads: bool = False
) -> dict[str, Any]:
    runners = {
        "dijkstra": run_dijkstra,
        "astar": run_astar,
        "pso": lambda value: run_pso(value, include_loads=include_loads),
        "qpso": lambda value: run_qpso(value, include_loads=include_loads),
    }
    try:
        runner = runners[algorithm]
    except KeyError as exc:
        raise ValueError(f"Unsupported algorithm '{algorithm}'") from exc
    return runner(scenario)
