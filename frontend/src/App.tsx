import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'
import { api } from './api/client'
import AnimationPanel from './components/AnimationPanel'
import BenchmarkDashboard from './components/BenchmarkDashboard'
import ControlPanel from './components/ControlPanel'
import ConditionPanel from './components/ConditionPanel'
import NetworkCanvas from './components/NetworkCanvas'
import VehiclePanel from './components/VehiclePanel'
import { generateRandomScenario } from './randomScenario'
import { useQFlowStore } from './store'
import { resolveEdgeLoads } from './traffic'
import type { AnimationTick, CompareAllResults, RouteOverlay, Scenario } from './types'

const EMPTY_SCENARIO: Scenario = {
  nodes: [],
  edges: [],
  vehicles: { cars: 0, trucks: 0, buses: 0 },
  egoVehicle: null,
  weather: { type: 'clear', intensity: 0 },
  weights: { wT: 1, wD: 1, wC: 1 },
}

type ResizablePanel = 'build' | 'operate'
type ResizeGesture = { panel: ResizablePanel; pointerId: number; startX: number; startWidth: number; cursor: string; userSelect: string }
const PANEL_WIDTH_MIN = 280
const PANEL_WIDTH_MAX = 560

function moveNodeAndGrowRoads(current: Scenario, nodeId: string, x: number, y: number): Scenario {
  const nodes = current.nodes.map((node) => node.id === nodeId ? { ...node, x, y } : node)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = current.edges.map((edge) => {
    if (edge.from !== nodeId && edge.to !== nodeId) return edge
    const from = nodeById.get(edge.from)!, to = nodeById.get(edge.to)!
    const minimumLength = Math.hypot(to.x - from.x, to.y - from.y) * 2.5
    return { ...edge, lengthM: Math.max(edge.lengthM, minimumLength) }
  })
  return { ...current, nodes, edges }
}

