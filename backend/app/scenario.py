"""In-memory scenario model and the exact Phase 1 default-network generator."""

from __future__ import annotations

import math
import random
from collections import deque
from typing import Any

from .graph_model import Edge, Graph, Node


def empty_scenario() -> dict[str, Any]:
    """Return the clean startup scenario; the network generator is user-triggered."""
    return {
        "nodes": [],
        "edges": [],
        "vehicles": {"cars": 0, "trucks": 0, "buses": 0},
        "egoVehicle": None,
        "weather": {"type": "clear", "intensity": 0},
        "weights": {"wT": 1.0, "wD": 1.0, "wC": 1.0},
    }


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _reachable(graph: Graph, origin: str, destination: str) -> bool:
    pending = deque([origin])
    visited = {origin}
    while pending:
        current = pending.popleft()
        if current == destination:
            return True
        for edge in graph.edges.values():
            if edge.from_node == current and edge.to not in visited:
                visited.add(edge.to)
                pending.append(edge.to)
            if not edge.oneWay and edge.to == current and edge.from_node not in visited:
                visited.add(edge.from_node)
                pending.append(edge.from_node)
    return False


def generate_default_scenario(rng: random.Random | None = None) -> dict[str, Any]:
    rng = rng or random.Random()
    node_count = rng.randint(10, 20)
    cols = math.ceil(math.sqrt(node_count))
    rows = math.ceil(node_count / cols)
    nodes: list[Node] = []
    for index in range(node_count):
        row, col = divmod(index, cols)
        x = col * 140 + rng.uniform(-25, 25)
        y = row * 140 + rng.uniform(-25, 25)
        signal = rng.random() < 0.30
        nodes.append(Node(f"N{index + 1}", x, y, signal, 0.5))

    graph = Graph()
    for node in nodes:
        graph.add_node(node)

    # Randomized incremental tree: each new node joins an already connected set.
    order = list(nodes)
    rng.shuffle(order)
    connected = [order[0]]
    pairs: list[tuple[Node, Node]] = []
    connected_pairs: set[frozenset[str]] = set()
    for node in order[1:]:
        parent = rng.choice(connected)
        pair = frozenset((node.id, parent.id))
        connected_pairs.add(pair)
        pairs.append((parent, node))
        connected.append(node)

    # Prefer pairs that occur in at least one node's nearest-four list.
    nearest_pairs: set[frozenset[str]] = set()
    for node in nodes:
        neighbors = sorted(
            (other for other in nodes if other.id != node.id),
            key=lambda other: _dist((node.x, node.y), (other.x, other.y)),
        )[:4]
        nearest_pairs.update(frozenset((node.id, other.id)) for other in neighbors)
    extras_needed = max(0, round(node_count * 1.3) - len(pairs))
    preferred = [
        (a, b)
        for a, b in (
            (nodes[i], nodes[j])
            for i in range(node_count)
            for j in range(i + 1, node_count)
        )
        if frozenset((a.id, b.id)) in nearest_pairs
        and frozenset((a.id, b.id)) not in connected_pairs
    ]
    rng.shuffle(preferred)
    all_remaining = [
        (nodes[i], nodes[j])
        for i in range(node_count)
        for j in range(i + 1, node_count)
        if frozenset((nodes[i].id, nodes[j].id)) not in connected_pairs
        and (nodes[i], nodes[j]) not in preferred
    ]
    rng.shuffle(all_remaining)
    for a, b in (preferred + all_remaining)[:extras_needed]:
        connected_pairs.add(frozenset((a.id, b.id)))
        pairs.append((a, b))

    for index, (a, b) in enumerate(pairs, start=1):
        distance = _dist((a.x, a.y), (b.x, b.y))
        edge = Edge(
            id=f"E{index}",
            from_node=a.id,
            to=b.id,
            lengthM=distance * 2.5,
            lanes=rng.choice([1, 1, 2, 2, 3]),
            laneWidthM=3.5,
            speedLimitKph=rng.choice([30, 40, 50, 50, 60]),
            oneWay=rng.random() < 0.10,
            incident=None,
        )
        graph.add_edge(edge)

    vehicles = {
        "cars": rng.randint(20, 60),
        "trucks": rng.randint(2, 10),
        "buses": rng.randint(0, 4),
    }
    origin: Node | None = None
    destination: Node | None = None
    for _ in range(20):
        candidate_origin, candidate_destination = rng.sample(nodes, 2)
        if _reachable(graph, candidate_origin.id, candidate_destination.id):
            origin, destination = candidate_origin, candidate_destination
            break
    if origin is None or destination is None:
        # Farthest ordered pair with a directed route, including one-way rules.
        reachable_pairs = [
            (a, b)
            for a in nodes
            for b in nodes
            if a.id != b.id and _reachable(graph, a.id, b.id)
        ]
        origin, destination = max(
            reachable_pairs,
            key=lambda pair: _dist((pair[0].x, pair[0].y), (pair[1].x, pair[1].y)),
        )

    return {
        "nodes": [node.to_dict() for node in nodes],
        "edges": [edge.to_dict() for edge in graph.edges.values()],
        "vehicles": vehicles,
        "egoVehicle": {"origin": origin.id, "destination": destination.id},
        "weather": {"type": "clear", "intensity": 0},
        "weights": {"wT": 1.0, "wD": 1.0, "wC": 1.0},
    }
