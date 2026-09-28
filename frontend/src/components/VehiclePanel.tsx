import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Scenario, VehicleCounts } from '../types'
import { useQFlowStore } from '../store'

type Props = {
  scenario: Scenario
  onScenarioChange: (scenario: Scenario) => void
}

export default function VehiclePanel({ scenario }: Props) {
  const [draft, setDraft] = useState<VehicleCounts>(scenario.vehicles)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(scenario.vehicles), [scenario.vehicles])

  async function saveCounts() {
    if (Object.values(draft).some((count) => !Number.isInteger(count) || count < 0)) {
      setError('Vehicle counts must be non-negative whole numbers.')
      return
    }
    if (draft.cars + draft.trucks + draft.buses > 1000) {
      setError('The scenario cannot exceed 1,000 vehicles.')
      return
    }
    setSaving(true)
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const vehicles = await api.updateVehicles(draft)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, vehicles } : current)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update vehicle counts')
    } finally {
      setSaving(false)
      useQFlowStore.getState().finishScenarioEdit()
    }
  }

  async function saveEgo(field: 'origin' | 'destination', value: string) {
    const fallbackRoute = scenario.egoVehicle ?? { origin: scenario.nodes[0]?.id ?? '', destination: scenario.nodes[1]?.id ?? '' }
    const egoVehicle = { ...fallbackRoute, [field]: value }
    if (!egoVehicle.origin || !egoVehicle.destination) return
    if (egoVehicle.origin === egoVehicle.destination) {
      setError('Ego origin and destination must be different intersections.')
      return
    }
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const saved = await api.updateEgo(egoVehicle)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, egoVehicle: saved } : current)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the ego route')
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  return (
    <section className="phase-panel vehicle-panel" aria-labelledby="vehicle-panel-title">
      <div className="phase-panel-heading"><h3 id="vehicle-panel-title">Vehicles</h3><span>Up to 1,000</span></div>
      <div className="vehicle-counts">
        {(['cars', 'trucks', 'buses'] as const).map((kind) => (
          <label className="phase-field" key={kind}>
            <span>{kind[0].toUpperCase() + kind.slice(1)}</span>
            <input
              type="number"
              min="0"
              step="1"
              value={draft[kind]}
              onChange={(event) => setDraft((current) => ({ ...current, [kind]: event.target.value === '' ? 0 : Number(event.target.value) }))}
            />
          </label>
        ))}
      </div>
      <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveCounts()}>{saving ? 'Saving…' : 'Save vehicle counts'}</button>

      <div className="phase-subheading">Ego route</div>
      {scenario.nodes.length < 2 ? <p className="cost-note">Add at least two intersections to set the ego route.</p> : <>
        {!scenario.egoVehicle && <p className="cost-note">Choose a start and destination for the ego vehicle.</p>}
        <div className="vehicle-route-fields">
          <label className="phase-field">Origin
            <select value={scenario.egoVehicle?.origin ?? scenario.nodes[0].id} onChange={(event) => void saveEgo('origin', event.target.value)}>
              {scenario.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
            </select>
          </label>
          <label className="phase-field">Destination
            <select value={scenario.egoVehicle?.destination ?? scenario.nodes[1].id} onChange={(event) => void saveEgo('destination', event.target.value)}>
              {scenario.nodes.filter((node) => node.id !== (scenario.egoVehicle?.origin ?? scenario.nodes[0].id)).map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
            </select>
          </label>
        </div>
      </>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </section>
  )
}
