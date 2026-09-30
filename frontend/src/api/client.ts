import type { CompareAllResults, EdgeData, NodeData, RunResult, Scenario, VehicleCounts, WeatherData } from '../types'

const rawBase = import.meta.env.VITE_API_BASE_URL
const API_BASE = (rawBase !== undefined ? rawBase : (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')).replace(/\/+$/, '')

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = await response.json()
      message = typeof payload.error === 'string' ? payload.error : message
    } catch {
      // Preserve the status message when the server response is not JSON.
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  getHealth: () => request<{ status: string }>('/health'),
  getScenario: () => request<Scenario>('/scenario'),
  replaceScenario: (body: Scenario) => request<Scenario>('/scenario', 'PUT', body),
  createNode: (body: Omit<NodeData, 'id'>) => request<NodeData>('/scenario/nodes', 'POST', body),
  patchNode: (id: string, body: Partial<Omit<NodeData, 'id'>>) => request<NodeData>(`/scenario/nodes/${encodeURIComponent(id)}`, 'PATCH', body),
  deleteNode: (id: string) => request<void>(`/scenario/nodes/${encodeURIComponent(id)}`, 'DELETE'),
  createEdge: (body: Omit<EdgeData, 'id' | 'incident'>) => request<EdgeData>('/scenario/edges', 'POST', body),
  patchEdge: (id: string, body: Partial<Omit<EdgeData, 'id' | 'incident'>>) => request<EdgeData>(`/scenario/edges/${encodeURIComponent(id)}`, 'PATCH', body),
  deleteEdge: (id: string) => request<void>(`/scenario/edges/${encodeURIComponent(id)}`, 'DELETE'),
  updateVehicles: (body: VehicleCounts) => request<VehicleCounts>('/scenario/vehicles', 'PUT', body),
  updateEgo: (body: Scenario['egoVehicle']) => request<Scenario['egoVehicle']>('/scenario/ego', 'PUT', body),
  updateWeather: (body: WeatherData) => request<WeatherData>('/scenario/weather', 'PUT', body),
  updateWeights: (body: Scenario['weights']) => request<Scenario['weights']>('/scenario/weights', 'PUT', body),
  updateIncident: (id: string, body: EdgeData['incident']) => request<EdgeData>(`/scenario/edges/${encodeURIComponent(id)}/incident`, 'PUT', body),
  validateScenario: () => request<{ valid: boolean; errors: string[] }>('/scenario/validate', 'POST'),
  runAlgorithm: (algorithm: RunResult['algorithm']) => request<RunResult>('/run', 'POST', { algorithm }),
  compareAll: () => request<CompareAllResults>('/run/compare-all', 'POST'),
  importScenario: async (rawJson: string) => {
    const response = await fetch(`${API_BASE}/scenario/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawJson,
    })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const payload = await response.json()
        message = typeof payload.error === 'string' ? payload.error : message
      } catch {
        // Keep the status message when the API response is not JSON.
      }
      throw new Error(message)
    }
    return response.json() as Promise<{ scenario: Scenario; valid: boolean; errors: string[] }>
  },
  exportScenario: async () => {
    const response = await fetch(`${API_BASE}/scenario/export`)
    if (!response.ok) throw new Error(`Scenario export failed (${response.status})`)
    return {
      blob: await response.blob(),
      filename: response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'scenario.json',
    }
  },
  animationSocketUrl: () => {
    if (!API_BASE || API_BASE.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${window.location.host}${API_BASE}/ws/animation`
    }
    return `${API_BASE.replace(/^http/, 'ws')}/ws/animation`
  },
}
