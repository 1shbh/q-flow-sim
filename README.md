
# Q-Flow Sim

An interactive traffic network simulator and routing benchmark platform. Q-Flow Sim models dynamic road congestion and benchmarks classical shortest-path algorithms against swarm intelligence metaheuristics (PSO and Quantum-Behaved PSO) in a real-time control-room environment.

---

## Architecture & Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Konva / React-Konva (canvas rendering), Recharts (convergence plots), Zustand (client state).
- **Backend:** Python 3.10+, FastAPI, Uvicorn, NetworkX (graph processing & shortest paths), NumPy (vectorized swarm optimization).
- **Transport & Storage:** REST for scenario CRUD and algorithm runs; WebSockets for 10 Hz real-time animation streaming. In-memory state with JSON scenario import/export.

---

## How the Simulation Works

### 1. Network & Road Representation
The road network is modeled as a directed graph $G = (V, E)$:
- **Intersections ($V$):** Nodes with 2D Cartesian coordinates $(x, y)$, optional traffic signal control, and green-split cycle timing.
- **Roads ($E$):** Edges with length in meters ($L$), lane count ($N \in \{1, 2, 3\}$), lane width (3.5 m), speed limit in km/h ($v_{\max}$), one-way toggle, and optional road incidents (slowdown factor or full closure). Two-way roads generate directed arcs in both directions.

### 2. Vehicle Equivalents & Traffic Load
Vehicles are weighted by physical road occupancy to determine edge load:
$$\text{Total Load (vehicle-equivalents)} = \text{cars} + 2 \times \text{trucks} + 2 \times \text{buses}$$
- **Per-road Background Load:** Explicitly configured on individual roads (`edge.backgroundLoad`).
- **Baseline Uniform Heuristic:** Before an optimization run, total scenario vehicle-equivalents are distributed evenly across open roads using round-half-to-even rounding:
  $$\text{baseline\_load} = \text{round}\left(\frac{\text{Total Load}}{|E_{\text{open}}|}\right)$$

### 3. Edge Travel Time & Congestion Model
The travel time for traversing an edge is computed in minutes:
$$\text{Base Time (min)} = \frac{L / 1000}{v_{\max}} \times 60$$
$$\text{Capacity} = N \times 15 \quad (\text{15 vehicle-equivalents per lane})$$
$$\text{Congestion Multiplier} = \min\left(1.0 + 3.0 \times \left(\frac{\text{load}}{\text{Capacity}}\right)^2, \; 6.0\right)$$
$$\text{Weather Multiplier} = \begin{cases} 1.0 & \text{clear} \\ 1.0 + 0.5 \times \text{intensity} & \text{rain} \\ 1.0 + 0.8 \times \text{intensity} & \text{fog} \end{cases}$$
$$\text{Incident Multiplier} = \begin{cases} 1.0 & \text{no incident} \\ \text{factor} \ (\text{default } 3.0) & \text{slowdown} \\ \text{excluded from graph} & \text{closure} \end{cases}$$

$$\text{Edge Cost (min)} = \text{Base Time} \times \text{Congestion Multiplier} \times \text{Weather Multiplier} \times \text{Incident Multiplier}$$

### 4. Objective & Fitness Function
All algorithms evaluate routes to minimize the weighted multi-objective score $J$:
$$J = w_T \cdot T + w_D \cdot D + w_C \cdot C$$
- $T$ = Route travel time (min), summing edge costs under evaluated traffic loads.
- $D$ = Route physical distance (km), $\sum L / 1000$.
- $C$ = Mean congestion multiplier across all edges carrying traffic load ($C = 1.0$ for load-zero static evaluations).
- Default weights: $w_T = 1.0, w_D = 1.0, w_C = 1.0$.

---

## Routing Algorithms

### Dijkstra
- Computes the optimal path via `nx.dijkstra_path` on the graph weighted by static, load-zero edge costs ($\text{load} = 0$, $C = 1.0$).
- Evaluates shortest path under free-flow conditions, serving as the classical static baseline.

