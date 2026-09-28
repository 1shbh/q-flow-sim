# Q-Flow Sim — Agent Build Specification (FINAL)

*Distilled and fully specified from the Q-Flow Sim Prototype SRS (SIH 2026, PS ID 26137), for direct use by a coding agent. Read this entire document before writing any code. Re-read the relevant phase section (§9) before starting that phase. Do not invent values for anything that has a concrete number in this document — every formula, endpoint, and hyperparameter below is final, not illustrative.*

---

## 0. What this is

A browser app, running entirely on one laptop with no internet dependency, where a judge builds a 2D road network, drops vehicles/weather/incidents onto it, and races four routing algorithms (Dijkstra, A\*, classical PSO, QPSO) against each other with a live benchmark dashboard. It should look and feel like a real traffic control-room simulator — actual road surfaces with lane markings, moving car sprites, a live signal state — not an abstract graph of dots and lines. Build across the phased sessions in §9; do not attempt it in one pass.

---

## 1. Locked technical decisions (do not deviate without asking)


| Layer        | Choice                                                     | Notes                                                  |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| Frontend     | React + Vite + Konva.js (canvas)                           | Konva for node/edge drag-and-drop and sprite animation |
| State        | Zustand                                                    | not Redux                                              |
| Backend      | Python 3.11 + FastAPI                                      | REST + WebSocket                                       |
| Graph        | NetworkX                                                   | Dijkstra/A\* and k-shortest-paths come from here       |
| Optimization | NumPy, hand-written PSO/QPSO                               | no external metaheuristic library                      |
| Charts       | Recharts                                                   | convergence curve + comparison table                   |
| Persistence  | None — in-memory + JSON export/import                     | no database                                            |
| Transport    | REST for CRUD/run requests, WebSocket for animation ticks  |                                                        |
| Packaging    | Vite build (frontend), uvicorn (backend), both run locally | no Docker                                              |

Hard caps: ≤60 nodes, ≤150 edges, ≤1,000 simulated vehicles. Optimization run must return in <5s at this scale — if PSO/QPSO can't hit that at the cap, reduce iteration count (§6.3) before reducing network size.

---

## 2. Visual & interaction design

The subject is a *live traffic control room for a quantum-inspired optimizer* — lean into that, not into a generic admin-dashboard look. This is a design brief to follow deliberately, not a checklist to satisfy minimally.

**Design tokens (use these exact values unless building a genuine reason to deviate):**


| Token              | Value                                | Use                                                                                                   |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `--bg-void`        | `#0A0A0D`                            | canvas/app background — neutral near-black, no blue undertone                                        |
| `--bg-panel`       | `#17151A`at 85% opacity, subtle blur | side panels — read as glass control consoles floating over the void                                  |
| `--road-surface`   | `#2C2A30`                            | default road fill                                                                                     |
| `--lane-marking`   | `#E8C468`                            | dashed centerline on roads with ≥2 lanes                                                             |
| `--flow-free`      | `#3DDC84`                            | congestion: free-flowing                                                                              |
| `--flow-moderate`  | `#F2B84B`                            | congestion: moderate                                                                                  |
| `--flow-congested` | `#F0523C`                            | congestion: congested                                                                                 |
| `--accent-qpso`    | `#8B5CF6`                            | QPSO-specific UI (results, active state, particle trails) — violet, reads as "quantum"               |
| `--accent-pso`     | `#C9A15C`                            | classical PSO-specific UI — muted brass/gold, reads as "classical/mechanical," deliberately not blue |
| `--accent-ego`     | `#F94F8C`                            | the ego vehicle — magenta-pink, always the most visually distinct object on screen                   |
| `--text-primary`   | `#ECE8E4`                            |                                                                                                       |
| `--text-dim`       | `#9A938F`                            | secondary labels                                                                                      |

Typography: one UI sans (Inter or IBM Plex Sans) for labels and controls; one monospace (JetBrains Mono or IBM Plex Mono) *only* for live numeric readouts (ETA, iteration count, objective score). No small-caps eyebrow labels, no middle-dot separators, no arrow-suffixed buttons.

**Page layout (exact — this replaces any single scrolling right-hand panel):**

```
┌─────────────────────────────────────────────────────────────────┐
│ TOP BAR — app name/icon only, nothing else                      │
├───────────────┬───────────────────────────────┬─────────────────┤
│ LEFT PANEL    │                               │ RIGHT PANEL     │
│ "Build"       │        CENTER — CANVAS        │ "Operate"       │
│               │  (header row: title + node/   │                 │
│ - Network     │   edge counts + "Randomize    │ - Conditions    │
│   inspector   │   network" button)             │   (weather,    │
│   (selected-  │                               │    incidents)   │
│   element     │        [canvas itself]         │ - Algorithm     │
│   fields per  │                               │   picker +      │
│   §2's canvas │  (footer row: legend —        │   Compare All   │
│   interaction │   road/lane/signal swatches   │ - Benchmark     │
│   model)      │   AND vehicle-type swatches   │   dashboard     │
│ - Vehicles    │   merged into one row)         │   (table +      │
│ - Ego route   │                               │   convergence   │
│               │                               │   chart)        │
│               │                               │ - Weights       │
│               │                               │   (wT/wD/wC)    │
│               │                               │ - Export/Import │
└───────────────┴───────────────────────────────┴─────────────────┘
```

