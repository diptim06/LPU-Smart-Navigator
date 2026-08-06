import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import initialNodesData from '../../../backend/data/nodes.json'

const LPU_COORDINATES: [number, number] = [31.2536, 75.7037]
const INITIAL_ZOOM = 16
const MIN_ZOOM = 15
const MAX_ZOOM = 19
const LOCAL_STORAGE_NODES_KEY = 'lpu_nodes_working_dataset'
const LOCAL_STORAGE_EDGES_KEY = 'lpu_edges_working_dataset'

const HOVER_SNAP_THRESHOLD_METERS = 12
const NODE_REUSE_TOLERANCE_METERS = 3

const LPU_BOUNDS: LatLngBoundsExpression = [
  [31.2400, 75.6900], // South-West [lat, lng]
  [31.2650, 75.7200], // North-East [lat, lng]
]

export interface NodeItem {
  id: string
  name: string
  category?: 'POI' | 'Navigation'
  type: string
  latitude: number
  longitude: number
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
  let bestProj: [number, number] = geom[0]
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
  onCancel: () => void
}

const EditPathForm = ({ edge, fromNodeName, toNodeName, onSave, onDelete, onCancel }: EditPathFormProps) => {
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
    <form onSubmit={handleSubmit} className="p-1 min-w-[240px] space-y-2 text-slate-900 font-sans">
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

interface SnapActionFormProps {
  snap: SnapProjection
  fromNodeName: string
  toNodeName: string
  onConnect: () => void
  onContinueSeparate: () => void
  onCancel: () => void
}

const SnapActionForm = ({ snap, fromNodeName, toNodeName, onConnect, onContinueSeparate, onCancel }: SnapActionFormProps) => {
  return (
    <div className="p-1 min-w-[260px] space-y-2.5 text-slate-900 font-sans">
      <div className="font-bold text-sm text-indigo-900 border-b border-slate-200 pb-1 flex items-center justify-between">
        <span>Path Intersection Detected</span>
        <span className="text-[10px] bg-sky-100 text-sky-800 font-semibold px-1.5 py-0.5 rounded">
          {snap.distanceMeters.toFixed(1)}m away
        </span>
      </div>

      <p className="text-xs text-slate-600">
        This path intersects or comes close to an existing path (<strong>{fromNodeName} ➔ {toNodeName}</strong>).
      </p>

      <div className="space-y-1.5 pt-1">
        <button
          type="button"
          onClick={onConnect}
          className="w-full text-left px-3 py-2 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-lg font-semibold transition-colors flex items-start space-x-2 shadow-sm"
        >
          <span className="text-base leading-none">🟢</span>
          <div>
            <div>Connect to Existing Path</div>
            <div className="text-[10px] font-normal text-emerald-700 mt-0.5">
              Split path & join graph at snapped point (reuses or creates Navigation node)
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
              Cross over without graph connection (overpass, skywalk, tunnel, corridor)
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
        return parsed.map((n: any) => ({
          ...n,
          category: n.category || 'POI',
        })) as NodeItem[]
      }
    }
  } catch (e) {
    console.error('Failed to load nodes from localStorage:', e)
  }
  return (initialNodesData as any[]).map((n) => ({
    ...n,
    category: n.category || 'POI',
  })) as NodeItem[]
}

const loadInitialEdges = (): EdgeItem[] => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_EDGES_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed as EdgeItem[]
      }
    }
  } catch (e) {
    console.error('Failed to load edges from localStorage:', e)
  }
  return []
}

