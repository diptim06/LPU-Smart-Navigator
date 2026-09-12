#include "DijkstraRouter.hpp"
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cmath>

using namespace std;

DijkstraRouter::DijkstraRouter(const Graph& graph)
    : graph_(graph) {}

RouteResult DijkstraRouter::findRoute(
    const string& startNodeId,
    const string& destinationNodeId
) {
    RouteResult result;
    const auto& nodes = graph_.getNodes();
    const auto& adj = graph_.getAdjacencyList();
    const auto& edges = graph_.getEdges();

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

    unordered_map<string, Edge> edgeMap;
    for (const auto& edge : edges) {
        edgeMap[edge.id] = edge;
    }

    using Element = pair<double, string>;
    priority_queue<Element, vector<Element>, greater<Element>> pq;

    unordered_map<string, double> distMap;
    unordered_map<string, pair<string, string>> parentMap;
    unordered_set<string> visited;

    distMap[startNodeId] = 0.0;
    pq.push({0.0, startNodeId});

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

    vector<string> revNodeIds;
    vector<string> revEdgeIds;

    string curr = destinationNodeId;
    revNodeIds.push_back(curr);

    while (curr != startNodeId) {
        auto pIt = parentMap.find(curr);
        if (pIt == parentMap.end()) break;

        const auto& [edgeId, parentNodeId] = pIt->second;
        revEdgeIds.push_back(edgeId);
        revNodeIds.push_back(parentNodeId);
        curr = parentNodeId;
    }

    reverse(revNodeIds.begin(), revNodeIds.end());
    reverse(revEdgeIds.begin(), revEdgeIds.end());

    result.found = true;
    result.totalDistance = distMap[destinationNodeId];
    result.walkingTime = round((result.totalDistance / 1.4) * 10.0) / 10.0;
    result.nodeIds = revNodeIds;
    result.edgeIds = revEdgeIds;

    vector<pair<double, double>> continuousGeometry;

    for (size_t i = 0; i < revEdgeIds.size(); ++i) {
        const string& edgeId = revEdgeIds[i];
        const string& fromId = revNodeIds[i];
        const string& toId = revNodeIds[i + 1];

        auto eIt = edgeMap.find(edgeId);
        if (eIt == edgeMap.end()) continue;

        const Edge& edgeObj = eIt->second;
        vector<pair<double, double>> segGeom;

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

        bool isForward = true;
        if (!segGeom.empty()) {
            auto fromNodeIt = nodes.find(fromId);
            if (fromNodeIt != nodes.end()) {
                double dStart = hypot(segGeom.front().first - fromNodeIt->second.latitude,
                                      segGeom.front().second - fromNodeIt->second.longitude);
                double dEnd = hypot(segGeom.back().first - fromNodeIt->second.latitude,
                                    segGeom.back().second - fromNodeIt->second.longitude);
                if (dEnd < dStart) {
                    isForward = false;
                }
            }
        }

        if (!isForward) {
            reverse(segGeom.begin(), segGeom.end());
        }

        for (const auto& pt : segGeom) {
            if (continuousGeometry.empty()) {
                continuousGeometry.push_back(pt);
            } else {
                const auto& lastPt = continuousGeometry.back();
                if (abs(lastPt.first - pt.first) > 1e-6 || abs(lastPt.second - pt.second) > 1e-6) {
                    continuousGeometry.push_back(pt);
                }
            }
        }
    }

    result.geometry = continuousGeometry;
    return result;
}
