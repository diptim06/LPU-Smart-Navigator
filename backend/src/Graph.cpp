#include "Graph.hpp"
#include "SimpleJson.hpp"
#include <unordered_set>
#include <queue>
#include <algorithm>
#include <iomanip>
#include <cctype>

static std::string toLower(const std::string& str) {
    std::string lower = str;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return lower;
}

bool Graph::loadNodes(const std::string& filepath) {
    try {
        std::string jsonStr = SimpleJson::readFile(filepath);
        std::vector<Node> loadedNodes = SimpleJson::parseNodes(jsonStr);

        nodesMap_.clear();
        validationErrors_.clear();
        validationWarnings_.clear();

        std::unordered_set<std::string> seenIds;
        for (const auto& node : loadedNodes) {
            if (seenIds.find(node.id) != seenIds.end()) {
                validationErrors_.push_back("Validation Error: Duplicate Node ID detected -> '" + node.id + "'");
            } else {
                seenIds.insert(node.id);
                nodesMap_[node.id] = node;
            }
        }

        std::cout << "[Graph Engine] Successfully parsed " << nodesMap_.size() << " nodes from " << filepath << std::endl;
        return true;
    } catch (const std::exception& ex) {
        std::cerr << "[Graph Engine Error] Failed to load nodes: " << ex.what() << std::endl;
        return false;
    }
}

bool Graph::loadEdges(const std::string& filepath) {
    try {
        std::string jsonStr = SimpleJson::readFile(filepath);
        edgesList_ = SimpleJson::parseEdges(jsonStr);

        std::unordered_set<std::string> seenEdgeIds;
        for (auto& edge : edgesList_) {
            if (seenEdgeIds.find(edge.id) != seenEdgeIds.end()) {
                validationErrors_.push_back("Validation Error: Duplicate Edge ID detected -> '" + edge.id + "'");
            } else {
                seenEdgeIds.insert(edge.id);
            }

            // Ensure geometry is never empty (populate at least fromNode and toNode endpoints)
            if (edge.geometry.empty() || edge.geometry.size() < 2) {
                auto fromIt = nodesMap_.find(edge.fromNodeId);
                auto toIt = nodesMap_.find(edge.toNodeId);
                if (fromIt != nodesMap_.end() && toIt != nodesMap_.end()) {
                    edge.geometry = {
                        {fromIt->second.latitude, fromIt->second.longitude},
                        {toIt->second.latitude, toIt->second.longitude}
                    };
                }
            }
        }

        buildAdjacencyList();
        std::cout << "[Graph Engine] Successfully parsed " << edgesList_.size() << " edges from " << filepath << std::endl;
        return true;
    } catch (const std::exception& ex) {
        std::cerr << "[Graph Engine Error] Failed to load edges: " << ex.what() << std::endl;
        return false;
    }
}

void Graph::buildAdjacencyList() {
    adjList_.clear();

    // Ensure entry for all known nodes
    for (const auto& [nodeId, node] : nodesMap_) {
        adjList_[nodeId] = std::vector<AdjEdge>();
    }

    for (const auto& edge : edgesList_) {
        // Forward edge: fromNodeId -> toNodeId
        AdjEdge forwardEdge{
            edge.toNodeId,
            edge.id,
            edge.distance,
            edge.walkingTime,
            edge.pathType,
            edge.isBidirectional
        };
        adjList_[edge.fromNodeId].push_back(forwardEdge);

        // Reverse edge if bidirectional: toNodeId -> fromNodeId
        if (edge.isBidirectional) {
            AdjEdge reverseEdge{
                edge.fromNodeId,
                edge.id,
                edge.distance,
                edge.walkingTime,
                edge.pathType,
                edge.isBidirectional
            };
            adjList_[edge.toNodeId].push_back(reverseEdge);
        }
    }
}

