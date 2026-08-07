#pragma once

#include "RouteResult.hpp"
#include <string>

class IRouteAlgorithm
{
public:
    virtual ~IRouteAlgorithm() = default;
    virtual RouteResult findRoute(
        const std::string& startNodeId,
        const std::string& destinationNodeId
    ) = 0;
};
