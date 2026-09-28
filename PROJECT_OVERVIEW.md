# Q-Flow Sim — Technical Project Overview

## 1. Project Purpose & Scope

**Q-Flow Sim** is an interactive, browser-based traffic control-room simulator and routing optimization benchmark. The platform models physical road geometry, dynamic traffic congestion, environmental disruptions, and signal controls, while pitting classical shortest-path algorithms against swarm intelligence metaheuristics:
- **Classical Shortest-Path Baselines:** Dijkstra and A\*
- **Metaheuristic Optimizers:** Classical Particle Swarm Optimization (PSO) and Quantum-Behaved Particle Swarm Optimization (QPSO)

The project is designed to run entirely locally with zero external database or cloud dependencies.

---

## 2. System Architecture & Component Responsibilities

The system adopts a decoupled client-server architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                    REACT FRONTEND (Vite)                     │
│  ┌────────────────────┬───────────────────┬───────────────┐  │
│  │    BUILD PANEL     │   KONVA CANVAS    │ OPERATE PANEL │  │
│  │ - Road Inspector   │ - Lane Geometry   │ - Conditions  │  │
│  │ - Vehicle Counts   │ - Sprites & Flow  │ - Benchmark   │  │
│  │ - Ego Origin/Dest  │ - Traffic Signals │ - Convergence │  │
│  └────────────────────┴───────────────────┴───────────────┘  │
│          ▲ REST (Scenario CRUD / Run)     ▲ WebSocket (10 Hz) │
└──────────┼────────────────────────────────┼───────────────────┘
           ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND (Python)                  │
│  ┌───────────────────────┬────────────────────────────────┐  │
│  │   GRAPH & COST MODEL  │      ROUTING ALGORITHMS        │  │
│  │ - Node & Edge Schema  │ - Dijkstra & A* (Static Load 0)│  │
│  │ - Congestion & Weather│ - Candidate Paths (K=8)        │  │
│  │ - Incident Filtering  │ - Hand-written PSO & QPSO      │  │
│  ├───────────────────────┴────────────────────────────────┤  │
│  │  WebSocket Animation Loop (/ws/animation @ 10 Hz)      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Frontend Responsibilities (`frontend/src/`)
- **Canvas Rendering (`NetworkCanvas.tsx`, `VehicleLayer.tsx`):** Renders road polygons scaled to physical lane width, dashed yellow centerlines, one-way directional chevrons, signal dots (flipping on a 20-second cycle), and moving vehicle sprites with lane offsets.
- **Client State (`store.ts`):** Centralized Zustand store holding the scenario, active selections, animation ticks, and UI panel dimensions.
- **Dynamic Interaction (`ControlPanel.tsx`, `ConditionPanel.tsx`, `VehiclePanel.tsx`):** Live editing of nodes, roads, traffic composition, weather (rain streak animation, fog opacity), and road incidents.
- **Benchmark & Analytics (`BenchmarkDashboard.tsx`, `ConvergenceChart.tsx`):** Side-by-side performance metrics comparison and interactive Recharts iteration convergence curves.

### Backend Responsibilities (`backend/app/`)
- **Graph & State Management (`main.py`, `graph_model.py`, `scenario.py`):** In-memory storage and validation of the road network graph.
- **Cost Calculation Primitives (`graph_model.py`, `network.py`):** Deterministic evaluation of free-flow times, congestion multipliers, weather penalties, and incident exclusions.
- **Routing Engine (`algorithms/`):** NetworkX pathfinding (Dijkstra, A\*, $K$-shortest paths) and NumPy vectorized swarm solvers (PSO, QPSO, fitness evaluation).
- **Animation Tick Streamer (`main.py:/ws/animation`):** Asynchronous WebSocket service streaming interpolated vehicle coordinates, headings, and road congestion levels at 10 ticks per second.

---

## 3. Scenario & Network Representation

The scenario is stored in memory as a JSON document:

