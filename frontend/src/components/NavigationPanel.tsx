import { useMemo, useState, useRef, useEffect } from 'react'

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
  onSelectRouteNodes?: (startNodeId: string, destNodeId: string) => void
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

export const NavigationPanel = ({ nodes, onSelectRouteNodes }: NavigationPanelProps) => {
  const [startNodeId, setStartNodeId] = useState<string | null>(null)
  const [destNodeId, setDestNodeId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Filter ONLY valid POI nodes (exclude category == 'Navigation' and isHidden == true)
  const poiOptions = useMemo(() => {
    return nodes.filter((n) => !n.isHidden && n.category !== 'Navigation')
  }, [nodes])

  const handleNavigateClick = () => {
    setErrorMessage(null)
    setStatusMessage(null)

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

    const startNode = nodes.find((n) => n.id === startNodeId)
    const destNode = nodes.find((n) => n.id === destNodeId)

    if (!startNode || !destNode) {
      setErrorMessage('Selected locations could not be resolved.')
      return
    }

    // Sprint 8.1 Specification: Log selected Start & Destination Nodes and Node IDs
    console.log('--------------------------------------------------')
    console.log('NAVIGATION SELECTION LOGGED (Sprint 8.1)')
    console.log('Selected Start Node:', startNode)
    console.log('Selected Destination Node:', destNode)
    console.log('Start Node ID:', startNode.id)
    console.log('Destination Node ID:', destNode.id)
    console.log('--------------------------------------------------')

    setStatusMessage(`Ready for routing: ${startNode.name} ➔ ${destNode.name}`)

    if (onSelectRouteNodes) {
      onSelectRouteNodes(startNode.id, destNode.id)
    }
  }

  return (
    <div className="absolute top-4 left-4 z-[1000] w-80 bg-slate-900/90 backdrop-blur-md p-3.5 rounded-2xl border border-slate-700/80 shadow-2xl text-white font-sans select-none space-y-3">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <h2 className="font-bold text-sm text-slate-100 tracking-wide">Route Finder</h2>
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
          setStatusMessage(null)
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
          setStatusMessage(null)
        }}
      />

      {errorMessage && (
        <div className="p-2 rounded-lg bg-rose-950/80 border border-rose-700/80 text-rose-200 text-xs font-medium animate-fadeIn">
          ⚠️ {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-700/80 text-emerald-200 text-xs font-medium animate-fadeIn">
          ✅ {statusMessage}
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
