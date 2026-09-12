# VERIFIED PROJECT ANALYSIS: LPU SMART NAVIGATOR / LPU PATHFINDER

**Student Name:** Dipti Mishra  
**Registration Number:** 12410476  
**University:** Lovely Professional University, Phagwara, Punjab  
**Project Name:** LPU Smart Navigator / LPU Pathfinder  
**Analysis Date:** August 19, 2026  

---

## 1. Project Overview

**LPU Smart Navigator / LPU Pathfinder** is a specialized, web-based campus spatial mapping and navigation application custom-built for Lovely Professional University (LPU), Phagwara, Punjab (`[VERIFIED: source code, dataset coordinates 31.2536 N, 75.7037 E]`).

The system combines a high-performance C++ graph routing backend engine with an interactive, responsive React + Leaflet frontend interface. It operates in two primary operational modes:

1. **User Navigation Mode:** Allows students, faculty, staff, and campus visitors to search and select Points of Interest (POIs) such as academic blocks, hostels, gates, food courts, libraries, and parks, and compute the shortest walking route with exact distance (in meters/kilometers), estimated walking time (based on an average human walking speed of 1.4 m/s), and a polyline path visualizer over OpenStreetMap tiles (`[VERIFIED: NavigationPanel.tsx, AStarRouter.cpp, MapView.tsx]`).
2. **Admin Graph Editor Mode:** Provides an interactive graph editing tool for campus mappers. Admins can create and edit POI and hidden navigation junction nodes, draw road/path edges, adjust multi-point waypoints via drag-and-drop handles, perform edge snapping within a 12-meter threshold, execute real-time graph dataset validation, and persist updated dataset files directly to disk via backend APIs (`[VERIFIED: MapView.tsx, HttpServer.cpp]`).

---

## 2. Problem Statement

University campuses such as Lovely Professional University span hundreds of acres with dozens of multi-story academic blocks, residential hostels, dining facilities, auditoriums, and open parks (`[VERIFIED: dataset contains 112 nodes across 52 POIs]`). 

Standard public navigation platforms (e.g., Google Maps, Apple Maps) focus primarily on motorized vehicular roads and frequently lack coverage of detailed internal pedestrian infrastructure—such as hostel tungstile entry gates, pedestrian underpasses, campus skywalks, internal corridors, and specific block entrances. Navigating between distant campus locations (e.g., Main Gate to Block 34 or Uni Health Center) is confusing for freshers, parents, and visitors. 

LPU Smart Navigator solves this problem by creating a dedicated, high-resolution graph dataset of campus pedestrian paths and building a custom graph search and routing system specifically tailored to LPU's physical infrastructure (`[VERIFIED: nodes.json, edges.json, AStarRouter.cpp]`).

---

## 3. Project Objectives

Based directly on the actual codebase implementation, the verified project objectives are:

1. **Campus POI Digitization:** Map and categorize all major campus landmark POIs (entrances, academic blocks, food courts, libraries, hospitals, parks, hostels, auditoriums) with accurate geographic coordinates (latitude and longitude) (`[VERIFIED: backend/data/nodes.json]`).
2. **Graph Network Construction:** Build a connected topological graph representing walking paths, roads, junctions, underpasses, and footpaths across the campus (`[VERIFIED: backend/data/edges.json, Graph.cpp]`).
3. **High-Performance Shortest Path Routing:** Implement the A* search algorithm using the Haversine formula as a geographic heuristic function to calculate optimal walking routes in sub-millisecond execution times (`[VERIFIED: AStarRouter.cpp, main.cpp benchmark of 0.23 ms]`).
4. **Dual Algorithm Cross-Verification:** Implement the Dijkstra algorithm alongside A* to benchmark execution speed, expanded node count, and verify distance optimality (`[VERIFIED: DijkstraRouter.cpp, RoutingManager.cpp]`).
5. **Lightweight Custom C++ Backend HTTP Server:** Build a raw POSIX socket HTTP server in C++20 without external web framework dependencies to serve routing APIs on port 8080 (`[VERIFIED: HttpServer.cpp, CMakeLists.txt]`).
6. **Interactive Visual Map Interface:** Develop a responsive web frontend with OpenStreetMap tile integration, smooth polyline geometry rendering, custom map markers, and searchable dropdown selectors (`[VERIFIED: MapView.tsx, NavigationPanel.tsx]`).
7. **Graph Dataset Management & Hot Reloading:** Provide an authenticated Admin Editor to modify nodes and edges visually, validate graph topological integrity, save changes to disk, and hot-reload memory search structures without server restarts (`[VERIFIED: MapView.tsx, HttpServer.cpp handleSaveGraph]`).
8. **Client-Side Offline Resilience:** Implement fallback A* and Dijkstra routing logic in client-side TypeScript so navigation continues working even if the C++ HTTP backend server is unreachable (`[VERIFIED: NavigationPanel.tsx, aStarRouter.ts]`).