```json
{
  "nodes": [
    { "id": "N1", "x": 120.0, "y": 80.0, "signal": true, "greenSplit": 0.5 }
  ],
  "edges": [
    {
      "id": "E1",
      "from": "N1",
      "to": "N2",
      "lengthM": 500.0,
      "lanes": 2,
      "laneWidthM": 3.5,
      "speedLimitKph": 50.0,
      "oneWay": false,
      "incident": null,
      "backgroundLoad": 0.0
    }
  ],
  "vehicles": { "cars": 40, "trucks": 6, "buses": 2 },
  "egoVehicle": { "origin": "N1", "destination": "N2" },
  "weather": { "type": "rain", "intensity": 0.6 },
  "weights": { "wT": 1.0, "wD": 1.0, "wC": 1.0 }
}
```

### Directed Graph Construction (`backend/app/algorithms/network.py:build_graph`)
- For every node, `graph.add_node(id, x=x, y=y)`.
- For each edge:
  - If `incident.type == "closure"`, the road is **omitted from the graph entirely**.
  - A directed arc $(u \to v)$ is added with `weight = edge_cost_min(edge, load=0, weather, intensity)`.
  - If `oneWay == false`, an opposing directed arc $(v \to u)$ is added with the identical static weight and road ID reference.

---

## 4. Traffic & Congestion Model

### Vehicle Equivalents (`backend/app/algorithms/fitness.py:29-33`)
Different vehicle types occupy different road capacities. The simulator converts raw vehicle counts into standard vehicle-equivalents:
$$\text{Total Load} = 1 \times \text{cars} + 2 \times \text{trucks} + 2 \times \text{buses}$$

### Per-Road Background Traffic vs. Baseline Fallback
1. **Configured Per-Road Traffic:** When an edge has an explicit `backgroundLoad > 0`, that exact vehicle-equivalent value is placed on that road.
2. **Baseline Uniform Fallback (`frontend/src/traffic.ts:32-44`):** If no edge has configured background traffic, the total vehicle equivalents are distributed uniformly across all open roads using round-half-to-even rounding:
   $$\text{baseline\_load} = \text{round}\left(\frac{\text{Total Load}}{|E_{\text{open}}|}\right)$$
   This ensures that pre-run canvas glows and background vehicle sprites display representative traffic before any algorithm run has executed.

### Road Capacity & Congestion Multiplier (`backend/app/graph_model.py:81-90`)
- **Capacity:** Each lane provides capacity for 15 vehicle-equivalents:
  $$\text{Capacity}(\text{lanes}) = \text{lanes} \times 15$$
- **Load Ratio:**
  $$\text{Load Ratio} = \frac{\text{load}}{\text{Capacity}}$$
- **Congestion Multiplier:** Based on a quadratic Bureau of Public Roads (BPR) curve, capped at $6.0\times$:
  $$\text{Congestion Multiplier}(\text{load}, \text{lanes}) = \min\left(1.0 + 3.0 \times \left(\frac{\text{load}}{\text{Capacity}}\right)^2, \; 6.0\right)$$

### Congestion Visual Buckets
- **Free-Flowing:** $\text{Multiplier} < 1.3$ (`--flow-free`, green `#3DDC84`)
- **Moderate:** $1.3 \le \text{Multiplier} < 2.5$ (`--flow-moderate`, amber `#F2B84B`)
- **Congested:** $\text{Multiplier} \ge 2.5$ (`--flow-congested`, red `#F0523C`)

---

## 5. Travel-Time Calculation & Environmental Effects

Traversing an edge requires an elapsed time in minutes (`backend/app/graph_model.py:114-128`):

### Base Free-Flow Time
$$\text{Base Time (min)} = \frac{L / 1000.0}{v_{\max}} \times 60.0$$
where $L$ is road length in meters (`lengthM`) and $v_{\max}$ is speed limit in km/h (`speedLimitKph`).

### Environmental Multipliers
- **Weather Multiplier (`weather_multiplier`):**
  - **Clear:** $1.0$ (intensity ignored)
  - **Rain:** $1.0 + 0.5 \times \text{intensity}$
  - **Fog:** $1.0 + 0.8 \times \text{intensity}$
