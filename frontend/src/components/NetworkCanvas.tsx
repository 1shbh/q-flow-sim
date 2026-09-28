import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva'
import type { AnimationTick, CanvasSelection, EdgeData, NodeData, RouteOverlay, Scenario } from '../types'
import VehicleLayer from './VehicleLayer'
import { laneSplit, offsetPoint } from '../laneGeometry'
import { readColorToken } from '../theme'

const PX_PER_METER = 4
const SIGNAL_CYCLE_SEC = 20
const LANE = '#E8C468'
const FLOW_FREE = '#3DDC84'
const FLOW_MODERATE = '#F2B84B'
const FLOW_CONGESTED = '#F0523C'

function blendColor(start: string, end: string, amount: number) {
  const a = start.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16))
  const b = end.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16))
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

function flowColor(multiplier: number) {
  if (multiplier < 1.3) return blendColor(FLOW_FREE, FLOW_MODERATE, Math.max(0, multiplier - 1) / 0.3)
  if (multiplier < 2.5) return blendColor(FLOW_MODERATE, FLOW_CONGESTED, (multiplier - 1.3) / 1.2)
  return FLOW_CONGESTED
}

function rgba(color: string, opacity: number) {
  const [red, green, blue] = color.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16))
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

type Props = {
  nodes: NodeData[]
  edges: EdgeData[]
  vehicles: Scenario['vehicles']
  weather: Scenario['weather']
  animationTick: AnimationTick | null
  edgeLoads: AnimationTick['edgeLoads']
  startedAt: number
  selection: CanvasSelection
  fitVersion: number
  routeOverlay: RouteOverlay | null
  onElementSelect: (selection: CanvasSelection) => void
  onCanvasCreateNode: (x: number, y: number) => void
  onCreateEdge: (from: string, to: string) => void
  onNodeMove: (id: string, x: number, y: number) => void
}

function useViewport() {
  const [size, setSize] = useState({ width: 1000, height: 700, measured: false })
  useLayoutEffect(() => {
    const element = document.getElementById('network-viewport')
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height, measured: true })
    })
    const bounds = element.getBoundingClientRect()
    setSize({ width: bounds.width, height: bounds.height, measured: true })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return size
}

function roadOutlineStyle(flowColorValue: string, selectionColor: string, selected: boolean) {
  const glowColor = selected ? selectionColor : flowColorValue
  return {
    stroke: 'transparent',
    strokeWidth: 0,
    shadowColor: glowColor,
    shadowBlur: selected ? 10 : 3,
    shadowOpacity: selected ? 0.15 : 0.08,
  }
}

type ViewTransform = { originX: number; originY: number; viewScale: number }

function fitView(width: number, height: number, nodes: NodeData[]): ViewTransform {
  const minX = Math.min(...nodes.map((node) => node.x), 0)
  const minY = Math.min(...nodes.map((node) => node.y), 0)
  const maxX = Math.max(...nodes.map((node) => node.x), 0)
  const maxY = Math.max(...nodes.map((node) => node.y), 0)
  const viewScale = Math.min(1, (width - 48) / (maxX - minX + 60), (height - 48) / (maxY - minY + 60))
  return {
    viewScale,
    originX: (width - (maxX - minX) * viewScale) / 2 - minX * viewScale,
    originY: (height - (maxY - minY) * viewScale) / 2 - minY * viewScale,
  }
}

