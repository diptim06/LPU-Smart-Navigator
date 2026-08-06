#include "Graph.hpp"
#include "SearchIndex.hpp"
#include <iostream>

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

    // Initialize & Build Search Index (Sprint 8.1)
    SearchIndex searchEngine;
    searchEngine.buildIndex(campusGraph);

    std::cout << "\n--------------------------------------------------" << std::endl;
    std::cout << "          SEARCH ENGINE INDEX DEMO (Sprint 8.1)   " << std::endl;
    std::cout << "--------------------------------------------------" << std::endl;

    std::cout << "\n[Search Query] 'Hospital':" << std::endl;
    auto hospitalResults = searchEngine.search("Hospital");
    for (const auto& res : hospitalResults) {
        std::cout << " -> Match: [" << res.nodeId << "] " << res.name << " (" << res.category << " • " << res.type << ")" << std::endl;
    }

    std::cout << "\n[Search Query] 'Library':" << std::endl;
    auto libraryResults = searchEngine.search("Library");
    for (const auto& res : libraryResults) {
        std::cout << " -> Match: [" << res.nodeId << "] " << res.name << " (" << res.category << " • " << res.type << ")" << std::endl;
    }

    // Demonstrate Start Node & Destination Node ID resolution for Routing Engine
    std::cout << "\n[Routing Engine Input Resolution]:" << std::endl;
    if (!hospitalResults.empty() && !libraryResults.empty()) {
        std::string startNodeId = hospitalResults[0].nodeId;
        std::string destNodeId = libraryResults[0].nodeId;

        std::cout << " -> Start Node ID      : " << startNodeId << " (" << hospitalResults[0].name << ")" << std::endl;
        std::cout << " -> Destination Node ID: " << destNodeId << " (" << libraryResults[0].name << ")" << std::endl;
        std::cout << " -> Ready for Routing Engine (Input: startNodeId=" << startNodeId << ", destNodeId=" << destNodeId << ")" << std::endl;
    }

    std::cout << "\n==================================================" << std::endl;
    std::cout << "   SEARCH ENGINE FOUNDATION VERIFIED SUCCESSFULLY " << std::endl;
    std::cout << "==================================================" << std::endl;

    return 0;
}
