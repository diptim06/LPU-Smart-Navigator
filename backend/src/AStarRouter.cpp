#include "AStarRouter.hpp"
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

AStarRouter::AStarRouter(const Graph& graph)
    : graph_(graph) {}

double AStarRouter::haversineDistance(double lat1, double lon1, double lat2, double lon2) {
    constexpr double R = 6371000.0; // Radius of earth in meters
    double dLat = (lat2 - lat1) * M_PI / 180.0;
    double dLon = (lon2 - lon1) * M_PI / 180.0;

    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * M_PI / 180.0) * std::cos(lat2 * M_PI / 180.0) *
               std::sin(dLon / 2.0) * std::sin(dLon / 2.0);
    double c = 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
    return R * c;
}

RouteResult AStarRouter::findRoute(
    const std::string& startNodeId,
    const std::string& destinationNodeId
) {
    RouteResult result;
    lastNodesExpanded_ = 0;

    const auto& nodes = graph_.getNodes();
    const auto& adj = graph_.getAdjacencyList();
    const auto& edges = graph_.getEdges();

    // 1. Validation & Edge Cases
    auto startIt = nodes.find(startNodeId);
    auto destIt = nodes.find(destinationNodeId);

    if (startIt == nodes.end() || destIt == nodes.end()) {
        result.found = false;
        return result;
    }

    if (startNodeId == destinationNodeId) {
        result.found = true;
        result.totalDistance = 0.0;
        result.walkingTime = 0.0;
        result.nodeIds = {startNodeId};
        result.edgeIds = {};
        result.geometry = {{startIt->second.latitude, startIt->second.longitude}};
        return result;
    }

    const Node& destNodeObj = destIt->second;

    // Index edges by edge ID for quick geometry lookup
    std::unordered_map<std::string, Edge> edgeMap;
    for (const auto& edge : edges) {
        edgeMap[edge.id] = edge;
    }

    // 2. A* Priority Queue Data Structures
    // Min Priority Queue storing pair<fScore, nodeId>
    using Element = std::pair<double, std::string>;
    std::priority_queue<Element, std::vector<Element>, std::greater<Element>> pq;

    std::unordered_map<std::string, double> gScoreMap;
    std::unordered_map<std::string, std::pair<std::string, std::string>> parentMap; // nodeId -> (edgeId, parentNodeId)
    std::unordered_set<std::string> visited;

    gScoreMap[startNodeId] = 0.0;
    double hStart = haversineDistance(startIt->second.latitude, startIt->second.longitude,
                                      destNodeObj.latitude, destNodeObj.longitude);
    pq.push({hStart, startNodeId});

    bool reachedDestination = false;

    // 3. Main A* Traversal Loop
    while (!pq.empty()) {
        auto [currentFScore, currNode] = pq.top();
        pq.pop();

        if (visited.count(currNode)) continue;
        visited.insert(currNode);
        lastNodesExpanded_++;

        if (currNode == destinationNodeId) {
            reachedDestination = true;
            break;
        }

        double currentGScore = gScoreMap[currNode];
        auto adjIt = adj.find(currNode);
        if (adjIt == adj.end()) continue;

        for (const auto& neighbor : adjIt->second) {
            if (visited.count(neighbor.toNodeId)) continue;

            double tentativeG = currentGScore + neighbor.distance;
            auto gIt = gScoreMap.find(neighbor.toNodeId);

            if (gIt == gScoreMap.end() || tentativeG < gIt->second) {
                gScoreMap[neighbor.toNodeId] = tentativeG;
                parentMap[neighbor.toNodeId] = {neighbor.edgeId, currNode};

                auto nIt = nodes.find(neighbor.toNodeId);
                double h = 0.0;
                if (nIt != nodes.end()) {
                    h = haversineDistance(nIt->second.latitude, nIt->second.longitude,
                                          destNodeObj.latitude, destNodeObj.longitude);
                }

                double fScore = tentativeG + h;
                pq.push({fScore, neighbor.toNodeId});
            }
        }
    }

    if (!reachedDestination) {
        result.found = false;
        return result;
    }

    // 4. Backtrack Parent Map to Reconstruct Path
    std::vector<std::string> revNodeIds;
    std::vector<std::string> revEdgeIds;

    std::string curr = destinationNodeId;
    revNodeIds.push_back(curr);

    while (curr != startNodeId) {
        auto pIt = parentMap.find(curr);
        if (pIt == parentMap.end()) break;

        const auto& [edgeId, parentNodeId] = pIt->second;
        revEdgeIds.push_back(edgeId);
        revNodeIds.push_back(parentNodeId);
        curr = parentNodeId;
    }

    std::reverse(revNodeIds.begin(), revNodeIds.end());
    std::reverse(revEdgeIds.begin(), revEdgeIds.end());

    result.found = true;
    result.totalDistance = gScoreMap[destinationNodeId];
    result.walkingTime = std::round((result.totalDistance / 1.4) * 10.0) / 10.0;
    result.nodeIds = revNodeIds;
    result.edgeIds = revEdgeIds;

    // 5. Merge Traversed Edge Geometries into One Continuous Polyline
    std::vector<std::pair<double, double>> continuousGeometry;

    for (size_t i = 0; i < revEdgeIds.size(); ++i) {
        const std::string& edgeId = revEdgeIds[i];
        const std::string& fromId = revNodeIds[i];
        const std::string& toId = revNodeIds[i + 1];

        auto eIt = edgeMap.find(edgeId);
        if (eIt == edgeMap.end()) continue;

        const Edge& edgeObj = eIt->second;
        std::vector<std::pair<double, double>> segGeom;

        if (edgeObj.geometry.size() >= 2) {
            segGeom = edgeObj.geometry;
        } else {
            auto fromNodeIt = nodes.find(fromId);
            auto toNodeIt = nodes.find(toId);
            if (fromNodeIt != nodes.end() && toNodeIt != nodes.end()) {
                segGeom = {
                    {fromNodeIt->second.latitude, fromNodeIt->second.longitude},
                    {toNodeIt->second.latitude, toNodeIt->second.longitude}
                };
            }
        }

        // Determine orientation
        bool isForward = true;
        if (!segGeom.empty()) {
            auto fromNodeIt = nodes.find(fromId);
            if (fromNodeIt != nodes.end()) {
                double dStart = std::hypot(segGeom.front().first - fromNodeIt->second.latitude,
                                           segGeom.front().second - fromNodeIt->second.longitude);
                double dEnd = std::hypot(segGeom.back().first - fromNodeIt->second.latitude,
                                         segGeom.back().second - fromNodeIt->second.longitude);
                if (dEnd < dStart) {
                    isForward = false;
                }
            }
        }

        if (!isForward) {
            std::reverse(segGeom.begin(), segGeom.end());
        }

        for (const auto& pt : segGeom) {
            if (continuousGeometry.empty()) {
                continuousGeometry.push_back(pt);
            } else {
                const auto& lastPt = continuousGeometry.back();
                if (std::abs(lastPt.first - pt.first) > 1e-6 || std::abs(lastPt.second - pt.second) > 1e-6) {
                    continuousGeometry.push_back(pt);
                }
            }
        }
    }

    result.geometry = continuousGeometry;
    return result;
}
