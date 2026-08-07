export interface NodeItem {
  id: string
  name: string
  category?: 'POI' | 'Navigation'
  type: string
  latitude: number
  longitude: number
  isHidden?: boolean
}

export interface EdgeItem {
  id: string
  fromNodeId: string
  toNodeId: string
  geometry: [number, number][]
  distance: number
  walkingTime: number
  pathType: string
  isBidirectional: boolean
}

export interface RouteResult {
  found: boolean
  totalDistance: number
  walkingTime: number
  nodeIds: string[]
  edgeIds: string[]
  geometry: [number, number][]
}

interface AdjEdge {
  toNodeId: string
  edgeId: string
  distance: number
  walkingTime: number
  pathType: string
  isBidirectional: boolean
}

export const findDijkstraRoute = (
  nodes: NodeItem[],
  edges: EdgeItem[],
  startNodeId: string,
  destinationNodeId: string
): RouteResult => {
  const nodesMap = new Map<string, NodeItem>()
  nodes.forEach((n) => nodesMap.set(n.id, n))

  const startNode = nodesMap.get(startNodeId)
  const destNode = nodesMap.get(destinationNodeId)

  if (!startNode || !destNode) {
    return { found: false, totalDistance: 0, walkingTime: 0, nodeIds: [], edgeIds: [], geometry: [] }
  }

  if (startNodeId === destinationNodeId) {
    return {
      found: true,
      totalDistance: 0,
      walkingTime: 0,
      nodeIds: [startNodeId],
      edgeIds: [],
      geometry: [[startNode.latitude, startNode.longitude]],
    }
  }

  // Build Adjacency List Map
  const adjMap = new Map<string, AdjEdge[]>()
  nodes.forEach((n) => adjMap.set(n.id, []))

  edges.forEach((e) => {
    if (!adjMap.has(e.fromNodeId)) adjMap.set(e.fromNodeId, [])
    if (!adjMap.has(e.toNodeId)) adjMap.set(e.toNodeId, [])

    adjMap.get(e.fromNodeId)!.push({
      toNodeId: e.toNodeId,
      edgeId: e.id,
      distance: e.distance,
      walkingTime: e.walkingTime,
      pathType: e.pathType,
      isBidirectional: e.isBidirectional !== false,
    })

    if (e.isBidirectional !== false) {
      adjMap.get(e.toNodeId)!.push({
        toNodeId: e.fromNodeId,
        edgeId: e.id,
        distance: e.distance,
        walkingTime: e.walkingTime,
        pathType: e.pathType,
        isBidirectional: true,
      })
    }
  })

  // Min-Heap Priority Queue simulation (distance, nodeId)
  const distMap = new Map<string, number>()
  const parentMap = new Map<string, { edgeId: string; parentNodeId: string }>()
  const visited = new Set<string>()

  // Open list array for priority queue
  const pq: { dist: number; nodeId: string }[] = []

  distMap.set(startNodeId, 0)
  pq.push({ dist: 0, nodeId: startNodeId })

  let reachedDestination = false

  while (pq.length > 0) {
    // Sort array to get minimum distance node (Min-Heap simulation)
    pq.sort((a, b) => a.dist - b.dist)
    const { dist: currentDist, nodeId: currNode } = pq.shift()!

    if (visited.has(currNode)) continue
    visited.add(currNode)

    if (currNode === destinationNodeId) {
      reachedDestination = true
      break
    }

    const neighbors = adjMap.get(currNode) || []
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.toNodeId)) continue

      const newDist = currentDist + neighbor.distance
      const existingDist = distMap.get(neighbor.toNodeId)

      if (existingDist === undefined || newDist < existingDist) {
        distMap.set(neighbor.toNodeId, newDist)
        parentMap.set(neighbor.toNodeId, { edgeId: neighbor.edgeId, parentNodeId: currNode })
        pq.push({ dist: newDist, nodeId: neighbor.toNodeId })
      }
    }
  }

  if (!reachedDestination) {
    return { found: false, totalDistance: 0, walkingTime: 0, nodeIds: [], edgeIds: [], geometry: [] }
  }

  // Backtrack Parent Map
  const revNodeIds: string[] = []
  const revEdgeIds: string[] = []

  let curr = destinationNodeId
  revNodeIds.push(curr)

  while (curr !== startNodeId) {
    const parentInfo = parentMap.get(curr)
    if (!parentInfo) break

    revEdgeIds.push(parentInfo.edgeId)
    revNodeIds.push(parentInfo.parentNodeId)
    curr = parentInfo.parentNodeId
  }

  const nodeIds = revNodeIds.reverse()
  const edgeIds = revEdgeIds.reverse()

  const totalDistance = Math.round((distMap.get(destinationNodeId) || 0) * 10) / 10
  const walkingTime = Math.round((totalDistance / 1.4) * 10) / 10

  // Index edges for quick lookup
  const edgeMap = new Map<string, EdgeItem>()
  edges.forEach((e) => edgeMap.set(e.id, e))

  // Merge polyline geometry
  const continuousGeometry: [number, number][] = []

  for (let i = 0; i < edgeIds.length; i++) {
    const edgeId = edgeIds[i]
    const fromId = nodeIds[i]
    const toId = nodeIds[i + 1]

    const edgeObj = edgeMap.get(edgeId)
    if (!edgeObj) continue

    let segGeom: [number, number][] = []
    if (edgeObj.geometry && edgeObj.geometry.length >= 2) {
      segGeom = [...edgeObj.geometry]
    } else {
      const fn = nodesMap.get(fromId)
      const tn = nodesMap.get(toId)
      if (fn && tn) {
        segGeom = [
          [fn.latitude, fn.longitude],
          [tn.latitude, tn.longitude],
        ]
      }
    }

    // Determine orientation
    let isForward = true
    if (segGeom.length >= 2) {
      const fn = nodesMap.get(fromId)
      if (fn) {
        const dStart = Math.hypot(segGeom[0][0] - fn.latitude, segGeom[0][1] - fn.longitude)
        const dEnd = Math.hypot(segGeom[segGeom.length - 1][0] - fn.latitude, segGeom[segGeom.length - 1][1] - fn.longitude)
        if (dEnd < dStart) {
          isForward = false
        }
      }
    }

    if (!isForward) {
      segGeom.reverse()
    }

    for (const pt of segGeom) {
      if (continuousGeometry.length === 0) {
        continuousGeometry.push(pt)
      } else {
        const lastPt = continuousGeometry[continuousGeometry.length - 1]
        if (Math.abs(lastPt[0] - pt[0]) > 1e-6 || Math.abs(lastPt[1] - pt[1]) > 1e-6) {
          continuousGeometry.push(pt)
        }
      }
    }
  }

  return {
    found: true,
    totalDistance,
    walkingTime,
    nodeIds,
    edgeIds,
    geometry: continuousGeometry,
  }
}
