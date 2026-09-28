import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api/client'
import type { CanvasSelection, EdgeData, NodeData, Scenario } from '../types'
import { useQFlowStore } from '../store'

type Props = {
  scenario: Scenario
  selection: CanvasSelection
  onSelectionChange: (selection: CanvasSelection) => void
  onScenarioChange: (scenario: Scenario) => void
}

export default function ControlPanel({ scenario, selection, onSelectionChange, onScenarioChange }: Props) {
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const deleteInFlight = useRef(false)
  const selectedNode = selection?.type === 'node' ? scenario.nodes.find((node) => node.id === selection.id) : undefined
  const selectedEdge = selection?.type === 'edge' ? scenario.edges.find((edge) => edge.id === selection.id) : undefined

  async function saveNode(id: string, patch: Partial<Omit<NodeData, 'id'>>) {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const saved = await api.patchNode(id, patch)
      if ('x' in patch || 'y' in patch) {
        const fresh = await api.getScenario()
        useQFlowStore.getState().setScenarioIfRevision(revision, fresh)
      } else {
        useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, nodes: current.nodes.map((node) => node.id === id ? saved : node) } : current)
      }
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update intersection')
      try { const fresh = await api.getScenario(); useQFlowStore.getState().setScenarioIfRevision(revision, fresh) } catch { /* keep the edit error visible */ }
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  async function saveEdge(id: string, patch: Partial<Omit<EdgeData, 'id' | 'incident'>>) {
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      const saved = await api.patchEdge(id, patch)
      useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, edges: current.edges.map((edge) => edge.id === id ? saved : edge) } : current)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update road')
      try { const fresh = await api.getScenario(); useQFlowStore.getState().setScenarioIfRevision(revision, fresh) } catch { /* keep the edit error visible */ }
    } finally { useQFlowStore.getState().finishScenarioEdit() }
  }

  function editNode<K extends 'x' | 'y'>(node: NodeData, field: K, raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    onScenarioChange({ ...scenario, nodes: scenario.nodes.map((item) => item.id === node.id ? { ...item, [field]: value } : item) })
  }

  function editEdge<K extends 'lengthM' | 'lanes' | 'laneWidthM' | 'speedLimitKph' | 'backgroundLoad'>(edge: EdgeData, field: K, raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    onScenarioChange({ ...scenario, edges: scenario.edges.map((item) => item.id === edge.id ? { ...item, [field]: value } : item) })
  }

  async function deleteSelected() {
    if (!selection || deleteInFlight.current) return
    deleteInFlight.current = true
    const revision = useQFlowStore.getState().beginScenarioEdit()
    try {
      if (selection.type === 'node') {
        await api.deleteNode(selection.id)
        useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, nodes: current.nodes.filter((node) => node.id !== selection.id), edges: current.edges.filter((edge) => edge.from !== selection.id && edge.to !== selection.id), egoVehicle: current.egoVehicle && ![current.egoVehicle.origin, current.egoVehicle.destination].includes(selection.id) ? current.egoVehicle : null } : current)
      } else {
        await api.deleteEdge(selection.id)
        useQFlowStore.getState().setScenarioIfRevision(revision, (current) => current ? { ...current, edges: current.edges.filter((edge) => edge.id !== selection.id) } : current)
      }
      onSelectionChange(null)
      setError('')
      setValidation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete selected element')
    } finally {
      deleteInFlight.current = false
      useQFlowStore.getState().finishScenarioEdit()
    }
  }

  async function validate() {
    try {
      setValidation(await api.validateScenario())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate the network')
    }
  }

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const focusedTag = (document.activeElement as HTMLElement | null)?.tagName
      if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT') return
      if (!selection || (!selectedNode && !selectedEdge) || event.repeat) return
      event.preventDefault()
      void deleteSelected()
    }
    window.addEventListener('keydown', handleDeleteKey)
    return () => window.removeEventListener('keydown', handleDeleteKey)
  }, [selection, selectedNode, selectedEdge])

  return (
    <div className="control-panel inspector-panel">
      <p className="inspector-help">Click empty canvas space to add an intersection. Click two intersections to connect them.</p>
      <label className="inspector-field">Inspect an element
        <select value={selection ? `${selection.type}:${selection.id}` : ''} onChange={(event) => {
          const [type, id] = event.target.value.split(':')
          onSelectionChange(type === 'node' || type === 'edge' ? { type, id } : null)
        }}>
          <option value="">Choose an intersection or road</option>
          {scenario.nodes.map((node) => <option key={node.id} value={`node:${node.id}`}>Intersection {node.id}</option>)}
          {scenario.edges.map((edge) => <option key={edge.id} value={`edge:${edge.id}`}>Road {edge.id}: {edge.from} to {edge.to}</option>)}
        </select>
      </label>

      {selectedNode && (
        <section className="inspector-section" aria-label="Selected intersection">
          <div className="inspector-heading"><h3>Intersection</h3><span>{selectedNode.id}</span></div>
          <div className="inspector-fields">
            <label className="inspector-field">X position
              <input type="number" step="any" value={selectedNode.x} onChange={(event) => editNode(selectedNode, 'x', event.target.value)} onBlur={() => void saveNode(selectedNode.id, { x: selectedNode.x })} />
            </label>
            <label className="inspector-field">Y position
              <input type="number" step="any" value={selectedNode.y} onChange={(event) => editNode(selectedNode, 'y', event.target.value)} onBlur={() => void saveNode(selectedNode.id, { y: selectedNode.y })} />
            </label>
            <label className="switch-row inspector-switch">Traffic signal
              <input type="checkbox" checked={selectedNode.signal} onChange={(event) => {
                const signal = event.target.checked
                onScenarioChange({ ...scenario, nodes: scenario.nodes.map((node) => node.id === selectedNode.id ? { ...node, signal } : node) })
                void saveNode(selectedNode.id, { signal })
              }} />
            </label>
            {selectedNode.signal && <label className="inspector-field range-label">Green split <b>{selectedNode.greenSplit.toFixed(2)}</b>
              <input className="green-split-range" type="range" min="0" max="1" step="0.01" value={selectedNode.greenSplit} style={{ '--slider-progress': `${selectedNode.greenSplit * 100}%` } as CSSProperties} aria-valuenow={selectedNode.greenSplit} aria-valuetext={`${Math.round(selectedNode.greenSplit * 100)} percent green`} onChange={(event) => {
                const greenSplit = Number(event.target.value)
                onScenarioChange({ ...scenario, nodes: scenario.nodes.map((node) => node.id === selectedNode.id ? { ...node, greenSplit } : node) })
              }} onPointerUp={(event) => void saveNode(selectedNode.id, { greenSplit: Number(event.currentTarget.value) })} onKeyUp={(event) => void saveNode(selectedNode.id, { greenSplit: Number(event.currentTarget.value) })} />
            </label>}
          </div>
          <button className="button button-quiet danger inspector-delete" type="button" onClick={() => void deleteSelected()}>Delete intersection</button>
        </section>
      )}

      {selectedEdge && (
        <section className="inspector-section" aria-label="Selected road">
          <div className="inspector-heading">
            <div className="selected-element-title"><h3>Road</h3><span>{selectedEdge.id}</span></div>
            <span className="selected-road-route">{selectedEdge.from} → {selectedEdge.to}</span>
          </div>
          <div className="inspector-fields">
            <label className="inspector-field">From
              <select value={selectedEdge.from} onChange={(event) => void saveEdge(selectedEdge.id, { from: event.target.value })}>
                {scenario.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
              </select>
            </label>
            <label className="inspector-field">To
              <select value={selectedEdge.to} onChange={(event) => void saveEdge(selectedEdge.id, { to: event.target.value })}>
                {scenario.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
              </select>
            </label>
            <label className="inspector-field">Length (m)
              <input type="number" min="0.01" step="any" value={Number(selectedEdge.lengthM.toFixed(1))} onChange={(event) => editEdge(selectedEdge, 'lengthM', event.target.value)} onBlur={() => void saveEdge(selectedEdge.id, { lengthM: selectedEdge.lengthM })} />
            </label>
            <label className="inspector-field">Lanes
              <select value={selectedEdge.lanes} onChange={(event) => {
                const lanes = Number(event.target.value)
                onScenarioChange({ ...scenario, edges: scenario.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, lanes } : edge) })
                void saveEdge(selectedEdge.id, { lanes })
              }}>
                {[1, 2, 3].map((lanes) => <option key={lanes} value={lanes}>{lanes}</option>)}
              </select>
            </label>
            <label className="inspector-field">Lane width (m)
              <input type="number" min="0.01" step="any" value={selectedEdge.laneWidthM} onChange={(event) => editEdge(selectedEdge, 'laneWidthM', event.target.value)} onBlur={() => void saveEdge(selectedEdge.id, { laneWidthM: selectedEdge.laneWidthM })} />
            </label>
            <label className="inspector-field">Speed limit (kph)
              <input type="number" min="0.01" step="any" value={selectedEdge.speedLimitKph} onChange={(event) => editEdge(selectedEdge, 'speedLimitKph', event.target.value)} onBlur={() => void saveEdge(selectedEdge.id, { speedLimitKph: selectedEdge.speedLimitKph })} />
            </label>
            <label className="inspector-field">Background traffic
              <input type="number" min="0" step="1" value={selectedEdge.backgroundLoad ?? 0} onChange={(event) => editEdge(selectedEdge, 'backgroundLoad', event.target.value)} onBlur={() => void saveEdge(selectedEdge.id, { backgroundLoad: selectedEdge.backgroundLoad ?? 0 })} />
            </label>
            <label className="switch-row inspector-switch">One way
              <input type="checkbox" checked={selectedEdge.oneWay} onChange={(event) => {
                const oneWay = event.target.checked
                onScenarioChange({ ...scenario, edges: scenario.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, oneWay } : edge) })
                void saveEdge(selectedEdge.id, { oneWay })
              }} />
            </label>
          </div>
          <button className="button button-quiet danger inspector-delete" type="button" onClick={() => void deleteSelected()}>Delete road</button>
        </section>
      )}

      {!selection && <div className="inspector-empty">Select an intersection or road on the canvas to inspect its fields.</div>}
      {selection && !selectedNode && !selectedEdge && <div className="inspector-empty">That element is no longer in the network.</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}

      <section className="validation-section inspector-validation">
        <button className="button button-validate" type="button" onClick={() => void validate()}>Validate network</button>
        {validation && <div className={`validation-result ${validation.valid ? 'valid' : 'invalid'}`} role="status">
          <strong>{validation.valid ? 'Network is valid' : 'Network needs attention'}</strong>
          {validation.errors.length ? validation.errors.map((message, index) => <span key={`${index}-${message}`}>{message}</span>) : <span>Road graph checks passed.</span>}
        </div>}
      </section>
    </div>
  )
}
