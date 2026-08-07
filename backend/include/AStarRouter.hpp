#pragma once

#include "IRouteAlgorithm.hpp"
#include "Graph.hpp"

class AStarRouter : public IRouteAlgorithm {
public:
    explicit AStarRouter(const Graph& graph);
    ~AStarRouter() override = default;

    RouteResult findRoute(
        const std::string& startNodeId,
        const std::string& destinationNodeId
    ) override;

    size_t getLastNodesExpanded() const { return lastNodesExpanded_; }

private:
    const Graph& graph_;
    size_t lastNodesExpanded_{0};

    static double haversineDistance(double lat1, double lon1, double lat2, double lon2);
};
