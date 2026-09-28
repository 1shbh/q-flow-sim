import type { AnimationTick, Scenario } from './types'

function roundHalfEven(value: number): number {
  const whole = Math.floor(value)
  const fraction = value - whole
  if (fraction < 0.5) return whole
  if (fraction > 0.5) return whole + 1
  return whole % 2 === 0 ? whole : whole + 1
}

/**
 * Loads used by the canvas glow, the background-traffic sprites and the road
 * readouts. Before any run, the baseline heuristic below is used. While an
 * animation is playing, the tick's own rows are used as-is whenever the
 * scenario has per-road background traffic configured, because they already
 * report exactly those per-road values. When no per-road traffic is configured
 * (demo fixtures, randomize), the baseline display load is kept so the traffic
 * view shown before the run does not collapse to zero during playback.
 */
export function resolveEdgeLoads(scenario: Scenario, tick: AnimationTick | null): AnimationTick['edgeLoads'] {
  const baseline = baselineEdgeLoads(scenario)
  if (!tick) return baseline
  const hasConfiguredLoad = scenario.edges.some((edge) => (edge.backgroundLoad ?? 0) > 0)
  if (hasConfiguredLoad) return tick.edgeLoads
  const baselineByEdge = new Map(baseline.map((row) => [row.edgeId, row]))
  return tick.edgeLoads.map((row) => {
    const display = baselineByEdge.get(row.edgeId)
    return display ? { ...row, load: display.load, congestionMultiplier: display.congestionMultiplier } : row
  })
}

export function baselineEdgeLoads(scenario: Scenario): AnimationTick['edgeLoads'] {
  const equivalentVehicles = scenario.vehicles.cars + 2 * scenario.vehicles.trucks + 2 * scenario.vehicles.buses
  const hasConfiguredLoad = scenario.edges.some((edge) => (edge.backgroundLoad ?? 0) > 0)
  const load = scenario.edges.length ? roundHalfEven(equivalentVehicles / scenario.edges.length) : 0
  return scenario.edges.filter((edge) => edge.incident?.type !== 'closure').map((edge) => ({
    edgeId: edge.id,
    load: hasConfiguredLoad ? (edge.backgroundLoad ?? 0) : load,
    backgroundLoad: hasConfiguredLoad ? (edge.backgroundLoad ?? 0) : load,
    optimizerLoad: 0,
    effectivePlanningLoad: hasConfiguredLoad ? (edge.backgroundLoad ?? 0) : load,
    congestionMultiplier: Math.min(1 + 3 * ((hasConfiguredLoad ? (edge.backgroundLoad ?? 0) : load) / (edge.lanes * 15)) ** 2, 6),
  }))
}
