import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '../api/client'
import type { AnimationTick, CanvasSelection, EdgeData, Scenario, WeatherData } from '../types'
import { useQFlowStore } from '../store'

type Props = {
  scenario: Scenario
  edgeLoads: AnimationTick['edgeLoads']
  selection: CanvasSelection
  onScenarioChange: (scenario: Scenario) => void
}

function weatherMultiplier(weather: WeatherData) {
  if (weather.type === 'rain') return 1 + 0.5 * weather.intensity
  if (weather.type === 'fog') return 1 + 0.8 * weather.intensity
  return 1
}

export function edgeCost(edge: EdgeData, scenario: Scenario, load: number) {
  if (edge.incident?.type === 'closure') return null
  const baseTimeMin = (edge.lengthM / 1000) / edge.speedLimitKph * 60
  const congestionMultiplier = Math.min(1 + 3 * (load / (edge.lanes * 15)) ** 2, 6)
  const incidentMultiplier = edge.incident?.type === 'slowdown' ? (edge.incident.factor ?? 3.0) : 1
  return baseTimeMin * congestionMultiplier * weatherMultiplier(scenario.weather) * incidentMultiplier
}

export default function ConditionPanel({ scenario, edgeLoads, selection }: Props) {
  const [intensityDraft, setIntensityDraft] = useState(String(scenario.weather.intensity))
  const [slowdownDraft, setSlowdownDraft] = useState('3.0')
  const [error, setError] = useState('')
  const selectedEdge = selection?.type === 'edge' ? scenario.edges.find((edge) => edge.id === selection.id) : undefined

  useEffect(() => setIntensityDraft(String(scenario.weather.intensity)), [scenario.weather.intensity])
  useEffect(() => setSlowdownDraft(String(selectedEdge?.incident?.type === 'slowdown' ? selectedEdge.incident.factor ?? 3 : 3)), [selectedEdge?.id, selectedEdge?.incident])

  async function saveWeather(weather: WeatherData) {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const saved = await api.updateWeather(weather)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, weather: saved } : current)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update weather')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  function commitIntensity(raw = intensityDraft) {
    const intensity = Number(raw)
    if (!Number.isFinite(intensity)) {
      setError('Weather intensity must be a number.')
      return
    }
    void saveWeather({ ...scenario.weather, intensity })
  }

  async function saveIncident(edge: EdgeData, incident: EdgeData['incident']) {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const saved = await api.updateIncident(edge.id, incident)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, edges: current.edges.map((item) => item.id === edge.id ? saved : item) } : current)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update road incident')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  function commitSlowdown(edge: EdgeData) {
    const factor = Number(slowdownDraft)
    if (!Number.isFinite(factor) || factor <= 0) {
      setError('Slowdown factor must be greater than 0.')
      return
    }
    void saveIncident(edge, { type: 'slowdown', factor })
  }

  return (
    <section className="phase-panel condition-panel" aria-labelledby="condition-panel-title">
      <div className="phase-panel-heading"><h3 id="condition-panel-title">Conditions</h3></div>
      <label className="phase-field">Weather
        <select value={scenario.weather.type} onChange={(event) => void saveWeather({ ...scenario.weather, type: event.target.value as WeatherData['type'] })}>
          <option value="clear">Clear</option>
          <option value="rain">Rain</option>
          <option value="fog">Fog</option>
        </select>
      </label>
      <label className="phase-field range-label">Weather intensity <b>{Number(intensityDraft).toFixed(2)}</b>
        <input className="weather-intensity-range" type="range" min="0" max="1" step="0.01" value={intensityDraft} style={{ '--slider-progress': `${Number(intensityDraft) * 100}%` } as CSSProperties} aria-valuenow={Number(intensityDraft)} aria-valuetext={`${Math.round(Number(intensityDraft) * 100)} percent intensity`} onChange={(event) => setIntensityDraft(event.target.value)} onPointerUp={(event) => commitIntensity(event.currentTarget.value)} onKeyUp={(event) => commitIntensity(event.currentTarget.value)} />
      </label>

      <div className="phase-subheading">Road incident</div>
      {selectedEdge ? <>
        <label className="phase-field">{selectedEdge.id}
          <select value={selectedEdge.incident?.type ?? 'none'} onChange={(event) => {
            const value = event.target.value
            if (value === 'none') void saveIncident(selectedEdge, null)
            else if (value === 'closure') void saveIncident(selectedEdge, { type: 'closure' })
            else void saveIncident(selectedEdge, { type: 'slowdown', factor: selectedEdge.incident?.type === 'slowdown' ? selectedEdge.incident.factor : 3 })
          }}>
            <option value="none">No incident</option><option value="closure">Closure</option><option value="slowdown">Slowdown</option>
          </select>
        </label>
        {selectedEdge.incident?.type === 'slowdown' && <label className="phase-field">Slowdown factor
          <input type="number" min="0.01" step="any" value={slowdownDraft} onChange={(event) => setSlowdownDraft(event.target.value)} onBlur={() => commitSlowdown(selectedEdge)} />
        </label>}
        <div className="inspector-readouts">
          <div><span>Current load</span><b>{edgeLoads.find((flow) => flow.edgeId === selectedEdge.id)?.load ?? 0}</b></div>
          <div><span>Travel cost</span><b>{(() => {
            const cost = edgeCost(selectedEdge, scenario, edgeLoads.find((flow) => flow.edgeId === selectedEdge.id)?.load ?? 0)
            return cost === null ? 'Closed' : `${cost.toFixed(2)} min`
          })()}</b></div>
        </div>
      </> : <p className="cost-note">Select a road on the canvas to set an incident.</p>}

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="phase-subheading cost-heading">Current edge costs <span>minutes</span></div>
      <p className="cost-note">Costs use the current displayed edge load and conditions.</p>
      <div className="edge-cost-list" aria-live="polite">
        {scenario.edges.map((edge) => {
          const cost = edgeCost(edge, scenario, edgeLoads.find((flow) => flow.edgeId === edge.id)?.load ?? 0)
          return <div className="edge-cost-row" key={edge.id}>
            <span><i className={`flow-indicator ${cost === null ? 'closed' : 'free'}`} />{edge.id}</span>
            <b>{cost === null ? 'Excluded by closure' : cost.toFixed(2)}</b>
          </div>
        })}
        {!scenario.edges.length && <span className="cost-note">No roads in the network.</span>}
      </div>
    </section>
  )
}
