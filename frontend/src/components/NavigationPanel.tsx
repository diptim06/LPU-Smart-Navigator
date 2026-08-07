import { useMemo, useState, useRef, useEffect } from 'react'
import { type RouteResult, type EdgeItem } from '../utils/dijkstraRouter'
import { findAStarRoute } from '../utils/aStarRouter'
import { fetchRouteFromBackend } from '../utils/apiClient'

export interface NodeItem {
  id: string
  name: string
  category?: 'POI' | 'Navigation'
  type: string
  latitude: number
  longitude: number
  isHidden?: boolean
}

interface NavigationPanelProps {
  nodes: NodeItem[]
  edges: EdgeItem[]
  onRouteCalculated?: (result: RouteResult | null) => void
}

interface SearchableSelectProps {
  label: string
  placeholder: string
  options: NodeItem[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}

const SearchableSelect = ({ label, placeholder, options, selectedNodeId, onSelectNode }: SearchableSelectProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedNode = useMemo(
    () => options.find((n) => n.id === selectedNodeId) || null,
    [options, selectedNodeId]
  )

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options
    const query = searchQuery.toLowerCase().trim()
    return options.filter(
      (n) =>
        n.name.toLowerCase().includes(query) ||
        n.type.toLowerCase().includes(query)
    )
  }, [options, searchQuery])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative font-sans text-xs" ref={dropdownRef}>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>

      {/* Main Select Button / Input Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-slate-800/90 border border-slate-700 hover:border-slate-600 px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between shadow-sm transition-all text-white"
      >
        <div className="truncate pr-2">
          {selectedNode ? (
            <span className="font-medium text-slate-100">
              {selectedNode.name}{' '}
              <span className="text-indigo-400 text-[10px] capitalize font-normal">
                • {selectedNode.type.replace('_', ' ')}
              </span>
            </span>
          ) : (
            <span className="text-slate-400 font-normal">{placeholder}</span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropdown Options Popup */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-[1100] bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Search Field */}
          <div className="p-2 border-b border-slate-800 bg-slate-950/60">
            <input
              type="text"
              autoFocus
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/60">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((node) => (
                <div
                  key={node.id}
                  onClick={() => {
                    onSelectNode(node.id)
                    setIsOpen(false)
                    setSearchQuery('')
                  }}
                  className={`px-3 py-2 cursor-pointer hover:bg-indigo-900/40 transition-colors flex items-center justify-between ${
                    selectedNodeId === node.id ? 'bg-indigo-950/60 text-indigo-300 font-semibold' : 'text-slate-200'
                  }`}
                >
                  <span className="truncate pr-2 font-medium">{node.name}</span>
                  <span className="text-[10px] text-slate-400 font-mono capitalize bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/50">
                    {node.type.replace('_', ' ')}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">
                No matching POI locations found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const NavigationPanel = ({ nodes, edges, onRouteCalculated }: NavigationPanelProps) => {
  const [startNodeId, setStartNodeId] = useState<string | null>(null)
  const [destNodeId, setDestNodeId] = useState<string | null>(null)
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Filter ONLY valid POI nodes, deduplicating by name and prioritizing connected nodes over isolated duplicates
  const poiOptions = useMemo(() => {
    const nodeDegrees = new Map<string, number>()
    nodes.forEach((n) => nodeDegrees.set(n.id, 0))
    edges.forEach((e) => {
      nodeDegrees.set(e.fromNodeId, (nodeDegrees.get(e.fromNodeId) || 0) + 1)
      nodeDegrees.set(e.toNodeId, (nodeDegrees.get(e.toNodeId) || 0) + 1)
    })

    const validPois = nodes.filter((n) => !n.isHidden && n.category !== 'Navigation')
    const bestPoisMap = new Map<string, NodeItem>()
    const bestDegreeMap = new Map<string, number>()

    validPois.forEach((n) => {
      const lowerName = n.name.toLowerCase().trim()
      const deg = nodeDegrees.get(n.id) || 0
      const existingDeg = bestDegreeMap.get(lowerName)

      if (!bestPoisMap.has(lowerName) || (existingDeg !== undefined && deg > existingDeg)) {
        bestPoisMap.set(lowerName, n)
        bestDegreeMap.set(lowerName, deg)
      }
    })

    return Array.from(bestPoisMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes, edges])

  const startNode = useMemo(() => nodes.find((n) => n.id === startNodeId), [nodes, startNodeId])
  const destNode = useMemo(() => nodes.find((n) => n.id === destNodeId), [nodes, destNodeId])

  const handleNavigateClick = async () => {
    setErrorMessage(null)
    setRouteResult(null)
    if (onRouteCalculated) onRouteCalculated(null)

    if (!startNodeId) {
      setErrorMessage('Please select a Current Location.')
      return
    }

    if (!destNodeId) {
      setErrorMessage('Please select a Destination.')
      return
    }

    if (startNodeId === destNodeId) {
      setErrorMessage('Start Location and Destination must be different.')
      return
    }

    if (!startNode || !destNode) {
      setErrorMessage('Selected locations could not be resolved.')
      return
    }

    console.log('--------------------------------------------------')
    console.log('SENDING REQUEST TO C++ BACKEND ROUTING MANAGER (Sprint 8.5)')
    console.log('Start Node ID:', startNodeId, `(${startNode.name})`)
    console.log('Destination Node ID:', destNodeId, `(${destNode.name})`)
    console.log('Endpoint: POST http://localhost:8080/api/route')
    console.log('--------------------------------------------------')

    try {
      // Sprint 8.5: C++ Backend RoutingManager is the SINGLE SOURCE OF TRUTH
      const result = await fetchRouteFromBackend(startNodeId, destNodeId)

      console.log('[C++ Backend Response Received]:', result)

      if (result.found) {
        setRouteResult(result)
        if (onRouteCalculated) onRouteCalculated(result)
      } else {
        setErrorMessage('No walking route could be found.')
        setRouteResult(null)
        if (onRouteCalculated) onRouteCalculated(null)
      }
    } catch (err) {
      console.warn('⚠️ C++ Backend API Server offline, executing client fallback:', err)
      // Fallback debug execution if backend HTTP server is offline
      const fallbackResult = findAStarRoute(nodes, edges, startNodeId, destNodeId)
      if (fallbackResult.found) {
        setRouteResult(fallbackResult)
        if (onRouteCalculated) onRouteCalculated(fallbackResult)
      } else {
        setErrorMessage('No walking route could be found.')
        setRouteResult(null)
        if (onRouteCalculated) onRouteCalculated(null)
      }
    }
  }

  const handleClearRoute = () => {
    setRouteResult(null)
    setErrorMessage(null)
    if (onRouteCalculated) onRouteCalculated(null)
  }

  return (
    <div className="absolute top-4 left-4 z-[1000] w-80 bg-slate-900/90 backdrop-blur-md p-3.5 rounded-2xl border border-slate-700/80 shadow-2xl text-white font-sans select-none space-y-3">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <h2 className="font-bold text-sm text-slate-100 tracking-wide">Campus Navigator</h2>
        </div>
        <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
          {poiOptions.length} POIs
        </span>
      </div>

      <SearchableSelect
        label="Current Location"
        placeholder="Select Start Location..."
        options={poiOptions}
        selectedNodeId={startNodeId}
        onSelectNode={(id) => {
          setStartNodeId(id)
          setErrorMessage(null)
          setRouteResult(null)
          if (onRouteCalculated) onRouteCalculated(null)
        }}
      />

      <SearchableSelect
        label="Destination"
        placeholder="Select Destination..."
        options={poiOptions}
        selectedNodeId={destNodeId}
        onSelectNode={(id) => {
          setDestNodeId(id)
          setErrorMessage(null)
          setRouteResult(null)
          if (onRouteCalculated) onRouteCalculated(null)
        }}
      />

      {errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-700/80 text-rose-200 text-xs font-medium animate-fadeIn">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Floating Route Information Card */}
      {routeResult && routeResult.found && startNode && destNode && (
        <div className="p-3 bg-gradient-to-br from-indigo-950/90 to-blue-950/90 border border-indigo-500/50 rounded-xl space-y-2 shadow-xl animate-fadeIn">
          <div className="flex items-center justify-between border-b border-indigo-800/60 pb-1.5">
            <span className="text-xs font-bold text-indigo-200 flex items-center space-x-1">
              <span>🚶 Optimal Route Found</span>
            </span>
            <button
              type="button"
              onClick={handleClearRoute}
              className="text-[10px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="space-y-1 text-xs">
            <div className="truncate">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Start:</span>{' '}
              <span className="font-bold text-white">{startNode.name}</span>
            </div>
            <div className="truncate">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Dest:</span>{' '}
              <span className="font-bold text-white">{destNode.name}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-900/60 text-xs font-mono">
            <div className="bg-slate-900/70 p-1.5 rounded-lg border border-indigo-900/50">
              <div className="text-[9px] text-slate-400 uppercase font-sans">Total Distance</div>
              <div className="text-indigo-300 font-bold text-sm">
                {routeResult.totalDistance >= 1000
                  ? `${(routeResult.totalDistance / 1000).toFixed(2)} km`
                  : `${routeResult.totalDistance} m`}
              </div>
            </div>

            <div className="bg-slate-900/70 p-1.5 rounded-lg border border-indigo-900/50">
              <div className="text-[9px] text-slate-400 uppercase font-sans">Est. Walk Time</div>
              <div className="text-emerald-300 font-bold text-sm">
                {Math.floor(routeResult.walkingTime / 60)}m {Math.round(routeResult.walkingTime % 60)}s
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 pt-0.5 text-center font-mono">
            Traversed: <span className="text-slate-200 font-semibold">{routeResult.nodeIds.length} nodes</span> •{' '}
            <span className="text-slate-200 font-semibold">{routeResult.geometry.length} polyline points</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleNavigateClick}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 tracking-wider uppercase"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
        <span>Navigate</span>
      </button>
    </div>
  )
}

export default NavigationPanel