---

## 4. Implemented Features

| Feature | Status | Evidence in Project | Explanation |
| :--- | :--- | :--- | :--- |
| **Searchable POI Selection** | IMPLEMENTED | `NavigationPanel.tsx:L36-145`, `SearchIndex.cpp` | Searchable auto-complete dropdown for start and destination locations filtering 52 unique POIs `[VERIFIED]`. |
| **A* Pathfinding Routing** | IMPLEMENTED | `AStarRouter.cpp:L27-214`, `aStarRouter.ts` | Primary shortest-path algorithm using Haversine distance heuristic `[VERIFIED]`. |
| **Dijkstra Pathfinding Routing** | IMPLEMENTED | `DijkstraRouter.cpp:L30-200`, `dijkstraRouter.ts` | Secondary algorithm used for dev verification and distance cross-checking `[VERIFIED]`. |
| **Route Distance & Walk Time Calculation** | IMPLEMENTED | `AStarRouter.cpp:L148-149`, `NavigationPanel.tsx:L393-401` | Calculates exact distance in meters/km and estimates walking time at 1.4 m/s speed `[VERIFIED]`. |
| **Polyline Route Visualizer** | IMPLEMENTED | `MapView.tsx`, `AStarRouter.cpp:L153-211` | Merges edge geometry into continuous coordinate polyline rendered on Leaflet map `[VERIFIED]`. |
| **Custom C++ HTTP API Server** | IMPLEMENTED | `HttpServer.cpp:L130-269`, `main.cpp:L98` | Native POSIX socket server handling CORS preflight, `POST /api/route`, and `POST /api/save-graph` on port 8080 `[VERIFIED]`. |
| **Interactive Admin Map Editor** | IMPLEMENTED | `MapView.tsx:L800-1500` | Full GUI tool to add POI/nav nodes, draw path edges, move waypoints, and delete elements `[VERIFIED]`. |
| **Snap-to-Edge Geometry Alignment** | IMPLEMENTED | `MapView.tsx:L26-27, L187-215` | Projects mouse hover to nearest edge segment within 12m threshold for exact junction creation `[VERIFIED]`. |
| **Graph Dataset Validation Engine** | IMPLEMENTED | `Graph.cpp:L113-175` | Checks duplicate IDs, orphan edge node references, zero/negative distances, and edges >50m `[VERIFIED]`. |
| **Hot-Reload Disk Persistence API** | IMPLEMENTED | `HttpServer.cpp:L271-350` | Saves edited nodes/edges to `backend/data/*.json` and hot-reloads memory graph instantly `[VERIFIED]`. |
| **Offline Client Routing Fallback** | IMPLEMENTED | `NavigationPanel.tsx:L248-260` | Client-side TypeScript A* engine executes automatically if C++ server is offline `[VERIFIED]`. |
| **Admin Authentication System** | PARTIALLY IMPLEMENTED | `MapView.tsx:L20-24` | Client-side login modal with hardcoded credentials (`dips006`/`2222026`). Lacks DB or JWT token auth `[VERIFIED]`. |
| **GPS Real-Time Location Tracking** | NOT IMPLEMENTED | Checked all `.tsx` and `.cpp` files | No HTML5 Geolocation API (`navigator.geolocation`) call exists in codebase `[VERIFIED]`. |
| **Turn-by-Turn Audio Navigation** | NOT IMPLEMENTED | Checked component codebase | No SpeechSynthesis or voice guidance implemented `[VERIFIED]`. |
| **Database Server Storage (SQL/NoSQL)** | NOT IMPLEMENTED | No database configuration files | Data is stored in static JSON files (`nodes.json`, `edges.json`) and browser LocalStorage `[VERIFIED]`. |
| **AI/ML Route Optimization** | NOT IMPLEMENTED | Checked source files | Traditional graph algorithms (A* & Dijkstra) are used exclusively. No ML models `[VERIFIED]`. |

