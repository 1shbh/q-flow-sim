# Q-Flow Sim

An interactive traffic network simulator and routing benchmark platform. Q-Flow Sim simulates dynamic road congestion and benchmarks classical shortest-path algorithms against swarm intelligence metaheuristics (PSO and Quantum-Behaved PSO) in a real-time control-room environment.

---

## What the Prototype Demonstrates

1. **Static vs. Traffic-Aware Routing:** How traditional shortest-path algorithms (Dijkstra, A*) behave when assuming static free-flow travel costs versus when traffic loads dynamically scale travel times.
2. **Swarm Intelligence in Traffic Optimization:** How Classical Particle Swarm Optimization (PSO) and Quantum-Behaved PSO (QPSO) explore candidate paths and traffic distributions to minimize an objective balancing travel time, distance, and congestion.
3. **Interactive Control Room:** A visual simulator where users can edit road geometry, inject weather and incident conditions, compare algorithms side-by-side, and replay optimal routes with real-time vehicle sprite animations.

---

## Main Features

- **Interactive Canvas Network Editor:** Click to place and drag intersections; draw roads with customizable lanes (1–3), speed limits, lengths, and one-way rules.
- **Dynamic Environmental Conditions:** Adjust global weather (clear, rain, fog with variable intensity), simulate signal cycles, and apply road incidents (slowdown factors or full closures).
- **Multi-Algorithm Benchmark:** Side-by-side execution and scorecard comparison of **Dijkstra**, **A***, **Classical PSO**, and **QPSO** with live convergence curves.
- **WebSocket Animation Engine:** Real-time 10 Hz streaming of ego-vehicle routes and background traffic flow along lane offsets with speed multiplier controls (1x, 2x, 4x).
- **Scenario Management:** Built-in demo presets (`demo-small`, `demo-large`) and complete scenario JSON import/export.

---

## Tech Stack & Architecture

- **Frontend:** React 18, TypeScript, Vite, Konva / React-Konva (canvas rendering), Recharts (convergence charts), Zustand (client state).
- **Backend:** Python 3.10+, FastAPI, Uvicorn, NetworkX (graph processing & shortest paths), NumPy (vectorized swarm optimization).
- **Architecture:** 
  - Client-server architecture with REST endpoints for scenario management and algorithm execution.
  - Full-duplex WebSocket connection streaming animation ticks (ego position, heading, edge congestion) at 10 Hz.
  - Zero external database dependencies — in-memory state with JSON import/export.

---

## How to Run Locally

### Prerequisites
- Python 3.10 or 3.11
- Node.js 18+ and npm

### 1. Backend Setup

```powershell
cd backend
python -m venv .venv

# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On macOS / Linux:
# source .venv/bin/activate

python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Verify backend health: visiting `http://127.0.0.1:8000/health` returns `{"status":"ok"}`.

### 2. Frontend Setup

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Technical Documentation

For the complete technical breakdown — including exact mathematical formulas, traffic congestion equations, PSO/QPSO particle encoding, heuristic proofs, and implementation details — see [**PROJECT_OVERVIEW.md**](PROJECT_OVERVIEW.md).