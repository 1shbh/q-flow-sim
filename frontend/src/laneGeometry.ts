import type { EdgeData } from './types'

export type LaneSplit = {
  laneWidthPx: number
  lanesForward: number
  lanesBackward: number
  forwardOffsets: number[]
  backwardOffsets: number[]
}

export function laneSplit(edge: EdgeData, pixelsPerMeter: number): LaneSplit {
  const laneWidthPx = edge.laneWidthM * pixelsPerMeter
  const lanesForward = edge.oneWay ? edge.lanes : Math.ceil(edge.lanes / 2)
  const lanesBackward = edge.oneWay ? 0 : Math.floor(edge.lanes / 2)
  const slotOffsets = Array.from(
    { length: edge.lanes },
    (_, index) => (index - (edge.lanes - 1) / 2) * laneWidthPx,
  )
  return {
    laneWidthPx,
    lanesForward,
    lanesBackward,
    backwardOffsets: slotOffsets.slice(0, lanesBackward),
    forwardOffsets: slotOffsets.slice(lanesBackward),
  }
}

export function offsetPoint(x: number, y: number, normalX: number, normalY: number, offsetPx: number) {
  return { x: x + normalX * offsetPx, y: y + normalY * offsetPx }
}