export default function App() {
  const { scenario, setScenario, selection, setSelection, animationTick, setAnimationTick, activeAnimation, setActiveAnimation } = useQFlowStore()
  const [error, setError] = useState('')
  const [canvasVersion, setCanvasVersion] = useState(0)
  const [viewVersion, setViewVersion] = useState(0)
  const [fitVersion, setFitVersion] = useState(0)
  const [routeOverlay, setRouteOverlay] = useState<RouteOverlay | null>(null)
  const [benchmarkResults, setBenchmarkResults] = useState<CompareAllResults | null>(null)
  const [animationGeneration, setAnimationGeneration] = useState(0)
  const [buildPanelWidth, setBuildPanelWidth] = useState(420)
  const [operatePanelWidth, setOperatePanelWidth] = useState(420)
  const resizeGesture = useRef<ResizeGesture | null>(null)
  const nodeCreateQueue = useRef(Promise.resolve())
  const appMountedAt = useRef<number>(performance.now()).current
  const edgeLoadsSignature = animationTick ? JSON.stringify(animationTick.edgeLoads) : ''
  const displayEdgeLoads = useMemo(() => scenario ? resolveEdgeLoads(scenario, animationTick) : [], [scenario?.edges, scenario?.vehicles, edgeLoadsSignature])
  const handleBenchmarkResults = useCallback((results: CompareAllResults | null) => setBenchmarkResults(results), [])

  useEffect(() => {
    setAnimationTick(null)
    setActiveAnimation(null)
    setAnimationGeneration((value) => value + 1)
  }, [scenario?.nodes, scenario?.edges, scenario?.vehicles, scenario?.weather, scenario?.egoVehicle, setAnimationTick, setActiveAnimation])

  function handleAnimationTick(tick: AnimationTick | null) {
    if (!tick) {
      setAnimationTick(null)
      return
    }
    const current = useQFlowStore.getState().activeAnimation
    if (!current || current.runId !== tick.runId || current.algorithm !== tick.algorithm) return
    setActiveAnimation({ ...current, route: tick.route, routeEdgeIds: tick.routeEdgeIds })
    setAnimationTick(tick)
  }

  function panelWidth(panel: ResizablePanel) {
    return panel === 'build' ? buildPanelWidth : operatePanelWidth
  }

  function setPanelWidth(panel: ResizablePanel, width: number) {
    const bounded = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width))
    if (panel === 'build') setBuildPanelWidth(bounded)
    else setOperatePanelWidth(bounded)
  }

  function beginPanelResize(panel: ResizablePanel, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeGesture.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth(panel),
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function movePanelResize(event: PointerEvent<HTMLDivElement>) {
    const gesture = resizeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const direction = gesture.panel === 'build' ? 1 : -1
    setPanelWidth(gesture.panel, gesture.startWidth + (event.clientX - gesture.startX) * direction)
  }

  function endPanelResize(event: PointerEvent<HTMLDivElement>) {
    const gesture = resizeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    document.body.style.cursor = gesture.cursor
    document.body.style.userSelect = gesture.userSelect
    resizeGesture.current = null
  }

  function keyboardResize(panel: ResizablePanel, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Home') { event.preventDefault(); setPanelWidth(panel, PANEL_WIDTH_MIN); return }
    if (event.key === 'End') { event.preventDefault(); setPanelWidth(panel, PANEL_WIDTH_MAX); return }
    const step = event.shiftKey ? 32 : 16
    if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth(panel, panelWidth(panel) + step) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth(panel, panelWidth(panel) - step) }
  }

  function panelResizeHandle(panel: ResizablePanel, className: string, label: string) {
    return <div
      className={`panel-resize-handle ${className}`}
      role="separator"
      aria-label={`${label} panel width`}
      aria-orientation="vertical"
      aria-valuemin={PANEL_WIDTH_MIN}
      aria-valuemax={PANEL_WIDTH_MAX}
      aria-valuenow={panelWidth(panel)}
      aria-controls={`${panel}-panel`}
      tabIndex={0}
      onKeyDown={(event) => keyboardResize(panel, event)}
      onPointerDown={(event) => beginPanelResize(panel, event)}
      onPointerMove={movePanelResize}
      onPointerUp={endPanelResize}
      onPointerCancel={endPanelResize}
      onLostPointerCapture={endPanelResize}
    />
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const healthBody = await api.getHealth()
        if (healthBody.status !== 'ok') throw new Error('Backend health check failed')
        const scenarioBody = await api.getScenario()
        if (!cancelled) {
          setScenario(scenarioBody)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not reach the Q-Flow API')
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  function moveNode(id: string, x: number, y: number) {
    setScenario((current) => current ? moveNodeAndGrowRoads(current, id, x, y) : current)
    const revision = useQFlowStore.getState().beginScenarioEdit()
    void api.patchNode(id, { x, y }).then((saved) => {
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? moveNodeAndGrowRoads(current, id, saved.x, saved.y) : current)
      setError('')
    }).catch(async (cause) => {
      setError(cause instanceof Error ? cause.message : 'Could not move node')
      try { const fresh = await api.getScenario(); useQFlowStore.getState().setScenarioIfRevision(revision, fresh) } catch { /* keep the movement error visible */ }
    }).finally(() => useQFlowStore.getState().finishScenarioEdit())
  }

  async function randomize() {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const next = await api.replaceScenario(generateRandomScenario())
      if (!useQFlowStore.getState().setScenarioIfRevision(revision, next)) return
      setSelection(null)
      setAnimationTick(null)
      setActiveAnimation(null)
      setCanvasVersion((current) => current + 1)
      setViewVersion((current) => current + 1)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not randomize the network')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function clearNetwork() {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const next = await api.replaceScenario(EMPTY_SCENARIO)
      if (!useQFlowStore.getState().setScenarioIfRevision(revision, next)) return
      setSelection(null)
      setAnimationTick(null)
      setActiveAnimation(null)
      setCanvasVersion((current) => current + 1)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear the network')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function createNodeAt(x: number, y: number) {
    const create = async () => {
      try {
        const created = await api.createNode({ x, y, signal: false, greenSplit: 0.5 })
        setScenario((current) => current ? { ...current, nodes: [...current.nodes, created] } : current)
        setSelection({ type: 'node', id: created.id })
        setError('')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not create intersection')
      }
    }
    const queued = nodeCreateQueue.current.then(create, create)
    nodeCreateQueue.current = queued.then(() => undefined, () => undefined)
    await queued
  }

  async function createEdge(from: string, to: string) {
    const fromNode = scenario?.nodes.find((node) => node.id === from)
    const toNode = scenario?.nodes.find((node) => node.id === to)
    if (!fromNode || !toNode) return
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const created = await api.createEdge({
        from,
        to,
        lengthM: Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) * 2.5,
        lanes: 2,
        laneWidthM: 3.5,
        speedLimitKph: 50,
        oneWay: false,
      })
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, edges: [...current.edges, created] } : current)
      setSelection({ type: 'edge', id: created.id })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create road')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  return (
    <main className="control-room">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div>
            <div className="brand-name">QIRA</div>
          </div>
        </div>
      </header>

      <section className="workspace" style={{ '--build-panel-width': `${buildPanelWidth}px`, '--operate-panel-width': `${operatePanelWidth}px` } as CSSProperties}>
        <aside id="build-panel" className="console-panel build-panel" aria-label="Build">
          {panelResizeHandle('build', 'build-resize-handle', 'Build')}
          <div className="panel-head"><div><h2>Build</h2><p className="panel-context">Construct the road network and vehicles</p></div></div>
          {scenario ? <div className="panel-scroll">
            <ControlPanel scenario={scenario} selection={selection} onSelectionChange={setSelection} onScenarioChange={setScenario} />
            <VehiclePanel scenario={scenario} onScenarioChange={setScenario} />
          </div> : <div className="panel-placeholder">Awaiting scenario data</div>}
        </aside>

        <div className="map-shell">
          <div className="map-heading">
            <h1>Network map</h1>
            {scenario && <div className="map-counts" aria-label="Network size"><span>Nodes <b>{scenario.nodes.length}</b></span><span>Edges <b>{scenario.edges.length}</b></span></div>}
            <div className="canvas-actions">
              <button className="button button-quiet" type="button" onClick={() => void randomize()}>Randomize network</button>
              <button className="button button-quiet" type="button" onClick={() => void clearNetwork()}>Clear network</button>
              <button className="button button-quiet" type="button" onClick={() => setFitVersion((value) => value + 1)}>Fit view</button>
            </div>
          </div>
          <div className="map-body">
            <div className="map-grid" />
            {scenario ? <NetworkCanvas key={viewVersion} fitVersion={fitVersion} routeOverlay={routeOverlay} nodes={scenario.nodes} edges={scenario.edges} vehicles={scenario.vehicles} weather={scenario.weather} animationTick={animationTick} edgeLoads={displayEdgeLoads} selection={selection} startedAt={appMountedAt} onElementSelect={setSelection} onCanvasCreateNode={createNodeAt} onCreateEdge={createEdge} onNodeMove={moveNode} /> : (
              <div className="map-message">
                {error ? <><strong>Network unavailable</strong><span>{error}</span><small>Start the API from the backend folder with <code>uvicorn app.main:app --reload</code>.</small></> : <><span className="loader" /><span>Connecting to network service…</span></>}
              </div>
            )}
            {scenario && error && <div className="canvas-error" role="alert">{error}</div>}
          </div>
          <div className="map-footer">
            <span><i className="legend-road" /> Road surface</span>
            <span><i className="legend-lane" /> Lane marking</span>
            <span><i className="legend-signal" /> Signalized intersection</span>
            <span><i className="vehicle-type-sprite car" /> Car</span>
            <span><i className="vehicle-type-sprite truck" /> Truck</span>
            <span><i className="vehicle-type-sprite bus" /> Bus</span>
            <span><i className="vehicle-type-sprite ego" /> Ego</span>
          </div>
        </div>

        <aside id="operate-panel" className="console-panel operate-panel" aria-label="Operate">
          {panelResizeHandle('operate', 'operate-resize-handle', 'Operate')}
          <div className="panel-head">
            <div><h2>Operate</h2><p className="panel-context">Set conditions and compare routes</p></div>
          </div>
          {scenario ? <div className="panel-scroll">
            <ConditionPanel scenario={scenario} edgeLoads={displayEdgeLoads} selection={selection} onScenarioChange={setScenario} />
            <AnimationPanel key={canvasVersion} activeAnimation={activeAnimation} benchmarkResults={benchmarkResults} onActiveAnimation={setActiveAnimation} onTick={handleAnimationTick} invalidateToken={animationGeneration} disabled={!scenario.nodes.length || !scenario.egoVehicle} />
            <BenchmarkDashboard scenario={scenario} onRouteOverlay={setRouteOverlay} onResults={handleBenchmarkResults} onImport={(next) => { setScenario(next); setSelection(null); setAnimationTick(null); setActiveAnimation(null); setRouteOverlay(null); setBenchmarkResults(null); setCanvasVersion((current) => current + 1); setViewVersion((current) => current + 1) }} />
          </div> : <div className="panel-placeholder">Awaiting scenario data</div>}
        </aside>
      </section>
    </main>
  )
}
