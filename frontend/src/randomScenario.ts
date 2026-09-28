import type { EdgeData, NodeData, Scenario } from './types'

const integer = (low: number, high: number) => low + Math.floor(Math.random() * (high - low + 1))
const choice = <T,>(values: T[]): T => values[integer(0, values.length - 1)]
const distance = (a: NodeData, b: NodeData) => Math.hypot(a.x - b.x, a.y - b.y)
const key = (a: NodeData, b: NodeData) => [a.id, b.id].sort().join(':')

function shuffle<T>(values: T[]): T[] {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = integer(0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function reachable(edges: EdgeData[], origin: string, destination: string): boolean {
  const pending = [origin]
  const visited = new Set(pending)
  while (pending.length) {
    const current = pending.shift()!
    if (current === destination) return true
    for (const edge of edges) {
      const next = edge.from === current ? edge.to : !edge.oneWay && edge.to === current ? edge.from : null
      if (next && !visited.has(next)) { visited.add(next); pending.push(next) }
    }
  }
  return false
}

export function generateRandomScenario(): Scenario {
  const nodeCount = integer(10, 20)
  const cols = Math.ceil(Math.sqrt(nodeCount))
  const nodes: NodeData[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `N${index + 1}`,
    x: (index % cols) * 140 + (Math.random() * 50 - 25),
    y: Math.floor(index / cols) * 140 + (Math.random() * 50 - 25),
    signal: Math.random() < 0.30,
    greenSplit: 0.5,
  }))

  const ordered = shuffle(nodes)
  const connected = [ordered[0]]
  const pairs: [NodeData, NodeData][] = []
  const used = new Set<string>()
  for (const node of ordered.slice(1)) {
    const parent = choice(connected)
    pairs.push([parent, node])
    used.add(key(parent, node))
    connected.push(node)
  }

  const near = new Set<string>()
  for (const node of nodes) {
    for (const neighbor of nodes.filter((other) => other.id !== node.id).sort((a, b) => distance(node, a) - distance(node, b)).slice(0, 4)) {
      near.add(key(node, neighbor))
    }
  }
  const remaining: [NodeData, NodeData][] = []
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!used.has(key(nodes[i], nodes[j]))) remaining.push([nodes[i], nodes[j]])
    }
  }
  const preferred = shuffle(remaining.filter(([a, b]) => near.has(key(a, b))))
  const other = shuffle(remaining.filter(([a, b]) => !near.has(key(a, b))))
  pairs.push(...[...preferred, ...other].slice(0, Math.max(0, Math.round(nodeCount * 1.3) - pairs.length)))

  const edges: EdgeData[] = pairs.map(([from, to], index) => ({
    id: `E${index + 1}`,
    from: from.id,
    to: to.id,
    lengthM: distance(from, to) * 2.5,
    lanes: choice([1, 1, 2, 2, 3]),
    laneWidthM: 3.5,
    speedLimitKph: choice([30, 40, 50, 50, 60]),
    oneWay: Math.random() < 0.10,
    incident: null,
  }))

  let origin: NodeData | undefined
  let destination: NodeData | undefined
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [a, b] = shuffle(nodes).slice(0, 2)
    if (reachable(edges, a.id, b.id)) { origin = a; destination = b; break }
  }
  if (!origin || !destination) {
    const pairsByDistance = nodes.flatMap((a) => nodes.filter((b) => b.id !== a.id && reachable(edges, a.id, b.id)).map((b) => [a, b] as const))
    const farthest = pairsByDistance.sort((a, b) => distance(b[0], b[1]) - distance(a[0], a[1]))[0]
    ;[origin, destination] = farthest
  }

  return {
    nodes,
    edges,
    vehicles: { cars: integer(20, 60), trucks: integer(2, 10), buses: integer(0, 4) },
    egoVehicle: { origin: origin.id, destination: destination.id },
    weather: { type: 'clear', intensity: 0 },
    weights: { wT: 1, wD: 1, wC: 1 },
  }
}

export type DemoScenarioKind = 'low-traffic' | 'congested-shortcut' | 'shared-bottleneck' | 'incident' | 'qpso-challenge'