export const MapView = () => {
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

  // Insert Navigation Node State
  const [splitTarget, setSplitTarget] = useState<{ location: ClickedLocation; edge: EdgeItem } | null>(null)

  // Snapping States
  const [hoveredSnap, setHoveredSnap] = useState<SnapProjection | null>(null)
  const [pendingSnapTarget, setPendingSnapTarget] = useState<{ location: ClickedLocation; snap: SnapProjection } | null>(null)

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

  const resetPathDrawingState = () => {
    setDrawStep('select_start')
    setSelectedStartNode(null)
    setDrawingWaypoints([])
    setSelectedEndNode(null)
    setHoveredSnap(null)
    setPendingSnapTarget(null)
  }

  const handleMouseMove = (location: ClickedLocation) => {
    if (!isPathMode || !selectedStartNode || pendingSnapTarget) {
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
    if (isNodeMode) {
      setPendingNode(location)
      setEditingNode(null)
      setEditingEdge(null)
      setSplitTarget(null)
      setPendingSnapTarget(null)
    } else if (isPathMode) {
      if (drawStep === 'drawing_waypoints') {
        if (hoveredSnap) {
          // Open snapping dialog option menu
          setPendingSnapTarget({ location, snap: hoveredSnap })
        } else {
          setDrawingWaypoints((prev) => [...prev, [location.lat, location.lng]])
        }
      }
    } else {
      setClickedCoords(location)
    }
  }

  const handleNodeClick = (node: NodeItem) => {
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
    }

    setNodes((prev) => [...prev, newNode])
    setPendingNode(null)
  }

  const handleUpdateNode = (updatedNode: NodeItem) => {
    setNodes((prev) => prev.map((n) => (n.id === updatedNode.id ? updatedNode : n)))
    setEditingNode(null)
  }

  const handleDeleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId))
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
    setEdges((prev) => prev.filter((e) => e.id !== edgeId))
    setEditingEdge(null)
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
    }

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
        : [[clickedLat, clickedLng]]

    const splitIndex = getClosestSegmentIndex(baseGeometry, [clickedLat, clickedLng])
    const navPt: [number, number] = [clickedLat, clickedLng]

    const geomPart1: [number, number][] = [...baseGeometry.slice(0, splitIndex + 1), navPt]
    const geomPart2: [number, number][] = [navPt, ...baseGeometry.slice(splitIndex + 1)]

    const dist1 = calculatePathDistance(geomPart1)
    const dist2 = calculatePathDistance(geomPart2)

    const edge1: EdgeItem = {
      id: `edge-${Date.now()}-1`,
      fromNodeId: originalEdge.fromNodeId,
      toNodeId: navNodeId,
      geometry: geomPart1,
      distance: dist1,
      walkingTime: Math.round(dist1 / 1.4),
      pathType: originalEdge.pathType,
      isBidirectional: originalEdge.isBidirectional,
    }

    const edge2: EdgeItem = {
      id: `edge-${Date.now()}-2`,
      fromNodeId: navNodeId,
      toNodeId: originalEdge.toNodeId,
      geometry: geomPart2,
      distance: dist2,
      walkingTime: Math.round(dist2 / 1.4),
      pathType: originalEdge.pathType,
      isBidirectional: originalEdge.isBidirectional,
    }

    setNodes((prev) => [...prev, newNavNode])
    setEdges((prev) => [...prev.filter((e) => e.id !== originalEdge.id), edge1, edge2])
    setSplitTarget(null)
  }

  // Handle Snapping Option 1: Connect to Existing Path
  const handleSnapConnect = () => {
    if (!pendingSnapTarget) return

    const { snap } = pendingSnapTarget
    const snapLat = snap.point[0]
    const snapLng = snap.point[1]

    // Check if an existing Navigation Node exists within 3 meters
    const nearbyNavNode = nodes.find(
      (n) => calculateDistanceMeters(n.latitude, n.longitude, snapLat, snapLng) <= NODE_REUSE_TOLERANCE_METERS
    )

    let connectNode: NodeItem

    if (nearbyNavNode) {
      connectNode = nearbyNavNode
    } else {
      // Create new Navigation Node at snapped position and split existing path
      const navNodeId = `node-nav-${Date.now()}`
      connectNode = {
        id: navNodeId,
        name: 'Road Junction',
        category: 'Navigation',
        type: 'road_junction',
        latitude: snapLat,
        longitude: snapLng,
      }

      const originalEdge = snap.edge
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
          : [[snapLat, snapLng]]

      const splitIndex = snap.segmentIndex
      const navPt: [number, number] = [snapLat, snapLng]

      const geomPart1: [number, number][] = [...baseGeometry.slice(0, splitIndex + 1), navPt]
      const geomPart2: [number, number][] = [navPt, ...baseGeometry.slice(splitIndex + 1)]

      const dist1 = calculatePathDistance(geomPart1)
      const dist2 = calculatePathDistance(geomPart2)

      const edge1: EdgeItem = {
        id: `edge-${Date.now()}-1`,
        fromNodeId: originalEdge.fromNodeId,
        toNodeId: navNodeId,
        geometry: geomPart1,
        distance: dist1,
        walkingTime: Math.round(dist1 / 1.4),
        pathType: originalEdge.pathType,
        isBidirectional: originalEdge.isBidirectional,
      }

      const edge2: EdgeItem = {
        id: `edge-${Date.now()}-2`,
        fromNodeId: navNodeId,
        toNodeId: originalEdge.toNodeId,
        geometry: geomPart2,
        distance: dist2,
        walkingTime: Math.round(dist2 / 1.4),
        pathType: originalEdge.pathType,
        isBidirectional: originalEdge.isBidirectional,
      }

      setNodes((prev) => [...prev, connectNode])
      setEdges((prev) => [...prev.filter((e) => e.id !== originalEdge.id), edge1, edge2])
    }

    // Set end node as connectNode to complete current path
    setSelectedEndNode(connectNode)
    setPendingSnapTarget(null)
    setHoveredSnap(null)
  }

  // Handle Snapping Option 2: Continue Drawing as Separate Path
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
          const validEdges = parsed.map((item: any) => ({
            id: String(item.id || `edge-${Date.now()}`),
            fromNodeId: String(item.fromNodeId || ''),
            toNodeId: String(item.toNodeId || ''),
            geometry: Array.isArray(item.geometry) ? item.geometry : [],
            distance: Number(item.distance || 0),
            walkingTime: Number(item.walkingTime || 0),
            pathType: String(item.pathType || 'road'),
            isBidirectional: item.isBidirectional !== false,
          })) as EdgeItem[]

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
      const official = (initialNodesData as any[]).map((n) => ({ ...n, category: n.category || 'POI' })) as NodeItem[]
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
      {/* Top Control Toolbar */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-wrap items-center gap-2 max-w-[calc(100vw-2rem)] bg-slate-900/90 backdrop-blur-md p-2.5 rounded-xl border border-slate-700/80 shadow-2xl text-white select-none">
        {/* Node Collection Mode Toggle */}
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
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
            isNodeMode
              ? 'bg-indigo-600 text-white shadow-md hover:bg-indigo-500'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isNodeMode ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span>Node Mode: {isNodeMode ? 'ON' : 'OFF'}</span>
        </button>

        {/* Path Drawing Mode Toggle */}
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
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
            isPathMode
              ? 'bg-amber-600 text-white shadow-md hover:bg-amber-500'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isPathMode ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span>🖊 Path Drawing Mode: {isPathMode ? 'ON' : 'OFF'}</span>
        </button>

        {/* Insert Navigation Node Mode Toggle */}
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
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
            isInsertNavMode
              ? 'bg-cyan-600 text-white shadow-md hover:bg-cyan-500'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isInsertNavMode ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span>📍 Insert Nav Node: {isInsertNavMode ? 'ON' : 'OFF'}</span>
        </button>

        <div className="h-4 w-px bg-slate-700 mx-0.5" />

        {/* Import Nodes Button */}
        <label className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide shadow-md transition-colors flex items-center space-x-1 cursor-pointer">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
          </svg>
          <span>Import Nodes</span>
          <input type="file" accept=".json" onChange={handleImportNodes} className="hidden" />
        </label>

        {/* Export Nodes Button */}
        <button
          type="button"
          onClick={handleExportNodes}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide shadow-md transition-colors flex items-center space-x-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4 4m4 4V4" />
          </svg>
          <span>Export Nodes ({nodes.length})</span>
        </button>

        <div className="h-4 w-px bg-slate-700 mx-0.5" />

        {/* Import Edges Button */}
        <label className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide shadow-md transition-colors flex items-center space-x-1 cursor-pointer">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
          </svg>
          <span>Import Edges</span>
          <input type="file" accept=".json" onChange={handleImportEdges} className="hidden" />
        </label>

        {/* Export Edges Button */}
        <button
          type="button"
          onClick={handleExportEdges}
          className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide shadow-md transition-colors flex items-center space-x-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4 4m4 4V4" />
          </svg>
          <span>Export Edges ({edges.length})</span>
        </button>

        <button
          type="button"
          onClick={handleReloadOfficial}
          className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors"
          title="Reload official dataset from backend/data/nodes.json"
        >
          Reload Official
        </button>
      </div>

      {/* Path Drawing Mode Guidance Banner */}
      {isPathMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-amber-950/90 text-amber-200 border border-amber-600/60 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center space-x-3 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          {drawStep === 'select_start' && (
            <span>Step 1: Click an existing node on the map as the <strong>Start Node</strong>.</span>
          )}
          {drawStep === 'drawing_waypoints' && (
            <div className="flex items-center space-x-3">
              <span>
                Start: <strong className="text-white">{selectedStartNode?.name}</strong>. Click map to add route waypoints ({drawingWaypoints.length} added).
                {hoveredSnap && <span className="text-sky-300 ml-2 animate-pulse">🎯 Snapping to nearby path</span>}
              </span>
              <button
                type="button"
                onClick={() => setDrawStep('select_end')}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-2.5 py-1 rounded shadow"
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

      {/* Insert Navigation Node Guidance Banner */}
      {isInsertNavMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-cyan-950/90 text-cyan-200 border border-cyan-600/60 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center space-x-2 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <span>📍 Insert Nav Node Mode: Click anywhere along an existing path line to insert a Navigation Node and split the path.</span>
        </div>
      )}

      <MapContainer
        center={LPU_COORDINATES}
        zoom={INITIAL_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
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
        />

        {/* Render Hovered Snap Edge Highlight */}
        {isPathMode && hoveredSnap && (
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

        {/* Render Hovered Snapping Point Indicator Dot */}
        {isPathMode && hoveredSnap && (
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

        {/* Render Saved Edges (Polylines) */}
        {edges.map((edge) => {
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

          return (
            <Polyline
              key={edge.id}
              positions={polyGeometry}
              pathOptions={{
                color: edge.isBidirectional ? '#4f46e5' : '#0284c7',
                weight: 4,
                opacity: 0.85,
                dashArray: edge.isBidirectional ? undefined : '6, 6',
              }}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent.stopPropagation()
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

        {/* Render Nodes (CircleMarkers) */}
        {nodes.map((node) => {
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

        {/* Popup form for creating new node */}
        {isNodeMode && pendingNode && (
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

        {/* Popup form for editing existing node */}
        {editingNode && (
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

        {/* Popup form for snapping action decision */}
        {pendingSnapTarget && (
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
              onConnect={handleSnapConnect}
              onContinueSeparate={handleSnapContinueSeparate}
              onCancel={() => setPendingSnapTarget(null)}
            />
          </Popup>
        )}

        {/* Popup form for inserting Navigation Node on path */}
        {splitTarget && (
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

        {/* Popup form for adding new drawn path */}
        {selectedStartNode && selectedEndNode && activeDrawingGeometry.length >= 2 && (
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

        {/* Popup form for editing existing edge */}
        {editingEdge && (
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
              onCancel={() => setEditingEdge(null)}
            />
          </Popup>
        )}

        <MapEventsHandler onMapClick={handleMapClick} onMouseMove={handleMouseMove} />
      </MapContainer>

      {/* Bottom Left Coordinate Indicator when modes are OFF */}
      {!isNodeMode && !isPathMode && !isInsertNavMode && clickedCoords && (
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
    </div>
  )
}

export default MapView