* **Top bar:** app name/icon only. No status indicator, no health-check badge, no secondary items of any kind. Every control anywhere in the app must map to something in §6's API contract or §8's phase scope — the top bar's only job is identity, not status.
* **Left panel ("Build"):** everything about constructing the network and placing vehicles — the selected-element inspector (populated by clicking the canvas per §2's interaction model; a dropdown-based element selector may additionally be offered here as a keyboard-accessible fallback per §7.2, but styled and sized as clearly secondary to canvas-click selection, not the primary flow), Vehicles, and Ego route.
* **Right panel ("Operate"):** everything about running and reading results — Conditions (weather/incident), the algorithm picker and Compare All, the Benchmark dashboard, the objective-function Weights, and Export/Import.
* **Canvas header/footer belong to the canvas, not either side panel:** node/edge counts, the "Randomize network" button, and a "Clear network" button (secondary style; resets to the empty scenario from §8 Phase 1 via `PUT /scenario` with an empty payload — no new endpoint needed) sit in the canvas's own header row, next to its title. The road/lane/signal legend and the vehicle-type swatches merge into a single legend row in the canvas's footer. Nothing that describes *the canvas itself* should live in a side panel.
* Both side panels use the module component system defined later in this section (spacing scale, typography tiers, button variants, input styling) — never plain unstyled stacked forms — and each should fit without scrolling for a typical laptop viewport (1366×768) at the network-size cap; if a panel's content genuinely can't fit, scope which module scrolls internally rather than letting the whole panel scroll past the canvas.
* **Resizable panels (exact):** both side panels get a 4px-wide drag handle on their inner edge (the Left panel's right edge, the Right panel's left edge) — cursor `col-resize` on hover. Dragging it live-resizes that panel's width between a minimum of `280px` and a maximum of `560px`. **Default width is `420px`** for both panels — wide enough that the Benchmark grid's 5 columns (Metric + Dijkstra/A\*/PSO/QPSO, per the column-width rule below) fit without any horizontal scrolling at the default size; horizontal scrolling should only ever be needed if the user deliberately drags a panel down toward the 280px minimum. This is UI-only state — panel width is never written to the scenario JSON (§4) or persisted across a page reload; it resets to `420px` on refresh.
* **Benchmark grid column widths (exact):** Metric label column = `140px` min-width; each of the four algorithm columns (Dijkstra, A\*, PSO, QPSO) = `70px` min-width. Total natural width ≈ `420px`, matching the default panel width above exactly, so the grid fits with no scrolling out of the box. Do not size columns wider than this (e.g. equal-width columns based on the widest cell) — the numeric values are short enough that 70px comfortably fits any value in this app at the monospace 13px size with `nowrap`.
* **Narrow-width content handling (exact):** at `280px` (or any width where a module's natural content — most likely the Benchmark grid's 5 columns — doesn't fit), that module gets its own `overflow-x: auto` horizontal scroll, scoped to that module only, exactly like the existing vertical module-scroll principle above but on the horizontal axis. Content must **never** be clipped, cut off, or silently hidden by the panel boundary at any width in the 280–560px range — every value must always be reachable, either by widening the panel or by scrolling that one module horizontally. Test this explicitly at `280px`: every column of the Benchmark grid should still be scrollable into view, not missing.

**Roads, not lines:**

* Render each edge as a filled road polygon whose width scales visibly with lane count. Exact rule: `roadWidthPx = lanes × laneWidthM × PX_PER_METER`, with `PX_PER_METER = 4` at default zoom. A 1-lane road (4px-equivalent) and a 3-lane road (12px-equivalent) must look obviously different.
* 2+ lane roads get a dashed centerline in `--lane-marking` (dash pattern: 8px on, 6px off), positioned per the lane-offset rule below — never at the visual middle of the road polygon by default. One-way roads get a directional chevron pattern along the surface (one chevron every 40px, pointing toward `to`) and no centerline.
* Congestion is shown as the road surface color/glow itself: interpolate the fill between `--flow-free` → `--flow-moderate` → `--flow-congested` per the congestion buckets in §5.1 (a soft gradient wash, not a separate colored line). Do **not** draw a separate high-contrast stroke/outline around a road polygon's perimeter for congestion or selection state — a saturated border reads as a neon UI overlay, not a road surface. If a selected road needs an indication, use a subtle glow (`box-shadow`-style blur, 15% opacity, no visible hard edge) rather than a solid-color outline.

**Lane geometry (exact — this is what §2's road-width rule was missing, and what vehicle placement below depends on):**

```
laneWidthPx = laneWidthM × PX_PER_METER    # PX_PER_METER = 4, as already defined

Direction split:
  if oneWay:       lanesForward = lanes,            lanesBackward = 0
  if not oneWay:    lanesForward = ceil(lanes / 2),  lanesBackward = floor(lanes / 2)
                     # odd lane counts give the extra lane to the "from→to" direction

Lane slots (exact — always computed from `lanes` alone, so the physical
road footprint never moves when oneWay is toggled; only which slots count
as forward vs backward changes):
  slot index i = 0 .. lanes-1, ordered left-to-right across the road
  offsetPx(i) = (i - (lanes - 1) / 2) × laneWidthPx
    # this is symmetric around 0 by construction, for any lanes/oneWay
    # combination — the road polygon always spans exactly
    # [-lanes×laneWidthPx/2, +lanes×laneWidthPx/2], centered on the
    # centerline, whether the road is one-way or two-way
  Assign the leftmost `lanesBackward` slots (i = 0 .. lanesBackward-1) as
  backward lanes (travel to→from); assign the remaining rightmost
  `lanesForward` slots (i = lanesBackward .. lanes-1) as forward lanes
  (travel from→to). For a one-way road, lanesBackward = 0, so ALL slots
  are forward — but they still occupy the same centered, symmetric span
  as before, not a span shifted entirely to one side.
```

**Do not** compute forward-lane offsets as `+(i+0.5)×laneWidthPx` and backward as `-(j+0.5)×laneWidthPx` independently from each direction's own count — that formula re-centers the whole lane band around 0 differently depending on the forward/backward split, which is exactly what makes the road's visual footprint jump sideways when `oneWay` is toggled. The slot-index formula above is the fix: the footprint is a pure function of `lanes`, never of `oneWay`/`lanesForward`/`lanesBackward`.

The dashed centerline (`--lane-marking`) is drawn at the midpoint between the last backward slot's offset and the first forward slot's offset (i.e. at `offsetPx = (offsetPx(lanesBackward - 1) + offsetPx(lanesBackward)) / 2`) whenever `lanesForward ≥ 1 AND lanesBackward ≥ 1` (a genuine two-way road). A one-way road gets no centerline (chevrons instead, per above). When `lanes = 1` and `oneWay = false` (a degenerate single shared lane), draw neither a centerline nor chevrons — it's one shared lane. Additionally, for every boundary between two adjacent same-direction slots, draw a thin **solid** lane-boundary line (not dashed) in `--lane-marking` at 40% opacity, at the midpoint offset between those two slots — this is what makes a 3-lane road visibly show 3 distinct lanes, not just a wider road with one center dash.

* Intersections are rounded junction shapes sized to `max(roadWidth of connected edges) × 1.4`, not bare circles. A signal-controlled node shows a small red/green indicator dot (6px radius) whose state is computed exactly as follows:

  ```
  SIGNAL_CYCLE_SEC = 20   # fixed for every signal; no coordination/offset between intersectionst = seconds since the frontend app mounted (a local clock, independent of §6.2's WS animation ticks)phase = t mod SIGNAL_CYCLE_SECdot color = green  if phase < (greenSplit × SIGNAL_CYCLE_SEC)            red    otherwise
  ```

  Drive this off a `requestAnimationFrame` loop (or a 250ms `setInterval`) in `NetworkCanvas.tsx`. It must run and be visibly flipping at all times — including when no algorithm run or WS animation is active — since it represents the signal's real-world state, not a simulation artifact.

**Vehicles, not dots:**

* Each vehicle is a small rounded-rect sprite: cars 10×5px, trucks 16×6px, buses 18×6px, rotated to face its direction of travel (forward-lane sprites face toward `to`; backward-lane sprites face toward `from`, i.e. rotated 180° from the edge's base heading). Cars render in a neutral gray-blue (`#5B6478`); trucks/buses in a heavier tone (`#3A4356`).
* Every vehicle sprite (ego and background) is drawn along a path offset from the edge's centerline by its assigned lane's `offsetPx`, per the lane geometry above — never along the raw centerline/edge path itself, regardless of lane count.
* The ego vehicle always occupies forward lane index 0 (or backward lane index 0, if its route traverses the edge in the `to→from` direction) — the lane closest to the centerline, so it stays easy to visually track. It renders at 14×7px in `--accent-ego`, with a pulsing ring (radius animates 10px↔16px over a 1.2s ease-in-out loop, opacity 0.6→0).
* Background traffic renders as aggregate flow along edges: total sprite count per edge = `min(round(edgeLoad / 3), 8)`. Split that count round-robin across all forward and backward lanes in proportion to `lanesForward : lanesBackward` (a one-way edge puts all sprites in the forward group). Each sprite loops continuously along its assigned lane's offset path, in that lane's direction of travel (forward lanes loop `from→to`, backward lanes loop `to→from`), at a speed proportional to `1 / congestion_multiplier` (§5.1). Within a lane group, sprites are evenly spaced along the edge length.

**Weather & incidents as scene effects:**

* Rain: light diagonal streak overlay (opacity = `0.15 + 0.35 × intensity`) across the whole canvas, streaks animate downward-diagonal continuously.
* Fog: soft desaturating gradient (`grayscale(${intensity × 60}%)` + white overlay at `opacity = intensity × 0.25`) over the affected area (whole canvas — weather is scenario-wide, not per-edge).
* A closed/incident edge shows a barrier icon (two diagonal red-and-white stripes) centered on the road surface, not just a red edge. A slowdown incident shows a small amber warning triangle instead.

**Panels:** side control panels read as translucent instrument consoles (`--bg-panel`), not white cards. Keep the canvas the largest, most visually dominant element on screen at all times.

**Canvas interaction model (exact — this is why Konva was chosen in §1, not a style preference):**

* The canvas is the primary editing surface. Clicking empty canvas space creates a node at that point (drag afterward to reposition it). Clicking an existing node, then clicking a second existing node, draws an edge between them (a visible "drawing" cursor/line-preview follows the pointer between the two clicks).
* **Dragging (exact):** no grid-snapping is specified anywhere in this document — a dragged node's final `x`/`y` must be exactly where the pointer released it, not rounded to a grid line or any other increment. Read the node's new position from the Konva drag event's own target (`e.target.x()`, `e.target.y()`) on `dragend`, in the shape's local/stage coordinate space, and convert through the inverse of the stage's current pan/zoom transform to get model coordinates — never recompute position from the raw pointer/mouse event coordinates or from a stored click-offset delta, both of which are what produce a node landing away from where it was actually released. Persist the new position via `PATCH /scenario/nodes/{id}` only on `dragend`, not on every `dragmove` tick.
* **Coordinate stability (exact):** the canvas's pan/zoom transform must never be automatically recalculated in response to a node or edge being added, moved, or deleted — only an explicit user pan/zoom gesture, or an explicit "fit view" action if the app has one, may change it. Creating a node from a canvas click must convert that click's pointer coordinates into model coordinates using the stage's *current* transform at the moment of the click (the same inverse-transform approach as the Dragging rule above), and that transform must be the one already in effect, not one freshly recomputed to fit the (now-changed) set of nodes. If the whole network visibly shifts, or a newly placed node lands somewhere other than the click point, whenever a node is added, that is a sign some "fit to content"/auto-center logic is re-running on every render or every scenario update instead of only on initial load or an explicit Randomize — remove any such logic that isn't explicitly user-triggered.
* **Keyboard delete:** when a node or road is currently selected (populating the inspector per the selected-element model above), pressing `Delete` or `Backspace` triggers the same action as that module's "Delete node"/"Delete road" button — but only when focus is not inside a text input, number field, or dropdown (check `document.activeElement`'s tag isn't `INPUT`/`TEXTAREA`/`SELECT` before handling the keydown), so editing a length or vehicle-count field doesn't accidentally delete the selected element.
* The side panel is a **selected-element inspector**, not a creation form: clicking a node or edge on the canvas populates the panel with that element's editable fields (per §4's schema) plus a delete button. Editing a field there updates the element live on the canvas.
* A manual "Add Node" / "Add Road" button is allowed only as a fallback that drops a default-positioned element for the user to drag into place afterward — it must not be the primary way to specify coordinates or connections by typing them.
* Section labels throughout the panel are normal sentence case — no small-caps eyebrow labels, no numbered section prefixes ("01", "02"), matching the typography rule above.
* `egoVehicle.origin`/`destination` selection is **not** part of this panel — it belongs to `VehiclePanel.tsx` in Phase 3 (`PUT /scenario/ego`, §6.1). The network editor's validate action (§6.1's `/scenario/validate`) only checks node/edge graph integrity.

**Panel component system (exact — every control in every panel uses these, no ad-hoc styling):**

*Spacing:* use only 4 / 8 / 12 / 16 / 24 / 32 (px) for any margin, padding, or gap. Nothing else.

*Typography tiers (all panel text falls into exactly one of these):*


| Tier            | Size | Color                                                                        | Weight | Use                                                                                                                                                                                                                                   |
| --------------- | ---- | ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module label    | 11px | `--text-dim`, letter-spacing 0.02em                                          | 600    | small module headers ("Road incident", "Vehicles") — sentence case, never all-caps                                                                                                                                                   |
| Section title   | 16px | `--text-primary`                                                             | 600    | the panel's top heading only (e.g. "Selected element")                                                                                                                                                                                |
| Field label     | 13px | `--text-dim`                                                                 | 500    | label above an input/dropdown/slider                                                                                                                                                                                                  |
| Body text       | 14px | `--text-primary`                                                             | 400    | normal readable text                                                                                                                                                                                                                  |
| Numeric readout | 13px | `--text-primary`, monospace font (§2 typography rule),`white-space: nowrap` | 400    | edge costs, ETA, iteration counts, objective scores — a value must never line-wrap mid-number; if a column is too narrow to fit a value on one line, the column (or the panel, per the resize rule below) must widen, not the number |

*Buttons — three variants only, chosen by role, never a fourth generic style:*

* **Primary** (the one clearly-most-important action in a given module — e.g. "Compare All," "Validate network," "Add Node/Road" confirm): solid fill in the accent color relevant to that action's context (default `--accent-ego` if no other accent applies; use `--accent-qpso`/`--accent-pso` for algorithm-specific actions), text in `--bg-void`, radius 6px, padding 10px 16px, weight 600, no default browser shadow.
* **Secondary** (Save, Export, Import, Randomize — supporting actions): 1px border `--text-dim` at 40% opacity, transparent fill, `--text-primary` text, same radius/padding as primary; on hover, fill with `--bg-panel` at a lighter tint.
* **Destructive** (Delete node/road/incident): text-only, color `--flow-congested`, no border or fill at rest; on hover, a subtle background tint of `--flow-congested` at 10% opacity. A panel section should have **at most one primary button** — if two actions feel equally important, that's a sign one should be secondary.

*Inputs, dropdowns, number fields:* background `--bg-void` (darker than the surrounding `--bg-panel`, so each field reads as a "slot" set into the console); border 1px solid `--text-dim` at 25% opacity; radius 6px; padding 8px 10px; text 14px `--text-primary`. On focus: border becomes 1px solid the module's accent color plus a 2px glow ring of that color at 20% opacity — never rely on the browser's default focus outline alone (see also §7.2's accessibility focus-ring requirement, which this satisfies). Dropdowns use a custom chevron in `--text-dim` that rotates 180° when open; never the browser's native `<select>` arrow.

*Sliders* (green-split, weather intensity): track = `--bg-void`; filled portion = the relevant accent color for that control; thumb = 12px circle in `--text-primary` with a glow ring matching the accent while dragging.

*Module grouping:* each logical group (Road incident, Current edge costs, Benchmark dashboard, Vehicles, Conditions, etc.) is a distinct module: a module-label header (per the typography table), 12px gap between its internal fields, 24px gap before the next module, and a 1px top border in `--text-dim` at 15% opacity separating it from the module above. Do not let unrelated modules run together as one continuous form.

*Panel chrome:* the side panel itself gets a 1px left border in `--text-dim` at 15% opacity separating it from the void, plus `--bg-panel`'s specified 85% opacity and blur (§2 top) — it should read as a distinct floating surface, not a flat opaque sidebar with square, undifferentiated edges.

**App chrome — keep it minimal, no generic dashboard header:** a top bar, if present, contains only the app name/icon — no status indicator, pill badge, subtitle tagline, or unexplained button like "Live Network"/"API connected" with no defined behavior. Every control in the app must map to something in §6's API contract or §8's phase scope, including anything in the top bar. Remove any label that exists purely as decoration (e.g. a redundant "grid units" label duplicating information already shown elsewhere, such as the canvas's existing "Grid spacing" readout).

**Restraint:** spend the visual budget on road/vehicle rendering and the live congestion glow. Keep every control (sliders, buttons, algorithm picker) plain, quiet, legible.

---

## 3. Repo structure

```
qflow-sim/
  backend/
    app/
      main.py                  # FastAPI app, routes (see §6)
      graph_model.py           # Node/Edge/Graph classes, cost functions (see §5)
      algorithms/
        dijkstra_astar.py
        pso.py
        qpso.py
        candidate_paths.py     # k-shortest-paths precompute, shared by PSO/QPSO
      scenario.py               # scenario state, validation, default network gen (see §7)
      ws.py                     # WebSocket animation tick handler (see §6.2)
    tests/
      test_qpso_convergence.py # required before wiring QPSO into UI — see §5.3
  frontend/
    src/
      components/
        NetworkCanvas.tsx        # road/junction rendering per §2
        VehicleLayer.tsx         # vehicle sprites + ego vehicle, per §2
        ControlPanel.tsx        # node/edge editing
        VehiclePanel.tsx        # drag-and-drop vehicles
        ConditionPanel.tsx      # weather/incident/signal toggles
        AlgorithmPanel.tsx      # algorithm select + Compare All
        BenchmarkDashboard.tsx  # table + convergence chart
      theme/
        tokens.ts               # §2 design tokens as constants
      store/
        scenarioStore.ts        # Zustand store
      api/
        client.ts               # REST + WS wrapper, matches §6 exactly
  scenarios/
    demo-small.json    # ~10 nodes / ~15 edges / ~100 vehicles
    demo-large.json    # ~55 nodes / ~140 edges / ~950 vehicles
  PROGRESS.md          # agent updates after each phase — see §10
```

---

## 4. Core data model (exact — do not invent fields)

```json
{
  "nodes": [
    { "id": "N1", "x": 120, "y": 80, "signal": true, "greenSplit": 0.5 }
  ],
  "edges": [
    { "id": "E1", "from": "N1", "to": "N2", "lengthM": 500,
      "lanes": 2, "laneWidthM": 3.5, "speedLimitKph": 50,
      "oneWay": false, "incident": null, "backgroundLoad": 0 }
  ],
  "vehicles": { "cars": 40, "trucks": 6, "buses": 2 },
  "egoVehicle": { "origin": "N1", "destination": "N2" },
  "weather": { "type": "rain", "intensity": 0.6 },
  "weights": { "wT": 1.0, "wD": 1.0, "wC": 1.0 }
}
```

`incident` on an edge, when present, is exactly one of:

```json
{ "type": "closure" }
{ "type": "slowdown", "factor": 3.0 }
```

---

## 5. Algorithm specs (exact math — implement exactly this, no approximation)

### 5.1 Edge cost function

```
base_time_min(length, speedLimitKph) = (lengthM / 1000) / speedLimitKph × 60

capacity(lanes) = lanes × 15          # CAPACITY_PER_LANE = 15 vehicle-equivalents
load_ratio(load, lanes) = load / capacity(lanes)
congestion_multiplier(load, lanes) = min(1 + 3 × load_ratio², 6.0)

weather_multiplier(type, intensity):
    clear -> 1.0                       # intensity ignored for clear
    rain  -> 1 + 0.5 × intensity       # e.g. intensity 0.6 -> 1.3
    fog   -> 1 + 0.8 × intensity       # e.g. intensity 0.6 -> 1.48

incident_multiplier(incident):
    null                    -> 1.0
    {type: "closure"}       -> edge is EXCLUDED from the graph entirely for this run
                                (not a multiplier — remove the edge before pathfinding)
    {type: "slowdown", factor} -> factor   # use the given factor directly, default 3.0 if omitted

edge_cost_min = base_time_min(length, speedLimitKph)
              × congestion_multiplier(load, lanes)
              × weather_multiplier(weather.type, weather.intensity)
              × incident_multiplier(edge.incident)
```

`load` for an edge = number of vehicle-equivalents currently assigned to it, where `truck` and `bus` each count as 2 vehicle-equivalents and `car` counts as 1 (this is the load figure used everywhere in this document and in the UI's edge-load display).

`backgroundLoad` is an optional per-edge count of vehicle-equivalents already present on that road. Legacy scenarios that omit it are treated as `0`. During PSO/QPSO evaluation, `effectivePlanningLoad = backgroundLoad + optimizerAssignedLoad`. The optimizer-assigned component is hypothetical planning state, not a second set of rendered vehicles. During actual ego traversal, all algorithms use the same scenario `backgroundLoad` environment.

**Baseline (pre-run) load — display-only, used before any `/run` has executed:**

```
totalVehicleEquivalents = 2×trucks + 2×buses + cars     (from scenario.vehicles)
baseline_load_per_edge  = round(totalVehicleEquivalents / edgeCount)   # same value, every edge
```

This uniform split exists only so §2's road-congestion glow and background-traffic sprite count, and Phase 3's "edge costs recompute live with no run required" behavior, have a display value before the user has triggered an algorithm. When any edge has an explicit `backgroundLoad`, those per-edge values replace the uniform display heuristic. The uniform fallback is not a routing input: Dijkstra/A\* (§5.3) always use `load = 0`, while PSO/QPSO (§5.5) use explicit scenario background loads plus their own candidate-path load distribution. Once any `/run` has completed, the frontend should use the run's planning/actual load data for the appropriate view until the network, vehicle counts, weather, or incidents change again.

**Congestion display buckets** (drives §2's road-glow color and the flow sprite speed):

* `congestion_multiplier < 1.3` → free (`--flow-free`)
* `1.3 ≤ congestion_multiplier < 2.5` → moderate (`--flow-moderate`)
* `congestion_multiplier ≥ 2.5` → congested (`--flow-congested`)

### 5.2 Objective function (prototype version — 3 terms only)

```
J = wT·T + wD·D + wC·C
```

* `T` = travel time (minutes) of the ego vehicle's route, summing `edge_cost_min` over its edges under the current load distribution.
* `D` = total distance (km) of the ego vehicle's route, `sum(lengthM) / 1000`.
* `C` = mean `congestion_multiplier` across every edge that has nonzero load in the current run.
* `wT, wD, wC` default to `1.0`, user-adjustable via `scenario.weights` (§4). Lower `J` is better; every algorithm minimizes it.

### 5.3 Dijkstra / A\*

* NetworkX built-ins (`nx.dijkstra_path`, `nx.astar_path`), run on the graph with `edge_cost_min` (§5.1) as edge weight, computed once using each edge's **static** load = 0 (i.e., these two algorithms ignore vehicle-load congestion and route purely on free-flow + weather + incident cost — this is intentional: it's what makes PSO/QPSO's load-aware routing a meaningful point of comparison).
* A\* heuristic: straight-line Euclidean distance between node `(x, y)` pairs, converted to a time estimate by dividing by the network's maximum `speedLimitKph` (an admissible heuristic).
* **Length invariant (exact):** for this heuristic to stay admissible, every edge must satisfy `lengthM ≥ geometricDistance(from, to) × 2.5` (the same scale factor §7's generator uses), where `geometricDistance` is the straight-line pixel distance between the two nodes' current `(x, y)`. This is enforced in exactly two places, with different behavior:
  * **Explicit user edits** (typing a new `lengthM` in the road inspector, or importing a scenario): reject the value with a clear inline error if it violates the invariant. This is the only place a hard rejection is correct.
  * **Node position changes** (dragging a node, via `PATCH /scenario/nodes/{id}`): **never** reject or block the move because of a connected edge's `lengthM`. A node drag must always land exactly where released, per the Dragging rule above — full stop. Instead, for every edge connected to the moved node, silently auto-update `lengthM = max(currentLengthM, newGeometricDistance × 2.5)` as part of the same node-move transaction, so the invariant is preserved without ever blocking or reverting the drag. The user only sees a validation error when *they* type an invalid length, never as a side effect of moving a node.
* Output: `{ route: [nodeIds], time: T, distance: D, objective_score: J }` computed by plugging the resulting path into §5.2 with load = 0 everywhere (so `C = 1.0`).

### 5.4 Candidate paths (shared setup for PSO and QPSO)

Before running PSO or QPSO, precompute:

```
K = 8
candidate_paths = first K paths from nx.shortest_simple_paths(graph, origin, destination, weight=edge_cost_min)
                   using load=0 static cost, stopping early if a candidate path's cost exceeds
                   2.0 × the shortest candidate's cost (do not include paths worse than 2x optimal)
```

If fewer than `K` paths exist (small/sparse networks), use however many exist — never error; a network with only 1 valid path just means PSO/QPSO collapse to that path, which is a valid and expected result to show on screen.

### 5.5 Particle encoding (identical for classical PSO and QPSO)

Each particle has `K + 1` real-valued dimensions, each initialized uniformly in `[0, 1]`:

```
dims[0 .. K-1]  -> softmax'd into a background-load split: what fraction of the
                   scenario's total vehicle-equivalents (§5.1) is routed along each
                   of the K candidate paths
dims[K]         -> the ego vehicle's own path choice: egoPathIndex = round(dims[K] × (K - 1))
```

**Fitness evaluation for a given particle position:**

1. `softmaxWeights = softmax(dims[0..K-1])`
2. `totalLoad = 2×trucks + 2×buses + cars` (vehicle-equivalents, from §5.1's counting rule)
3. For each candidate path `k`, distribute `softmaxWeights[k] × totalLoad` vehicle-equivalents evenly across that path's edges, and sum contributions across paths onto shared edges (an edge used by two candidate paths accumulates load from both).
4. Recompute `edge_cost_min` for every edge that received load, using the `congestion_multiplier` from step 3's load (weather/incident multipliers unchanged).
5. `egoPathIndex = round(dims[K] × (K-1))`; the ego vehicle's route = `candidate_paths[egoPathIndex]`.
6. `T` = sum of the (now load-adjusted) `edge_cost_min` over the ego route's edges. `D` = ego route distance. `C` = mean `congestion_multiplier` over all edges with nonzero load from step 3.
7. Fitness = `J` from §5.2. Lower is better; both PSO and QPSO minimize it.

This encoding is what makes PSO/QPSO directly comparable to each other (same fitness, same search space) while giving them something Dijkstra/A\* cannot do: reason about how spreading background traffic across alternate routes changes the ego vehicle's best path.

### 5.6 Classical PSO — exact hyperparameters

```
swarmSize = 30
maxIterations = 60
w  = 0.7        # inertia
c1 = 1.5        # cognitive (personal-best) coefficient
c2 = 1.5        # social (global-best) coefficient
velocityClamp = [-0.5, 0.5] per dimension, per iteration
positionClamp = [0, 1] per dimension (clip after update)

For each iteration:
  for each particle:
    v = w×v + c1×rand()×(pbest - x) + c2×rand()×(gbest - x)   # clamp v
    x = x + v                                                    # clamp x to [0,1]
    evaluate fitness(x) per §5.5
    update pbest if improved
  update gbest if any particle improved
  record best fitness this iteration -> convergence_curve point
Stop early if gbest fitness does not improve for 10 consecutive iterations, OR maxIterations reached.
```

### 5.7 QPSO — exact hyperparameters

Same particle encoding, same fitness (§5.5), same `swarmSize = 30`, `maxIterations = 60`, same early-stop rule. No velocity term.

```
betaStart = 1.0
betaEnd   = 0.5
beta(iteration) = betaStart - (betaStart - betaEnd) × (iteration / maxIterations)   # linear anneal

For each iteration:
  mbest = mean(pbest across all particles), per dimension
  for each particle:
    for each dimension d:
      phi = rand(0,1)
      p_d = phi × pbest[d] + (1 - phi) × gbest[d]        # local attractor
      u = rand(0,1)
      sign = +1 if rand(0,1) > 0.5 else -1
      x[d] = p_d + sign × beta(iteration) × abs(mbest[d] - x[d]) × ln(1 / u)
    clip x to [0, 1] per dimension
    evaluate fitness(x) per §5.5
    update pbest if improved
  update gbest if any particle improved
  record best fitness this iteration -> convergence_curve point
```

**Before wiring QPSO into the UI**, implement `qpso.py` as its own module and write `tests/test_qpso_convergence.py`: build a trivial 5-node, 2-candidate-path graph with a clear optimal load split, run QPSO for 60 iterations, and assert the final `gbest` fitness is within 5% of the known-optimal `J` for that trivial case. Do not proceed to Phase 4's UI wiring until this test passes.

### 5.8 Run output contract

Every algorithm run (Dijkstra, A\*, PSO, QPSO) returns exactly:

```json
{
  "algorithm": "qpso",
  "route": ["N1", "N4", "N7", "N2"],
  "time": 4.8,
  "distance": 2.1,
  "objective_score": 9.7,
  "iterations": 42,
  "optimization_time_ms": 812,
  "convergence_curve": [ { "iteration": 0, "bestFitness": 18.2 }, ... ]
}
```

Dijkstra/A\* still populate `iterations: 1` and a single-point `convergence_curve` (for dashboard consistency, even though they don't iterate).

Implementations may additionally return `free_flow_time` (route cost with load zero), `actual_time` (route cost using scenario background loads), and `congestion` for the benchmark. `time` remains the algorithm's route-evaluation time: static for Dijkstra/A\* and traffic-aware optimizer cost for PSO/QPSO.

---

## 6. API contract (exact — implement exactly these endpoints, no more, no fewer, unless a later phase in §9 explicitly adds one)

### 6.1 REST endpoints


| Method | Path                            | Body                                                            | Response                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                       | —                                                              | `{ "status": "ok" }`                                                                                                                                                                                                                                                               |
| GET    | `/scenario`                     | —                                                              | full scenario object (§4)                                                                                                                                                                                                                                                         |
| PUT    | `/scenario`                     | full scenario object                                            | replaces entire in-memory scenario; returns it back                                                                                                                                                                                                                                |
| POST   | `/scenario/nodes`               | `{x, y, signal, greenSplit}`                                    | created node (server assigns`id`)                                                                                                                                                                                                                                                  |
| PATCH  | `/scenario/nodes/{id}`          | partial node fields                                             | updated node                                                                                                                                                                                                                                                                       |
| DELETE | `/scenario/nodes/{id}`          | —                                                              | `204`; also cascades: deletes any edge referencing this node                                                                                                                                                                                                                       |
| POST   | `/scenario/edges`               | `{from, to, lengthM, lanes, laneWidthM, speedLimitKph, oneWay, backgroundLoad?}` | created edge (server assigns`id`,`incident: null`, default `backgroundLoad: 0`)                                                                                                                                                                                                    |
| PATCH  | `/scenario/edges/{id}`          | partial edge fields                                             | updated edge                                                                                                                                                                                                                                                                       |
| DELETE | `/scenario/edges/{id}`          | —                                                              | `204`                                                                                                                                                                                                                                                                              |
| PUT    | `/scenario/vehicles`            | `{cars, trucks, buses}`                                         | updated vehicle counts                                                                                                                                                                                                                                                             |
| PUT    | `/scenario/ego`                 | `{origin, destination}`                                         | updated ego vehicle                                                                                                                                                                                                                                                                |
| PUT    | `/scenario/weather`             | `{type, intensity}`                                             | updated weather                                                                                                                                                                                                                                                                    |
| PUT    | `/scenario/edges/{id}/incident` | `{type, factor?}`or`null`to clear                               | updated edge                                                                                                                                                                                                                                                                       |
| PUT    | `/scenario/weights`             | `{wT, wD, wC}`                                                  | updated weights                                                                                                                                                                                                                                                                    |
| POST   | `/scenario/validate`            | —                                                              | `{ valid: bool, errors: [string] }`— checks: no orphan nodes (every node has ≥1 edge), a path exists between`egoVehicle.origin`and`egoVehicle.destination`ignoring`closure`incidents being temporarily lifted (validate against the*editable*graph, not the live-incident graph) |
| GET    | `/scenario/export`              | —                                                              | scenario JSON as a file download (`Content-Disposition: attachment`)                                                                                                                                                                                                               |
| POST   | `/scenario/import`              | scenario JSON body                                              | replaces in-memory scenario; runs the same validation as`/scenario/validate`and returns`{valid, errors}`alongside the scenario                                                                                                                                                     |
| POST   | `/run`                          | `{ "algorithm": "dijkstra" | "astar" | "pso" | "qpso" }`        | one result object per §5.8, computed against the**current**in-memory scenario                                                                                                                                                                                                     |
| POST   | `/run/compare-all`              | —                                                              | `{ "dijkstra": {...}, "astar": {...}, "pso": {...}, "qpso": {...} }`, each per §5.8                                                                                                                                                                                               |

Every mutating endpoint (`POST`/`PATCH`/`PUT`/`DELETE` under `/scenario`) returns `400` with `{ "error": string }` on invalid input (e.g. edge referencing a nonexistent node) — the frontend must surface this as an inline error, not a silent failure.

### 6.2 WebSocket — `/ws/animation`

Client → server messages:

```json
{ "type": "start", "route": ["N1","N4","N2"], "algorithm": "qpso", "speedMultiplier": 1.0 }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "reset" }
{ "type": "setSpeed", "speedMultiplier": 2.0 }   # changes speed of an in-progress run without restarting it
```

**Playback duration (exact — this is what makes animation watchable in a live demo):** the route's actual travel time `T` (§5.2, in simulated minutes) is never played back 1:1 against real time. Instead:

```
BASE_ROUTE_DURATION_SEC = 10   # real-world seconds to play the full route at speedMultiplier = 1,
                                 # regardless of the route's actual T — this decouples demo pacing
                                 # from simulated minutes, which would otherwise take minutes to watch
TICK_RATE = 10                 # ticks/second (unchanged)
progressPerTick = 1 / (BASE_ROUTE_DURATION_SEC × TICK_RATE) × speedMultiplier
```

Each tick, the ego's overall route progress (a 0→1 fraction of total route length, summed across all its edges) advances by `progressPerTick`; convert that overall progress into a specific `edgeId`/`progressOnEdge` by walking the route's edges in order, consuming length-proportional shares of the 0→1 range. `speedMultiplier` is exposed in the UI as three discrete options: **1×** (10s full-route playback), **2×** (5s), **4×** (2.5s) — a segmented control, not a free slider, placed next to the pause/resume/reset controls in the Operate panel (§2's page layout). Changing it mid-run sends `"setSpeed"` and continues from the current progress at the new rate; it does not restart the animation.

Server → client messages, sent once per tick (tick rate: 10 ticks/second while running):

```json
{
  "type": "tick",
  "simTimeSec": 4.2,
  "status": "running",
  "ego": { "edgeId": "E3", "progressOnEdge": 0.42, "x": 214.6, "y": 88.1, "headingDeg": 37 },
  "edgeLoads": [ { "edgeId": "E1", "load": 22, "congestionMultiplier": 1.6 }, ... ]
}
```

`status` is one of `"running" | "paused" | "complete"`. On `"complete"`, the server sends one final tick with `status: "complete"` and stops ticking until the next `"start"` or `"reset"`. The server computes `ego.x/y/headingDeg` by interpolating between the edge's `from`/`to` node coordinates using `progressOnEdge` and the edge's static geometry (straight line between nodes is sufficient — no curved roads required). **This `ego.x`/`ego.y` is in the same model coordinate space as every node's `x`/`y` in §4's data model — never raw screen pixels.** The frontend must render the ego sprite (and, per §2's background-flow rendering, every background vehicle sprite) inside the same Konva layer/group — sharing the exact same pan/zoom transform — as the roads and nodes. If the ego sprite appears at a fixed, route-independent position (commonly near whatever screen location model-coordinate `(0,0)` happens to project to before any pan/zoom, e.g. pinned near the canvas's top-left corner regardless of the actual route), that is a sign the vehicle layer is a separately-positioned overlay applying `ego.x`/`ego.y` directly as screen coordinates instead of passing them through the canvas's current transform like every other rendered element.

---

## 7. Default network generator (exact algorithm)

Used only when the user clicks the "Randomize network" button (Phase 1+) — never run automatically on load (see §8 Phase 1, which now starts from an empty scenario):

```
1. nodeCount = random integer in [10, 20]
2. Place nodes on a jittered grid: compute the smallest grid (rows × cols) that fits
   nodeCount cells, spacing = 140px, then for each node add random jitter of ±25px
   to both x and y.
3. Build a random spanning tree over the nodes (guarantees connectivity) by
   connecting each node (in random order, skipping the first) to a random
   already-connected node.
4. Add extra edges until edgeCount ≈ nodeCount × 1.3, preferring to connect
   geometrically nearby node pairs (nearest 4 neighbors by Euclidean distance)
   that aren't already connected, and never creating a self-loop or duplicate edge.
5. For every edge: lanes = random choice [1,1,2,2,3] (weighted toward 2),
   laneWidthM = 3.5, speedLimitKph = random choice [30,40,50,50,60],
   oneWay = 10% chance true, lengthM = Euclidean distance between the two
   nodes' (x,y) × 2.5 (a scale factor so pixel-distance maps to a plausible
   metres value), incident = null.
6. Signal: 30% of nodes get signal=true, greenSplit=0.5. The rest get signal=false.
7. Vehicles: cars = random[20,60], trucks = random[2,10], buses = random[0,4]. These ranges apply only to the live in-app default-network/"Randomize" action (Phase 1) — they are not used for the `demo-small.json`/`demo-large.json` fixture files, which use their own fixed vehicle counts given in §8 Phase 6.
8. Ego vehicle: origin = a random node, destination = a random node that is
   NOT origin and IS reachable from origin (retry until satisfied, or fall
   back to the two most distant connected nodes if random sampling fails
   after 20 tries).
9. Weather: type = "clear", intensity = 0.
10. weights: wT=1.0, wD=1.0, wC=1.0.
```

---

## 8. Phase-by-phase build plan

Each phase has an explicit **Definition of Done**. Do not move to the next phase until DoD is met; append a line to `PROGRESS.md` (§10) confirming it. **Build one phase per session** — do not attempt to implement the entire spec in a single pass; start each new session by reading `PROGRESS.md` back first.

**Phase 1 — Scaffolding + graph model + base rendering**

* FastAPI skeleton + React/Vite/Konva skeleton, talking to each other (`GET /health` round-trip).
* `graph_model.py`: Node/Edge/Graph classes, cost function exactly per §5.1.
* `scenario.py`: the app starts from an **empty** scenario (`nodes: []`, `edges: []`, `vehicles: {cars:0,trucks:0,buses:0}`, `egoVehicle: null`) served via `GET /scenario` on startup — the §7 generator is never run automatically. A "Randomize network" button (visible at all times, in the canvas header per §2's layout) calls the §7 generator on demand and replaces the current scenario with its output.
* Canvas shows a clear empty state when there are no nodes: centered helper text such as "Click the canvas to add an intersection, or Randomize" — never a blank void with no guidance.
* Canvas renders whatever scenario is current (empty, hand-built, or randomized) using the road/junction rendering from §2 (not placeholder lines/circles) — lane-width-scaled roads, dashed centerlines, signal dots.
* DoD: open the app, see the empty state described above with no console errors; clicking "Randomize network" populates the canvas with a network *looking like §2's spec*; `GET /scenario` returns the empty scenario on a fresh start and a scenario matching §4/§7 after randomizing.

**Phase 2 — Network editor**

* Implement the canvas interaction model exactly per §2's "Canvas interaction model" — click-to-create nodes/edges on the canvas, side panel as a selected-element inspector, not a coordinate-entry form. Wire the inspector to the node/edge CRUD endpoints in §6.1.
* Signal toggle + green-split slider per node (in the inspector, when a signal node is selected), reflected live as the flipping red/green dot per §2's signal cycle.
* Wire `POST /scenario/validate`, surface `errors` inline per the §6.1 error-handling rule. Ego origin/destination selection stays out of this phase — see §2.
* DoD: build a network from scratch entirely by clicking/dragging on the canvas, no typed coordinates required for the base workflow; it validates correctly per §6.1's rule; road width visibly updates when lane count changes.

**Phase 3 — Vehicles & conditions**

* `VehiclePanel.tsx` wired to `PUT /scenario/vehicles` and `PUT /scenario/ego`; sprites render per §2 (size/color by type from §2's exact pixel values).
* `ConditionPanel.tsx` wired to `PUT /scenario/weather` and `PUT /scenario/edges/{id}/incident`, with the scene-effect overlays from §2.
* Edge costs recompute immediately (client re-fetches `/scenario` or computes client-side preview) on any condition change — road surface glow and background sprite counts update per §5.1's baseline load formula and the §5.1 congestion buckets, not just a number.
* DoD: changing weather/incident/vehicle counts visibly changes both displayed edge costs and canvas appearance (glow + sprite density, using baseline load) with no `/run` call required.

**Phase 4 — Algorithms**

* Implement Dijkstra, A\* exactly per §5.3.
* Implement `candidate_paths.py` exactly per §5.4.
* Implement PSO exactly per §5.5–§5.6, QPSO exactly per §5.5+§5.7.
* Write and pass `tests/test_qpso_convergence.py` (§5.7) **before** wiring QPSO to any endpoint.
* Expose `/run` and `/run/compare-all` exactly per §6.1, returning the exact shape in §5.8.
* DoD: `/run` returns correct, comparable results for all four algorithms on `demo-small.json`; the QPSO convergence unit test passes.

**Phase 5 — Animation + wiring**

* Implement `/ws/animation` exactly per §6.2.
* Ego vehicle animates along its route per §2 (glow/pulse, heading rotation from `headingDeg`), visually distinct from background traffic.
* Roads live-recolor by congestion using the §5.1 buckets and §2's gradient wash.
* Pause/resume/reset controls wired to the `"pause"/"resume"/"reset"` WS messages.
* DoD: running an algorithm produces a visible, controllable animation matching the returned route at 10 ticks/sec, and it looks like moving traffic, not moving dots.

**Phase 6 — Benchmark dashboard + save/load**

* `BenchmarkDashboard.tsx`: a compact comparison **grid**, metrics as rows and algorithms as columns (Time ms / Iterations / Travel time / Distance / Congestion / Objective score down the left, Dijkstra | A\* | PSO | QPSO across the top) — not one stacked card per algorithm, which is too tall for the Operate panel's width. Column headers use each algorithm's accent color (`--accent-qpso`, `--accent-pso`; Dijkstra/A\* use `--text-primary`, no accent). All values in the monospace numeric-readout tier (§2 typography table). Populate from `/run/compare-all`'s response shape.
* Convergence curve (Recharts) plotting each result's `convergence_curve` for PSO and QPSO.
* `GET /scenario/export` / `POST /scenario/import` wired to UI buttons; author two fixture files by running the §7 generator for node/edge layout, then overwriting the generated `vehicles` field with these exact fixed values (§7's random vehicle ranges apply only to the live default-network action, not these fixtures) and hand-adjusting node/edge counts until topology size matches:
  * `demo-small.json`: \~10 nodes / \~15 edges, `vehicles: { "cars": 80, "trucks": 15, "buses": 5 }` (total 100).
  * `demo-large.json`: \~55 nodes / \~140 edges, `vehicles: { "cars": 800, "trucks": 120, "buses": 30 }` (total 950).
* DoD: "Compare All" populates the table and chart correctly from the exact response shape in §6.1; a saved-then-reloaded scenario is byte-identical to the original JSON (aside from `id` reassignment on import, which must preserve the original ids).

**Phase 7 — Integration, deep review, and finishing pass**

This phase is not "add more features" — it is closing the gap between "the DoD boxes got checked" and "this actually works and looks finished." Go through every subsection below in order; do not skip to bug fixing before the audit, since the audit is what tells you what to fix.

**7.1 — Full spec-conformance audit (do this first, before touching code)** Re-read this entire spec §0–§8 top to bottom, and for every numbered rule/formula/endpoint, check the running app against it and note any mismatch — do not assume a phase is correct just because its own DoD was marked done earlier; cross-phase interactions (e.g. Phase 3's baseline load vs Phase 4's real run load, per §5.1) are exactly where regressions hide. Specifically verify:

* Every `edge_cost_min` component (§5.1) matches the formula exactly — put a breakpoint/log on one edge and hand-calculate the expected value for a known load/weather/incident combination, compare.
* Dijkstra/A\* genuinely use `load = 0` (§5.3) and PSO/QPSO genuinely compute their own load from the candidate-path split (§5.5) — confirm these haven't drifted onto the same code path.
* Every REST endpoint in §6.1's table exists, accepts the documented body, and returns the documented shape — call each one directly (curl/Postman) once, don't just trust the UI never hitting an edge case.
* The WS message shapes in §6.2 match exactly, including `status` transitioning to `"complete"` correctly.
* The signal cycle (§2) is still running off its own local clock, independent of WS ticks, and flips at the correct `greenSplit`-derived boundary.
* The QPSO convergence test (§5.7) still passes.

**7.2 — Accessibility**

* Keyboard: every control in every panel (node/edge inspector, vehicle counts, weather/incident toggles, algorithm picker, Compare All, pause/resume/reset, save/load) must be reachable via Tab in a logical order and operable via Enter/Space, with a visible focus ring (`--accent-ego` or `--accent-qpso` outline, 2px, never removed via `outline: none` without a replacement).
* Contrast: verify `--text-primary` on `--bg-panel` and `--text-dim` on `--bg-panel` both meet WCAG AA (4.5:1 for normal text, 3:1 for large text/icons) at the panel's actual opacity (85%) over `--bg-void`, not over white — check the composited color, not the token alone.
* Every icon-only control (delete, pause/resume/reset, close) has an `aria-label` describing its action, not just a tooltip.
* Sliders (green-split, weather intensity) expose current value via `aria-valuenow`/`aria-valuetext` so it's announced, not just shown visually.
* Canvas content (roads, vehicles, signals) is supplementary to control-panel state, not the only place information exists — a screen-reader user should still be able to tell how many nodes/edges exist and what's selected from the panel text, not only from the canvas.

**7.3 — UI polish and placement**

* Re-check every element against §2's exact pixel/color values (road width formula, vehicle sprite sizes, ego pulse ring, dash patterns, junction sizing) — measure, don't eyeball; if something was approximated during an earlier phase under time pressure, fix it now to the exact spec values.
* No overlapping panels, no controls clipped or hidden behind the canvas at the app's default window size and at a typical laptop 1366×768.
* Every readout that should be monospace (ETA, iteration count, objective score, per §2's typography rule) actually is — audit for places that quietly fell back to the UI sans font.
* Empty/zero states (no nodes yet, no run yet, `convergence_curve` empty) render something intentional, not a blank panel or a chart library error.
* Loading and in-flight states: `/run` and `/run/compare-all` can take up to 5s — the UI must show a clear busy state (disable the trigger button, show a spinner or progress indicator) for the whole duration, not appear frozen.

**7.4 — Performance at the hard cap**

* Build or generate a scenario at the literal cap (60 nodes / 150 edges / 1,000 vehicles). Run every one of Dijkstra, A\*, PSO, QPSO individually and via Compare All; confirm every `/run` response returns in <5s wall-clock, measured from the actual HTTP request, not just `optimization_time_ms` in the payload.
* If any run exceeds 5s, first reduce `maxIterations` in §5.6/§5.7 (try 40, then 30) before touching anything else — never reduce the network-size cap to hit this.
* Confirm canvas rendering (road glow updates, background sprite animation, ego pulse) stays visually smooth at this scale — no obvious frame stutter during an active WS-driven animation with all 150 edges rendering flow sprites.
* Confirm memory/CPU stay stable across at least 5 consecutive Compare All runs in a row (no obvious leak from repeated particle-swarm allocation).

**7.5 — Bug fixing and demo rehearsal**

* Fix everything surfaced by 7.1–7.4, prioritizing correctness (7.1) and performance (7.4) over polish (7.3) if time is short.
* Full demo run-through, cold start, using the exact flow: open app → build/edit a network by hand → place vehicles and designate ego → toggle weather → trigger an incident → run Compare All → watch the animation → read the benchmark dashboard → export the scenario → reload it and confirm it's identical.
* Run the same flow once more using `demo-small.json` and once using `demo-large.json` as the starting import, to confirm the fallback scenarios (§8 Phase 6) work end-to-end, not just the hand-built path.

**DoD:** every item in 7.1–7.4 has been checked and any mismatch fixed (not just noted); the cold-start → full demo script in 7.5 runs without manual intervention or console errors on a hand-built scenario and on both fixture files; the canvas is the thing a viewer's eye goes to. Record in `PROGRESS.md` (§10) exactly what was found and fixed in each of 7.1–7.4, not just "Phase 7 done" — this is the final entry and should be detailed enough that someone reading only `PROGRESS.md` knows the app's actual state without re-running it.

---

## 9. Explicitly out of scope — do not add these

Real map import, SUMO, camera/CV, live weather API, predictive/forecast layer, probabilistic robust-routing, GA, OR-Tools/CP-SAT, any database, any cloud deployment, curved/bezier road rendering, per-vehicle microscopic physics for background traffic. These belong to the *final* Q-Flow product, not this prototype. If asked to add any of these "for realism," reject it as scope creep.

---

## 10. `PROGRESS.md` — keep the agent honest across sessions

Maintain this file, updated at the end of every phase:

```
## Phase N — [name] — DONE [date]
- What was built
- What deviated from this spec, and why (deviations from §5's formulas or §6's
  API contract must be flagged here explicitly — they should be rare)
- What's left / known issues
```

Read this file back at the start of every new session, before starting the next phase — this is what prevents context loss between sessions from causing re-litigated decisions or silent scope drift.
