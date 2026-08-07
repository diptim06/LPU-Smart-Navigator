import { type RouteResult } from './dijkstraRouter'
import { type NodeItem } from '../components/NavigationPanel'
import { type EdgeItem } from '../utils/dijkstraRouter'

const BACKEND_BASE_URL = 'http://localhost:8080'

export interface SaveGraphResponse {
  success: boolean
  nodes?: number
  edges?: number
  error?: string
}

export const fetchRouteFromBackend = async (
  startNodeId: string,
  destinationNodeId: string
): Promise<RouteResult> => {
  const response = await fetch(`${BACKEND_BASE_URL}/api/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startNodeId, destinationNodeId }),
  })

  if (!response.ok) {
    throw new Error(`Backend HTTP Error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as RouteResult
  return data
}

export const saveGraphToBackend = async (
  nodes: NodeItem[],
  edges: EdgeItem[]
): Promise<SaveGraphResponse> => {
  const response = await fetch(`${BACKEND_BASE_URL}/api/save-graph`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nodes, edges }),
  })

  const data = (await response.json()) as SaveGraphResponse

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Failed to save graph (HTTP ${response.status})`)
  }

  return data
}
