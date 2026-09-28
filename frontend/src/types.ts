export type NodeData = {
  id: string
  x: number
  y: number
  signal: boolean
  greenSplit: number
}

export type EdgeData = {
  id: string
  from: string
  to: string
  lengthM: number
  lanes: number
  laneWidthM: number
  speedLimitKph: number
  oneWay: boolean
  backgroundLoad?: number
  incident: null | { type: 'closure' } | { type: 'slowdown'; factor?: number }
}

export type Scenario = {
  nodes: NodeData[]
  edges: EdgeData[]
  vehicles: { cars: number; trucks: number; buses: number }
  egoVehicle: { origin: string; destination: string } | null
  weather: { type: 'clear' | 'rain' | 'fog'; intensity: number }
  weights: { wT: number; wD: number; wC: number }
}

export type VehicleCounts = Scenario['vehicles']
export type WeatherData = Scenario['weather']

export type CanvasSelection = { type: 'node' | 'edge'; id: string } | null

export type RunResult = {
  algorithm: 'dijkstra' | 'astar' | 'pso' | 'qpso'
  route: string[]
  time: number
  distance: number
  objective_score: number
  congestion: number
  actual_congestion: number
  free_flow_time: number
  actual_time: number
  iterations: number
  optimization_time_ms: number
  convergence_curve: { iteration: number; bestFitness: number }[]
}

export type CompareAllResults = Record<RunResult['algorithm'], RunResult>
export type RouteOverlay = Partial<Record<RunResult['algorithm'], string[]>>

export type AnimationTick = {
  type: 'tick'
  runId: string
  algorithm: RunResult['algorithm']
  route: string[]
  routeEdgeIds: string[]
  routeEdgeTimesMin: number[]
  actualRouteTimeMin: number
  simTimeSec: number
  status: 'running' | 'paused' | 'complete'
  ego: {
    edgeId: string
    forward: boolean
    progressOnEdge: number
    x: number
    y: number
    headingDeg: number
  }
  edgeLoads: { edgeId: string; load: number; backgroundLoad: number; optimizerLoad: number; effectivePlanningLoad: number; congestionMultiplier: number }[]
}

export type ActiveAnimation = {
  runId: string
  algorithm: RunResult['algorithm']
  route: string[]
  routeEdgeIds: string[]
}