export function generateDemoScenario(kind: DemoScenarioKind): Scenario {
  const nodes: NodeData[] = [
    { id: 'N1', x: 0, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N2', x: 120, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N3', x: 240, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N4', x: 0, y: 120, signal: false, greenSplit: 0.5 },
    { id: 'N5', x: 120, y: 120, signal: false, greenSplit: 0.5 },
    { id: 'N6', x: 240, y: 120, signal: false, greenSplit: 0.5 },
  ]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const road = (id: string, from: string, to: string, lanes: number, backgroundLoad: number, incident: EdgeData['incident'] = null): EdgeData => {
    const source = nodeById.get(from)!
    const target = nodeById.get(to)!
    return {
      id,
      from,
      to,
      lengthM: distance(source, target) * 2.5,
      lanes,
      laneWidthM: 3.5,
      speedLimitKph: 50,
      oneWay: false,
      backgroundLoad,
      incident,
    }
  }

  const congested = kind === 'congested-shortcut' || kind === 'incident'
  const shared = kind === 'shared-bottleneck'
  const scenarioNodes = shared ? nodes.filter((node) => node.id !== 'N4') : nodes
  const edges = shared
    ? [road('E1', 'N1', 'N2', 1, 36), road('E2', 'N2', 'N3', 1, 0), road('E3', 'N2', 'N5', 2, 0), road('E4', 'N5', 'N6', 2, 0), road('E5', 'N6', 'N3', 2, 0)]
    : [
        road('E1', 'N1', 'N2', 1, congested ? 48 : 0, kind === 'incident' ? { type: 'slowdown', factor: 3 } : null),
        road('E2', 'N2', 'N3', 1, congested ? 48 : 0),
        road('E3', 'N1', 'N4', 2, 2),
        road('E4', 'N4', 'N5', 2, 2),
        road('E5', 'N5', 'N6', 2, 2),
        road('E6', 'N6', 'N3', 2, 2),
      ]

  return {
    nodes: scenarioNodes,
    edges,
    vehicles: { cars: kind === 'low-traffic' ? 8 : 40, trucks: 2, buses: 0 },
    egoVehicle: { origin: 'N1', destination: 'N3' },
    weather: { type: 'clear', intensity: 0 },
    weights: { wT: 1, wD: 1, wC: 1 },
  }
}

export function generateQpsoChallengeScenario(): Scenario {
  const nodes: NodeData[] = [
    { id: 'N1', x: 0, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N2', x: 100, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N3', x: 200, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N4', x: 300, y: 0, signal: false, greenSplit: 0.5 },
    { id: 'N5', x: 100, y: 80, signal: false, greenSplit: 0.5 },
    { id: 'N6', x: 200, y: 80, signal: false, greenSplit: 0.5 },
    { id: 'N7', x: 300, y: 80, signal: false, greenSplit: 0.5 },
    { id: 'N8', x: 400, y: 0, signal: false, greenSplit: 0.5 },
  ]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const road = (id: string, from: string, to: string, lanes: number, speedLimitKph: number, backgroundLoad: number): EdgeData => {
    const source = nodeById.get(from)!
    const target = nodeById.get(to)!
    return {
      id,
      from,
      to,
      lengthM: distance(source, target) * 2.5,
      lanes,
      laneWidthM: 3.5,
      speedLimitKph,
      oneWay: true,
      backgroundLoad,
      incident: null,
    }
  }
  return {
    nodes,
    edges: [
      road('E1', 'N1', 'N2', 1, 60, 32),
      road('E2', 'N2', 'N3', 1, 60, 32),
      road('E3', 'N3', 'N4', 1, 60, 32),
      road('E4', 'N4', 'N8', 1, 60, 32),
      road('E5', 'N1', 'N5', 3, 45, 0),
      road('E6', 'N5', 'N6', 3, 45, 0),
      road('E7', 'N6', 'N7', 3, 45, 0),
      road('E8', 'N7', 'N8', 3, 45, 0),
      road('E9', 'N2', 'N6', 2, 55, 4),
      road('E10', 'N6', 'N4', 2, 55, 4),
      road('E11', 'N5', 'N3', 2, 50, 8),
      road('E12', 'N3', 'N7', 1, 55, 18),
    ],
    vehicles: { cars: 54, trucks: 6, buses: 2 },
    egoVehicle: { origin: 'N1', destination: 'N8' },
    weather: { type: 'clear', intensity: 0 },
    weights: { wT: 1, wD: 0.7, wC: 1.4 },
  }
}

export function generateQpsoLandscapeScenario(): Scenario {
  const nodes: NodeData[] = [
    { id: 'N1', x: 0, y: 120, signal: false, greenSplit: 0.5 },
    ...[2, 3, 4].map((id, index) => ({ id: `N${id}`, x: 100, y: 40 + index * 80, signal: false, greenSplit: 0.5 })),
    ...[5, 6, 7].map((id, index) => ({ id: `N${id}`, x: 200, y: 40 + index * 80, signal: false, greenSplit: 0.5 })),
    ...[8, 9, 10].map((id, index) => ({ id: `N${id}`, x: 300, y: 40 + index * 80, signal: false, greenSplit: 0.5 })),
    ...[11, 12, 13].map((id, index) => ({ id: `N${id}`, x: 400, y: 40 + index * 80, signal: false, greenSplit: 0.5 })),
    ...[14, 15, 16].map((id, index) => ({ id: `N${id}`, x: 500, y: 40 + index * 80, signal: false, greenSplit: 0.5 })),
    { id: 'N17', x: 600, y: 120, signal: false, greenSplit: 0.5 },
  ]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const layers = [['N1'], ['N2', 'N3', 'N4'], ['N5', 'N6', 'N7'], ['N8', 'N9', 'N10'], ['N11', 'N12', 'N13'], ['N14', 'N15', 'N16'], ['N17']]
  const loadPattern = [28, 7, 18, 11, 25, 8, 21, 6, 15]
  const edges: EdgeData[] = []
  let edgeNumber = 1
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const sources = layers[layerIndex]
    const targets = layers[layerIndex + 1]
    sources.forEach((from, sourceIndex) => targets.forEach((to, targetIndex) => {
      const patternIndex = (layerIndex * 2 + sourceIndex * 3 + targetIndex) % loadPattern.length
      const lanes = 1 + ((layerIndex + sourceIndex + targetIndex) % 3)
      const speed = [45, 50, 55][(layerIndex + sourceIndex * 2 + targetIndex) % 3]
      const sourceNode = nodeById.get(from)!
      const targetNode = nodeById.get(to)!
      edges.push({
        id: `E${edgeNumber++}`,
        from,
        to,
        lengthM: distance(sourceNode, targetNode) * 2.5,
        lanes,
        laneWidthM: 3.5,
        speedLimitKph: speed,
        oneWay: true,
        backgroundLoad: loadPattern[patternIndex],
        incident: null,
      })
    }))
  }
  return {
    nodes,
    edges,
    vehicles: { cars: 48, trucks: 7, buses: 2 },
    egoVehicle: { origin: 'N1', destination: 'N17' },
    weather: { type: 'clear', intensity: 0 },
    weights: { wT: 1, wD: 0.9, wC: 1.2 },
  }
}