---

## 5. Technology Stack

| Technology | Actual Usage | Location in Code | Purpose |
| :--- | :--- | :--- | :--- |
| **React 19** (`^19.2.8`) | Frontend Framework | `frontend/package.json:L14` | Core UI component rendering and reactive state management `[VERIFIED]`. |
| **TypeScript** (`~6.0.2`) | Programming Language | `frontend/tsconfig.json`, `*.tsx` | Type-safe web application development `[VERIFIED]`. |
| **Vite** (`^8.2.0`) | Build Tool / Dev Server | `frontend/vite.config.ts` | Ultra-fast frontend development server and ESM bundler `[VERIFIED]`. |
| **Tailwind CSS** (`^4.3.3`) | Styling Framework | `frontend/package.json:L19, L26` | Modern utility-first styling engine `@tailwindcss/vite` `[VERIFIED]`. |
| **Leaflet** (`^1.9.4`) | Map Rendering Engine | `frontend/package.json:L13` | Open-source interactive map rendering engine `[VERIFIED]`. |
| **React-Leaflet** (`^5.0.0`) | Map Component Wrappers | `frontend/package.json:L16` | React bindings for Leaflet map elements (`MapContainer`, `TileLayer`, `Polyline`, `Marker`) `[VERIFIED]`. |
| **OpenStreetMap** | Map Tile Provider | `MapView.tsx:L1400` | Raster map tiles layer for LPU coordinates `[VERIFIED]`. |
| **C++20** | Backend Language | `backend/CMakeLists.txt:L4` | High-performance graph processing engine and HTTP server `[VERIFIED]`. |
| **CMake** (`>= 3.16`) | Backend Build Tool | `backend/CMakeLists.txt:L1` | Cross-platform build generator for C++ binary `[VERIFIED]`. |
| **POSIX Sockets** | Networking Library | `backend/src/HttpServer.cpp:L3-7` | Native socket networking (`sys/socket.h`, `netinet/in.h`) for lightweight HTTP server `[VERIFIED]`. |
| **JSON** | Data Interchange | `backend/data/nodes.json`, `edges.json` | Persistent storage format for graph nodes and edges `[VERIFIED]`. |
| **Oxlint** (`^1.75.0`) | Code Quality Tool | `frontend/package.json:L25` | High-speed JavaScript/TypeScript linter `[VERIFIED]`. |
| **HTML5 LocalStorage** | Browser Storage | `MapView.tsx:L16-18` | Stores admin session flag and fallback working graph dataset `[VERIFIED]`. |

---

## 6. Project Architecture

The application adopts a decoupled client-server architecture with dual execution capabilities:

```
+-----------------------------------------------------------------------------------+
|                                  USER / BROWSER                                   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        FRONTEND (React 19 + TypeScript + Vite)                    |
|  - MapView.tsx (Leaflet Map & Admin Graph Editor)                                 |
|  - NavigationPanel.tsx (POI Search Selectors & Route Info)                        |
|  - apiClient.ts (HTTP Client)                                                     |
+-----------------------------------------------------------------------------------+
                                         |
                       +-----------------+-----------------+
                       | (Primary HTTP API)                | (Fallback Mode)
                       v                                   v
+------------------------------------+   +------------------------------------------+
|  BACKEND (C++20 Native Executable)  |   |  CLIENT-SIDE TS ROUTER FALLBACK          |
|  - HttpServer (Port 8080 Sockets)  |   |  - aStarRouter.ts                        |
|  - RoutingManager (A* & Dijkstra)  |   |  - dijkstraRouter.ts                     |
|  - Graph Engine & Validation       |   +------------------------------------------+
|  - SearchIndex                     |
+------------------------------------+
                   |
                   v
+------------------------------------+
|  DATA STORE (Flat Files)           |
|  - backend/data/nodes.json (112)   |
|  - backend/data/edges.json (122)   |
+------------------------------------+
```

### Architecture Description `[VERIFIED]`
1. **Frontend Layer:** React 19 web application built with Vite and styled with Tailwind CSS 4. Leaflet renders tile overlays centered at LPU campus coordinates (`31.2536, 75.7037`).
2. **Communication Layer:** RESTful JSON endpoints (`POST /api/route`, `POST /api/save-graph`) transmitted over HTTP to port 8080.
3. **Backend Layer:** Native C++20 compiled binary. Uses POSIX sockets to manage HTTP communication, single-source graph dataset loading, Haversine A* routing, Dijkstra validation, and hot-reloading disk storage.
4. **Data Layer:** Structured JSON file storage representing graph nodes and edges.

