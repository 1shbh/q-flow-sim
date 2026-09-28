import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { ActiveAnimation, AnimationTick, CompareAllResults, RunResult } from '../types'

type Props = {
  onTick: (tick: AnimationTick | null) => void
  onActiveAnimation: (animation: ActiveAnimation | null) => void
  activeAnimation: ActiveAnimation | null
  benchmarkResults: CompareAllResults | null
  invalidateToken: number
  disabled?: boolean
}
type Status = 'idle' | 'starting' | 'running' | 'paused' | 'complete'
type SpeedMultiplier = 1 | 2 | 4

const ALGORITHM_LABELS: Record<RunResult['algorithm'], string> = {
  dijkstra: 'Dijkstra',
  astar: 'A*',
  pso: 'PSO',
  qpso: 'QPSO',
}

function createRunId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

export default function AnimationPanel({ onTick, onActiveAnimation, activeAnimation, benchmarkResults, invalidateToken, disabled = false }: Props) {
  const [algorithm, setAlgorithm] = useState<RunResult['algorithm']>('qpso')
  const [status, setStatus] = useState<Status>('idle')
  const [speedMultiplier, setSpeedMultiplier] = useState<SpeedMultiplier>(1)
  const [error, setError] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick
  // Compare All route for the selected algorithm, when its results still match
  // the current scenario. Replaying it keeps PSO/QPSO deterministic on screen.
  const benchmarkRoute = benchmarkResults?.[algorithm]?.route ?? null

  function invalidate() {
    activeRunIdRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    onTick(null)
    onActiveAnimation(null)
    setStatus('idle')
  }

  useEffect(() => {
    invalidate()
    return () => socketRef.current?.close()
  }, [invalidateToken])

  function socket(): WebSocket {
    if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) return socketRef.current
    const connection = new WebSocket(api.animationSocketUrl())
    connection.onmessage = (event) => {
      try {
        const tick = JSON.parse(event.data) as AnimationTick
        if (tick.type !== 'tick') return
        if (tick.runId !== activeRunIdRef.current) return
        onTickRef.current(tick)
        setStatus(tick.status)
        setError('')
      } catch {
        setError('Received an invalid animation tick')
      }
    }
    connection.onerror = () => setError('Animation connection failed')
    connection.onclose = () => {
      if (socketRef.current === connection) {
        socketRef.current = null
        setStatus((current) => current === 'idle' ? current : 'idle')
      }
    }
    socketRef.current = connection
    return connection
  }

  async function start() {
    invalidate()
    setStatus('starting')
    setError('')
    const requestToken = invalidateToken
    const runId = createRunId()
    activeRunIdRef.current = runId
    try {
      // Replay the Compare All result when one exists for the selected
      // algorithm; only run the algorithm when there is nothing to replay.
      const result = benchmarkRoute
        ? { algorithm, route: benchmarkRoute }
        : await api.runAlgorithm(algorithm)
      if (requestToken !== invalidateToken || activeRunIdRef.current !== runId) return
      onActiveAnimation({ runId, algorithm: result.algorithm, route: result.route, routeEdgeIds: [] })
      onTick(null)
      const connection = socket()
      const sendStart = () => connection.send(JSON.stringify({
        type: 'start', runId, route: result.route, algorithm: result.algorithm, speedMultiplier,
      }))
      if (connection.readyState === WebSocket.OPEN) sendStart()
      else connection.addEventListener('open', sendStart, { once: true })
    } catch (cause) {
      setStatus('idle')
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null
        onActiveAnimation(null)
      }
      setError(cause instanceof Error ? cause.message : 'Could not run the selected algorithm')
    }
  }

  function send(type: 'pause' | 'resume' | 'reset') {
    const connection = socketRef.current
    if (type === 'reset') {
      setStatus('idle')
      onTick(null)
      activeRunIdRef.current = null
      onActiveAnimation(null)
      setError('')
      if (connection?.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type }))
    } else if (connection?.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify({ type }))
      setStatus(type === 'pause' ? 'paused' : 'running')
    }
  }

  function changeSpeed(multiplier: SpeedMultiplier) {
    setSpeedMultiplier(multiplier)
    if (status !== 'running' && status !== 'paused') return
    const connection = socketRef.current
    if (connection?.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify({ type: 'setSpeed', speedMultiplier: multiplier }))
    }
  }

  return (
    <section className="phase-panel animation-panel" aria-label="Route animation">
      <div className="phase-panel-heading"><h3>Algorithm picker</h3><span>{status === 'idle' ? 'Ready' : status}</span></div>
      <label className="phase-field">Algorithm
        <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as RunResult['algorithm'])} disabled={disabled || status === 'running' || status === 'paused' || status === 'starting'}>
          <option value="dijkstra">Dijkstra</option>
          <option value="astar">A*</option>
          <option value="pso">PSO</option>
          <option value="qpso">QPSO</option>
        </select>
      </label>
      <div className="animation-actions">
        <button className="button button-primary" type="button" onClick={() => void start()} disabled={disabled || status === 'starting' || status === 'running' || status === 'paused'}>
          {status === 'starting' ? <><span className="loader inline-loader" aria-hidden="true" /> Running algorithm…</> : benchmarkRoute ? 'Animate benchmark result' : 'Run and animate'}
        </button>
        {status === 'running' && <button className="button button-quiet" type="button" onClick={() => send('pause')}>Pause</button>}
        {status === 'paused' && <button className="button button-quiet" type="button" onClick={() => send('resume')}>Resume</button>}
        {(status === 'running' || status === 'paused' || status === 'complete') && <button className="button button-quiet" type="button" onClick={() => send('reset')}>Reset</button>}
        <div className="speed-control" role="group" aria-label="Animation speed">
          {([1, 2, 4] as const).map((multiplier) => <button
            key={multiplier}
            type="button"
            className={`speed-option${speedMultiplier === multiplier ? ' active' : ''}`}
            aria-pressed={speedMultiplier === multiplier}
            onClick={() => changeSpeed(multiplier)}
          >{multiplier}×</button>)}
        </div>
      </div>
      {disabled && <p className="cost-note">Create a route between two intersections to run an algorithm.</p>}
      {!disabled && benchmarkRoute && <p className="cost-note">Replaying the Compare All route for {ALGORITHM_LABELS[algorithm]} — no new algorithm run.</p>}
      {activeAnimation && <p className="animation-route">Route: {activeAnimation.route.join(' → ')}</p>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </section>
  )
}
