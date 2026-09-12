import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import initialNodesData from '../../../backend/data/nodes.json'
import initialEdgesData from '../../../backend/data/edges.json'
import { NavigationPanel } from './NavigationPanel'
import type { RouteResult } from '../utils/dijkstraRouter'
import { saveGraphToBackend } from '../utils/apiClient'

const LPU_COORDINATES: [number, number] = [31.2536, 75.7037]
const INITIAL_ZOOM = 16
const MIN_ZOOM = 15
const MAX_ZOOM = 22
const MAX_NATIVE_ZOOM = 19
const LOCAL_STORAGE_NODES_KEY = 'lpu_nodes_working_dataset'
const LOCAL_STORAGE_EDGES_KEY = 'lpu_edges_working_dataset'
const LOCAL_STORAGE_ADMIN_AUTH_KEY = 'lpu_admin_authenticated'

// Demo authentication only. Replace with secure backend authentication for production.
const ADMIN_CREDENTIALS = {
  username: 'dips006',
  password: '2222026',
} as const

const HOVER_SNAP_THRESHOLD_METERS = 12
const NODE_REUSE_TOLERANCE_METERS = 3

const LPU_BOUNDS: LatLngBoundsExpression = [
  [31.2400, 75.6900], // South-West [lat, lng]
  [31.2650, 75.7200], // North-East [lat, lng]
]

const lockedEndpointIcon = L.divIcon({
  className: 'custom-locked-endpoint-icon',
  html: '<div style="width:12px;height:12px;background:#64748b;border:2px solid #ffffff;border-radius:3px;box-shadow:0 2px 4px rgba(0,0,0,0.4);" title="Locked Endpoint"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const intermediateWaypointIcon = L.divIcon({
  className: 'custom-waypoint-icon',
  html: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid #ffffff;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.4);cursor:grab;"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const selectedWaypointIcon = L.divIcon({
  className: 'custom-selected-waypoint-icon',
  html: '<div style="width:14px;height:14px;background:#ef4444;border:2px solid #ffffff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:grab;"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

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

interface ClickedLocation {
  lat: number
  lng: number
}

interface SnapProjection {
  edge: EdgeItem
  point: [number, number]
  distanceMeters: number
  segmentIndex: number
}

const SUPPORTED_NODE_TYPES = [
  'gate',
  'building',
  'entrance',
  'intersection',
  'road',
  'library',
  'hospital',
  'food_court',
  'parking',
  'hostel',
  'skywalk',
  'corridor',
  'stairs',
  'lift',
  'custom',
] as const

const SUPPORTED_NAV_TYPES = [
  'road_junction',
  'corridor_junction',
  'skywalk_entrance',
  'park_entrance',
  'stairs',
  'lift',
  'custom',
] as const

const SUPPORTED_PATH_TYPES = [
  'road',
  'footpath',
  'corridor',
  'skywalk',
  'stairs',
  'lift',
  'bridge',
  'tunnel',
  'ramp',
  'custom',
] as const

// Haversine distance calculation in meters
const calculateDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10
}

// Calculate total multi-point polyline distance
const calculatePathDistance = (points: [number, number][]): number => {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += calculateDistanceMeters(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1])
  }
  return Math.round(total * 10) / 10
}

const getGeometryCenter = (geometry: [number, number][]): [number, number] => {
  if (!geometry || geometry.length === 0) return LPU_COORDINATES
  let sumLat = 0
  let sumLng = 0
  geometry.forEach(([lat, lng]) => {
    sumLat += lat
    sumLng += lng
  })
  return [sumLat / geometry.length, sumLng / geometry.length] as [number, number]
}

// Project a point onto a line segment
const projectPointOnSegment = (
  p: [number, number],
  a: [number, number],
  b: [number, number]
): { point: [number, number]; distanceMeters: number; t: number } => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) {
    const d = calculateDistanceMeters(p[0], p[1], a[0], a[1])
    return { point: a, distanceMeters: d, t: 0 }
  }

  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  const projLat = a[0] + t * dx
  const projLng = a[1] + t * dy
  const projPt: [number, number] = [Number(projLat.toFixed(6)), Number(projLng.toFixed(6))]
  const dist = calculateDistanceMeters(p[0], p[1], projLat, projLng)

  return { point: projPt, distanceMeters: dist, t }
}

// Find nearest point on a polyline geometry
const findNearestPointOnEdge = (
  p: [number, number],
  edge: EdgeItem,
  nodesMap: Map<string, NodeItem>
): { point: [number, number]; distanceMeters: number; segmentIndex: number } | null => {
  const fromNode = nodesMap.get(edge.fromNodeId)
  const toNode = nodesMap.get(edge.toNodeId)
  const geom: [number, number][] | null =
    edge.geometry && edge.geometry.length >= 2
      ? edge.geometry
      : fromNode && toNode
      ? [
          [fromNode.latitude, fromNode.longitude],
          [toNode.latitude, toNode.longitude],
        ]
      : null

  if (!geom) return null

  let minDistance = Infinity
  let bestProj: [number, number] = geom[0] as [number, number]
  let bestSegIndex = 0

  for (let i = 0; i < geom.length - 1; i++) {
    const p1 = geom[i] as [number, number]
    const p2 = geom[i + 1] as [number, number]
    const res = projectPointOnSegment(p, p1, p2)
    if (res.distanceMeters < minDistance) {
      minDistance = res.distanceMeters
      bestProj = res.point
      bestSegIndex = i
    }
  }

  return { point: bestProj, distanceMeters: minDistance, segmentIndex: bestSegIndex }
}

// Find closest segment index in geometry array to a clicked point
const getClosestSegmentIndex = (geometry: [number, number][], clickPt: [number, number]): number => {
  if (!geometry || geometry.length < 2) return 0
  let minSqDist = Infinity
  let closestIndex = 0

  for (let i = 0; i < geometry.length - 1; i++) {
    const p1 = geometry[i]
    const p2 = geometry[i + 1]

    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]

    if (dx === 0 && dy === 0) continue

    const t = Math.max(0, Math.min(1, ((clickPt[0] - p1[0]) * dx + (clickPt[1] - p1[1]) * dy) / (dx * dx + dy * dy)))
    const projX = p1[0] + t * dx
    const projY = p1[1] + t * dy

    const distSq = (clickPt[0] - projX) * (clickPt[0] - projX) + (clickPt[1] - projY) * (clickPt[1] - projY)
    if (distSq < minSqDist) {
      minSqDist = distSq
      closestIndex = i
    }
  }

  return closestIndex
}

// Split an edge topologically at a specific node coordinate
const splitEdgeAtNode = (
  originalEdge: EdgeItem,
  node: NodeItem,
  segmentIndex: number,
  nodesMap: Map<string, NodeItem>
): { edge1: EdgeItem; edge2: EdgeItem } => {
  const fromNode = nodesMap.get(originalEdge.fromNodeId)
  const toNode = nodesMap.get(originalEdge.toNodeId)

  const baseGeometry: [number, number][] =
    originalEdge.geometry && originalEdge.geometry.length >= 2
      ? originalEdge.geometry
      : fromNode && toNode
      ? [
          [fromNode.latitude, fromNode.longitude],
          [toNode.latitude, toNode.longitude],
        ]
      : [[node.latitude, node.longitude]]

  const navPt: [number, number] = [node.latitude, node.longitude]
  const geomPart1: [number, number][] = [...baseGeometry.slice(0, segmentIndex + 1), navPt]
  const geomPart2: [number, number][] = [navPt, ...baseGeometry.slice(segmentIndex + 1)]

  const dist1 = calculatePathDistance(geomPart1)
  const dist2 = calculatePathDistance(geomPart2)

  const timestamp = Date.now()

  const edge1: EdgeItem = {
    id: `edge-${timestamp}-1`,
    fromNodeId: originalEdge.fromNodeId,
    toNodeId: node.id,
    geometry: geomPart1,
    distance: dist1,
    walkingTime: Math.round(dist1 / 1.4),
    pathType: originalEdge.pathType,
    isBidirectional: originalEdge.isBidirectional,
  }

  const edge2: EdgeItem = {
    id: `edge-${timestamp}-2`,
    fromNodeId: node.id,
    toNodeId: originalEdge.toNodeId,
    geometry: geomPart2,
    distance: dist2,
    walkingTime: Math.round(dist2 / 1.4),
    pathType: originalEdge.pathType,
    isBidirectional: originalEdge.isBidirectional,
  }

  return { edge1, edge2 }
}

interface MapEventsProps {
  onMapClick: (location: ClickedLocation) => void
  onMouseMove: (location: ClickedLocation) => void
}