---

## 7. Application Flow

```
[Start App] ──> Load React 19 Frontend & Mount Leaflet Map (LPU Coordinates)
     │
     ├──> [User Mode Flow]
     │     1. User selects "Start Location" POI from dropdown.
     │     2. User selects "Destination" POI from dropdown.
     │     3. User clicks "Navigate" button.
     │     4. Frontend calls POST http://localhost:8080/api/route with JSON payload.
     │     5. C++ Backend executes A* Search algorithm, returns RouteResult JSON.
     │     6. Frontend displays Distance, Walk Time, and draws Blue Polyline on Map.
     │
     └──> [Admin Mode Flow]
           1. User clicks "Admin Login" & enters credentials (dips006 / 2222026).
           2. Editor controls unlock on map (Add Node, Add Nav Point, Draw Edge, Waypoint handles).
           3. Admin edits graph, moves nodes, or adjusts path polyline waypoints.
           4. Admin clicks "Save Graph to Disk".
           5. Frontend calls POST http://localhost:8080/api/save-graph.
           6. C++ Backend validates graph, writes data/nodes.json & edges.json, and hot-reloads memory engine.
```

---

## 8. Frontend Structure

The frontend source code is organized under `frontend/src/`:

```
frontend/src/
├── assets/
│   ├── hero.png
│   ├── react.svg
│   └── vite.svg
├── components/
│   ├── MapView.tsx          # Fullscreen Leaflet map & Admin graph editor (~2950 lines) [VERIFIED]
│   └── NavigationPanel.tsx  # Header bar, POI search dropdowns, route summary (~420 lines) [VERIFIED]
├── utils/
│   ├── apiClient.ts         # HTTP fetch functions for C++ API endpoints [VERIFIED]
│   ├── aStarRouter.ts       # Client-side A* pathfinding algorithm implementation [VERIFIED]
│   └── dijkstraRouter.ts    # Client-side Dijkstra routing & TypeScript interfaces [VERIFIED]
├── App.css                  # Custom styling & media queries [VERIFIED]
├── App.tsx                  # Root component rendering <MapView /> [VERIFIED]
├── index.css                # Global styles & Tailwind CSS @import [VERIFIED]
└── main.tsx                 # React entry point mounting App to DOM [VERIFIED]
```

### Component Details `[VERIFIED]`
* **`MapView.tsx` (Core Component):** Renders the Leaflet Map Container, tile layer, markers for POIs, polyline path for calculated route, and administrative tools (drag-and-drop node placement, snapping logic within 12m, waypoint editing).
* **`NavigationPanel.tsx`:** Floating UI control header. Contains custom searchable dropdowns (`SearchableSelect`), mode toggle buttons (User vs. Admin), login modal trigger, and route output summary bar.
* **`apiClient.ts`:** Utility functions `fetchRouteFromBackend()` and `saveGraphToBackend()`.
* **`aStarRouter.ts` & `dijkstraRouter.ts`:** Standalone client-side implementations of graph algorithms ensuring offline execution support.

---

## 9. Backend Structure

The C++ backend code is organized under `backend/`:

```
backend/
├── CMakeLists.txt           # Build configuration targeting C++20 executable [VERIFIED]
├── main.cpp                 # Binary entry point, graph initialization & benchmark tests [VERIFIED]
├── include/
│   ├── AStarRouter.hpp      # A* search algorithm header [VERIFIED]
│   ├── DijkstraRouter.hpp   # Dijkstra search algorithm header [VERIFIED]
│   ├── Edge.hpp             # Edge and AdjEdge data structures [VERIFIED]
│   ├── Graph.hpp            # Graph class header [VERIFIED]
│   ├── HttpServer.hpp       # Native socket HTTP server header [VERIFIED]
│   ├── IRouteAlgorithm.hpp  # Abstract interface for routing algorithms [VERIFIED]
│   ├── Node.hpp             # Node data structure [VERIFIED]
│   ├── RouteResult.hpp      # Route outcome data structure [VERIFIED]
│   ├── RoutingManager.hpp   # Manager encapsulating primary/secondary routers [VERIFIED]
│   ├── SearchIndex.hpp      # POI search indexing header [VERIFIED]
│   └── SimpleJson.hpp       # Custom lightweight JSON parser header [VERIFIED]
├── src/
│   ├── AStarRouter.cpp      # A* algorithm implementation with Haversine heuristic [VERIFIED]
│   ├── DijkstraRouter.cpp   # Dijkstra algorithm implementation [VERIFIED]
│   ├── Graph.cpp            # Graph dataset loader, BFS component counter & validator [VERIFIED]
│   ├── HttpServer.cpp       # Socket listener loop, HTTP parser & route endpoints [VERIFIED]
│   ├── RoutingManager.cpp   # Execution benchmark & verification manager [VERIFIED]
│   └── SearchIndex.cpp      # POI substring search indexer [VERIFIED]
└── data/
    ├── nodes.json           # 112 graph nodes (52 searchable POIs, 34 hidden junctions) [VERIFIED]
    └── edges.json           # 122 graph edges connecting campus paths [VERIFIED]
```

