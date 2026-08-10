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
  appMode?: 'user' | 'admin'
  isAdminAuthenticated?: boolean
  isSidebarExpanded?: boolean
  onModeToggle: (mode: 'user' | 'admin') => void
  onOpenAdminLogin: () => void
  onAdminLogout: () => void
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
    <div className="relative font-sans text-xs w-full" ref={dropdownRef}>
      {/* Main Select Button / Input Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-slate-800/90 border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-xl cursor-pointer flex items-center justify-between shadow-sm transition-all text-white min-h-[36px]"
      >
        <div className="truncate pr-1">
          {selectedNode ? (
            <span className="font-medium text-slate-100">
              <span className="text-slate-400 font-semibold mr-1">{label.split(' ')[0]}</span>
              {selectedNode.name}{' '}
              <span className="text-indigo-400 text-[10px] capitalize font-normal hidden xl:inline">
                • {selectedNode.type.replace('_', ' ')}
              </span>
            </span>
          ) : (
            <span className="text-slate-400 font-normal">
              <span className="font-semibold mr-1">{label.split(' ')[0]}</span>
              {placeholder}
            </span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropdown Options Popup */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-[1200] min-w-[220px] bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Search Field */}
          <div className="p-2 border-b border-slate-800 bg-slate-950/60">
            <input
              type="text"
              autoFocus
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
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
                  <span className="text-[10px] text-slate-400 font-mono capitalize bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-700/50">
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

export const NavigationPanel = ({
  nodes,
  edges,
  appMode = 'user',
  isAdminAuthenticated = false,
  isSidebarExpanded = true,
  onModeToggle,
  onOpenAdminLogin,
  onAdminLogout,
  onRouteCalculated,
}: NavigationPanelProps) => {
  const [startNodeId, setStartNodeId] = useState<string | null>(null)
  const [destNodeId, setDestNodeId] = useState<string | null>(null)
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const panelPositionClass = useMemo(() => {
    if (appMode === 'admin') {
      return isSidebarExpanded
        ? 'left-[304px] right-4'
        : 'left-[84px] right-4'
    }
    return 'left-4 right-4'
  }, [appMode, isSidebarExpanded])

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
    <div
      className={`fixed ${panelPositionClass} top-4 z-[1000] bg-slate-900/95 backdrop-blur-md p-2 rounded-2xl border border-slate-700/80 shadow-2xl text-white font-sans transition-all duration-300 select-none space-y-1.5 pointer-events-auto`}
    >
      {/* Row 1: Single Responsive Flex Header Controls Row */}
      <div className="flex items-center justify-between gap-2.5 flex-wrap md:flex-nowrap">
        {/* Left: Brand Logo */}
        <div className="flex items-center space-x-2 shrink-0 pr-2 border-r border-slate-800 hidden lg:flex">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <h2 className="font-bold text-xs text-slate-100 tracking-wide whitespace-nowrap">LPU Navigator</h2>
        </div>

        {/* Center: Search Inputs & Navigate Action Button */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          {/* Start Location Input */}
          <div className="flex-1 min-w-[120px]">
            <SearchableSelect
              label="📍 Start"
              placeholder="Select Start..."
              options={poiOptions}
              selectedNodeId={startNodeId}
              onSelectNode={(id) => {
                setStartNodeId(id)
                setErrorMessage(null)
                setRouteResult(null)
                if (onRouteCalculated) onRouteCalculated(null)
              }}
            />
          </div>

          {/* Destination Input */}
          <div className="flex-1 min-w-[120px]">
            <SearchableSelect
              label="🎯 Dest"
              placeholder="Select Dest..."
              options={poiOptions}
              selectedNodeId={destNodeId}
              onSelectNode={(id) => {
                setDestNodeId(id)
                setErrorMessage(null)
                setRouteResult(null)
                if (onRouteCalculated) onRouteCalculated(null)
              }}
            />
          </div>

          {/* Navigate Action Button */}
          <button
            type="button"
            onClick={handleNavigateClick}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center space-x-1.5 shrink-0 uppercase tracking-wider cursor-pointer"
          >
            <span className="text-sm">🧭</span>
            <span>Navigate</span>
          </button>
        </div>

        {/* Right: User / Admin Mode Switcher Controls */}
        <div className="flex items-center space-x-1 shrink-0 border-l border-slate-800/80 pl-2">
          <button
            type="button"
            onClick={() => onModeToggle('user')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer ${
              appMode === 'user'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <span>👤</span>
            <span className="hidden sm:inline">User Mode</span>
          </button>

          {isAdminAuthenticated && appMode === 'admin' ? (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => onModeToggle('admin')}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white shadow-md shadow-amber-900/50 flex items-center space-x-1 cursor-default"
              >
                <span>👨‍💻</span>
                <span className="hidden sm:inline">Admin Mode</span>
              </button>

              <button
                type="button"
                onClick={onAdminLogout}
                className="px-2 py-1.5 rounded-xl text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/70 hover:bg-rose-900 border border-rose-700/50 transition-colors cursor-pointer"
                title="Logout from Admin session"
              >
                Logout 🚪
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all flex items-center space-x-1 cursor-pointer"
            >
              <span>👨‍💻</span>
              <span className="hidden sm:inline">Admin Login</span>
            </button>
          )}
        </div>
      </div>

      {/* Error Message banner */}
      {errorMessage && (
        <div className="px-3 py-1.5 rounded-xl bg-rose-950/80 border border-rose-700/80 text-rose-200 text-xs font-medium animate-fadeIn flex items-center space-x-1.5">
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Row 2: Compact Route Summary Row (Only when route is calculated) */}
      {routeResult && routeResult.found && startNode && destNode && (
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-950/95 via-slate-900/95 to-blue-950/95 border border-indigo-500/50 px-3 py-1.5 rounded-xl text-xs shadow-xl animate-fadeIn">
          <div className="flex items-center space-x-2 truncate">
            <span className="text-emerald-400 font-bold text-xs shrink-0">🚶 Route:</span>
            <span className="font-bold text-slate-100 truncate">{startNode.name}</span>
            <span className="text-indigo-400 font-bold">➔</span>
            <span className="font-bold text-slate-100 truncate">{destNode.name}</span>
          </div>

          <div className="flex items-center space-x-2.5 shrink-0 text-xs font-mono">
            <div className="bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-800/60 text-indigo-300 font-bold">
              {routeResult.totalDistance >= 1000
                ? `${(routeResult.totalDistance / 1000).toFixed(2)} km`
                : `${routeResult.totalDistance} m`}
            </div>

            <div className="bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60 text-emerald-300 font-bold">
              ⏱ {Math.floor(routeResult.walkingTime / 60)}m {Math.round(routeResult.walkingTime % 60)}s
            </div>

            <div className="text-slate-400 text-[10px] hidden lg:block">
              {routeResult.nodeIds.length} nodes
            </div>

            <button
              type="button"
              onClick={handleClearRoute}
              className="text-[10px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-700 transition-colors cursor-pointer"
            >
              Clear ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default NavigationPanel
