"""Core road-network data model and the Phase 1 edge-cost primitives."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


CAPACITY_PER_LANE = 15


@dataclass
class Node:
    id: str
    x: float
    y: float
    signal: bool
    greenSplit: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "signal": self.signal,
            "greenSplit": self.greenSplit,
        }


@dataclass
class Edge:
    id: str
    from_node: str
    to: str
    lengthM: float
    lanes: int
    laneWidthM: float
    speedLimitKph: float
    oneWay: bool
    incident: dict[str, Any] | None = None
    backgroundLoad: float = 0.0

    @property
    def from_(self) -> str:
        """Return the source node id (``from`` is a Python keyword)."""
        return self.from_node

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "from": self.from_node,
            "to": self.to,
            "lengthM": self.lengthM,
            "lanes": self.lanes,
            "laneWidthM": self.laneWidthM,
            "speedLimitKph": self.speedLimitKph,
            "oneWay": self.oneWay,
            "incident": self.incident,
            "backgroundLoad": self.backgroundLoad,
        }


@dataclass
class Graph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: dict[str, Edge] = field(default_factory=dict)

    def add_node(self, node: Node) -> None:
        self.nodes[node.id] = node

    def add_edge(self, edge: Edge) -> None:
        if edge.from_node not in self.nodes or edge.to not in self.nodes:
            raise ValueError("edge endpoints must exist in the graph")
        self.edges[edge.id] = edge


def base_time_min(lengthM: float, speedLimitKph: float) -> float:
    return (lengthM / 1000.0) / speedLimitKph * 60.0


def capacity(lanes: int) -> int:
    return lanes * CAPACITY_PER_LANE


def load_ratio(load: float, lanes: int) -> float:
    return load / capacity(lanes)


def congestion_multiplier(load: float, lanes: int) -> float:
    return min(1.0 + 3.0 * load_ratio(load, lanes) ** 2, 6.0)


def weather_multiplier(weather_type: str, intensity: float) -> float:
    if weather_type == "clear":
        return 1.0
    if weather_type == "rain":
        return 1.0 + 0.5 * intensity
    if weather_type == "fog":
        return 1.0 + 0.8 * intensity
    raise ValueError(f"unsupported weather type: {weather_type}")


def incident_multiplier(incident: dict[str, Any] | None) -> float | None:
    """Return None for a closure, which callers must exclude from pathfinding."""
    if incident is None:
        return 1.0
    if incident.get("type") == "closure":
        return None
    if incident.get("type") == "slowdown":
        return float(incident.get("factor", 3.0))
    raise ValueError("incident must be null, closure, or slowdown")


def edge_cost_min(
    edge: Edge,
    load: float,
    weather_type: str,
    weather_intensity: float,
) -> float | None:
    incident_factor = incident_multiplier(edge.incident)
    if incident_factor is None:
        return None
    return (
        base_time_min(edge.lengthM, edge.speedLimitKph)
        * congestion_multiplier(load, edge.lanes)
        * weather_multiplier(weather_type, weather_intensity)
        * incident_factor
    )