- **Incident Multiplier (`incident_multiplier`):**
  - **No Incident (`None`):** $1.0$
  - **Slowdown:** `factor` (default $3.0$)
  - **Closure:** Returns `None`; road is excluded from graph search.

### Total Edge Cost
$$\text{Edge Cost (min)} = \text{Base Time} \times \text{Congestion Multiplier} \times \text{Weather Multiplier} \times \text{Incident Multiplier}$$

---

## 6. Objective & Fitness Function ($J$)

All algorithms optimize or evaluate routes against the prototype objective function (`backend/app/algorithms/fitness.py:80-85`):
$$J = w_T \cdot T + w_D \cdot D + w_C \cdot C$$

- **$T$ (Ego Travel Time):** Sum of `edge_cost_min` for each edge in the ego vehicle's chosen route under evaluated traffic loads (in minutes).
- **$D$ (Ego Physical Distance):** Total route length in kilometers:
  $$D = \frac{\sum_{e \in \text{route}} L_e}{1000.0}$$
- **$C$ (Network Congestion):** Arithmetic mean of `congestion_multiplier` across every edge that received traffic load in the current run:
  $$C = \frac{1}{|E_{\text{loaded}}|} \sum_{e \in E_{\text{loaded}}} \text{Congestion Multiplier}_e$$
  If no roads carry load (e.g. Dijkstra/A\* load-zero runs), $C = 1.0$.
- **Weights:** User-adjustable via `scenario.weights` ($w_T, w_D, w_C$), defaulting to $1.0$. Lower $J$ indicates a superior route.

---

## 7. Shortest-Path Algorithms: Dijkstra & A\*

### Dijkstra (`backend/app/algorithms/dijkstra_astar.py:run_dijkstra`)
- Runs `nx.dijkstra_path(graph, origin, destination, weight="weight")`.
- Operates on the static directed graph where edge weights are computed with $\text{load} = 0$.
- Because Dijkstra ignores vehicle loads, it selects the route with the shortest free-flow time + weather/incident penalty, regardless of congestion traps.

### A\* (`backend/app/algorithms/dijkstra_astar.py:run_astar`)
- Runs `nx.astar_path` using an admissible Euclidean heuristic (`backend/app/algorithms/network.py:astar_heuristic`).
- **Heuristic Function:**
  $$h(u, \text{dest}) = \frac{\sqrt{(x_u - x_{\text{dest}})^2 + (y_u - y_{\text{dest}})^2} \times 2.5 / 1000.0}{\max(v_{\max})} \times 60.0 \times \min(\text{multipliers})$$
- **Admissibility Guarantee:**
  - Coordinates use a conversion factor of $2.5$ meters per coordinate pixel.
  - Divided by the maximum speed limit across all edges in the scenario ($\max(v_{\max})$).
  - Scaled by the lowest possible weather $\times$ non-closure incident multiplier.
  - Because straight-line Euclidean distance at the maximum possible speed under the lowest possible multiplier can never exceed actual road travel time, the heuristic is strictly admissible ($h(u) \le h^*(u)$).

---

## 8. Candidate Path Generation (PSO & QPSO)

Before running swarm optimizers, candidate paths are precomputed (`backend/app/algorithms/candidate_paths.py`):
1. **Extraction:** $K$ shortest paths are extracted via `nx.shortest_simple_paths` on the static load-zero graph, with hard ceiling $K = 8$.
2. **Early Pruning:** Any path whose static cost exceeds $2.0 \times$ the cost of the shortest candidate path is excluded.
3. If fewer than 8 paths exist (small or sparse topologies), all available paths are used. If only 1 path exists, the swarm collapses to that single path without error.

---

## 9. Swarm Encoding & Optimization Mechanics

Both Classical PSO and Quantum-Behaved PSO share identical particle representation and fitness evaluations (`backend/app/algorithms/fitness.py`).