export default function NetworkCanvas({
  nodes, edges, vehicles, weather, animationTick, edgeLoads, startedAt, selection, fitVersion, routeOverlay, onElementSelect, onCanvasCreateNode, onCreateEdge, onNodeMove,
}: Props) {
  const { width, height, measured } = useViewport()
  const colors = useMemo(() => ({
    road: readColorToken('--road-surface'),
    textDim: readColorToken('--text-dim'),
    textPrimary: readColorToken('--text-primary'),
    bgVoid: readColorToken('--bg-void'),
    accentEgo: readColorToken('--accent-ego'),
    accentPso: readColorToken('--accent-pso'),
    accentQpso: readColorToken('--accent-qpso'),
  }), [])
  const [clockNow, setClockNow] = useState(() => performance.now())
  const [edgeStartId, setEdgeStartId] = useState<string | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const activeDragId = useRef<string | null>(null)
  const previewFrame = useRef<number | null>(null)
  const pendingPreview = useRef<{ id: string; x: number; y: number } | null>(null)
  const lastPreviewAt = useRef(0)
  const dragEndNodes = useRef<NodeData[] | null>(null)
  // Fit once on mount (with the measured viewport), then keep the transform
  // fixed through every node/edge edit. App remounts this canvas only when the
  // user explicitly randomizes the network.
  const [initialView, setInitialView] = useState<ViewTransform | null>(null)
  const panGesture = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  useLayoutEffect(() => {
    if (measured && initialView === null) setInitialView(fitView(width, height, nodes))
  }, [measured, width, height, nodes, initialView])
  useLayoutEffect(() => {
    if (measured && fitVersion > 0) setInitialView(fitView(width, height, nodes))
  }, [fitVersion])
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(performance.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (dragEndNodes.current && nodes !== dragEndNodes.current) {
      dragEndNodes.current = null
      setDragPreview(null)
    }
  }, [nodes])
  useEffect(() => () => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
  }, [])
  function handleNodeDragEnd(event: { target: { x: () => number; y: () => number; position: (position: { x: number; y: number }) => void; getAbsolutePosition: () => { x: number; y: number }; isDragging: () => boolean }; evt?: { type?: string } }, id: string) {
    const node = event.target
    const modelPoint = stageToModel(node.getAbsolutePosition())
    const finalX = modelPoint.x
    const finalY = modelPoint.y
    activeDragId.current = null
    // Konva's dragend is authoritative. Keep its target at the released
    // position, synchronously commit that same local/model position, then save.
    node.position({ x: finalX, y: finalY })
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null
    pendingPreview.current = null
    setDragPreview({ id, x: finalX, y: finalY })
    dragEndNodes.current = nodes
    onNodeMove(id, finalX, finalY)
  }
  const renderNodes = useMemo(() => dragPreview
    ? nodes.map((node) => node.id === dragPreview.id ? { ...node, x: dragPreview.x, y: dragPreview.y } : node)
    : nodes, [nodes, dragPreview])
  const nodeById = useMemo(() => new Map(renderNodes.map((node) => [node.id, node])), [renderNodes])
  const edgeLoadById = useMemo(() => new Map(edgeLoads.map((flow) => [flow.edgeId, flow])), [edgeLoads])
  const junctionSizes = useMemo(() => {
    const widestRoadByNode = new Map<string, number>()
    for (const edge of edges) {
      const roadWidth = edge.lanes * edge.laneWidthM * PX_PER_METER
      widestRoadByNode.set(edge.from, Math.max(widestRoadByNode.get(edge.from) ?? 0, roadWidth))
      widestRoadByNode.set(edge.to, Math.max(widestRoadByNode.get(edge.to) ?? 0, roadWidth))
    }
    return new Map([...widestRoadByNode].map(([nodeId, widestRoadWidth]) => [nodeId, widestRoadWidth * 1.4]))
  }, [edges])
  const { originX, originY, viewScale } = initialView ?? fitView(width, height, nodes)
  const stageToModel = (point: { x: number; y: number }) => ({
    x: (point.x - originX) / viewScale,
    y: (point.y - originY) / viewScale,
  })

  const renderedEdges = useMemo(() => {
    return edges.map((edge) => {
              const from = nodeById.get(edge.from)
              const to = nodeById.get(edge.to)
              if (!from || !to) return null
              const dx = to.x - from.x
              const dy = to.y - from.y
              const length = Math.hypot(dx, dy)
              if (length === 0) return null
              const ux = dx / length
              const uy = dy / length
              const normalX = -uy
              const normalY = ux
              const lanes = laneSplit(edge, PX_PER_METER)
              const centerlineOffset = lanes.lanesForward >= 1 && lanes.lanesBackward >= 1
                ? (lanes.backwardOffsets[lanes.backwardOffsets.length - 1] + lanes.forwardOffsets[0]) / 2
                : null
              const roadWidth = edge.lanes * lanes.laneWidthPx
              const roadHalfWidth = roadWidth / 2
              const backStart = offsetPoint(from.x, from.y, normalX, normalY, -roadHalfWidth)
              const backEnd = offsetPoint(to.x, to.y, normalX, normalY, -roadHalfWidth)
              const forwardEnd = offsetPoint(to.x, to.y, normalX, normalY, roadHalfWidth)
              const forwardStart = offsetPoint(from.x, from.y, normalX, normalY, roadHalfWidth)
              const roadPoints = [
                backStart.x, backStart.y, backEnd.x, backEnd.y,
                forwardEnd.x, forwardEnd.y, forwardStart.x, forwardStart.y,
              ]
              const chevrons = edge.oneWay
                ? Array.from({ length: Math.floor(length / 40) }, (_, index) => {
                    const distance = Math.min(length - 12, 20 + index * 40)
                    const center = offsetPoint(from.x + ux * distance, from.y + uy * distance, normalX, normalY, 0)
                    const cx = center.x
                    const cy = center.y
                    const backX = -ux * 6
                    const backY = -uy * 6
                    const sideX = -uy * 5
                    const sideY = ux * 5
                    return [cx + backX + sideX, cy + backY + sideY, cx, cy, cx + backX - sideX, cy + backY - sideY]
                  })
                : []
              const selected = selection?.type === 'edge' && selection.id === edge.id
              const multiplier = edgeLoadById.get(edge.id)?.congestionMultiplier ?? 1
              const color = flowColor(multiplier)
              const outline = roadOutlineStyle(color, colors.accentEgo, selected)
              const roadMiddle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
              const rotation = Math.atan2(dy, dx) * 180 / Math.PI
              return (
                <Group key={edge.id} onClick={() => { setEdgeStartId(null); onElementSelect({ type: 'edge', id: edge.id }) }} onTap={() => { setEdgeStartId(null); onElementSelect({ type: 'edge', id: edge.id }) }}>
                  <Line
                    points={roadPoints}
                    closed
                    fill={colors.road}
                    fillLinearGradientStartPoint={{ x: from.x, y: from.y }}
                    fillLinearGradientEndPoint={{ x: to.x, y: to.y }}
                    fillLinearGradientColorStops={[0, rgba(color, 0.28), 0.5, colors.road, 1, rgba(color, 0.28)]}
                    stroke={outline.stroke}
                    strokeWidth={outline.strokeWidth}
                    shadowColor={outline.shadowColor}
                    shadowBlur={outline.shadowBlur}
                    shadowOpacity={outline.shadowOpacity}
                    lineJoin="round"
                  />
                  {centerlineOffset !== null && (() => {
                    const start = offsetPoint(from.x, from.y, normalX, normalY, centerlineOffset)
                    const end = offsetPoint(to.x, to.y, normalX, normalY, centerlineOffset)
                    return <Line points={[start.x, start.y, end.x, end.y]} stroke={LANE} strokeWidth={1.5} dash={[8, 6]} opacity={0.9} listening={false} />
                  })()}
                  {lanes.forwardOffsets.slice(0, -1).map((offsetPx, index) => {
                    const offset = (offsetPx + lanes.forwardOffsets[index + 1]) / 2
                    const start = offsetPoint(from.x, from.y, normalX, normalY, offset)
                    const end = offsetPoint(to.x, to.y, normalX, normalY, offset)
                    return <Line key={`${edge.id}-forward-boundary-${index}`} points={[start.x, start.y, end.x, end.y]} stroke={LANE} strokeWidth={1} opacity={0.4} listening={false} />
                  })}
                  {lanes.backwardOffsets.slice(0, -1).map((offsetPx, index) => {
                    const offset = (offsetPx + lanes.backwardOffsets[index + 1]) / 2
                    const start = offsetPoint(from.x, from.y, normalX, normalY, offset)
                    const end = offsetPoint(to.x, to.y, normalX, normalY, offset)
                    return <Line key={`${edge.id}-backward-boundary-${index}`} points={[start.x, start.y, end.x, end.y]} stroke={LANE} strokeWidth={1} opacity={0.4} listening={false} />
                  })}
                  {chevrons.map((points, index) => <Line key={`${edge.id}-chevron-${index}`} points={points} stroke={LANE} strokeWidth={1.6} lineCap="round" lineJoin="round" opacity={0.82} listening={false} />)}
                  {edge.incident?.type === 'closure' && <Group x={roadMiddle.x} y={roadMiddle.y} rotation={rotation} listening={false}>
                    <Rect x={-6} y={-roadWidth / 2} width={12} height={roadWidth} fill="#F0523C" cornerRadius={1} />
                    <Line points={[-6, -roadWidth / 2, -1, roadWidth / 2]} stroke="#F7F8FA" strokeWidth={3} />
                    <Line points={[1, -roadWidth / 2, 6, roadWidth / 2]} stroke="#F7F8FA" strokeWidth={3} />
                  </Group>}
                  {edge.incident?.type === 'slowdown' && <Group x={roadMiddle.x} y={roadMiddle.y} listening={false}>
                    <RegularPolygon sides={3} radius={8} fill="#F2B84B" stroke={colors.bgVoid} strokeWidth={1} />
                    <Text x={-2} y={-5} text="!" fontSize={9} fontStyle="bold" fill={colors.bgVoid} />
                  </Group>}
                </Group>
              )
    })
  }, [edges, nodeById, edgeLoadById, selection, onElementSelect, colors])

  return (
    <div id="network-viewport" className="network-viewport">
      <div className="network-stage" style={{ filter: weather.type === 'fog' ? `grayscale(${weather.intensity * 60}%)` : undefined, cursor: isPanning ? 'grabbing' : undefined }}>
      <Stage
        width={width}
        height={height}
        onWheel={(event) => {
          event.evt.preventDefault()
          const point = event.target.getStage()?.getPointerPosition()
          if (!point) return
          const nextScale = Math.min(3, Math.max(0.25, viewScale * (event.evt.deltaY < 0 ? 1.1 : 1 / 1.1)))
          const modelPoint = { x: (point.x - originX) / viewScale, y: (point.y - originY) / viewScale }
          setInitialView({ viewScale: nextScale, originX: point.x - modelPoint.x * nextScale, originY: point.y - modelPoint.y * nextScale })
        }}
        onPointerDown={(event) => {
          if (event.evt.button !== 1) return
          event.evt.preventDefault()
          const point = event.target.getStage()?.getPointerPosition()
          if (!point) return
          panGesture.current = { pointerId: event.evt.pointerId, startX: point.x, startY: point.y, originX, originY }
          setIsPanning(true)
        }}
        onPointerMove={(event) => {
          const gesture = panGesture.current
          if (!gesture || gesture.pointerId !== event.evt.pointerId) return
          const point = event.target.getStage()?.getPointerPosition()
          if (!point) return
          setInitialView((current) => current ? { ...current, originX: gesture.originX + point.x - gesture.startX, originY: gesture.originY + point.y - gesture.startY } : current)
        }}
        onPointerUp={(event) => {
          if (panGesture.current?.pointerId === event.evt.pointerId) { panGesture.current = null; setIsPanning(false) }
        }}
        onPointerCancel={(event) => {
          if (panGesture.current?.pointerId === event.evt.pointerId) { panGesture.current = null; setIsPanning(false) }
        }}
        onClick={(event) => {
          if (event.evt.button !== 0) return
          if (event.target !== event.currentTarget) return
          const point = event.target.getStage()?.getPointerPosition()
          if (!point) return
          setEdgeStartId(null)
          setPointer(null)
          onElementSelect(null)
          const modelPoint = stageToModel(point)
          onCanvasCreateNode(modelPoint.x, modelPoint.y)
        }}
        onTap={(event) => {
          if (event.target !== event.currentTarget) return
          const point = event.target.getStage()?.getPointerPosition()
          if (!point) return
          setEdgeStartId(null)
          setPointer(null)
          onElementSelect(null)
          const modelPoint = stageToModel(point)
          onCanvasCreateNode(modelPoint.x, modelPoint.y)
        }}
        onMouseMove={(event) => {
          if (!edgeStartId) return
          const point = event.target.getStage()?.getPointerPosition()
          if (point) setPointer(stageToModel(point))
        }}
        onTouchMove={(event) => {
          if (!edgeStartId) return
          const point = event.target.getStage()?.getPointerPosition()
          if (point) setPointer(stageToModel(point))
        }}
      >
        <Layer>
          <Group x={originX} y={originY} scaleX={viewScale} scaleY={viewScale}>
            {renderedEdges}
            {routeOverlay && (() => {
              const routeStyles = [
                { algorithm: 'dijkstra' as const, color: colors.textPrimary },
                { algorithm: 'astar' as const, color: '#9A938F' },
                { algorithm: 'pso' as const, color: colors.accentPso },
                { algorithm: 'qpso' as const, color: colors.accentQpso },
              ]
              return edges.map((edge) => {
                const from = nodeById.get(edge.from), to = nodeById.get(edge.to)
                if (!from || !to) return null
                const matches = routeStyles.flatMap((style) => {
                  const route = routeOverlay[style.algorithm] ?? []
                  const forward = route.some((node, index) => node === edge.from && route[index + 1] === edge.to)
                  const backward = !edge.oneWay && route.some((node, index) => node === edge.to && route[index + 1] === edge.from)
                  return forward || backward ? [{ ...style, reverse: backward && !forward }] : []
                })
                if (!matches.length) return null
                const dx = to.x - from.x, dy = to.y - from.y
                const length = Math.hypot(dx, dy) || 1
                const nx = -dy / length, ny = dx / length
                const draw = (match: (typeof matches)[number], index: number) => {
                  const offset = (index - (matches.length - 1) / 2) * 4
                  const start = match.reverse ? to : from
                  const end = match.reverse ? from : to
                  return <Arrow key={`${edge.id}-${match.algorithm}`} points={[start.x + nx * offset, start.y + ny * offset, end.x + nx * offset, end.y + ny * offset]} stroke={match.color} fill={match.color} strokeWidth={2.5} pointerLength={5} pointerWidth={5} opacity={0.9} listening={false} />
                }
                return <Group key={`${edge.id}-routes`}>{matches.map(draw)}</Group>
              })
            })()}
            {edgeStartId && pointer && nodeById.get(edgeStartId) && (
              <Line
                points={[nodeById.get(edgeStartId)!.x, nodeById.get(edgeStartId)!.y, pointer.x, pointer.y]}
                stroke={colors.accentEgo}
                strokeWidth={2}
                dash={[7, 5]}
                opacity={0.9}
                listening={false}
              />
            )}
            {nodes.map((node) => {
              const size = junctionSizes.get(node.id) ?? 20
              const phase = ((clockNow - startedAt) / 1000) % SIGNAL_CYCLE_SEC
              const signalGreen = phase < node.greenSplit * SIGNAL_CYCLE_SEC
              const selected = selection?.type === 'node' && selection.id === node.id
              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true
                    onElementSelect({ type: 'node', id: node.id })
                    if (edgeStartId && edgeStartId !== node.id) {
                      onCreateEdge(edgeStartId, node.id)
                      setEdgeStartId(null)
                      setPointer(null)
                    } else if (edgeStartId === node.id) {
                      setEdgeStartId(null)
                      setPointer(null)
                    } else {
                      setEdgeStartId(node.id)
                      setPointer({ x: node.x, y: node.y })
                    }
                  }}
                  onTap={(event) => {
                    event.cancelBubble = true
                    onElementSelect({ type: 'node', id: node.id })
                    if (edgeStartId && edgeStartId !== node.id) {
                      onCreateEdge(edgeStartId, node.id)
                      setEdgeStartId(null)
                      setPointer(null)
                    } else if (edgeStartId === node.id) {
                      setEdgeStartId(null)
                      setPointer(null)
                    } else {
                      setEdgeStartId(node.id)
                      setPointer({ x: node.x, y: node.y })
                    }
                  }}
                  onDragStart={() => { activeDragId.current = node.id; lastPreviewAt.current = 0; dragEndNodes.current = null; setEdgeStartId(null); setPointer(null); onElementSelect({ type: 'node', id: node.id }) }}
                  onDragMove={(event) => {
                    pendingPreview.current = { id: node.id, x: event.target.x(), y: event.target.y() }
                    if (previewFrame.current === null) {
                      previewFrame.current = requestAnimationFrame(() => {
                        previewFrame.current = null
                        const now = performance.now()
                        if (pendingPreview.current && now - lastPreviewAt.current >= 1000 / 30) {
                          lastPreviewAt.current = now
                          setDragPreview(pendingPreview.current)
                        }
                      })
                    }
                  }}
                  onDragEnd={(event) => handleNodeDragEnd(event, node.id)}
                >
                  <Rect x={-size / 2} y={-size / 2} width={size} height={size} cornerRadius={size / 2} fill="#373234" stroke={selected ? colors.accentEgo : '#615B58'} strokeWidth={selected ? 2 : 1.2} />
                  {node.signal && <Circle x={size * 0.32} y={-size * 0.32} radius={6} fill={signalGreen ? '#3DDC84' : '#F0523C'} stroke={colors.bgVoid} strokeWidth={2} />}
                  <Circle x={0} y={0} radius={2.5} fill={colors.textPrimary} opacity={0.8} listening={false} />
                  <Text x={-24} y={size / 2 + 7} width={48} align="center" text={node.id} fontFamily="'JetBrains Mono', 'IBM Plex Mono', monospace" fontSize={10} fill={colors.textDim} listening={false} />
                </Group>
              )
            })}
            <VehicleLayer nodes={renderNodes} edges={edges} vehicles={vehicles} animationTick={animationTick} edgeLoads={edgeLoads} />
          </Group>
        </Layer>
      </Stage>
      </div>
      {nodes.length === 0 && <div className="canvas-empty-state">Click the canvas to add an intersection, or Randomize</div>}
      {weather.type === 'rain' && <div className="rain-overlay" style={{ opacity: 0.15 + 0.35 * weather.intensity }} aria-hidden="true" />}
      {weather.type === 'fog' && <div className="fog-overlay" style={{ opacity: weather.intensity * 0.25 }} aria-hidden="true" />}
    </div>
  )
}