### Backend Details `[VERIFIED]`
* **No External Web Framework:** Uses standard C++ POSIX socket headers (`<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`).
* **Graph Engine:** Loads dataset files into `std::unordered_map<std::string, Node>` and builds an adjacency list `std::unordered_map<std::string, std::vector<AdjEdge>>`.
* **Validation Engine:** Automatically checks dataset integrity upon boot and after every `/api/save-graph` request.

---

## 10. Database

* **Database Engine:** NONE `[VERIFIED: no SQL/NoSQL database server configured]`.
* **Data Storage Mechanism:** Flat JSON files on disk (`backend/data/nodes.json` and `backend/data/edges.json`) and browser LocalStorage (`lpu_nodes_working_dataset`, `lpu_edges_working_dataset`).

### Verified Node Schema (`nodes.json`) `[VERIFIED]`
```json
{
  "id": "node-1785994418803",
  "name": "Main Gate",
  "category": "POI",
  "type": "entrance",
  "latitude": 31.260506,
  "longitude": 75.706894,
  "isHidden": false
}
```

### Verified Edge Schema (`edges.json`) `[VERIFIED]`
```json
{
  "id": "edge-1785999331093",
  "fromNodeId": "node-1785994418803",
  "toNodeId": "node-nav-1785997637986",
  "geometry": [[31.260506, 75.706894], [31.260433, 75.706876]],
  "distance": 8.1,
  "walkingTime": 5.8,
  "pathType": "road",
  "isBidirectional": true
}
```

---

## 11. APIs and External Services

### 1. OpenStreetMap Tile API `[VERIFIED]`
* **Service:** OpenStreetMap Tile Server (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`).
* **Purpose:** Provides background map tiles for Leaflet rendering centered on LPU.
* **Information Exchanged:** Tile coordinate requests `(x, y, z)` sent; PNG map images returned.

### 2. Custom C++ Backend HTTP API Server `[VERIFIED]`
* **Base URL:** `http://localhost:8080`
* **Endpoints:**

#### Endpoints Summary Table `[VERIFIED]`
| Method | Endpoint | Description | Payload Example | Response Example |
| :--- | :--- | :--- | :--- | :--- |
| `OPTIONS` | `/*` | CORS Preflight Handler | N/A | `HTTP/1.1 200 OK` with CORS headers |
| `POST` | `/api/route` | Compute Shortest Path | `{"startNodeId": "node-1785994418803", "destinationNodeId": "node-1785923336991"}` | `{"found": true, "totalDistance": 301.5, "walkingTime": 215.4, "nodeIds": [...], "geometry": [...]}` |
| `POST` | `/api/save-graph` | Persist & Hot-Reload Graph | `{"nodes": [...], "edges": [...]}` | `{"success": true, "nodes": 112, "edges": 122}` |

---

## 12. Navigation Implementation

Campus navigation is driven by a custom topological graph network (`[VERIFIED: Graph.cpp, AStarRouter.cpp]`):

### 1. Graph Statistics `[VERIFIED]`
* **Total Nodes:** 112
* **Searchable POI Nodes:** 52
* **Hidden Navigation Junction Nodes:** 34
* **Total Edges:** 122
* **Bidirectional Edges:** 122 (100%)
* **Connected Components:** 10
* **Average Node Degree:** 2.18

### 2. A* Routing Algorithm Mechanics `[VERIFIED]`
1. **Heuristic Function:** Uses the Haversine formula to compute great-circle distance between current node coordinates `(lat1, lon1)` and destination node coordinates `(lat2, lon2)` in meters:
   \[
   d = 2R \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)
   \]
   where \( R = 6,371,000 \) meters.