### A\*
- Guided shortest path via `nx.astar_path` using an admissible Euclidean heuristic:
  $$h(u, \text{dest}) = \frac{\sqrt{(x_u - x_{\text{dest}})^2 + (y_u - y_{\text{dest}})^2} \times 2.5 / 1000}{\max(v_{\max})} \times 60 \times \min(\text{multipliers})$$
- Uses a coordinate scale of 2.5 meters per pixel and scales by the network's maximum speed and smallest legal weather/incident multiplier to guarantee admissibility.

### Candidate Path Generation (PSO & QPSO)
- Precomputes up to $K = 8$ paths using `nx.shortest_simple_paths` on static load-zero costs.
- Prunes any path whose static cost exceeds $2.0 \times$ the cost of the shortest candidate path.

### Particle Swarm Optimization (Classical PSO)
- **Encoding:** Each particle has $K + 1$ dimensions in $[0, 1]$:
  - Dimensions $0 \dots K-1$: Softmax-normalized to determine the distribution of background traffic load across candidate paths.
  - Dimension $K$: Selects the ego vehicle route: $\text{path\_index} = \text{round}(x_K \times (K - 1))$.
- **Effective Load:** Roads accumulate assigned traffic load on top of existing `backgroundLoad`.
- **Swarm Parameters:**
  - Swarm size: 30 particles, max iterations: 60.
  - Inertia weight $w = 0.7$, cognitive coefficient $c_1 = 1.5$, social coefficient $c_2 = 1.5$.
  - Velocity clamping: $v \in [-0.5, 0.5]$ per dimension.
  - Position clamping: $x \in [0.0, 1.0]$ per dimension.
  - Velocity update: $v_i = w v_i + c_1 r_1 (p_{\text{best}, i} - x_i) + c_2 r_2 (g_{\text{best}} - x_i)$ with $r_1, r_2 \sim U(0, 1)$.
  - Early stopping: Terminates if $g_{\text{best}}$ does not improve for 10 consecutive iterations.

### Quantum-Behaved PSO (QPSO)
- **Concept:** Particles lack velocity vectors and instead move within a quantum delta-potential well centered at a local attractor, enabling global search across the entire solution space.
- **Parameters & Equations:**
  - Swarm size: 30 particles, max iterations: 60.
  - Linear contraction-expansion annealing:
    $$\beta = 1.0 - 0.5 \times \left(\frac{\text{iteration}}{\text{max\_iterations}}\right)$$
  - Mean best position:
    $$m_{\text{best}} = \frac{1}{30} \sum_{j=1}^{30} p_{\text{best}, j}$$
  - Local attractor:
    $$p_i = \phi \cdot p_{\text{best}, i} + (1 - \phi) \cdot g_{\text{best}}, \quad \phi \sim U(0, 1)$$
  - Quantum position update:
    $$x_i = \text{clip}\left(p_i \pm \beta \cdot |m_{\text{best}} - x_i| \cdot \ln(1/u), \; 0.0, \; 1.0\right), \quad u \sim U(0, 1)$$
  - Early stopping: Terminates if $g_{\text{best}}$ does not improve for 10 consecutive iterations.

---

## Benchmark & Animation

- **Compare All:** Concurrently runs Dijkstra, A\*, PSO, and QPSO against the current scenario, displaying travel time (min), distance (km), objective score ($J$), iterations, and runtime (ms).
- **Free-Flow vs. Actual Travel Time:**
  - `free_flow_time`: Route duration assuming zero vehicle load ($\text{load} = 0$).
  - `actual_time`: Route duration under the scenario's configured background traffic.
- **Deterministic Replay:** Benchmark results are cached and can be directly replayed in the animation without re-executing stochastic optimizers.
- **WebSocket Animation:** Streams ego-vehicle progress and background traffic flow at 10 Hz along lane-offset paths with live speed-multiplier controls (1×, 2×, 4×).

---

## Local Setup

### Prerequisites
- Python 3.10 or 3.11
- Node.js 18+ and npm

### 1. Backend Setup

```powershell
cd backend
python -m venv .venv

# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Verify backend health: `http://127.0.0.1:8000/health` returns `{"status":"ok"}`.

### 2. Frontend Setup

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

