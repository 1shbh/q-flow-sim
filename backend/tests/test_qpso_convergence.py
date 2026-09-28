import numpy as np

from app.algorithms.candidate_paths import generate_candidate_paths
from app.algorithms.network import build_graph
from app.algorithms.qpso import run_qpso


def _two_route_scenario():
    nodes = [
        {"id": "N1", "x": 0, "y": 0, "signal": False, "greenSplit": 0.5},
        {"id": "N2", "x": 1, "y": 0, "signal": False, "greenSplit": 0.5},
        {"id": "N3", "x": 0, "y": 1, "signal": False, "greenSplit": 0.5},
        {"id": "N4", "x": 1, "y": 1, "signal": False, "greenSplit": 0.5},
        {"id": "N5", "x": 2, "y": 1, "signal": False, "greenSplit": 0.5},
    ]
    pairs = [("N1", "N2"), ("N2", "N4"), ("N1", "N3"), ("N3", "N4"), ("N4", "N5")]
    edges = [
        {
            "id": f"E{index}",
            "from": source,
            "to": target,
            "lengthM": 1,
            "lanes": 1,
            "laneWidthM": 3.5,
            "speedLimitKph": 60,
            "oneWay": True,
            "incident": None,
        }
        for index, (source, target) in enumerate(pairs, start=1)
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "vehicles": {"cars": 30, "trucks": 0, "buses": 0},
        "egoVehicle": {"origin": "N1", "destination": "N5"},
        "weather": {"type": "clear", "intensity": 0},
        "weights": {"wT": 1.0, "wD": 1.0, "wC": 1.0},
    }


def test_qpso_converges_on_clear_two_path_load_split():
    scenario = _two_route_scenario()
    graph = build_graph(scenario)
    candidates = generate_candidate_paths(scenario, graph)
    assert len(scenario["nodes"]) == 5
    assert len(candidates) == 2

    # At an equal split, each unique road has load 5 and the shared road has load 10.
    # This gives T=0.005 minutes, D=0.003 km, and C=23/15 by §5.1–§5.2.
    known_optimal_j = 0.005 + 0.003 + 23 / 15
    result = run_qpso(scenario, rng=np.random.default_rng(7))

    assert result["iterations"] <= 60
    assert abs(result["objective_score"] - known_optimal_j) <= known_optimal_j * 0.05