### Particle Representation
Each particle is a continuous vector of length $K + 1$ with values in $[0.0, 1.0]$:
- **Dimensions $0 \dots K-1$ (Traffic Distribution):** Softmax-normalized to determine what fraction of global vehicle equivalents is assigned to each candidate route:
  $$\text{weights} = \text{softmax}(x[0 \dots K-1]), \quad \text{softmax}(z_i) = \frac{e^{z_i - \max(z)}}{\sum e^{z_j - \max(z)}}$$
- **Dimension $K$ (Ego Route Selection):** Mapped to an integer path index via rounding:
  $$\text{ego\_index} = \text{round}(x[K] \times (K - 1))$$
  $$\text{ego\_route} = \text{candidates}[\text{ego\_index}]$$

### How Optimizer Traffic Is Applied
1. For candidate path $k$ with edge set $E_k$, the assigned traffic load per edge is:
   $$\text{assigned\_load}_{e, k} = \frac{\text{weights}[k] \times \text{Total Load}}{|E_k|}$$
2. Roads shared by multiple candidate paths accumulate load:
   $$\text{optimizer\_load}_e = \sum_{k: e \in E_k} \text{assigned\_load}_{e, k}$$
3. Effective planning load combines optimizer assignments with existing background load:
   $$\text{effective\_load}_e = \text{optimizer\_load}_e + \text{backgroundLoad}_e$$
4. Edge travel times and congestion multipliers are evaluated using `effective_load`.

---

## 10. Classical PSO vs. Quantum-Behaved PSO (QPSO)

### Classical PSO (`backend/app/algorithms/pso.py`)
- **Hyperparameters:**
  - Swarm size: 30 particles, Max iterations: 60
  - Inertia: $w = 0.7$, Cognitive coefficient: $c_1 = 1.5$, Social coefficient: $c_2 = 1.5$
  - Velocity clamping: $v \in [-0.5, 0.5]$ per dimension
  - Position clamping: $x \in [0.0, 1.0]$ per dimension
- **Updates:**
  $$v_i^{(t+1)} = \text{clip}\left(w v_i^{(t)} + c_1 r_1 (p_{\text{best}, i} - x_i^{(t)}) + c_2 r_2 (g_{\text{best}} - x_i^{(t)}), \; -0.5, \; 0.5\right)$$
  $$x_i^{(t+1)} = \text{clip}\left(x_i^{(t)} + v_i^{(t+1)}, \; 0.0, \; 1.0\right)$$
  where $r_1, r_2 \sim U(0, 1)$.

### Quantum-Behaved PSO (QPSO) (`backend/app/algorithms/qpso.py`)
In classical mechanics, velocity and position are simultaneously known. In quantum mechanics, particles behave according to a wave function. In QPSO, particles have no velocity vectors and are instead treated as bound within a quantum delta-potential well centered on a local attractor.

- **Hyperparameters:**
  - Swarm size: 30 particles, Max iterations: 60
  - Contraction-Expansion coefficient: Linear anneal from $\beta_{\text{start}} = 1.0$ to $\beta_{\text{end}} = 0.5$:
    $$\beta(t) = 1.0 - 0.5 \times \left(\frac{t}{60}\right)$$
- **Mean Best Position ($m_{\text{best}}$):**
  $$m_{\text{best}} = \frac{1}{30} \sum_{j=1}^{30} p_{\text{best}, j}$$
- **Local Attractor ($p_i$):**
  $$p_i = \phi \cdot p_{\text{best}, i} + (1.0 - \phi) \cdot g_{\text{best}}, \quad \phi \sim U(0, 1)$$
- **Quantum Wave Position Sampling:**
  $$x_i^{(t+1)} = \text{clip}\left(p_i \pm \beta(t) \cdot |m_{\text{best}} - x_i^{(t)}| \cdot \ln\left(\frac{1}{u}\right), \; 0.0, \; 1.0\right), \quad u \sim U(0, 1)$$

### Summary of Differences

