#include "RoutingManager.hpp"
#include <chrono>
#include <iostream>
#include <iomanip>
#include <cmath>

RoutingManager::RoutingManager(const Graph& graph)
    : graph_(graph),
      dijkstraRouter_(graph),
      aStarRouter_(graph) {}

RouteResult RoutingManager::findRoute(
    const std::string& startNodeId,
    const std::string& destinationNodeId
) {
    if (debugVerificationMode_) {
        // Measure Dijkstra execution
        auto t1 = std::chrono::high_resolution_clock::now();
        RouteResult dResult = dijkstraRouter_.findRoute(startNodeId, destinationNodeId);
        auto t2 = std::chrono::high_resolution_clock::now();
        double dTimeMs = std::chrono::duration<double, std::milli>(t2 - t1).count();

        // Measure A* execution
        auto t3 = std::chrono::high_resolution_clock::now();
        RouteResult aResult = aStarRouter_.findRoute(startNodeId, destinationNodeId);
        auto t4 = std::chrono::high_resolution_clock::now();
        double aTimeMs = std::chrono::duration<double, std::milli>(t4 - t3).count();

        // Compare Dijkstra vs A*
        compareResults(startNodeId, destinationNodeId, dResult, aResult, dTimeMs, aTimeMs);

        // Record statistics for selected primary algorithm
        if (primaryType_ == RoutingAlgorithmType::ASTAR) {
            lastStats_ = {
                "A* Search",
                aStarRouter_.getLastNodesExpanded(),
                aResult.totalDistance,
                aResult.walkingTime,
                aTimeMs
            };
            return aResult;
        } else {
            lastStats_ = {
                "Dijkstra",
                0, // Dijkstra doesn't track nodes expanded
                dResult.totalDistance,
                dResult.walkingTime,
                dTimeMs
            };
            return dResult;
        }
    }

    // Production Mode: Execute only primary algorithm
    auto startT = std::chrono::high_resolution_clock::now();
    RouteResult primaryResult;

    if (primaryType_ == RoutingAlgorithmType::ASTAR) {
        primaryResult = aStarRouter_.findRoute(startNodeId, destinationNodeId);
        auto endT = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(endT - startT).count();
        lastStats_ = {
            "A* Search",
            aStarRouter_.getLastNodesExpanded(),
            primaryResult.totalDistance,
            primaryResult.walkingTime,
            ms
        };
    } else {
        primaryResult = dijkstraRouter_.findRoute(startNodeId, destinationNodeId);
        auto endT = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(endT - startT).count();
        lastStats_ = {
            "Dijkstra",
            0,
            primaryResult.totalDistance,
            primaryResult.walkingTime,
            ms
        };
    }

    return primaryResult;
}

void RoutingManager::compareResults(
    const std::string& startNodeId,
    const std::string& destNodeId,
    const RouteResult& dijkstraRes,
    const RouteResult& aStarRes,
    double dijkstraTimeMs,
    double aStarTimeMs
) const {
    std::cout << "\n[RoutingManager Dev Verification Mode]" << std::endl;
    std::cout << "Query: " << startNodeId << " ➔ " << destNodeId << std::endl;

    if (dijkstraRes.found != aStarRes.found) {
        std::cout << "⚠️ WARNING: Route existence mismatch! Dijkstra found=" 
                  << dijkstraRes.found << ", A* found=" << aStarRes.found << std::endl;
        return;
    }

    if (!dijkstraRes.found && !aStarRes.found) {
        std::cout << " -> Both Dijkstra and A* confirmed: No Route Exists." << std::endl;
        return;
    }

    double distDiff = std::abs(dijkstraRes.totalDistance - aStarRes.totalDistance);
    bool nodeMatch = (dijkstraRes.nodeIds == aStarRes.nodeIds);
    bool edgeMatch = (dijkstraRes.edgeIds == aStarRes.edgeIds);

    std::cout << std::fixed << std::setprecision(3);
    std::cout << " -> Dijkstra Distance : " << dijkstraRes.totalDistance << " m (" << dijkstraTimeMs << " ms)" << std::endl;
    std::cout << " -> A* Distance       : " << aStarRes.totalDistance << " m (" << aStarTimeMs << " ms, " 
              << aStarRouter_.getLastNodesExpanded() << " nodes expanded)" << std::endl;

    if (distDiff <= 1e-4) {
        std::cout << " ✅ MATCH CONFIRMED: A* and Dijkstra produced identical optimal distance (" << dijkstraRes.totalDistance << " m)." << std::endl;
    } else {
        std::cout << " ⚠️ WARNING: Distance mismatch! Difference: " << distDiff << " m" << std::endl;
    }

    if (nodeMatch && edgeMatch) {
        std::cout << " ✅ MATCH CONFIRMED: Identical node & edge traversal sequences." << std::endl;
    } else if (!nodeMatch) {
        std::cout << " ℹ️ Note: Equal-cost path with alternative node sequence detected." << std::endl;
    }
}
