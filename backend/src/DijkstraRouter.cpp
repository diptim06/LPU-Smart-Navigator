#include "DijkstraRouter.hpp"
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cmath>

DijkstraRouter::DijkstraRouter(const Graph& graph)
    : graph_(graph) {}

RouteResult DijkstraRouter::findRoute(
    const std::string& startNodeId,
    const std::string& destinationNodeId
) {
    RouteResult result;
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

    // Index edges by edge ID for quick geometry lookup
    std::unordered_map<std::string, Edge> edgeMap;
    for (const auto& edge : edges) {
        edgeMap[edge.id] = edge;
    }

    // 2. Dijkstra Min-Heap Data Structures
    // Min Priority Queue storing pair<distance, nodeId>
    using Element = std::pair<double, std::string>;
    std::priority_queue<Element, std::vector<Element>, std::greater<Element>> pq;

    std::unordered_map<std::string, double> distMap;
    // parentMap: nodeId -> pair<parent edgeId, parent nodeId>
    std::unordered_map<std::string, std::pair<std::string, std::string>> parentMap;
    std::unordered_set<std::string> visited;

    distMap[startNodeId] = 0.0;
    pq.push({0.0, startNodeId});

    // 3. Main Dijkstra Traversal Loop
    bool reachedDestination = false;

    while (!pq.empty()) {
        auto [currentDist, currNode] = pq.top();
        pq.pop();

        if (visited.count(currNode)) continue;
        visited.insert(currNode);

        if (currNode == destinationNodeId) {
            reachedDestination = true;
            break;
        }

        auto adjIt = adj.find(currNode);
        if (adjIt == adj.end()) continue;

        for (const auto& neighbor : adjIt->second) {
            if (visited.count(neighbor.toNodeId)) continue;

            double newDist = currentDist + neighbor.distance;
            auto distIt = distMap.find(neighbor.toNodeId);

            if (distIt == distMap.end() || newDist < distIt->second) {
                distMap[neighbor.toNodeId] = newDist;
                parentMap[neighbor.toNodeId] = {neighbor.edgeId, currNode};
                pq.push({newDist, neighbor.toNodeId});
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
    result.totalDistance = distMap[destinationNodeId];
    // Walking time at 1.4 m/s
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

        // Determine orientation: does segGeom start at fromId or toId?
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
                // Avoid pushing identical duplicate adjacent points
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
