import { type NodeItem, type EdgeItem, type RouteResult } from './dijkstraRouter'

interface AdjEdge {
  toNodeId: string
  edgeId: string
  distance: number
  walkingTime: number
  pathType: string
  isBidirectional: boolean
}

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export const findAStarRoute = (
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

  // Priority Queue storing pair (fScore, nodeId)
  const gScoreMap = new Map<string, number>()
  const parentMap = new Map<string, { edgeId: string; parentNodeId: string }>()
  const visited = new Set<string>()

  const pq: { fScore: number; nodeId: string }[] = []

  gScoreMap.set(startNodeId, 0)
  const hStart = haversineDistance(startNode.latitude, startNode.longitude, destNode.latitude, destNode.longitude)
  pq.push({ fScore: hStart, nodeId: startNodeId })

  let reachedDestination = false

  while (pq.length > 0) {
    pq.sort((a, b) => a.fScore - b.fScore)
    const { nodeId: currNode } = pq.shift()!

    if (visited.has(currNode)) continue
    visited.add(currNode)

    if (currNode === destinationNodeId) {
      reachedDestination = true
      break
    }

    const currentG = gScoreMap.get(currNode) || 0
    const neighbors = adjMap.get(currNode) || []

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.toNodeId)) continue

      const tentativeG = currentG + neighbor.distance
      const existingG = gScoreMap.get(neighbor.toNodeId)

      if (existingG === undefined || tentativeG < existingG) {
        gScoreMap.set(neighbor.toNodeId, tentativeG)
        parentMap.set(neighbor.toNodeId, { edgeId: neighbor.edgeId, parentNodeId: currNode })

        const nObj = nodesMap.get(neighbor.toNodeId)
        const h = nObj ? haversineDistance(nObj.latitude, nObj.longitude, destNode.latitude, destNode.longitude) : 0
        const fScore = tentativeG + h

        pq.push({ fScore, nodeId: neighbor.toNodeId })
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

  const totalDistance = Math.round((gScoreMap.get(destinationNodeId) || 0) * 10) / 10
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