const MapEventsHandler = ({ onMapClick, onMouseMove }: MapEventsProps) => {
  useMapEvents({
    click(e) {
      const location = { lat: e.latlng.lat, lng: e.latlng.lng }
      console.log('Clicked coordinates:', location)
      onMapClick(location)
    },
    mousemove(e) {
      onMouseMove({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

interface NodeFormProps {
  pendingNode: ClickedLocation
  onSave: (name: string, category: 'POI' | 'Navigation', type: string) => void
  onCancel: () => void
}

const NodeForm = ({ pendingNode, onSave, onCancel }: NodeFormProps) => {
  const [nodeName, setNodeName] = useState<string>('')
  const [category, setCategory] = useState<'POI' | 'Navigation'>('POI')
  const [typeSelect, setTypeSelect] = useState<string>('building')
  const [customType, setCustomType] = useState<string>('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalType = typeSelect === 'custom' ? customType.trim() || 'custom' : typeSelect
    onSave(nodeName, category, finalType)
  }

  return (
    <form onSubmit={handleSubmit} className="p-1 min-w-[230px] space-y-2 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1">
        Add New Node
      </div>
      
      <div>
        <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
          Coordinates
        </label>
        <div className="font-mono text-xs text-slate-700 bg-slate-100 p-1.5 rounded border border-slate-200">
          {pendingNode.lat.toFixed(6)}, {pendingNode.lng.toFixed(6)}
        </div>
      </div>

      <div>
        <label htmlFor="node-category" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Node Category
        </label>
        <select
          id="node-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as 'POI' | 'Navigation')}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
        >
          <option value="POI">Point of Interest (POI)</option>
          <option value="Navigation">Navigation</option>
        </select>
      </div>

      <div>
        <label htmlFor="node-name" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Name
        </label>
        <input
          id="node-name"
          type="text"
          required
          autoFocus
          placeholder={category === 'Navigation' ? 'e.g. Road Junction 4' : 'e.g. Block 35 Entrance'}
          value={nodeName}
          onChange={(e) => setNodeName(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="node-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Type
        </label>
        <select
          id="node-type"
          value={typeSelect}
          onChange={(e) => setTypeSelect(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
        >
          {SUPPORTED_NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {typeSelect === 'custom' && (
        <div>
          <label htmlFor="custom-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Custom Type
          </label>
          <input
            id="custom-type"
            type="text"
            required
            placeholder="e.g. cafeteria, garden"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      <div className="flex justify-end space-x-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded font-semibold shadow-sm"
        >
          Save Node
        </button>
      </div>
    </form>
  )
}

interface EditNodeFormProps {
  node: NodeItem
  onSave: (updatedNode: NodeItem) => void
  onDelete: (nodeId: string) => void
  onCancel: () => void
}

const EditNodeForm = ({ node, onSave, onDelete, onCancel }: EditNodeFormProps) => {
  const isPreset = (SUPPORTED_NODE_TYPES as readonly string[]).includes(node.type) && node.type !== 'custom'
  
  const [name, setName] = useState<string>(node.name)
  const [category, setCategory] = useState<'POI' | 'Navigation'>(node.category || 'POI')
  const [typeSelect, setTypeSelect] = useState<string>(isPreset ? node.type : 'custom')
  const [customType, setCustomType] = useState<string>(isPreset ? '' : node.type)
  const [lat, setLat] = useState<string>(node.latitude.toString())
  const [lng, setLng] = useState<string>(node.longitude.toString())

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalType = typeSelect === 'custom' ? customType.trim() || 'custom' : typeSelect
    onSave({
      ...node,
      name: name.trim() || node.name,
      category,
      type: finalType,
      latitude: parseFloat(lat) || node.latitude,
      longitude: parseFloat(lng) || node.longitude,
    })
  }

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete "${node.name}"?`)) {
      onDelete(node.id)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-1 min-w-[230px] space-y-2 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1 flex justify-between items-center">
        <span>Edit Node</span>
        <span className="text-[10px] font-mono text-slate-400">{node.id}</span>
      </div>

      <div>
        <label htmlFor="edit-node-category" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Node Category
        </label>
        <select
          id="edit-node-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as 'POI' | 'Navigation')}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
        >
          <option value="POI">Point of Interest (POI)</option>
          <option value="Navigation">Navigation</option>
        </select>
      </div>

      <div>
        <label htmlFor="edit-node-name" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Name
        </label>
        <input
          id="edit-node-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="edit-node-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Type
        </label>
        <select
          id="edit-node-type"
          value={typeSelect}
          onChange={(e) => setTypeSelect(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
        >
          {SUPPORTED_NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {typeSelect === 'custom' && (
        <div>
          <label htmlFor="edit-custom-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Custom Type
          </label>
          <input
            id="edit-custom-type"
            type="text"
            required
            placeholder="e.g. cafeteria, garden"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="edit-lat" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Latitude
          </label>
          <input
            id="edit-lat"
            type="number"
            step="any"
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="edit-lng" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Longitude
          </label>
          <input
            id="edit-lng"
            type="number"
            step="any"
            required
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
        <button
          type="button"
          onClick={handleDelete}
          className="px-2.5 py-1 text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-medium transition-colors"
        >
          Delete
        </button>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded font-semibold shadow-sm"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

interface InsertNavNodeFormProps {
  location: ClickedLocation
  fromNodeName: string
  toNodeName: string
  onConfirm: (name: string, navType: string) => void
  onCancel: () => void
}

const InsertNavNodeForm = ({ location, fromNodeName, toNodeName, onConfirm, onCancel }: InsertNavNodeFormProps) => {
  const [navName, setNavName] = useState<string>('Road Junction')
  const [typeSelect, setTypeSelect] = useState<string>('road_junction')
  const [customType, setCustomType] = useState<string>('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalNavType = typeSelect === 'custom' ? customType.trim() || 'custom' : typeSelect
    onConfirm(navName, finalNavType)
  }

  return (
    <form onSubmit={handleSubmit} className="p-1 min-w-[240px] space-y-2 text-slate-900 font-sans">
      <div className="font-bold text-sm text-cyan-900 border-b border-slate-200 pb-1">
        Insert Navigation Node & Split Path
      </div>

      <div className="space-y-0.5 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
        <div>
          <span className="font-semibold text-slate-500 uppercase text-[10px]">Splitting Path:</span>{' '}
          <span className="font-bold text-slate-900">{fromNodeName}</span> ➔ <span className="font-bold text-slate-900">{toNodeName}</span>
        </div>
        <div className="font-mono text-[10px] text-slate-600">
          Location: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
        </div>
      </div>

      <div>
        <label htmlFor="nav-node-name" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Node Name
        </label>
        <input
          id="nav-node-name"
          type="text"
          required
          autoFocus
          value={navName}
          onChange={(e) => setNavName(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      <div>
        <label htmlFor="nav-node-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Navigation Type
        </label>
        <select
          id="nav-node-type"
          value={typeSelect}
          onChange={(e) => {
            setTypeSelect(e.target.value)
            if (e.target.value !== 'custom') {
              setNavName(e.target.value.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
            }
          }}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500 capitalize"
        >
          {SUPPORTED_NAV_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {typeSelect === 'custom' && (
        <div>
          <label htmlFor="nav-custom-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Custom Navigation Type
          </label>
          <input
            id="nav-custom-type"
            type="text"
            required
            placeholder="e.g. walkway_split"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
      )}

      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1 text-xs text-white bg-cyan-600 hover:bg-cyan-700 rounded font-semibold shadow-sm"
        >
          Split & Insert Node
        </button>
      </div>
    </form>
  )
}

interface AddPathFormProps {
  fromNode: NodeItem
  toNode: NodeItem
  geometry: [number, number][]
  onSave: (data: { distance: number; walkingTime: number; pathType: string; isBidirectional: boolean }) => void
  onCancel: () => void
}

const AddPathForm = ({ fromNode, toNode, geometry, onSave, onCancel }: AddPathFormProps) => {
  const calculatedDist = useMemo(() => calculatePathDistance(geometry), [geometry])

  const [walkingTime, setWalkingTime] = useState<string>(Math.round(calculatedDist / 1.4).toString())
  const [typeSelect, setTypeSelect] = useState<string>('road')
  const [customType, setCustomType] = useState<string>('')
  const [isBidirectional, setIsBidirectional] = useState<boolean>(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalPathType = typeSelect === 'custom' ? customType.trim() || 'custom' : typeSelect
    onSave({
      distance: calculatedDist,
      walkingTime: parseInt(walkingTime) || Math.round(calculatedDist / 1.4),
      pathType: finalPathType,
      isBidirectional,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="p-1 min-w-[240px] space-y-2 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1">
        Add New Path
      </div>

      <div className="space-y-1 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
        <div>
          <span className="font-semibold text-slate-500 uppercase text-[10px]">Start Node:</span>{' '}
          <span className="font-bold text-slate-900">{fromNode.name}</span>
        </div>
        <div>
          <span className="font-semibold text-slate-500 uppercase text-[10px]">End Node:</span>{' '}
          <span className="font-bold text-slate-900">{toNode.name}</span>
        </div>
        <div className="text-[11px] text-slate-600">
          Calculated Distance: <span className="font-mono font-semibold text-indigo-600">{calculatedDist}m</span> ({geometry.length} points)
        </div>
      </div>

      <div>
        <label htmlFor="path-time" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Estimated Walking Time (sec)
        </label>
        <input
          id="path-time"
          type="number"
          required
          value={walkingTime}
          onChange={(e) => setWalkingTime(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="path-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Path Type
        </label>
        <select
          id="path-type"
          value={typeSelect}
          onChange={(e) => setTypeSelect(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
        >
          {SUPPORTED_PATH_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {typeSelect === 'custom' && (
        <div>
          <label htmlFor="custom-path-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Custom Path Type
          </label>
          <input
            id="custom-path-type"
            type="text"
            required
            placeholder="e.g. walkway, ramp_stairs"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
          Direction
        </label>
        <div className="flex items-center space-x-4 text-xs">
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="path-direction"
              checked={isBidirectional}
              onChange={() => setIsBidirectional(true)}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>Bidirectional (↔)</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="path-direction"
              checked={!isBidirectional}
              onChange={() => setIsBidirectional(false)}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>One Way (➔)</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded font-semibold shadow-sm"
        >
          Save Path
        </button>
      </div>
    </form>
  )
}

interface EditPathFormProps {
  edge: EdgeItem
  fromNodeName: string
  toNodeName: string
  onSave: (updatedEdge: EdgeItem) => void
  onDelete: (edgeId: string) => void
  onEditGeometry: () => void
  onCancel: () => void
}

const EditPathForm = ({ edge, fromNodeName, toNodeName, onSave, onDelete, onEditGeometry, onCancel }: EditPathFormProps) => {
  const isPreset = (SUPPORTED_PATH_TYPES as readonly string[]).includes(edge.pathType) && edge.pathType !== 'custom'

  const [walkingTime, setWalkingTime] = useState<string>(edge.walkingTime.toString())
  const [typeSelect, setTypeSelect] = useState<string>(isPreset ? edge.pathType : 'custom')
  const [customType, setCustomType] = useState<string>(isPreset ? '' : edge.pathType)
  const [isBidirectional, setIsBidirectional] = useState<boolean>(edge.isBidirectional)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalPathType = typeSelect === 'custom' ? customType.trim() || 'custom' : typeSelect
    onSave({
      ...edge,
      walkingTime: parseInt(walkingTime) || edge.walkingTime,
      pathType: finalPathType,
      isBidirectional,
    })
  }

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this path?')) {
      onDelete(edge.id)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-1 min-w-[250px] space-y-2 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1 flex justify-between items-center">
        <span>Edit Path</span>
        <span className="text-[10px] font-mono text-slate-400">{edge.id}</span>
      </div>

      <div className="space-y-0.5 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
        <div>
          <span className="font-semibold text-slate-500 text-[10px]">Start:</span>{' '}
          <span className="font-bold text-slate-900">{fromNodeName}</span>
        </div>
        <div>
          <span className="font-semibold text-slate-500 text-[10px]">End:</span>{' '}
          <span className="font-bold text-slate-900">{toNodeName}</span>
        </div>
        <div className="text-[10px] text-slate-500">
          Distance: <span className="font-mono font-semibold">{edge.distance}m</span> ({edge.geometry?.length || 2} points)
        </div>
      </div>

      <div>
        <label htmlFor="edit-path-time" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Walking Time (sec)
        </label>
        <input
          id="edit-path-time"
          type="number"
          required
          value={walkingTime}
          onChange={(e) => setWalkingTime(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="edit-path-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
          Path Type
        </label>
        <select
          id="edit-path-type"
          value={typeSelect}
          onChange={(e) => setTypeSelect(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
        >
          {SUPPORTED_PATH_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {typeSelect === 'custom' && (
        <div>
          <label htmlFor="edit-custom-path-type" className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-0.5">
            Custom Path Type
          </label>
          <input
            id="edit-custom-path-type"
            type="text"
            required
            placeholder="e.g. walkway, ramp_stairs"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider mb-1">
          Direction
        </label>
        <div className="flex items-center space-x-4 text-xs">
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="edit-path-direction"
              checked={isBidirectional}
              onChange={() => setIsBidirectional(true)}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>Bidirectional (↔)</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="edit-path-direction"
              checked={!isBidirectional}
              onChange={() => setIsBidirectional(false)}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>One Way (➔)</span>
          </label>
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
        <div className="flex space-x-1.5">
          <button
            type="button"
            onClick={handleDelete}
            className="px-2.5 py-1 text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-medium transition-colors"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onEditGeometry}
            className="px-2.5 py-1 text-xs text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded font-semibold transition-colors flex items-center space-x-1"
          >
            <span>✏️ Edit Geometry</span>
          </button>
        </div>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded font-semibold shadow-sm"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

interface SnapActionFormProps {
  snap: SnapProjection
  fromNodeName: string
  toNodeName: string
  onMerge: () => void
  onJunction: () => void
  onContinueSeparate: () => void
  onCancel: () => void
}

const SnapActionForm = ({
  snap,
  fromNodeName,
  toNodeName,
  onMerge,
  onJunction,
  onContinueSeparate,
  onCancel,
}: SnapActionFormProps) => {
  return (
    <div className="p-1 min-w-[270px] space-y-2.5 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1 flex items-center justify-between">
        <span>Path Intersection Detected</span>
        <span className="text-[10px] bg-sky-100 text-sky-800 font-semibold px-1.5 py-0.5 rounded">
          {snap.distanceMeters.toFixed(1)}m away
        </span>
      </div>

      <p className="text-xs text-slate-600">
        Near path: <strong>{fromNodeName} ➔ {toNodeName}</strong>. Choose action:
      </p>

      <div className="space-y-1.5 pt-1">
        <button
          type="button"
          onClick={onMerge}
          className="w-full text-left px-3 py-2 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-lg font-semibold transition-colors flex items-start space-x-2 shadow-sm"
        >
          <span className="text-base leading-none">🟢</span>
          <div>
            <div>Merge With Existing Path</div>
            <div className="text-[10px] font-normal text-emerald-700 mt-0.5">
              Connect to graph with an invisible junction node (continuous road look)
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onJunction}
          className="w-full text-left px-3 py-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-300 rounded-lg font-semibold transition-colors flex items-start space-x-2 shadow-sm"
        >
          <span className="text-base leading-none">🔵</span>
          <div>
            <div>Create Junction</div>
            <div className="text-[10px] font-normal text-blue-700 mt-0.5">
              Insert/reuse visible Navigation node & split road into intersection
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onContinueSeparate}
          className="w-full text-left px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg font-semibold transition-colors flex items-start space-x-2 shadow-sm"
        >
          <span className="text-base leading-none">⚪</span>
          <div>
            <div>Continue Drawing as Separate Path</div>
            <div className="text-[10px] font-normal text-slate-500 mt-0.5">
              Cross over without graph connection (bridge, skywalk, tunnel)
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end pt-1 border-t border-slate-200">
        <button type="button" onClick={onCancel} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 font-medium">
          Cancel
        </button>
      </div>
    </div>
  )
}

const loadInitialNodes = (): NodeItem[] => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_NODES_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((n: any) => {
          const category = n.category || (n.id.startsWith('node-nav-') ? 'Navigation' : 'POI')
          // Auto-repair POIs incorrectly set to isHidden: true by previous merge operations
          const isHidden = category === 'POI' ? false : Boolean(n.isHidden)
          return {
            ...n,
            category,
            isHidden,
          }
        }) as NodeItem[]
      }
    }
  } catch (e) {
    console.error('Failed to load nodes from localStorage:', e)
  }
  return (initialNodesData as any[]).map((n) => {
    const category = n.category || (n.id.startsWith('node-nav-') ? 'Navigation' : 'POI')
    const isHidden = category === 'POI' ? false : Boolean(n.isHidden)
    return {
      ...n,
      category,
      isHidden,
    }
  }) as NodeItem[]
}

const loadInitialEdges = (): EdgeItem[] => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_EDGES_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as EdgeItem[]
      }
    }
  } catch (e) {
    console.error('Failed to load edges from localStorage:', e)
  }
  return initialEdgesData as EdgeItem[]
}

export const MapView = () => {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_ADMIN_AUTH_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [appMode, setAppMode] = useState<'user' | 'admin'>(() => {
    try {
      const isAuth = localStorage.getItem(LOCAL_STORAGE_ADMIN_AUTH_KEY) === 'true'
      const saved = localStorage.getItem('lpu_app_mode')
      return isAuth && saved === 'admin' ? 'admin' : 'user'
    } catch {
      return 'user'
    }
  })

  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('lpu_admin_sidebar_expanded')
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  const toggleSidebar = () => {
    setIsSidebarExpanded((prev) => {
      const next = !prev
      try {
        localStorage.setItem('lpu_admin_sidebar_expanded', String(next))
      } catch (e) {
        console.error('Failed to save sidebar state:', e)
      }
      return next
    })
  }

  const [showAdminLoginModal, setShowAdminLoginModal] = useState<boolean>(false)
  const [loginUsername, setLoginUsername] = useState<string>('')
  const [loginPassword, setLoginPassword] = useState<string>('')
  const [loginError, setLoginError] = useState<string | null>(null)

  const [isNodeMode, setIsNodeMode] = useState<boolean>(false)
  const [isPathMode, setIsPathMode] = useState<boolean>(false)
  const [isInsertNavMode, setIsInsertNavMode] = useState<boolean>(false)

  const [nodes, setNodes] = useState<NodeItem[]>(loadInitialNodes)
  const [edges, setEdges] = useState<EdgeItem[]>(loadInitialEdges)

  const [clickedCoords, setClickedCoords] = useState<ClickedLocation | null>(null)
  const [pendingNode, setPendingNode] = useState<ClickedLocation | null>(null)
  const [editingNode, setEditingNode] = useState<NodeItem | null>(null)

  // Path Drawing Mode States
  const [drawStep, setDrawStep] = useState<'select_start' | 'drawing_waypoints' | 'select_end'>('select_start')
  const [selectedStartNode, setSelectedStartNode] = useState<NodeItem | null>(null)
  const [drawingWaypoints, setDrawingWaypoints] = useState<[number, number][]>([])
  const [selectedEndNode, setSelectedEndNode] = useState<NodeItem | null>(null)
  const [editingEdge, setEditingEdge] = useState<EdgeItem | null>(null)

  // Edit Path Geometry States
  const [editingGeometryEdge, setEditingGeometryEdge] = useState<EdgeItem | null>(null)
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null)

  // Insert Navigation Node State
  const [splitTarget, setSplitTarget] = useState<{ location: ClickedLocation; edge: EdgeItem } | null>(null)

  // Snapping States
  const [hoveredSnap, setHoveredSnap] = useState<SnapProjection | null>(null)
  const [pendingSnapTarget, setPendingSnapTarget] = useState<{ location: ClickedLocation; snap: SnapProjection } | null>(null)
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false)

  // Route Visualization State (Sprint 8.3)
  const [activeRouteResult, setActiveRouteResult] = useState<RouteResult | null>(null)

  // Save Graph Status State (Sprint 8.6)
  const [isSavingGraph, setIsSavingGraph] = useState<boolean>(false)
  const [saveStatusMessage, setSaveStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSaveGraphToBackend = async () => {
    setIsSavingGraph(true)
    setSaveStatusMessage(null)
    const res = await saveGraphToBackend(nodes, edges)
    setIsSavingGraph(false)

    if (res.success) {
      setSaveStatusMessage({
        type: 'success',
        text: `✅ Graph saved & reloaded in C++ backend (${res.nodes} N, ${res.edges} E)`,
      })
    } else {
      setSaveStatusMessage({
        type: 'error',
        text: `❌ ${res.error || 'Failed to save graph to backend'}`,
      })
    }

    setTimeout(() => {
      setSaveStatusMessage(null)
    }, 4000)
  }

  const nodesMap = useMemo(() => {
    const map = new Map<string, NodeItem>()
    nodes.forEach((n) => map.set(n.id, n))
    return map
  }, [nodes])

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_NODES_KEY, JSON.stringify(nodes))
    } catch (e) {
      console.error('Failed to save nodes to localStorage:', e)
    }
  }, [nodes])

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_EDGES_KEY, JSON.stringify(edges))
    } catch (e) {
      console.error('Failed to save edges to localStorage:', e)
    }
  }, [edges])

  // Global Keyboard shortcuts: ESC to cancel drawing, Backspace / Ctrl+Z to undo last waypoint or delete selected waypoint, Shift for Smart Snap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true)
      }

      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase()
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') {
        return
      }

      if (editingGeometryEdge && selectedWaypointIndex !== null) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedWaypointIndex > 0 && selectedWaypointIndex < editingGeometryEdge.geometry.length - 1) {
            e.preventDefault()
            handleDeleteWaypoint(selectedWaypointIndex)
            return
          }
        }
      }

      if (isPathMode) {
        if (e.key === 'Escape') {
          e.preventDefault()
          resetPathDrawingState()
        } else if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
          if (drawingWaypoints.length > 0) {
            e.preventDefault()
            setDrawingWaypoints((prev) => prev.slice(0, -1))
          }
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false)
        setHoveredSnap(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isPathMode, drawingWaypoints.length, editingGeometryEdge, selectedWaypointIndex])

  const resetPathDrawingState = () => {
    setDrawStep('select_start')
    setSelectedStartNode(null)
    setDrawingWaypoints([])
    setSelectedEndNode(null)
    setHoveredSnap(null)
    setPendingSnapTarget(null)
  }

  const handleModeToggle = (mode: 'user' | 'admin') => {
    if (mode === 'admin' && !isAdminAuthenticated) {
      handleOpenAdminLogin()
      return
    }

    setAppMode(mode)
    try {
      localStorage.setItem('lpu_app_mode', mode)
    } catch (e) {
      console.error('Failed to save app mode:', e)
    }
    if (mode === 'user') {
      setIsNodeMode(false)
      setIsPathMode(false)
      setIsInsertNavMode(false)
      resetPathDrawingState()
      setEditingNode(null)
      setEditingEdge(null)
      setEditingGeometryEdge(null)
      setPendingNode(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
    }
  }

  const handleOpenAdminLogin = () => {
    if (isAdminAuthenticated) {
      setAppMode('admin')
      localStorage.setItem('lpu_app_mode', 'admin')
    } else {
      setLoginUsername('')
      setLoginPassword('')
      setLoginError(null)
      setShowAdminLoginModal(true)
    }
  }

  const handleAdminLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      loginUsername === ADMIN_CREDENTIALS.username &&
      loginPassword === ADMIN_CREDENTIALS.password
    ) {
      setIsAdminAuthenticated(true)
      localStorage.setItem(LOCAL_STORAGE_ADMIN_AUTH_KEY, 'true')
      localStorage.setItem('lpu_app_mode', 'admin')
      setAppMode('admin')
      setShowAdminLoginModal(false)
      setLoginError(null)
    } else {
      setLoginError('❌ Invalid username or password.')
    }
  }

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false)
    localStorage.setItem(LOCAL_STORAGE_ADMIN_AUTH_KEY, 'false')
    localStorage.setItem('lpu_app_mode', 'user')
    handleModeToggle('user')
  }

  const handleMouseMove = (location: ClickedLocation) => {
    if (!isPathMode || !selectedStartNode || pendingSnapTarget || !isShiftPressed) {
      if (hoveredSnap) setHoveredSnap(null)
      return
    }

    const pt: [number, number] = [location.lat, location.lng]
    let bestSnap: SnapProjection | null = null
    let minDistance = HOVER_SNAP_THRESHOLD_METERS

    for (const edge of edges) {
      const res = findNearestPointOnEdge(pt, edge, nodesMap)
      if (res && res.distanceMeters < minDistance) {
        minDistance = res.distanceMeters
        bestSnap = {
          edge,
          point: res.point,
          distanceMeters: res.distanceMeters,
          segmentIndex: res.segmentIndex,
        }
      }
    }

    setHoveredSnap(bestSnap)
  }

  const handleMapClick = (location: ClickedLocation) => {
    if (appMode === 'user') return

    if (editingGeometryEdge) {
      setSelectedWaypointIndex(null)
      return
    }

    if (isNodeMode) {
      setPendingNode(location)
      setEditingNode(null)
      setEditingEdge(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
    } else if (isPathMode) {
      if (drawStep === 'drawing_waypoints') {
        if (isShiftPressed && hoveredSnap) {
          setPendingSnapTarget({ location, snap: hoveredSnap })
          return
        }
        setDrawingWaypoints((prev) => [...prev, [Number(location.lat.toFixed(6)), Number(location.lng.toFixed(6))]])
      }
    } else {
      setClickedCoords(location)
      setPendingNode(null)
      setEditingNode(null)
      setEditingEdge(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
    }
  }

  const handleNodeClick = (node: NodeItem) => {
    if (appMode === 'user') return

    if (isPathMode) {
      if (drawStep === 'select_start') {
        setSelectedStartNode(node)
        setDrawingWaypoints([])
        setDrawStep('drawing_waypoints')
      } else if (drawStep === 'drawing_waypoints' || drawStep === 'select_end') {
        if (selectedStartNode && node.id !== selectedStartNode.id) {
          setSelectedEndNode(node)
        }
      }
    } else {
      setEditingNode(node)
      setPendingNode(null)
      setEditingEdge(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
    }
  }

  const handleSaveNewNode = (name: string, category: 'POI' | 'Navigation', type: string) => {
    if (!pendingNode) return

    const newNode: NodeItem = {
      id: `node-${Date.now()}`,
      name: name.trim() || `Node ${nodes.length + 1}`,
      category,
      type: type,
      latitude: Number(pendingNode.lat.toFixed(6)),
      longitude: Number(pendingNode.lng.toFixed(6)),
      isHidden: false,
    }

    setNodes((prev) => [...prev, newNode])
    setPendingNode(null)
  }

  const handleUpdateNode = (updatedNode: NodeItem) => {
    setNodes((prev) => prev.map((n) => (n.id === updatedNode.id ? updatedNode : n)))
    setEditingNode(null)
  }

  const handleDeleteNode = (nodeId: string) => {
    const updatedNodes = nodes.filter((n) => n.id !== nodeId)
    const updatedEdges = edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId)

    // Garbage collect isolated hidden nodes (degree 0)
    const cleanNodes = updatedNodes.filter((node) => {
      if (node.isHidden) {
        const edgeCount = updatedEdges.filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id).length
        if (edgeCount === 0) return false
      }
      return true
    })

    setNodes(cleanNodes)
    setEdges(updatedEdges)
    setEditingNode(null)
  }

  const handleSaveNewPath = (data: { distance: number; walkingTime: number; pathType: string; isBidirectional: boolean }) => {
    if (!selectedStartNode || !selectedEndNode) return

    const fullGeometry: [number, number][] = [
      [selectedStartNode.latitude, selectedStartNode.longitude],
      ...drawingWaypoints,
      [selectedEndNode.latitude, selectedEndNode.longitude],
    ]

    const newEdge: EdgeItem = {
      id: `edge-${Date.now()}`,
      fromNodeId: selectedStartNode.id,
      toNodeId: selectedEndNode.id,
      geometry: fullGeometry,
      ...data,
    }

    setEdges((prev) => [...prev, newEdge])
    resetPathDrawingState()
  }

  const handleUpdateEdge = (updatedEdge: EdgeItem) => {
    setEdges((prev) => prev.map((e) => (e.id === updatedEdge.id ? updatedEdge : e)))
    setEditingEdge(null)
  }

  const handleDeleteEdge = (edgeId: string) => {
    const deletedEdge = edges.find((e) => e.id === edgeId)
    const remainingEdges = edges.filter((e) => e.id !== edgeId)
    setEdges(remainingEdges)

    if (deletedEdge) {
      const impactedNodeIds = [deletedEdge.fromNodeId, deletedEdge.toNodeId]
      setNodes((prevNodes) =>
        prevNodes.filter((node) => {
          if (node.isHidden && impactedNodeIds.includes(node.id)) {
            const edgeCount = remainingEdges.filter(
              (e) => e.fromNodeId === node.id || e.toNodeId === node.id
            ).length
            if (edgeCount === 0) {
              console.log(`Cleaned up isolated hidden node: ${node.id}`)
              return false
            }
          }
          return true
        })
      )
    }

    setEditingEdge(null)
    setEditingGeometryEdge(null)
  }

  // Edit Path Geometry Helper Methods
  const handleWaypointDragEnd = (index: number, e: L.DragEndEvent) => {
    if (!editingGeometryEdge) return
    const marker = e.target
    const position = marker.getLatLng()
    const newPt: [number, number] = [Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6))]

    const newGeom = [...editingGeometryEdge.geometry]
    newGeom[index] = newPt
    const newDist = calculatePathDistance(newGeom)

    const updatedEdge: EdgeItem = {
      ...editingGeometryEdge,
      geometry: newGeom,
      distance: newDist,
      walkingTime: Math.round(newDist / 1.4),
    }

    setEditingGeometryEdge(updatedEdge)
    setEdges((prev) => prev.map((item) => (item.id === updatedEdge.id ? updatedEdge : item)))
  }

  const handleInsertWaypointOnPolyline = (clickLat: number, clickLng: number) => {
    if (!editingGeometryEdge) return

    const clickPt: [number, number] = [Number(clickLat.toFixed(6)), Number(clickLng.toFixed(6))]
    const segIdx = getClosestSegmentIndex(editingGeometryEdge.geometry, clickPt)

    const newGeom = [
      ...editingGeometryEdge.geometry.slice(0, segIdx + 1),
      clickPt,
      ...editingGeometryEdge.geometry.slice(segIdx + 1),
    ]

    const newDist = calculatePathDistance(newGeom)
    const updatedEdge: EdgeItem = {
      ...editingGeometryEdge,
      geometry: newGeom,
      distance: newDist,
      walkingTime: Math.round(newDist / 1.4),
    }

    setEditingGeometryEdge(updatedEdge)
    setSelectedWaypointIndex(segIdx + 1)
    setEdges((prev) => prev.map((item) => (item.id === updatedEdge.id ? updatedEdge : item)))
  }

  const handleDeleteWaypoint = (index: number) => {
    if (!editingGeometryEdge) return
    if (index <= 0 || index >= editingGeometryEdge.geometry.length - 1) return

    const newGeom = editingGeometryEdge.geometry.filter((_, idx) => idx !== index)
    const newDist = calculatePathDistance(newGeom)

    const updatedEdge: EdgeItem = {
      ...editingGeometryEdge,
      geometry: newGeom,
      distance: newDist,
      walkingTime: Math.round(newDist / 1.4),
    }

    setEditingGeometryEdge(updatedEdge)
    setSelectedWaypointIndex(null)
    setEdges((prev) => prev.map((item) => (item.id === updatedEdge.id ? updatedEdge : item)))
  }

  const handleConfirmSplitPath = (navName: string, navType: string) => {
    if (!splitTarget) return

    const { location, edge: originalEdge } = splitTarget
    const navNodeId = `node-nav-${Date.now()}`
    const clickedLat = Number(location.lat.toFixed(6))
    const clickedLng = Number(location.lng.toFixed(6))

    const newNavNode: NodeItem = {
      id: navNodeId,
      name: navName.trim() || 'Road Junction',
      category: 'Navigation',
      type: navType,
      latitude: clickedLat,
      longitude: clickedLng,
      isHidden: false,
    }

    const splitIndex = getClosestSegmentIndex(
      originalEdge.geometry && originalEdge.geometry.length >= 2
        ? originalEdge.geometry
        : [
            [nodesMap.get(originalEdge.fromNodeId)?.latitude || 0, nodesMap.get(originalEdge.fromNodeId)?.longitude || 0],
            [nodesMap.get(originalEdge.toNodeId)?.latitude || 0, nodesMap.get(originalEdge.toNodeId)?.longitude || 0],
          ],
      [clickedLat, clickedLng]
    )

    const { edge1, edge2 } = splitEdgeAtNode(originalEdge, newNavNode, splitIndex, nodesMap)

    setNodes((prev) => [...prev, newNavNode])
    setEdges((prev) => [...prev.filter((e) => e.id !== originalEdge.id), edge1, edge2])
    setSplitTarget(null)
  }

  // Smart Merge Option A: 🟢 Merge With Existing Path (create/reuse HIDDEN Navigation node & ATOMICALLY save incoming edge)
  const handleSnapMerge = () => {
    if (!pendingSnapTarget || !selectedStartNode) return

    const { snap } = pendingSnapTarget
    const snapLat = Number(snap.point[0].toFixed(6))
    const snapLng = Number(snap.point[1].toFixed(6))
    const timestamp = Date.now()

    // CRITICAL POI PRESERVATION FIX: Only search and reuse existing NAVIGATION nodes. NEVER reuse a POI node!
    const nearbyNavNode = nodes.find(
      (n) => (n.category === 'Navigation' || n.isHidden === true) &&
             calculateDistanceMeters(n.latitude, n.longitude, snapLat, snapLng) <= NODE_REUSE_TOLERANCE_METERS
    )

    let connectNode: NodeItem

    if (nearbyNavNode) {
      connectNode = { ...nearbyNavNode, isHidden: true }
      setNodes((prev) => prev.map((n) => (n.id === connectNode.id ? connectNode : n)))
    } else {
      const navNodeId = `node-nav-${timestamp}`
      connectNode = {
        id: navNodeId,
        name: 'Merge Junction',
        category: 'Navigation',
        type: 'road_junction',
        latitude: snapLat,
        longitude: snapLng,
        isHidden: true, // Invisible Merge Node
      }
      setNodes((prev) => [...prev, connectNode])
    }

    const originalEdge = snap.edge
    const isAlreadyConnected = originalEdge.fromNodeId === connectNode.id || originalEdge.toNodeId === connectNode.id

    let newReplacementEdges: EdgeItem[] = []
    if (!isAlreadyConnected) {
      const { edge1, edge2 } = splitEdgeAtNode(originalEdge, connectNode, snap.segmentIndex, nodesMap)
      newReplacementEdges = [edge1, edge2]
    }

    // Construct geometry for incoming drawn path ending EXACTLY at connectNode [snapLat, snapLng]
    const incomingGeometry: [number, number][] = [
      [selectedStartNode.latitude, selectedStartNode.longitude],
      ...drawingWaypoints,
      [snapLat, snapLng],
    ]

    const incomingDist = calculatePathDistance(incomingGeometry)

    const incomingEdge: EdgeItem = {
      id: `edge-incoming-${timestamp}`,
      fromNodeId: selectedStartNode.id,
      toNodeId: connectNode.id,
      geometry: incomingGeometry,
      distance: incomingDist,
      walkingTime: Math.round(incomingDist / 1.4),
      pathType: originalEdge.pathType || 'road',
      isBidirectional: originalEdge.isBidirectional !== false,
    }

    // CRITICAL POI CONNECTIVITY: If a POI node is within 15 meters of the merge point, connect connectNode -> POI without modifying POI
    const nearbyPoi = nodes.find(
      (n) => !n.isHidden && n.category !== 'Navigation' &&
             calculateDistanceMeters(n.latitude, n.longitude, snapLat, snapLng) <= 15
    )

    let poiConnectionEdge: EdgeItem | null = null
    if (nearbyPoi) {
      const isPoiConnected = edges.some(
        (e) => (e.fromNodeId === connectNode.id && e.toNodeId === nearbyPoi.id) ||
               (e.fromNodeId === nearbyPoi.id && e.toNodeId === connectNode.id)
      )
      if (!isPoiConnected) {
        const pDist = calculateDistanceMeters(connectNode.latitude, connectNode.longitude, nearbyPoi.latitude, nearbyPoi.longitude)
        poiConnectionEdge = {
          id: `edge-poi-conn-${timestamp}`,
          fromNodeId: connectNode.id,
          toNodeId: nearbyPoi.id,
          geometry: [
            [connectNode.latitude, connectNode.longitude],
            [nearbyPoi.latitude, nearbyPoi.longitude],
          ],
          distance: Math.round(pDist * 10) / 10,
          walkingTime: Math.round(pDist / 1.4),
          pathType: 'walkway',
          isBidirectional: true,
        }
      }
    }

    // Atomically persist replacement edges, incoming edge, and POI connection edge
    setEdges((prev) => {
      const filtered = isAlreadyConnected ? prev : prev.filter((e) => e.id !== originalEdge.id)
      const toAdd = poiConnectionEdge ? [...newReplacementEdges, incomingEdge, poiConnectionEdge] : [...newReplacementEdges, incomingEdge]
      return [...filtered, ...toAdd]
    })

    // Reset drawing state only AFTER incoming edge has been added to edges state
    resetPathDrawingState()
  }

  // Smart Merge Option B: BLUE Create Junction (create/reuse VISIBLE Navigation node & ATOMICALLY save incoming edge)
  const handleSnapJunction = () => {
    if (!pendingSnapTarget || !selectedStartNode) return

    const { snap } = pendingSnapTarget
    const snapLat = Number(snap.point[0].toFixed(6))
    const snapLng = Number(snap.point[1].toFixed(6))
    const timestamp = Date.now()

    // CRITICAL POI PRESERVATION FIX: Only search and reuse existing NAVIGATION nodes. NEVER reuse a POI node!
    const nearbyNavNode = nodes.find(
      (n) => (n.category === 'Navigation' || n.isHidden === true) &&
             calculateDistanceMeters(n.latitude, n.longitude, snapLat, snapLng) <= NODE_REUSE_TOLERANCE_METERS
    )

    let connectNode: NodeItem

    if (nearbyNavNode) {
      connectNode = { ...nearbyNavNode, isHidden: false }
      setNodes((prev) => prev.map((n) => (n.id === connectNode.id ? connectNode : n)))
    } else {
      const navNodeId = `node-nav-${timestamp}`
      connectNode = {
        id: navNodeId,
        name: 'Road Junction',
        category: 'Navigation',
        type: 'road_junction',
        latitude: snapLat,
        longitude: snapLng,
        isHidden: false, // Visible Navigation Node
      }
      setNodes((prev) => [...prev, connectNode])
    }

    const originalEdge = snap.edge
    const isAlreadyConnected = originalEdge.fromNodeId === connectNode.id || originalEdge.toNodeId === connectNode.id

    let newReplacementEdges: EdgeItem[] = []
    if (!isAlreadyConnected) {
      const { edge1, edge2 } = splitEdgeAtNode(originalEdge, connectNode, snap.segmentIndex, nodesMap)
      newReplacementEdges = [edge1, edge2]
    }

    const incomingGeometry: [number, number][] = [
      [selectedStartNode.latitude, selectedStartNode.longitude],
      ...drawingWaypoints,
      [snapLat, snapLng],
    ]

    const incomingDist = calculatePathDistance(incomingGeometry)

    const incomingEdge: EdgeItem = {
      id: `edge-incoming-${timestamp}`,
      fromNodeId: selectedStartNode.id,
      toNodeId: connectNode.id,
      geometry: incomingGeometry,
      distance: incomingDist,
      walkingTime: Math.round(incomingDist / 1.4),
      pathType: originalEdge.pathType || 'road',
      isBidirectional: originalEdge.isBidirectional !== false,
    }

    // CRITICAL POI CONNECTIVITY: If a POI node is within 15 meters of the junction point, connect connectNode -> POI without modifying POI
    const nearbyPoi = nodes.find(
      (n) => !n.isHidden && n.category !== 'Navigation' &&
             calculateDistanceMeters(n.latitude, n.longitude, snapLat, snapLng) <= 15
    )

    let poiConnectionEdge: EdgeItem | null = null
    if (nearbyPoi) {
      const isPoiConnected = edges.some(
        (e) => (e.fromNodeId === connectNode.id && e.toNodeId === nearbyPoi.id) ||
               (e.fromNodeId === nearbyPoi.id && e.toNodeId === connectNode.id)
      )
      if (!isPoiConnected) {
        const pDist = calculateDistanceMeters(connectNode.latitude, connectNode.longitude, nearbyPoi.latitude, nearbyPoi.longitude)
        poiConnectionEdge = {
          id: `edge-poi-conn-${timestamp}`,
          fromNodeId: connectNode.id,
          toNodeId: nearbyPoi.id,
          geometry: [
            [connectNode.latitude, connectNode.longitude],
            [nearbyPoi.latitude, nearbyPoi.longitude],
          ],
          distance: Math.round(pDist * 10) / 10,
          walkingTime: Math.round(pDist / 1.4),
          pathType: 'walkway',
          isBidirectional: true,
        }
      }
    }

    setEdges((prev) => {
      const filtered = isAlreadyConnected ? prev : prev.filter((e) => e.id !== originalEdge.id)
      const toAdd = poiConnectionEdge ? [...newReplacementEdges, incomingEdge, poiConnectionEdge] : [...newReplacementEdges, incomingEdge]
      return [...filtered, ...toAdd]
    })

    resetPathDrawingState()
  }

  // Smart Merge Option C: ⚪ Continue Drawing as Separate Path
  const handleSnapContinueSeparate = () => {
    if (!pendingSnapTarget) return
    const { location } = pendingSnapTarget
    setDrawingWaypoints((prev) => [...prev, [location.lat, location.lng]])
    setPendingSnapTarget(null)
    setHoveredSnap(null)
  }

  const handleImportNodes = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          const validNodes = parsed.filter(
            (item: any) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.latitude === 'number' &&
              typeof item.longitude === 'number'
          ).map((item: any) => ({
            ...item,
            category: item.category || 'POI',
            isHidden: Boolean(item.isHidden),
          })) as NodeItem[]

          if (validNodes.length > 0) {
            setNodes(validNodes)
            setPendingNode(null)
            setEditingNode(null)
            setSplitTarget(null)
            setPendingSnapTarget(null)
          } else {
            alert('No valid nodes found in imported file.')
          }
        } else {
          alert('Invalid JSON format: root element must be an array of nodes.')
        }
      } catch (err) {
        console.error('Error parsing imported JSON:', err)
        alert('Error parsing JSON file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleExportNodes = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(nodes, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', 'nodes.json')
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  const handleImportEdges = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          const nodesMapLocal = new Map<string, NodeItem>()
          nodes.forEach((n) => nodesMapLocal.set(n.id, n))

          const validEdges = parsed.map((item: any) => {
            const fId = String(item.fromNodeId || '')
            const tId = String(item.toNodeId || '')
            const fn = nodesMapLocal.get(fId)
            const tn = nodesMapLocal.get(tId)

            let geom: [number, number][] = Array.isArray(item.geometry) ? item.geometry : []
            if (geom.length < 2 && fn && tn) {
              geom = [
                [fn.latitude, fn.longitude],
                [tn.latitude, tn.longitude],
              ]
            }

            return {
              id: String(item.id || `edge-${Date.now()}`),
              fromNodeId: fId,
              toNodeId: tId,
              geometry: geom,
              distance: Number(item.distance || 0),
              walkingTime: Number(item.walkingTime || 0),
              pathType: String(item.pathType || 'road'),
              isBidirectional: item.isBidirectional !== false,
            } as EdgeItem
          })

          setEdges(validEdges)
          setEditingEdge(null)
          setSplitTarget(null)
          setPendingSnapTarget(null)
          resetPathDrawingState()
        } else {
          alert('Invalid JSON format: root element must be an array of edges.')
        }
      } catch (err) {
        console.error('Error parsing imported edges JSON:', err)
        alert('Error parsing JSON file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleExportEdges = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(edges, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', 'edges.json')
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  const handleReloadOfficial = () => {
    if (window.confirm('Reset current dataset to official backend/data/nodes.json? Any unsaved edits will be discarded.')) {
      const official = (initialNodesData as any[]).map((n) => ({
        ...n,
        category: n.category || 'POI',
        isHidden: Boolean(n.isHidden),
      })) as NodeItem[]
      setNodes(official)
      setPendingNode(null)
      setEditingNode(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
      localStorage.setItem(LOCAL_STORAGE_NODES_KEY, JSON.stringify(official))
    }
  }

  // Active full geometry for current path drawing session
  const activeDrawingGeometry: [number, number][] = useMemo(() => {
    if (!selectedStartNode) return []
    const points: [number, number][] = [[selectedStartNode.latitude, selectedStartNode.longitude], ...drawingWaypoints]
    if (selectedEndNode) {
      points.push([selectedEndNode.latitude, selectedEndNode.longitude])
    }
    return points
  }, [selectedStartNode, drawingWaypoints, selectedEndNode])

  return (
    <div className="relative h-screen w-screen m-0 p-0 overflow-hidden">
      {/* Sprint 8.1, 8.3 & 9.4.1: Unified Responsive Top Header Panel */}
      <NavigationPanel
        nodes={nodes}
        edges={edges}
        appMode={appMode}
        isAdminAuthenticated={isAdminAuthenticated}
        isSidebarExpanded={isSidebarExpanded}
        onModeToggle={handleModeToggle}
        onOpenAdminLogin={handleOpenAdminLogin}
        onAdminLogout={handleAdminLogout}
        onRouteCalculated={(result) => setActiveRouteResult(result)}
      />

      {/* Admin Mode Collapsible Left Sidebar (Sprint 9.2) */}
      {appMode === 'admin' && (
        <div
          className={`absolute top-4 left-4 z-[1100] max-h-[calc(100vh-2rem)] bg-slate-900/95 text-white border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md transition-all duration-300 flex flex-col overflow-hidden select-none font-sans ${
            isSidebarExpanded ? 'w-72' : 'w-16'
          }`}
        >
          {/* Sidebar Header & Toggle */}
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-center cursor-pointer"
              title={isSidebarExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}
            >
              <span className="text-lg leading-none">☰</span>
            </button>

            {isSidebarExpanded && (
              <div className="flex items-center space-x-1.5 font-bold text-sm text-slate-100 pr-1">
                <span>⚡</span>
                <span>Admin Suite</span>
              </div>
            )}
          </div>

          {/* Scrollable Sidebar Body */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-4 text-xs scrollbar-thin scrollbar-thumb-slate-700">
            {/* Section 1: GRAPH */}
            <div>
              {isSidebarExpanded ? (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center space-x-1">
                  <span>📍</span>
                  <span>GRAPH</span>
                </div>
              ) : (
                <div className="text-center text-slate-500 mb-1 text-[10px]">📍</div>
              )}

              <div className="space-y-1.5">
                {/* Node Mode */}
                <button
                  type="button"
                  onClick={() => {
                    setIsNodeMode(!isNodeMode)
                    if (!isNodeMode) {
                      setIsPathMode(false)
                      setIsInsertNavMode(false)
                      resetPathDrawingState()
                    }
                    setPendingNode(null)
                    setEditingNode(null)
                    setSplitTarget(null)
                  }}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2.5 px-3' : 'justify-center px-0'
                  } py-2 rounded-xl text-xs font-semibold transition-all ${
                    isNodeMode
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/50'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Draw Node Mode"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isNodeMode ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                  {isSidebarExpanded && <span>Draw Node: {isNodeMode ? 'ON' : 'OFF'}</span>}
                </button>

                {/* Path Drawing Mode */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPathMode(!isPathMode)
                    if (!isPathMode) {
                      setIsNodeMode(false)
                      setIsInsertNavMode(false)
                      resetPathDrawingState()
                    } else {
                      resetPathDrawingState()
                    }
                    setPendingNode(null)
                    setEditingNode(null)
                    setSplitTarget(null)
                  }}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2.5 px-3' : 'justify-center px-0'
                  } py-2 rounded-xl text-xs font-semibold transition-all ${
                    isPathMode
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-900/50'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Path Drawing Mode"
                >
                  <span className="text-sm shrink-0">🖊</span>
                  {isSidebarExpanded && <span>Draw Path: {isPathMode ? 'ON' : 'OFF'}</span>}
                </button>

                {/* Insert Nav Node Mode */}
                <button
                  type="button"
                  onClick={() => {
                    setIsInsertNavMode(!isInsertNavMode)
                    if (!isInsertNavMode) {
                      setIsNodeMode(false)
                      setIsPathMode(false)
                      resetPathDrawingState()
                    }
                    setPendingNode(null)
                    setEditingNode(null)
                    setSplitTarget(null)
                  }}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2.5 px-3' : 'justify-center px-0'
                  } py-2 rounded-xl text-xs font-semibold transition-all ${
                    isInsertNavMode
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/50'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Insert Navigation Node Mode"
                >
                  <span className="text-sm shrink-0">📍</span>
                  {isSidebarExpanded && <span>Insert Nav Node: {isInsertNavMode ? 'ON' : 'OFF'}</span>}
                </button>
              </div>
            </div>

            {/* Section 2: PATH EDITING (Status Info) */}
            {(isPathMode || editingGeometryEdge || splitTarget) && (
              <div className="border-t border-slate-800/80 pt-3">
                {isSidebarExpanded ? (
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center space-x-1">
                    <span>🛣</span>
                    <span>PATH EDITING</span>
                  </div>
                ) : (
                  <div className="text-center text-slate-500 mb-1 text-[10px]">🛣</div>
                )}
                <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
                  {isPathMode && <div>• Drawing waypoints ({drawingWaypoints.length})</div>}
                  {editingGeometryEdge && <div>• Reshaping path geometry</div>}
                  {splitTarget && <div>• Splitting path at junction</div>}
                </div>
              </div>
            )}

            {/* Section 3: DATASET */}
            <div className="border-t border-slate-800/80 pt-3">
              {isSidebarExpanded ? (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center space-x-1">
                  <span>💾</span>
                  <span>DATASET</span>
                </div>
              ) : (
                <div className="text-center text-slate-500 mb-1 text-[10px]">💾</div>
              )}

              <div className="space-y-1.5">
                {/* Primary Save Graph Button */}
                <button
                  type="button"
                  onClick={handleSaveGraphToBackend}
                  disabled={isSavingGraph}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all cursor-pointer disabled:opacity-50`}
                  title="Save graph directly to C++ backend"
                >
                  <span className="text-sm shrink-0">💾</span>
                  {isSidebarExpanded && <span>{isSavingGraph ? 'Saving...' : `Save Graph`}</span>}
                </button>

                {/* Import Nodes */}
                <label
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer`}
                  title="Import Nodes JSON"
                >
                  <span className="text-sm shrink-0">📥</span>
                  {isSidebarExpanded && <span>Import Nodes</span>}
                  <input type="file" accept=".json" onChange={handleImportNodes} className="hidden" />
                </label>

                {/* Export Nodes */}
                <button
                  type="button"
                  onClick={handleExportNodes}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer`}
                  title="Export Nodes JSON"
                >
                  <span className="text-sm shrink-0">📤</span>
                  {isSidebarExpanded && <span>Export Nodes</span>}
                </button>

                {/* Import Edges */}
                <label
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer`}
                  title="Import Edges JSON"
                >
                  <span className="text-sm shrink-0">📥</span>
                  {isSidebarExpanded && <span>Import Edges</span>}
                  <input type="file" accept=".json" onChange={handleImportEdges} className="hidden" />
                </label>

                {/* Export Edges */}
                <button
                  type="button"
                  onClick={handleExportEdges}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer`}
                  title="Export Edges JSON"
                >
                  <span className="text-sm shrink-0">📤</span>
                  {isSidebarExpanded && <span>Export Edges</span>}
                </button>

                {/* Reload Official */}
                <button
                  type="button"
                  onClick={handleReloadOfficial}
                  className={`w-full flex items-center ${
                    isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                  } py-1.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer`}
                  title="Reload Official Dataset"
                >
                  <span className="text-sm shrink-0">🔄</span>
                  {isSidebarExpanded && <span>Reload Official</span>}
                </button>
              </div>
            </div>

            {/* Section 4: TOOLS / STATISTICS */}
            <div className="border-t border-slate-800/80 pt-3">
              {isSidebarExpanded ? (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center space-x-1">
                  <span>📊</span>
                  <span>TOOLS & STATS</span>
                </div>
              ) : (
                <div className="text-center text-slate-500 mb-1 text-[10px]">📊</div>
              )}

              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 space-y-1 text-slate-300 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Nodes:</span>
                  <span className="font-mono font-bold text-indigo-400">{nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Edges:</span>
                  <span className="font-mono font-bold text-cyan-400">{edges.length}</span>
                </div>
                {isSidebarExpanded && (
                  <div className="flex justify-between pt-1 border-t border-slate-800 text-[10px] text-slate-400">
                    <span>Engine Status:</span>
                    <span className="text-emerald-400 font-bold">C++ 1.0 Ready</span>
                  </div>
                )}
              </div>
            </div>

            {/* Section 5: ADMIN & LOGOUT */}
            <div className="border-t border-slate-800/80 pt-3">
              {isSidebarExpanded ? (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center space-x-1">
                  <span>⚙</span>
                  <span>ADMIN</span>
                </div>
              ) : (
                <div className="text-center text-slate-500 mb-1 text-[10px]">⚙</div>
              )}

              <button
                type="button"
                onClick={handleAdminLogout}
                className={`w-full flex items-center ${
                  isSidebarExpanded ? 'justify-start space-x-2 px-3' : 'justify-center px-0'
                } py-2 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800/60 transition-all cursor-pointer`}
                title="Logout from Admin session"
              >
                <span className="text-sm shrink-0">🚪</span>
                {isSidebarExpanded && <span>Logout</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Graph Status Toast Banner (Sprint 8.6) */}
      {saveStatusMessage && (
        <div
          className={`absolute top-20 left-1/2 -translate-x-1/2 z-[1100] px-5 py-2.5 rounded-xl shadow-2xl backdrop-blur-md text-xs font-bold border transition-all animate-bounce flex items-center space-x-2 select-none ${
            saveStatusMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/60'
              : 'bg-rose-950/90 text-rose-200 border-rose-500/60'
          }`}
        >
          <span>{saveStatusMessage.text}</span>
        </div>
      )}

      {/* Path Drawing Mode Guidance Banner (Admin Mode Only) */}
      {appMode === 'admin' && isPathMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-amber-950/90 text-amber-200 border border-amber-600/60 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center space-x-3 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          {drawStep === 'select_start' && (
            <span>Step 1: Click an existing node on the map as the <strong>Start Node</strong>.</span>
          )}
          {drawStep === 'drawing_waypoints' && (
            <div className="flex items-center space-x-3">
              <span>
                Start: <strong className="text-white">{selectedStartNode?.name}</strong>. Click map for waypoints ({drawingWaypoints.length} added).
                <span className="text-slate-300 text-[11px] ml-2">(ESC: Cancel | Backspace/Ctrl+Z: Undo)</span>
                {isShiftPressed ? (
                  <span className="text-cyan-300 font-bold ml-2 animate-pulse bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/50">
                    🧲 Smart Snap Enabled (Shift)
                  </span>
                ) : (
                  <span className="text-amber-300/80 text-[11px] ml-2">
                    💡 Hold Shift to Snap
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setDrawStep('select_end')}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-2.5 py-1 rounded shadow text-xs transition-colors"
              >
                Finish Waypoints & Select End Node
              </button>
            </div>
          )}
          {drawStep === 'select_end' && (
            <span>
              Start: <strong className="text-white">{selectedStartNode?.name}</strong> ({drawingWaypoints.length} waypoints). Now click an existing <strong>End Node</strong> to finish.
            </span>
          )}
        </div>
      )}

      {/* Insert Navigation Node Guidance Banner (Admin Mode Only) */}
      {appMode === 'admin' && isInsertNavMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-cyan-950/90 text-cyan-200 border border-cyan-600/60 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center space-x-2 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <span>📍 Insert Nav Node Mode: Click anywhere along an existing path line to insert a Navigation Node and split the path.</span>
        </div>
      )}

      {/* Geometry Editing Mode Guidance Banner (Admin Mode Only) */}
      {appMode === 'admin' && editingGeometryEdge && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-amber-950/90 text-amber-200 border border-amber-600/60 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center space-x-3 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <span>
            ✏️ <strong>Editing Path Geometry</strong> ({editingGeometryEdge.distance}m, {editingGeometryEdge.geometry.length} points). Drag waypoints to reshape. Click line to add point.
            {selectedWaypointIndex !== null && selectedWaypointIndex > 0 && selectedWaypointIndex < editingGeometryEdge.geometry.length - 1 && (
              <span className="text-rose-300 font-bold ml-2">Backspace/Delete: remove pt #{selectedWaypointIndex}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setEditingGeometryEdge(null)
              setSelectedWaypointIndex(null)
            }}
            className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1 rounded shadow text-xs transition-colors"
          >
            ✔ Finish Editing
          </button>
        </div>
      )}

      <MapContainer
        center={LPU_COORDINATES}
        zoom={INITIAL_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelDebounceTime={40}
        maxBounds={LPU_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxNativeZoom={MAX_NATIVE_ZOOM}
        />

        {/* Render Active Dijkstra Shortest Path Route (Prominent Blue Polyline - Sprint 8.3) */}
        {activeRouteResult && activeRouteResult.found && activeRouteResult.geometry.length >= 2 && (
          <Polyline
            positions={activeRouteResult.geometry}
            pathOptions={{
              color: '#2563eb',
              weight: 6,
              opacity: 0.95,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* Render Route Start and Destination Endpoint Markers */}
        {activeRouteResult && activeRouteResult.found && activeRouteResult.geometry.length >= 1 && (
          <>
            <CircleMarker
              center={activeRouteResult.geometry[0]}
              radius={7}
              pathOptions={{
                color: '#1e40af',
                fillColor: '#3b82f6',
                fillOpacity: 1.0,
                weight: 2,
              }}
            >
              <Tooltip opacity={0.95} permanent direction="top" offset={[0, -6]}>
                <span className="font-bold text-xs text-blue-900">🚩 Start</span>
              </Tooltip>
            </CircleMarker>

            <CircleMarker
              center={activeRouteResult.geometry[activeRouteResult.geometry.length - 1]}
              radius={7}
              pathOptions={{
                color: '#065f46',
                fillColor: '#10b981',
                fillOpacity: 1.0,
                weight: 2,
              }}
            >
              <Tooltip opacity={0.95} permanent direction="top" offset={[0, -6]}>
                <span className="font-bold text-xs text-emerald-900">🏁 Destination</span>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* Render Hovered Snap Edge Highlight (Admin Mode Only) */}
        {appMode === 'admin' && isPathMode && hoveredSnap && (
          <Polyline
            positions={
              hoveredSnap.edge.geometry && hoveredSnap.edge.geometry.length >= 2
                ? hoveredSnap.edge.geometry
                : [
                    [nodesMap.get(hoveredSnap.edge.fromNodeId)?.latitude || 0, nodesMap.get(hoveredSnap.edge.fromNodeId)?.longitude || 0],
                    [nodesMap.get(hoveredSnap.edge.toNodeId)?.latitude || 0, nodesMap.get(hoveredSnap.edge.toNodeId)?.longitude || 0],
                  ]
            }
            pathOptions={{
              color: '#38bdf8',
              weight: 8,
              opacity: 0.7,
            }}
          />
        )}

        {/* Render Hovered Snapping Point Indicator Dot (Admin Mode Only) */}
        {appMode === 'admin' && isPathMode && hoveredSnap && (
          <CircleMarker
            center={hoveredSnap.point}
            radius={7}
            pathOptions={{
              color: '#0284c7',
              fillColor: '#38bdf8',
              fillOpacity: 1.0,
              weight: 2,
            }}
          />
        )}

        {/* Render Saved Edges Polylines (Admin Mode Only - User Mode hides raw graph lines for clean Google Maps look) */}
        {appMode === 'admin' &&
          edges.map((edge) => {
            const fromNode = nodesMap.get(edge.fromNodeId)
            const toNode = nodesMap.get(edge.toNodeId)
            if (!fromNode || !toNode) return null

            const polyGeometry: [number, number][] =
              edge.geometry && edge.geometry.length >= 2
                ? edge.geometry
                : [
                    [fromNode.latitude, fromNode.longitude],
                    [toNode.latitude, toNode.longitude],
                  ]

            const isBeingGeomEdited = editingGeometryEdge?.id === edge.id

            return (
              <Polyline
                key={edge.id}
                positions={polyGeometry}
                pathOptions={{
                  color: isBeingGeomEdited ? '#f59e0b' : edge.isBidirectional ? '#4f46e5' : '#0284c7',
                  weight: isBeingGeomEdited ? 7 : 4,
                  opacity: isBeingGeomEdited ? 0.95 : 0.85,
                  dashArray: edge.isBidirectional ? undefined : '6, 6',
                }}
                eventHandlers={{
                  click: (e) => {
                    e.originalEvent.stopPropagation()
                    if (editingGeometryEdge) {
                      if (editingGeometryEdge.id === edge.id) {
                        handleInsertWaypointOnPolyline(e.latlng.lat, e.latlng.lng)
                      }
                      return
                    }
                    if (isInsertNavMode) {
                      setSplitTarget({
                        location: { lat: e.latlng.lat, lng: e.latlng.lng },
                        edge,
                      })
                      setEditingEdge(null)
                    } else if (!isPathMode) {
                      setEditingEdge(edge)
                      setPendingNode(null)
                      setEditingNode(null)
                      resetPathDrawingState()
                    }
                  },
                }}
              >
                <Tooltip sticky opacity={0.95}>
                  <div className="font-sans text-xs">
                    <div className="font-bold text-slate-900 capitalize">
                      {edge.pathType} {edge.isBidirectional ? '(↔ Bidirectional)' : '(➔ One Way)'}
                    </div>
                    <div className="text-[10px] text-indigo-600 font-medium">
                      {fromNode.name} ➔ {toNode.name}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Dist: {edge.distance}m | Time: {edge.walkingTime}s | Points: {polyGeometry.length}
                    </div>
                  </div>
                </Tooltip>
              </Polyline>
            )
          })}

        {/* Edit Geometry Mode Interactive Waypoint Markers */}
        {editingGeometryEdge &&
          editingGeometryEdge.geometry.map((pt, idx) => {
            const isEndpoint = idx === 0 || idx === editingGeometryEdge.geometry.length - 1
            const isSelected = selectedWaypointIndex === idx

            if (isEndpoint) {
              return (
                <Marker
                  key={`geom-pt-${idx}`}
                  position={pt}
                  draggable={false}
                  icon={lockedEndpointIcon}
                >
                  <Tooltip opacity={0.9}>
                    <span className="text-[10px] font-semibold text-slate-700">🔒 Locked Endpoint</span>
                  </Tooltip>
                </Marker>
              )
            }

            return (
              <Marker
                key={`geom-pt-${idx}`}
                position={pt}
                draggable={true}
                icon={isSelected ? selectedWaypointIcon : intermediateWaypointIcon}
                eventHandlers={{
                  click: (e) => {
                    e.originalEvent.stopPropagation()
                    setSelectedWaypointIndex(idx)
                  },
                  dragend: (e) => handleWaypointDragEnd(idx, e),
                }}
              >
                <Tooltip opacity={0.95}>
                  <div className="p-0.5 text-xs text-slate-900 font-sans">
                    <div className="font-bold text-amber-700">Waypoint #{idx}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {pt[0].toFixed(6)}, {pt[1].toFixed(6)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Drag to move | Backspace/Delete to remove
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteWaypoint(idx)
                      }}
                      className="mt-1 px-1.5 py-0.5 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded font-semibold hover:bg-rose-100"
                    >
                      Delete Waypoint
                    </button>
                  </div>
                </Tooltip>
              </Marker>
            )
          })}

        {/* Render Temporary Polyline During Active Path Drawing */}
        {isPathMode && activeDrawingGeometry.length >= 2 && (
          <Polyline
            positions={activeDrawingGeometry}
            pathOptions={{
              color: '#f59e0b',
              weight: 5,
              opacity: 0.9,
              dashArray: '8, 8',
            }}
          />
        )}

        {/* Render Drawing Waypoints as small amber dots */}
        {isPathMode &&
          drawingWaypoints.map((pt, idx) => (
            <CircleMarker
              key={`wpt-${idx}`}
              center={pt}
              radius={4}
              pathOptions={{
                color: '#d97706',
                fillColor: '#f59e0b',
                fillOpacity: 1.0,
                weight: 1,
              }}
            />
          ))}

        {/* Render Visible Nodes (CircleMarkers) - Exclude Hidden and Navigation nodes in User Mode */}
        {nodes.map((node) => {
          if (node.isHidden) return null
          if (appMode === 'user' && node.category === 'Navigation') return null

          const isSelectedStart = selectedStartNode?.id === node.id
          const isSelectedEnd = selectedEndNode?.id === node.id
          const isNav = node.category === 'Navigation'

          return (
            <CircleMarker
              key={node.id}
              center={[node.latitude, node.longitude]}
              radius={isSelectedStart || isSelectedEnd ? 9 : isNav ? 5 : 6}
              pathOptions={{
                color: isSelectedStart ? '#d97706' : isSelectedEnd ? '#059669' : isNav ? '#0284c7' : '#3730a3',
                fillColor: isSelectedStart ? '#f59e0b' : isSelectedEnd ? '#10b981' : isNav ? '#38bdf8' : '#6366f1',
                fillOpacity: isSelectedStart || isSelectedEnd ? 1.0 : 0.85,
                weight: isSelectedStart || isSelectedEnd ? 3 : isNav ? 1.5 : 2,
              }}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent.stopPropagation()
                  handleNodeClick(node)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                <div className="font-sans text-xs">
                  <div className="font-bold text-slate-900 flex items-center space-x-1">
                    <span>{node.name}</span>
                    {isNav && (
                      <span className="text-[9px] bg-cyan-100 text-cyan-800 font-semibold px-1 py-0.5 rounded">
                        Nav
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-indigo-600 font-medium capitalize">
                    {node.category || 'POI'} • {node.type}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* Popup form for creating new node (Admin Mode Only) */}
        {appMode === 'admin' && isNodeMode && pendingNode && (
          <Popup
            position={[pendingNode.lat, pendingNode.lng]}
            eventHandlers={{
              remove: () => setPendingNode(null),
            }}
          >
            <NodeForm
              pendingNode={pendingNode}
              onSave={handleSaveNewNode}
              onCancel={() => setPendingNode(null)}
            />
          </Popup>
        )}

        {/* Popup form for editing existing node (Admin Mode Only) */}
        {appMode === 'admin' && editingNode && (
          <Popup
            position={[editingNode.latitude, editingNode.longitude]}
            eventHandlers={{
              remove: () => setEditingNode(null),
            }}
          >
            <EditNodeForm
              node={editingNode}
              onSave={handleUpdateNode}
              onDelete={handleDeleteNode}
              onCancel={() => setEditingNode(null)}
            />
          </Popup>
        )}

        {/* Popup form for snapping action decision (Admin Mode Only) */}
        {appMode === 'admin' && pendingSnapTarget && (
          <Popup
            position={pendingSnapTarget.snap.point}
            eventHandlers={{
              remove: () => setPendingSnapTarget(null),
            }}
          >
            <SnapActionForm
              snap={pendingSnapTarget.snap}
              fromNodeName={nodesMap.get(pendingSnapTarget.snap.edge.fromNodeId)?.name || pendingSnapTarget.snap.edge.fromNodeId}
              toNodeName={nodesMap.get(pendingSnapTarget.snap.edge.toNodeId)?.name || pendingSnapTarget.snap.edge.toNodeId}
              onMerge={handleSnapMerge}
              onJunction={handleSnapJunction}
              onContinueSeparate={handleSnapContinueSeparate}
              onCancel={() => setPendingSnapTarget(null)}
            />
          </Popup>
        )}

        {/* Popup form for inserting Navigation Node on path (Admin Mode Only) */}
        {appMode === 'admin' && splitTarget && (
          <Popup
            position={[splitTarget.location.lat, splitTarget.location.lng]}
            eventHandlers={{
              remove: () => setSplitTarget(null),
            }}
          >
            <InsertNavNodeForm
              location={splitTarget.location}
              fromNodeName={nodesMap.get(splitTarget.edge.fromNodeId)?.name || splitTarget.edge.fromNodeId}
              toNodeName={nodesMap.get(splitTarget.edge.toNodeId)?.name || splitTarget.edge.toNodeId}
              onConfirm={handleConfirmSplitPath}
              onCancel={() => setSplitTarget(null)}
            />
          </Popup>
        )}

        {/* Popup form for adding new drawn path (Admin Mode Only) */}
        {appMode === 'admin' && selectedStartNode && selectedEndNode && activeDrawingGeometry.length >= 2 && (
          <Popup
            position={getGeometryCenter(activeDrawingGeometry)}
            eventHandlers={{
              remove: () => resetPathDrawingState(),
            }}
          >
            <AddPathForm
              fromNode={selectedStartNode}
              toNode={selectedEndNode}
              geometry={activeDrawingGeometry}
              onSave={handleSaveNewPath}
              onCancel={() => resetPathDrawingState()}
            />
          </Popup>
        )}

        {/* Popup form for editing existing edge (Admin Mode Only) */}
        {appMode === 'admin' && editingEdge && (
          <Popup
            position={getGeometryCenter(
              editingEdge.geometry && editingEdge.geometry.length >= 2
                ? editingEdge.geometry
                : [
                    [nodesMap.get(editingEdge.fromNodeId)?.latitude || 0, nodesMap.get(editingEdge.fromNodeId)?.longitude || 0],
                    [nodesMap.get(editingEdge.toNodeId)?.latitude || 0, nodesMap.get(editingEdge.toNodeId)?.longitude || 0],
                  ]
            )}
            eventHandlers={{
              remove: () => setEditingEdge(null),
            }}
          >
            <EditPathForm
              edge={editingEdge}
              fromNodeName={nodesMap.get(editingEdge.fromNodeId)?.name || editingEdge.fromNodeId}
              toNodeName={nodesMap.get(editingEdge.toNodeId)?.name || editingEdge.toNodeId}
              onSave={handleUpdateEdge}
              onDelete={handleDeleteEdge}
              onEditGeometry={() => {
                setEditingGeometryEdge(editingEdge)
                setEditingEdge(null)
                setSelectedWaypointIndex(null)
              }}
              onCancel={() => setEditingEdge(null)}
            />
          </Popup>
        )}

        <MapEventsHandler onMapClick={handleMapClick} onMouseMove={handleMouseMove} />
      </MapContainer>

      {/* Bottom Left Coordinate Indicator when modes are OFF */}
      {!isNodeMode && !isPathMode && !isInsertNavMode && !editingGeometryEdge && clickedCoords && (
        <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/90 text-white px-4 py-3 rounded-lg shadow-xl backdrop-blur-md border border-slate-700 font-mono text-sm pointer-events-auto select-none">
          <div className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">
            Clicked Coordinates
          </div>
          <div>
            <span className="text-indigo-400 font-semibold">Lat:</span> {clickedCoords.lat.toFixed(6)}
          </div>
          <div>
            <span className="text-indigo-400 font-semibold">Lng:</span> {clickedCoords.lng.toFixed(6)}
          </div>
        </div>
      )}

      {/* Admin Login Modal (Sprint 9.1) */}
      {showAdminLoginModal && (
        <div className="fixed inset-0 z-[2000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans select-none animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700/80 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-white space-y-4 relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xl">🔐</span>
                <h3 className="font-bold text-base text-slate-100">Admin Login</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminLoginModal(false)}
                className="text-slate-400 hover:text-white transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {loginError && (
              <div className="bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-semibold px-3 py-2 rounded-lg animate-shake">
                {loginError}
              </div>
            )}

            <form onSubmit={handleAdminLoginSubmit} className="space-y-3.5">
              <div>
                <label htmlFor="admin-username" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Username
                </label>
                <input
                  id="admin-username"
                  type="text"
                  required
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="Enter admin username"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                />
              </div>

              <div>
                <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdminLoginModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs text-white bg-amber-600 hover:bg-amber-500 rounded-lg font-bold shadow-md shadow-amber-950/50 transition-colors"
                >
                  Login
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default MapView
