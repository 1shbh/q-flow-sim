import { useEffect, useMemo, useState } from 'react'
import { Circle, Group, Rect } from 'react-konva'
import type { AnimationTick, EdgeData, NodeData, Scenario } from '../types'
import { laneSplit, offsetPoint } from '../laneGeometry'
import { readColorToken } from '../theme'

const PX_PER_METER = 4

type Props = {
  nodes: NodeData[]
  edges: EdgeData[]
  vehicles: Scenario['vehicles']
  animationTick: AnimationTick | null
  edgeLoads: AnimationTick['edgeLoads']
}

export default function VehicleLayer({ nodes, edges, vehicles, animationTick, edgeLoads }: Props) {
  const [clockNow, setClockNow] = useState(() => performance.now())
  const colors = useMemo(() => ({
    accentEgo: readColorToken('--accent-ego'),
    textPrimary: readColorToken('--text-primary'),
  }), [])
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const edgeById = useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges])
  const loadByEdge = useMemo(() => new Map(edgeLoads.map((flow) => [flow.edgeId, flow])), [edgeLoads])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(performance.now()), 16)
    return () => window.clearInterval(timer)
  }, [])

  const age = (clockNow % 1200) / 1200
  const pulseRadius = 13 - 3 * Math.cos(2 * Math.PI * age)
  const pulseOpacity = 0.6 * (1 - age)
  const totalVehicles = vehicles.cars + vehicles.trucks + vehicles.buses
  const traffic = edges.flatMap((edge, edgeIndex) => {
    const flow = loadByEdge.get(edge.id)
    if (!flow || edge.incident?.type === 'closure') return []
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) return []
    const count = Math.min(Math.round(flow.load / 3), 8)
    if (count <= 0) return []

    const lanes = laneSplit(edge, PX_PER_METER)
    const laneOrder = [
      ...lanes.forwardOffsets.map((offsetPx, laneIndex) => ({ offsetPx, laneIndex, forward: true })),
      ...lanes.backwardOffsets.map((offsetPx, laneIndex) => ({ offsetPx, laneIndex, forward: false })),
    ]
    if (!laneOrder.length) return []

    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (!length) return []
    const normalX = -dy / length
    const normalY = dx / length
    const heading = Math.atan2(dy, dx)
    const travelSeconds = edge.lengthM / (edge.speedLimitKph / 3.6) * flow.congestionMultiplier

    return Array.from({ length: count }, (_, index) => {
      const laneOrderIndex = index % laneOrder.length
      const lane = laneOrder[laneOrderIndex]
      const laneSpriteIndex = Math.floor(index / laneOrder.length)
      const laneSpriteCount = Math.ceil((count - laneOrderIndex) / laneOrder.length)
      const distanceAlong = ((clockNow / 1000 / travelSeconds + laneSpriteIndex / laneSpriteCount) % 1)
      const progress = lane.forward ? distanceAlong : 1 - distanceAlong
      const center = offsetPoint(from.x + dx * progress, from.y + dy * progress, normalX, normalY, lane.offsetPx)
      const sample = totalVehicles ? (edgeIndex * 53 + index * 29) % totalVehicles : 0
      const kind = sample < vehicles.cars ? 'car' : sample < vehicles.cars + vehicles.trucks ? 'truck' : 'bus'
      return {
        key: `${edge.id}-${index}`,
        x: center.x,
        y: center.y,
        rotation: heading + (lane.forward ? 0 : Math.PI),
        kind,
      }
    })
  })

  const tickEdge = animationTick ? edgeById.get(animationTick.ego.edgeId) : undefined
  const egoEdge = tickEdge && animationTick?.routeEdgeIds.includes(tickEdge.id) ? { edge: tickEdge, forward: animationTick.ego.forward } : null
  let egoX = animationTick?.ego.x ?? 0
  let egoY = animationTick?.ego.y ?? 0
  const egoRotation = animationTick ? (animationTick.ego.headingDeg * Math.PI) / 180 : 0
  if (egoEdge) {
    const from = nodeById.get(egoEdge.edge.from)
    const to = nodeById.get(egoEdge.edge.to)
    if (from && to) {
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy)
      if (length) {
        const lane = laneSplit(egoEdge.edge, PX_PER_METER)
        const offset = egoEdge.forward ? lane.forwardOffsets[0] : lane.backwardOffsets[lane.backwardOffsets.length - 1] ?? 0
        const egoCenter = offsetPoint(egoX, egoY, -dy / length, dx / length, offset)
        egoX = egoCenter.x
        egoY = egoCenter.y
      }
    }
  }

  return (
    <Group listening={false}>
      {traffic.map((vehicle) => <Group key={vehicle.key} x={vehicle.x} y={vehicle.y} rotation={vehicle.rotation}>
        <Rect x={vehicle.kind === 'car' ? -5 : vehicle.kind === 'truck' ? -8 : -9} y={vehicle.kind === 'car' ? -2.5 : -3} width={vehicle.kind === 'car' ? 10 : vehicle.kind === 'truck' ? 16 : 18} height={vehicle.kind === 'car' ? 5 : 6} cornerRadius={1.5} fill={vehicle.kind === 'car' ? '#5B6478' : '#3A4356'} stroke={colors.textPrimary} strokeWidth={0.35} />
      </Group>)}
      {animationTick && egoEdge && <Group x={egoX} y={egoY} rotation={egoRotation * 180 / Math.PI}>
        <Circle radius={pulseRadius} stroke={colors.accentEgo} strokeWidth={1.5} opacity={pulseOpacity} />
        <Rect x={-7} y={-3.5} width={14} height={7} cornerRadius={2} fill={colors.accentEgo} stroke="#FFD0DF" strokeWidth={0.6} />
      </Group>}
    </Group>
  )
}