2. **Priority Queue Traversal:** Min-priority queue ordered by \( f(n) = g(n) + h(n) \), where \( g(n) \) is accumulated distance from start and \( h(n) \) is Haversine estimate to destination.
3. **Parent Backtracking:** Maintains a parent lookup map `std::unordered_map<std::string, std::pair<std::string, std::string>>` to reconstruct the exact node and edge sequence.
4. **Polyline Geometry Concatenation:** Merges individual multi-point segment geometries into a continuous coordinate array `[[lat, lng], ...]`, automatically orienting edge directions forward or reverse based on node sequence.

---

## 13. UI Screens

### 1. Main Navigation View `[VERIFIED]`
* **Screen Name:** Main Navigation Screen
* **Location:** `frontend/src/components/MapView.tsx`, `NavigationPanel.tsx`
* **Elements:** Fullscreen Leaflet map, floating top navigation panel, brand title ("LPU Navigator"), start location selector, destination selector, "Navigate" action button, route summary banner (showing distance and walking time), blue polyline route path.

### 2. Admin Graph Editor View `[VERIFIED]`
* **Screen Name:** Admin Graph Editor Screen
* **Location:** `frontend/src/components/MapView.tsx` (unlocked via Admin Mode)
* **Elements:** Admin sidebar panel with live graph statistics, "Add POI Node" button, "Add Nav Node" button, "Connect Edge" tool, line-snapping visual helper, node drag handles, edge waypoint drag handles, "Save Graph to Disk" button.

### 3. Admin Authentication Modal `[VERIFIED]`
* **Screen Name:** Admin Login Modal
* **Location:** `frontend/src/components/NavigationPanel.tsx`
* **Elements:** Modal dialog, username input field, password input field, login button, error banner. (Demo credentials: username `dips006`, password `2222026`).

---

## 14. Important Code Modules

### 1. `backend/src/AStarRouter.cpp` `[VERIFIED]`
* **Purpose:** Core A* pathfinding algorithm implementation.
* **Key Functions:** `haversineDistance()` (computes geographical distance in meters), `findRoute()` (executes priority-queue search, parent backtracking, and polyline orientation merging).

### 2. `backend/src/Graph.cpp` `[VERIFIED]`
* **Purpose:** Graph data structure management and graph dataset validation.
* **Key Functions:** `loadNodes()`, `loadEdges()`, `buildAdjacencyList()`, `validateGraph()` (scans for missing nodes, orphan edges, zero-length edges, long edges >50m), `countConnectedComponents()` (BFS traversal).

### 3. `backend/src/HttpServer.cpp` `[VERIFIED]`
* **Purpose:** Custom socket HTTP web server.
* **Key Functions:** `listenLoop()` (POSIX socket bind/listen on port 8080), `handleClient()` (HTTP request parser & routing API handler), `handleSaveGraph()` (validates, overwrites disk files, and hot-reloads graph data).

### 4. `frontend/src/components/MapView.tsx` `[VERIFIED]`
* **Purpose:** Interactive map view and admin editor (~2950 lines).
* **Key Functions:** Leaflet map rendering, state management for working nodes/edges, snap-to-edge calculation (`findNearestPointOnEdge`), waypoint drag-and-drop handling.

---

## 15. Testing

### 1. Automated Dataset Validation (`Graph::validateGraph()`) `[VERIFIED]`
The C++ backend automatically runs topological graph validation upon startup and after graph saves:
* **Duplicate Check:** Verifies no duplicate node or edge IDs exist.
* **Orphan Check:** Verifies every edge `fromNodeId` and `toNodeId` exists in `nodes.json`.
* **Distance Integrity Check:** Flags edges with zero or negative distances (`distance <= 0.0`).
* **Geometry Quality Check:** Warns on edges longer than 50 meters to encourage waypoint detail.

