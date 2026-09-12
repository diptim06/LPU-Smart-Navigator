#include "Graph.hpp"
#include "SearchIndex.hpp"
#include "RoutingManager.hpp"
#include "HttpServer.hpp"
#include <iostream>
#include <iomanip>

using namespace std;

void runRoutingDemo(
    RoutingManager& manager,
    const Graph& graph,
    const string& startId,
    const string& destId,
    const string& testTitle
) {
    cout << "\n--- Demo Route: " << testTitle << " ---" << endl;

    auto startNodeOpt = graph.findNodeById(startId);
    auto destNodeOpt = graph.findNodeById(destId);

    string startName = startNodeOpt ? startNodeOpt->name : ("Unknown (" + startId + ")");
    string destName = destNodeOpt ? destNodeOpt->name : ("Unknown (" + destId + ")");

    cout << "Start: " << startName << " [" << startId << "]" << endl;
    cout << "Dest : " << destName << " [" << destId << "]" << endl;

    RouteResult result = manager.findRoute(startId, destId);
    const auto& stats = manager.getLastStats();

    if (result.found) {
        cout << "Algorithm  : " << stats.algorithmName << endl;
        cout << "Expanded   : " << stats.nodesExpanded << " nodes" << endl;
        cout << fixed << setprecision(1);
        cout << "Distance   : " << result.totalDistance << " m" << endl;
        cout << "Walk Time  : " << result.walkingTime << " s" << endl;
        cout << setprecision(3);
        cout << "Time       : " << stats.executionTimeMs << " ms" << endl;
        cout << "Path Nodes : " << result.nodeIds.size() << endl;
    } else {
        cout << "Status     : No route found" << endl;
    }
}

int main() {
    cout << "LPU Smart Navigator Engine" << endl;

    Graph campusGraph;

    bool nodesLoaded = campusGraph.loadNodes("data/nodes.json");
    bool edgesLoaded = campusGraph.loadEdges("data/edges.json");

    if (!nodesLoaded || !edgesLoaded) {
        cerr << "Failed to load dataset files." << endl;
        return 1;
    }

    campusGraph.validateGraph();
    campusGraph.printStatistics();

    SearchIndex searchEngine;
    searchEngine.buildIndex(campusGraph);

    RoutingManager routingManager(campusGraph);
    routingManager.setPrimaryAlgorithm(RoutingAlgorithmType::ASTAR);
    routingManager.setDebugVerificationMode(true);

    runRoutingDemo(
        routingManager,
        campusGraph,
        "node-1785994418803",
        "node-1785923336991",
        "Main Gate -> Uni Health Center"
    );

    HttpServer server(campusGraph, searchEngine, routingManager, 8080);
    server.start();

    return 0;
}
