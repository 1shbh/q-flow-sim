import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { generateDemoScenario, generateQpsoLandscapeScenario, type DemoScenarioKind } from '../randomScenario'
import type { CompareAllResults, RouteOverlay, RunResult, Scenario } from '../types'
import { useQFlowStore } from '../store'

type Props = {
  scenario: Scenario
  onImport: (scenario: Scenario) => void
  onRouteOverlay: (routes: RouteOverlay | null) => void
  onResults: (results: CompareAllResults | null) => void
}

const ALGORITHMS: RunResult['algorithm'][] = ['dijkstra', 'astar', 'pso', 'qpso']
const NAMES: Record<RunResult['algorithm'], string> = {
  dijkstra: 'Dijkstra',
  astar: 'A*',
  pso: 'PSO',
  qpso: 'QPSO',
}
const WEIGHT_LABELS: Record<'wT' | 'wD' | 'wC', string> = {
  wT: 'Travel Time Weight',
  wD: 'Distance Weight',
  wC: 'Congestion Weight',
}
const ConvergenceChart = lazy(() => import('./ConvergenceChart'))

export default function BenchmarkDashboard({ scenario, onImport, onRouteOverlay, onResults }: Props) {
  const pendingScenarioEdits = useQFlowStore((state) => state.pendingScenarioEdits)
  const [results, setResults] = useState<CompareAllResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [weightDraft, setWeightDraft] = useState(scenario.weights)
  const [successfulScenario, setSuccessfulScenario] = useState('')
  const [showRoutes, setShowRoutes] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const downloadUrl = useRef<string | null>(null)

  useEffect(() => {
    setWeightDraft(scenario.weights)
  }, [scenario])

  const disconnectedRoadCount = (() => {
    if (!scenario.egoVehicle) return 0
    const adjacency = new Map(scenario.nodes.map((node) => [node.id, new Set<string>()]))
    for (const edge of scenario.edges) {
      if (edge.incident?.type === 'closure') continue
      adjacency.get(edge.from)?.add(edge.to)
      adjacency.get(edge.to)?.add(edge.from)
    }
    const reachable = new Set<string>([scenario.egoVehicle.origin])
    const queue = [scenario.egoVehicle.origin]
    while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
    return scenario.edges.filter((edge) => edge.incident?.type !== 'closure' && !reachable.has(edge.from) && !reachable.has(edge.to)).length
  })()

  useEffect(() => () => {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
  }, [])

  async function compareAll() {
    const revision = useQFlowStore.getState().scenarioRevision
    const scenarioSnapshot = JSON.stringify(scenario)
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const compared = await api.compareAll()
      if (useQFlowStore.getState().scenarioRevision !== revision || JSON.stringify(useQFlowStore.getState().scenario) !== scenarioSnapshot) return
      setResults(compared)
      setSuccessfulScenario(scenarioSnapshot)
      setShowRoutes(false)
      onRouteOverlay(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compare algorithms')
    } finally {
      setLoading(false)
    }
  }

  async function saveWeights() {
    setError('')
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const weights = await api.updateWeights(weightDraft)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, weights } : current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update objective weights')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function exportScenario() {
    setError('')
    setNotice('')
    try {
      const { blob, filename } = await api.exportScenario()
      const url = URL.createObjectURL(blob)
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
      downloadUrl.current = url
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setNotice('Scenario exported.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the scenario')
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    const revision = useQFlowStore.getState().beginScenarioEdit()
    setError('')
    setNotice('')
    try {
      const result = await api.importScenario(await file.text())
      if (useQFlowStore.getState().scenarioRevision !== revision) return
      onImport(result.scenario)
      if (result.valid) setNotice('Scenario imported and validated.')
      else setError(result.errors.join('; '))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import the scenario')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
      useQFlowStore.getState().finishScenarioEdit()
    }
  }

  async function loadDemo(kind: 'small' | 'large') {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    setError(''); setNotice('')
    try {
      const response = await fetch(`/scenarios/demo-${kind}.json`)
      if (!response.ok) throw new Error(`Could not load the ${kind} demo fixture`)
      const result = await api.importScenario(await response.text())
      if (useQFlowStore.getState().scenarioRevision !== revision) return
      onImport(result.scenario)
      setNotice(`Demo ${kind} scenario loaded.`)
      if (!result.valid) setError(result.errors.join('; '))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load demo scenario') }
    finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function loadPreset(kind: DemoScenarioKind) {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    setError(''); setNotice('')
    try {
      const result = await api.replaceScenario(generateDemoScenario(kind))
      if (useQFlowStore.getState().scenarioRevision !== revision) return
      onImport(result)
      setNotice(`${kind.replace('-', ' ')} demonstration loaded.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the demonstration scenario')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function loadQpsoChallenge() {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    setError(''); setNotice('')
    try {
      const result = await api.replaceScenario(generateQpsoLandscapeScenario())
      if (useQFlowStore.getState().scenarioRevision !== revision) return
      onImport(result)
      setNotice('QPSO challenge demonstration loaded.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the QPSO challenge scenario')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  const hasBackgroundTraffic = scenario.vehicles.cars + scenario.vehicles.trucks + scenario.vehicles.buses > 0
  const objectiveGap = results ? results.qpso.objective_score - results.pso.objective_score : 0
  const objectiveGapPercent = results && results.pso.objective_score !== 0 ? objectiveGap / Math.abs(results.pso.objective_score) * 100 : 0
  const staleResults = Boolean(results && (pendingScenarioEdits > 0 || successfulScenario !== JSON.stringify(scenario)))
  // Publish the comparison so "Animate benchmark result" can replay these exact
  // routes; withdraw it as soon as the results no longer match the scenario.
  useEffect(() => {
    onResults(staleResults ? null : results)
  }, [onResults, results, staleResults])
  const finalBestIteration = (result: RunResult) => result.convergence_curve.find((point) => point.bestFitness <= result.objective_score + 1e-9)?.iteration ?? result.iterations

  return (
    <div className="operate-modules">
      <section className="phase-panel compare-panel" aria-label="Compare All">
        <div className="phase-panel-heading"><h3>Compare All</h3></div>
        <button className="button button-primary" type="button" onClick={() => void compareAll()} disabled={loading || pendingScenarioEdits > 0 || !scenario.nodes.length || !scenario.egoVehicle}>
          {loading ? <><span className="loader inline-loader" aria-hidden="true" /> Comparing…</> : 'Compare All'}
        </button>
      </section>
      {scenario.egoVehicle && disconnectedRoadCount > 0 && <p className="inline-warning" role="status">network has {disconnectedRoadCount} disconnected road{disconnectedRoadCount === 1 ? '' : 's'} the optimizer never considers.</p>}
      <section className="phase-panel benchmark-panel" aria-label="Benchmark dashboard">
        <div className="phase-panel-heading"><h3>Benchmark dashboard</h3></div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {staleResults && <div className="cost-note">Showing the last successful run for an earlier scenario.</div>}
      {results && <div className="benchmark-content-scroll"><>
        <div className="result-gap"><strong>Single-run result</strong><span>QPSO − PSO objective: {objectiveGap.toFixed(3)} ({objectiveGapPercent.toFixed(1)}%)</span><span>Final best first reached: PSO {finalBestIteration(results.pso)}, QPSO {finalBestIteration(results.qpso)}</span><span>Static route choice is compared with actual background-traffic travel.</span></div>
        {!hasBackgroundTraffic && <p className="traffic-note">no background traffic — congestion-aware routing isn't being demonstrated</p>}
        <div className="benchmark-table-scroll">
          <table className="benchmark-table">
            <colgroup><col className="benchmark-metric-column" /><col span={4} className="benchmark-algorithm-column" /></colgroup>
            <thead><tr><th scope="col">Metric</th>{ALGORITHMS.map((algorithm) => <th scope="col" className={`algorithm-heading ${algorithm}`} key={algorithm}>{NAMES[algorithm]}</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Optimization runtime (ms)</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].optimization_time_ms.toFixed(2)}</td>)}</tr>
              <tr><th scope="row">Iterations</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].iterations}</td>)}</tr>
              <tr><th scope="row">Route</th>{ALGORITHMS.map((algorithm) => <td className="route-cell" key={algorithm} title={results[algorithm].route.join(' → ')}><span className="route-cell-content">{results[algorithm].route.join(' → ')}</span></td>)}</tr>
              <tr><th scope="row">Static/free-flow time (min)</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].free_flow_time.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Optimizer planning cost (min)</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].time.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Actual traffic travel time (min)</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].actual_time.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Route distance (km)</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].distance.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Planning congestion multiplier</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].congestion.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Actual route congestion multiplier</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].actual_congestion.toFixed(3)}</td>)}</tr>
              <tr><th scope="row">Weighted objective score</th>{ALGORITHMS.map((algorithm) => <td key={algorithm}>{results[algorithm].objective_score.toFixed(3)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="convergence-heading">PSO and QPSO convergence</div>
        <div className="convergence-chart">
          <Suspense fallback={<div className="chart-loading">Loading convergence plot</div>}>
            <ConvergenceChart pso={results.pso.convergence_curve} qpso={results.qpso.convergence_curve} />
          </Suspense>
        </div>
        <label className="route-overlay-toggle"><input type="checkbox" checked={showRoutes} onChange={(event) => { const enabled = event.target.checked; setShowRoutes(enabled); onRouteOverlay(enabled ? Object.fromEntries(ALGORITHMS.map((algorithm) => [algorithm, results[algorithm].route])) : null) }} /> Show all algorithm routes on canvas</label>
      </></div>}
        {!results && <p className="cost-note">Compare routes to populate the results table and chart.</p>}
      </section>
      <section className="phase-panel weights-panel" aria-label="Weights">
        <div className="phase-panel-heading"><h3>Weights</h3></div>
        <p className="cost-note objective-weight-help">These weights control the PSO/QPSO optimization objective.</p>
        <div className="vehicle-counts" aria-label="Objective weights">
          {(['wT', 'wD', 'wC'] as const).map((name) => <label className="phase-field" key={name}>{WEIGHT_LABELS[name]}
            <input type="number" step="any" value={weightDraft[name]} onChange={(event) => setWeightDraft((current) => ({ ...current, [name]: Number(event.target.value) }))} />
          </label>)}
        </div>
        <button className="button button-quiet" type="button" onClick={() => void saveWeights()}>Save weights</button>
      </section>
      <section className="phase-panel import-export-panel" aria-label="Export and import">
        <div className="phase-panel-heading"><h3>Export/Import</h3></div>
        <div className="scenario-file-actions">
          <button className="button button-quiet" type="button" onClick={() => void loadDemo('small')}>Load small demo</button>
          <button className="button button-quiet" type="button" onClick={() => void loadDemo('large')}>Load large demo</button>
          <button className="button button-quiet" type="button" onClick={() => void loadPreset('low-traffic')}>Low traffic preset</button>
          <button className="button button-quiet" type="button" onClick={() => void loadPreset('congested-shortcut')}>Congested shortcut</button>
          <button className="button button-quiet" type="button" onClick={() => void loadPreset('shared-bottleneck')}>Shared bottleneck</button>
          <button className="button button-quiet" type="button" onClick={() => void loadPreset('incident')}>Incident route</button>
              <button className="button button-quiet" type="button" onClick={() => void loadQpsoChallenge()}>PSO/QPSO challenge</button>
          <button className="button button-quiet" type="button" onClick={() => void exportScenario()}>Export scenario</button>
          <button className="button button-quiet" type="button" onClick={() => fileInput.current?.click()}>Import scenario</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
        </div>
      </section>
    </div>
  )
}