bool Graph::validateGraph() const {
    bool isValid = true;
    std::cout << "\n--------------------------------------------------" << std::endl;
    std::cout << "               GRAPH VALIDATION REPORT            " << std::endl;
    std::cout << "--------------------------------------------------" << std::endl;

    for (const auto& err : validationErrors_) {
        std::cout << "❌ " << err << std::endl;
        isValid = false;
    }

    int missingNodeRefs = 0;
    int zeroLengthEdges = 0;
    int longEdgeWarnings = 0;
    int invalidGeometries = 0;
    int orphanEdges = 0;

    for (const auto& edge : edgesList_) {
        bool fromExists = nodesMap_.find(edge.fromNodeId) != nodesMap_.end();
        bool toExists = nodesMap_.find(edge.toNodeId) != nodesMap_.end();

        if (!fromExists) {
            std::cout << "❌ Validation Error: Edge '" << edge.id << "' references missing fromNodeId '" << edge.fromNodeId << "'" << std::endl;
            missingNodeRefs++;
            isValid = false;
        }

        if (!toExists) {
            std::cout << "❌ Validation Error: Edge '" << edge.id << "' references missing toNodeId '" << edge.toNodeId << "'" << std::endl;
            missingNodeRefs++;
            isValid = false;
        }

        if (!fromExists || !toExists) {
            orphanEdges++;
        }

        if (edge.distance <= 0.0) {
            std::cout << "❌ Validation Error: Edge '" << edge.id << "' (" << edge.fromNodeId << " -> " << edge.toNodeId << ") has zero or negative distance: " << edge.distance << "m" << std::endl;
            zeroLengthEdges++;
            isValid = false;
        }

        if (edge.distance > 50.0) {
            std::cout << "⚠️  Validation Warning: Edge '" << edge.id << "' (" << edge.fromNodeId << " -> " << edge.toNodeId << ") exceeds 50 meters (distance: " << std::fixed << std::setprecision(1) << edge.distance << "m). Consider adding intermediate waypoints/nodes for geometry precision." << std::endl;
            longEdgeWarnings++;
        }

        if (edge.geometry.size() < 2) {
            std::cout << "⚠️  Validation Warning: Edge '" << edge.id << "' has invalid geometry (<2 points)." << std::endl;
            invalidGeometries++;
        }
    }

    if (isValid && validationErrors_.empty()) {
        std::cout << "✅ Graph Dataset Validation Passed Successfully (0 Errors)." << std::endl;
    } else {
        std::cout << "⚠️  Graph Dataset Validation Completed with Errors." << std::endl;
    }
    std::cout << "--------------------------------------------------\n" << std::endl;

    return isValid;
}

int Graph::countConnectedComponents() const {
    if (nodesMap_.empty()) return 0;

    std::unordered_set<std::string> visited;
    int components = 0;

    for (const auto& [nodeId, node] : nodesMap_) {
        if (visited.find(nodeId) == visited.end()) {
            components++;
            std::queue<std::string> q;
            q.push(nodeId);
            visited.insert(nodeId);

            while (!q.empty()) {
                std::string curr = q.front();
                q.pop();

                auto it = adjList_.find(curr);
                if (it != adjList_.end()) {
                    for (const auto& neighbor : it->second) {
                        if (visited.find(neighbor.toNodeId) == visited.end()) {
                            visited.insert(neighbor.toNodeId);
                            q.push(neighbor.toNodeId);
                        }
                    }
                }
            }
        }
    }

    return components;
}

void Graph::printStatistics() const {
    int totalNodes = static_cast<int>(nodesMap_.size());
    int totalEdges = static_cast<int>(edgesList_.size());
    int hiddenNodes = 0;
    int bidirectionalEdges = 0;
    int oneWayEdges = 0;

    for (const auto& [id, node] : nodesMap_) {
        if (node.isHidden) hiddenNodes++;
    }

    for (const auto& edge : edgesList_) {
        if (edge.isBidirectional) {
            bidirectionalEdges++;
        } else {
            oneWayEdges++;
        }
    }

    int components = countConnectedComponents();

    int totalDegrees = 0;
    for (const auto& [nodeId, neighbors] : adjList_) {
        totalDegrees += static_cast<int>(neighbors.size());
    }

    double avgDegree = totalNodes > 0 ? static_cast<double>(totalDegrees) / totalNodes : 0.0;

    std::cout << "==================================================" << std::endl;
    std::cout << "            GRAPH ENGINE DATASET STATISTICS       " << std::endl;
    std::cout << "==================================================" << std::endl;
    std::cout << " Nodes               : " << totalNodes << std::endl;
    std::cout << " Edges               : " << totalEdges << std::endl;
    std::cout << " Hidden Nodes        : " << hiddenNodes << std::endl;
    std::cout << " Bidirectional Edges : " << bidirectionalEdges << std::endl;
    std::cout << " One-way Edges       : " << oneWayEdges << std::endl;
    std::cout << " Connected Components: " << components << std::endl;
    std::cout << std::fixed << std::setprecision(2);
    std::cout << " Average Degree      : " << avgDegree << std::endl;
    std::cout << "==================================================\n" << std::endl;
}

std::optional<Node> Graph::findNodeById(const std::string& id) const {
    auto it = nodesMap_.find(id);
    if (it != nodesMap_.end()) {
        return it->second;
    }
    return std::nullopt;
}

std::vector<Node> Graph::findNodesByName(const std::string& nameQuery) const {
    std::vector<Node> results;
    std::string queryLower = toLower(nameQuery);

    for (const auto& [id, node] : nodesMap_) {
        if (node.isHidden) continue; // Ignore hidden navigation nodes in search

        std::string nodeNameLower = toLower(node.name);
        if (nodeNameLower.find(queryLower) != std::string::npos) {
            results.push_back(node);
        }
    }

    return results;
}
