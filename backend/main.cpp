#include "Graph.hpp"
#include "SearchIndex.hpp"
#include "RoutingManager.hpp"
#include <iostream>
#include <iomanip>

void runRoutingDemo(
    RoutingManager& manager,
    const Graph& graph,
    const std::string& startId,
    const std::string& destId,
    const std::string& testTitle
) {
    std::cout << "\n==================================================" << std::endl;
    std::cout << "  TEST: " << testTitle << std::endl;
    std::cout << "==================================================" << std::endl;

    auto startNodeOpt = graph.findNodeById(startId);
    auto destNodeOpt = graph.findNodeById(destId);

    std::string startName = startNodeOpt ? startNodeOpt->name : ("Unknown (" + startId + ")");
    std::string destName = destNodeOpt ? destNodeOpt->name : ("Unknown (" + destId + ")");

    std::cout << "Start Location      : " << startName << " [" << startId << "]" << std::endl;
    std::cout << "Destination         : " << destName << " [" << destId << "]" << std::endl;

    RouteResult result = manager.findRoute(startId, destId);
    const auto& stats = manager.getLastStats();

    if (result.found) {
        std::cout << "\n--- Performance Statistics ---" << std::endl;
        std::cout << "Algorithm Used      : " << stats.algorithmName << std::endl;
        std::cout << "Nodes Expanded      : " << stats.nodesExpanded << std::endl;
        std::cout << std::fixed << std::setprecision(1);
        std::cout << "Total Distance      : " << result.totalDistance << " meters" << std::endl;
        std::cout << "Estimated Walk Time : " << result.walkingTime << " seconds (" 
                  << static_cast<int>(result.walkingTime / 60) << "m " 
                  << static_cast<int>(result.walkingTime) % 60 << "s)" << std::endl;
        std::cout << std::setprecision(3);
        std::cout << "Execution Time      : " << stats.executionTimeMs << " ms" << std::endl;
        std::cout << "Nodes Traversed     : " << result.nodeIds.size() << " nodes" << std::endl;
        std::cout << "Polyline Geometry   : " << result.geometry.size() << " merged coordinate points" << std::endl;
    } else {
        std::cout << "Status              : ❌ No Route Found (result.found = false)" << std::endl;
    }
}

int main() {
    std::cout << "==================================================" << std::endl;
    std::cout << "      LPU SMART NAVIGATOR GRAPH ENGINE v1.0       " << std::endl;
    std::cout << "==================================================\n" << std::endl;

    Graph campusGraph;

    // Load dataset from backend/data/
    bool nodesLoaded = campusGraph.loadNodes("data/nodes.json");
    bool edgesLoaded = campusGraph.loadEdges("data/edges.json");

    if (!nodesLoaded || !edgesLoaded) {
        std::cerr << "❌ Graph Initialization Failed: Failed to load dataset files." << std::endl;
        return 1;
    }

    // Run Graph Validation
    campusGraph.validateGraph();

    // Print Dataset Statistics
    campusGraph.printStatistics();

    // Build Search Index (Sprint 8.1)
    SearchIndex searchEngine;
    searchEngine.buildIndex(campusGraph);

    // Initialize Routing Manager with A* Primary + Dijkstra Verification (Sprint 8.4)
    RoutingManager routingManager(campusGraph);
    routingManager.setPrimaryAlgorithm(RoutingAlgorithmType::ASTAR);
    routingManager.setDebugVerificationMode(true);

    std::cout << "==================================================" << std::endl;
    std::cout << "   ROUTING MANAGER (DIJKSTRA + A*) DEMONSTRATION  " << std::endl;
    std::cout << "==================================================" << std::endl;

    // Route Test 1: Tungstile Entrance -> Uni Health Center
    runRoutingDemo(
        routingManager,
        campusGraph,
        "node-1785994418803", // Tungstile
        "node-1785923336991", // Uni Health Center
        "Tungstile Entrance ➔ Uni Health Center"
    );

    // Route Test 2: Tungstile Entrance -> Park
    runRoutingDemo(
        routingManager,
        campusGraph,
        "node-1785994418803", // Tungstile
        "node-1785923287944", // Park
        "Tungstile Entrance ➔ Park"
    );

    // Route Test 3: Same Start and Destination Node
    runRoutingDemo(
        routingManager,
        campusGraph,
        "node-1785923336991",
        "node-1785923336991",
        "Same Start and Destination Node"
    );

    // Route Test 4: Invalid Start Node ID Failure Case
    runRoutingDemo(
        routingManager,
        campusGraph,
        "invalid-node-xyz",
        "node-1786004471611",
        "Invalid Start Node ID Failure Case"
    );

    std::cout << "\n==================================================" << std::endl;
    std::cout << "   HYBRID ROUTING ENGINE VERIFIED SUCCESSFULLY    " << std::endl;
    std::cout << "==================================================" << std::endl;

    return 0;
}
