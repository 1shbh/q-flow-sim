import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RunResult } from '../types'

type Props = {
  pso: RunResult['convergence_curve']
  qpso: RunResult['convergence_curve']
}

export default function ConvergenceChart({ pso, qpso }: Props) {
  const data = useMemo(() => {
    const points = new Map<number, { iteration: number; pso?: number; qpso?: number }>()
    for (const [algorithm, curve] of [['pso', pso], ['qpso', qpso]] as const) {
      for (const point of curve) {
        const row = points.get(point.iteration) ?? { iteration: point.iteration }
        row[algorithm] = point.bestFitness
        points.set(point.iteration, row)
      }
    }
    return [...points.values()].sort((a, b) => a.iteration - b.iteration)
  }, [pso, qpso])

  if (data.length === 0) return <div className="chart-loading" role="status">No convergence data for this run.</div>

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="rgba(154,147,143,.28)" strokeDasharray="3 3" />
        <XAxis dataKey="iteration" stroke="var(--text-dim)" tick={{ fontSize: 9 }} />
        <YAxis stroke="var(--text-dim)" tick={{ fontSize: 9 }} width={48} />
        <Tooltip contentStyle={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid rgba(154,147,143,.3)', fontSize: 10 }} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Line name="PSO" type="monotone" dataKey="pso" stroke="var(--accent-pso)" dot={false} isAnimationActive={false} />
        <Line name="QPSO" type="monotone" dataKey="qpso" stroke="var(--accent-qpso)" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