### 2. Dual-Algorithm Benchmark Verification (`RoutingManager::compareResults()`) `[VERIFIED]`
In dev mode, `RoutingManager` executes both A* and Dijkstra on every query and verifies:
* Distance match within \( 10^{-4} \) meters.
* Traversal node and edge sequence equality.
* **Benchmark Evidence (`main.cpp` demo output):**
  * Start: Main Gate (`node-1785994418803`) ➔ Destination: Uni Health Center (`node-1785923336991`)
  * Dijkstra Time: `0.356 ms` | A* Time: `0.219 ms` (8 nodes expanded)
  * Distance Result: `301.5 meters` (Exact Match Confirmed)

### 3. Missing Testing Frameworks `[VERIFIED]`
No automated unit test frameworks (such as GoogleTest, Catch2, Jest, or Vitest) were found in the codebase.

---

## 16. Deployment

* **Local Environment:** Fully operational. C++ backend compiles via CMake (`lpu_smart_navigator_backend`) and runs on port 8080. Frontend runs via Vite dev server on port 5173/5174 (`[VERIFIED]`).
* **Production Web Deployment:** NOT DEPLOYED / MISSING `[MISSING: no live production URL or deployment configuration files (e.g. Dockerfile, Vercel/Netlify configs) found in workspace]`.

---

## 17. Development Challenges

Based directly on code inspection and project commit structure:

1. **Polyline Geometry Concatenation & Edge Orientation:** Bidirectional edges can be traversed in forward (`from -> to`) or reverse (`to -> from`) order. The router must dynamically invert polyline coordinate arrays during route assembly (`[VERIFIED: AStarRouter.cpp:L181-198]`).
2. **Native C++ POSIX Socket HTTP Server Implementation:** Implementing HTTP request parsing, header construction, CORS preflight (`OPTIONS`), content-length body reading, and multi-part JSON serialization without third-party frameworks like Crow required custom socket handling (`[VERIFIED: HttpServer.cpp]`).
3. **Interactive Line-Snapping in Leaflet:** Projecting mouse coordinates onto multi-point edge line segments in real-time within a 12-meter snap threshold required geometric vector projections (`[VERIFIED: MapView.tsx:L187-215]`).
4. **Dual Execution Fallback:** Synchronizing state interfaces between the C++ backend routing API and the client-side TypeScript routing fallback to ensure seamless user experience (`[VERIFIED: NavigationPanel.tsx:L248-260]`).

---

## 18. Current Limitations

1. **No Real-Time GPS Tracking:** Users must manually select start and destination points from dropdown menus. The app does not auto-detect live device coordinates `[VERIFIED]`.
2. **Simplified Admin Authentication:** Admin login uses hardcoded client-side credentials (`dips006`/`2222026`) without password hashing or server-side JWT authentication `[VERIFIED]`.
3. **Dataset Disconnected Components:** The dataset contains 10 disconnected graph components, meaning certain isolated nodes cannot be navigated to from Main Gate `[VERIFIED: Graph.cpp statistics]`.
4. **Validation Dataset Errors:** Current dataset validation reports 2 edge validation errors due to zero-length edge entries (`distance: 0.0m`) `[VERIFIED: backend startup validation log]`.
5. **No Indoor Multi-Floor Navigation:** Maps are 2D planar top-down overlays. Multi-story block interior floor plans are not modeled `[VERIFIED]`.

---

## 19. Future Scope

The following features represent realistic potential enhancements for future iterations of LPU Pathfinder:

1. **HTML5 Geolocation & Mobile GPS Tracking:** Integrating browser GPS APIs to automatically select user current position as start location.
2. **Turn-by-Turn Voice Navigation:** Adding step-by-step audio instructions using the Web Speech API.
3. **Multi-Floor Indoor Building Maps:** Integrating SVG/CAD floor plan overlays for multi-story academic blocks (e.g., Block 34, Block 38).
4. **PostgreSQL/PostGIS Spatial Database:** Transitioning from flat JSON files to a relational spatial database with spatial indexing (`GEOMETRY` types).
5. **Secure JWT User & Admin Authentication:** Replacing hardcoded admin credentials with hashed password storage (bcrypt) and JWT auth headers.

---

## 20. Missing Information

The following items cannot be determined directly from the codebase and require student input if needed for official university records:

* `[NEED STUDENT INPUT: Exact project start and completion dates / academic semester duration]`
* `[NEED STUDENT INPUT: Academic course code (e.g. CSE450 / Capstone Project ID)]`
* `[NEED STUDENT INPUT: Live hosted URL if published on a domain]`
* `[NEED STUDENT INPUT: User feedback / field survey testing statistics from actual campus users]`
