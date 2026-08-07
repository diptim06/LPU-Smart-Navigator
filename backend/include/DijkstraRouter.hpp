#pragma once

#include "IRouteAlgorithm.hpp"
#include "Graph.hpp"

class DijkstraRouter : public IRouteAlgorithm {
public:
    explicit DijkstraRouter(const Graph& graph);
    ~DijkstraRouter() override = default;

    RouteResult findRoute(
        const std::string& startNodeId,
        const std::string& destinationNodeId
    ) override;

private:
    const Graph& graph_;
};
