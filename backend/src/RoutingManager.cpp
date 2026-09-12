#include "RoutingManager.hpp"
#include <chrono>
#include <iostream>
#include <iomanip>
#include <cmath>

using namespace std;

RoutingManager::RoutingManager(const Graph& graph)
    : graph_(graph),
      dijkstraRouter_(graph),
      aStarRouter_(graph) {}

RouteResult RoutingManager::findRoute(
    const string& startNodeId,
    const string& destinationNodeId
) {
    if (debugVerificationMode_) {
        auto t1 = chrono::high_resolution_clock::now();
        RouteResult dResult = dijkstraRouter_.findRoute(startNodeId, destinationNodeId);
        auto t2 = chrono::high_resolution_clock::now();
        double dTimeMs = chrono::duration<double, milli>(t2 - t1).count();

        auto t3 = chrono::high_resolution_clock::now();
        RouteResult aResult = aStarRouter_.findRoute(startNodeId, destinationNodeId);
        auto t4 = chrono::high_resolution_clock::now();
        double aTimeMs = chrono::duration<double, milli>(t4 - t3).count();

        compareResults(startNodeId, destinationNodeId, dResult, aResult, dTimeMs, aTimeMs);

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
                0,
                dResult.totalDistance,
                dResult.walkingTime,
                dTimeMs
            };
            return dResult;
        }
    }

    auto startT = chrono::high_resolution_clock::now();
    RouteResult primaryResult;

    if (primaryType_ == RoutingAlgorithmType::ASTAR) {
        primaryResult = aStarRouter_.findRoute(startNodeId, destinationNodeId);
        auto endT = chrono::high_resolution_clock::now();
        double ms = chrono::duration<double, milli>(endT - startT).count();
        lastStats_ = {
            "A* Search",
            aStarRouter_.getLastNodesExpanded(),
            primaryResult.totalDistance,
            primaryResult.walkingTime,
            ms
        };
    } else {
        primaryResult = dijkstraRouter_.findRoute(startNodeId, destinationNodeId);
        auto endT = chrono::high_resolution_clock::now();
        double ms = chrono::duration<double, milli>(endT - startT).count();
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
    const string& startNodeId,
    const string& destNodeId,
    const RouteResult& dijkstraRes,
    const RouteResult& aStarRes,
    double dijkstraTimeMs,
    double aStarTimeMs
) const {
    cout << "\n[Routing Verification]" << endl;
    cout << "Route: " << startNodeId << " -> " << destNodeId << endl;

    if (dijkstraRes.found != aStarRes.found) {
        cout << "Warning: Route existence mismatch between Dijkstra and A*." << endl;
        return;
    }

    if (!dijkstraRes.found && !aStarRes.found) {
        cout << "No route found." << endl;
        return;
    }

    double distDiff = abs(dijkstraRes.totalDistance - aStarRes.totalDistance);

    cout << fixed << setprecision(3);
    cout << "Dijkstra: " << dijkstraRes.totalDistance << " m (" << dijkstraTimeMs << " ms)" << endl;
    cout << "A*: " << aStarRes.totalDistance << " m (" << aStarTimeMs << " ms)" << endl;

    if (distDiff > 1e-4) {
        cout << "Warning: Distance mismatch (" << distDiff << " m)" << endl;
    }
}
