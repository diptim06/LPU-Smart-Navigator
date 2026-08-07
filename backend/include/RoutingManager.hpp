#pragma once

#include "IRouteAlgorithm.hpp"
#include "DijkstraRouter.hpp"
#include "AStarRouter.hpp"
#include "Graph.hpp"
#include <memory>
#include <string>

enum class RoutingAlgorithmType {
    ASTAR,
    DIJKSTRA
};

struct RoutingStats {
    std::string algorithmName;
    size_t nodesExpanded{0};
    double totalDistance{0.0};
    double walkingTime{0.0};
    double executionTimeMs{0.0};
};

class RoutingManager {
public:
    explicit RoutingManager(const Graph& graph);

    // Primary route resolution method for clients
    RouteResult findRoute(
        const std::string& startNodeId,
        const std::string& destinationNodeId
    );

    void setPrimaryAlgorithm(RoutingAlgorithmType type) { primaryType_ = type; }
    void setDebugVerificationMode(bool enable) { debugVerificationMode_ = enable; }

    const RoutingStats& getLastStats() const { return lastStats_; }

private:
    const Graph& graph_;
    DijkstraRouter dijkstraRouter_;
    AStarRouter aStarRouter_;

    RoutingAlgorithmType primaryType_{RoutingAlgorithmType::ASTAR};
    bool debugVerificationMode_{true};
    RoutingStats lastStats_;

    void compareResults(
        const std::string& startNodeId,
        const std::string& destNodeId,
        const RouteResult& dijkstraRes,
        const RouteResult& aStarRes,
        double dijkstraTimeMs,
        double aStarTimeMs
    ) const;
};