| Property | Classical PSO | Quantum-Behaved PSO (QPSO) |
| :--- | :--- | :--- |
| **Search Mechanism** | Newtonian mechanics (velocity vectors + inertia) | Quantum wave mechanics (delta-potential well sampling) |
| **Tuning Parameters** | 4 parameters ($w, c_1, c_2$, velocity clamp) | 1 parameter (contraction-expansion coefficient $\beta$) |
| **Search Space Coverage** | Bounded by previous velocity and inertia trajectory | Infinite potential well; can sample anywhere in state space |
| **Local Minima Escape** | Vulnerable to momentum stalling in local valleys | Exponential probability distribution facilitates tunneling |

### Early Stopping Rule
Both PSO and QPSO track the best fitness found across the swarm. If $g_{\text{best}}$ does not strictly improve for **10 consecutive iterations**, optimization stops early.

---

## 11. Benchmark & Travel Time Metrics

When **Compare All** executes (`backend/app/main.py:compare_all`):
- All four algorithms run sequentially against the exact same scenario state.
- **Metric Definitions:**
  - **Travel Time ($T$):** The algorithm's planning travel time (static for Dijkstra/A\*; traffic-aware optimizer cost for PSO/QPSO).
  - **Distance ($D$):** Physical route distance in km ($\sum L / 1000$).
  - **Objective Score ($J$):** Weighted composite fitness ($w_T T + w_D D + w_C C$).
  - **`free_flow_time`:** Route travel time assuming zero vehicle load ($\text{load} = 0$).
  - **`actual_time`:** Route travel time evaluated with the scenario's configured `backgroundLoad`.
  - **`actual_congestion`:** Average congestion multiplier along the chosen route under `backgroundLoad`.
  - **Iterations:** Count of iterations executed until convergence or early stopping (Dijkstra/A\* report 1).
  - **Optimization Time:** Execution duration in milliseconds.

### Deterministic Replay
The backend caches the route and edge loads of the most recent comparison run. When the user clicks **Animate benchmark result**, the frontend replays the exact route and traffic distribution that was displayed in the benchmark table without re-running stochastic algorithms.

---

## 12. WebSocket Animation Flow (`/ws/animation`)

The animation loop streams tick updates over WebSocket at **10 ticks per second** (`backend/app/main.py:animate`):
1. **Route Progress:** The ego vehicle progresses along route edges based on simulated travel time.
2. **Coordinate & Heading Interpolation:** Node-to-node coordinates are interpolated linearly; headings are calculated via `atan2(dy, dx)`.
3. **Lane Offset Geometry (`frontend/src/laneGeometry.ts`):**
   - Road footprint is symmetric around the centerline regardless of one-way status:
     $$\text{offsetPx}(i) = \left(i - \frac{\text{lanes} - 1}{2}\right) \times \text{laneWidthPx}$$
   - The ego car always occupies lane index 0 (closest to the road centerline).
   - Background vehicle sprites loop along forward and backward lane slots with speeds inversely proportional to edge congestion.

---

## 13. Preset Scenarios

Two preconfigured scenarios are provided in `scenarios/` and `frontend/public/scenarios/`:
1. **`demo-small.json`:**
   - 10 intersections, 15 roads, 48 total vehicles (40 cars, 6 trucks, 2 buses).
   - Designed for fast testing of baseline shortest paths.
2. **`demo-large.json`:**
   - 55 intersections, 140 roads, 950 vehicles (800 cars, 100 trucks, 50 buses).
   - Stress test demonstrating swarm optimization and alternate route traffic dispersion at scale.

---

## 14. Implementation Assumptions & Constraints

1. **Scale Hard Caps:** $\le 60$ nodes, $\le 150$ edges, $\le 1,000$ vehicles.
2. **Admissible Road Length Invariant:** For A\* heuristic admissibility, edge lengths must satisfy:
   $$\text{lengthM} \ge \text{geometric distance} \times 2.5$$
   When dragging nodes, the network editor silently expands `lengthM = max(lengthM, distance * 2.5)` to guarantee heuristic validity.
3. **Single Ego Vehicle:** Optimization optimizes the single ego vehicle's path while treating background traffic as macroscopic aggregate flow along candidate routes.
4. **In-Memory Volatility:** Scenario state resets upon backend restart; persistent scenarios are maintained via JSON export and import files.

