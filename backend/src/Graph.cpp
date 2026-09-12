#include "Graph.hpp"
#include "SimpleJson.hpp"
#include <unordered_set>
#include <queue>
#include <algorithm>
#include <iomanip>
#include <cctype>

using namespace std;

static string toLower(const string& str) {
    string lower = str;
    transform(lower.begin(), lower.end(), lower.begin(),
              [](unsigned char c) { return tolower(c); });
    return lower;
}

bool Graph::loadNodes(const string& filepath) {
    try {
        string jsonStr = SimpleJson::readFile(filepath);
        vector<Node> loadedNodes = SimpleJson::parseNodes(jsonStr);

        nodesMap_.clear();
        validationErrors_.clear();
        validationWarnings_.clear();

        unordered_set<string> seenIds;
        for (const auto& node : loadedNodes) {
            if (seenIds.find(node.id) != seenIds.end()) {
                validationErrors_.push_back("Duplicate Node ID: " + node.id);
            } else {
                seenIds.insert(node.id);
                nodesMap_[node.id] = node;
            }
        }

        cout << "Loaded " << nodesMap_.size() << " nodes from " << filepath << endl;
        return true;
    } catch (const exception& ex) {
        cerr << "Failed to load nodes: " << ex.what() << endl;
        return false;
    }
}

bool Graph::loadEdges(const string& filepath) {
    try {
        string jsonStr = SimpleJson::readFile(filepath);
        edgesList_ = SimpleJson::parseEdges(jsonStr);

        unordered_set<string> seenEdgeIds;
        for (auto& edge : edgesList_) {
            if (seenEdgeIds.find(edge.id) != seenEdgeIds.end()) {
                validationErrors_.push_back("Duplicate Edge ID: " + edge.id);
            } else {
                seenEdgeIds.insert(edge.id);
            }

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
        cout << "Loaded " << edgesList_.size() << " edges from " << filepath << endl;
        return true;
    } catch (const exception& ex) {
        cerr << "Failed to load edges: " << ex.what() << endl;
        return false;
    }
}

void Graph::buildAdjacencyList() {
    adjList_.clear();

    for (const auto& [nodeId, node] : nodesMap_) {
        adjList_[nodeId] = vector<AdjEdge>();
    }

    for (const auto& edge : edgesList_) {
        AdjEdge forwardEdge{
            edge.toNodeId,
            edge.id,
            edge.distance,
            edge.walkingTime,
            edge.pathType,
            edge.isBidirectional
        };
        adjList_[edge.fromNodeId].push_back(forwardEdge);

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

    for (const auto& err : validationErrors_) {
        cout << "Error: " << err << endl;
        isValid = false;
    }

    for (const auto& edge : edgesList_) {
        bool fromExists = (nodesMap_.find(edge.fromNodeId) != nodesMap_.end());
        bool toExists = (nodesMap_.find(edge.toNodeId) != nodesMap_.end());

        if (!fromExists) {
            cout << "Error: Edge '" << edge.id << "' references missing fromNodeId '" << edge.fromNodeId << "'" << endl;
            isValid = false;
        }

        if (!toExists) {
            cout << "Error: Edge '" << edge.id << "' references missing toNodeId '" << edge.toNodeId << "'" << endl;
            isValid = false;
        }

        if (edge.distance <= 0.0) {
            cout << "Error: Edge '" << edge.id << "' has invalid distance: " << edge.distance << "m" << endl;
            isValid = false;
        }
    }

    return isValid;
}

int Graph::countConnectedComponents() const {
    if (nodesMap_.empty()) return 0;

    unordered_set<string> visited;
    int components = 0;

    for (const auto& [nodeId, node] : nodesMap_) {
        if (visited.find(nodeId) == visited.end()) {
            components++;
            queue<string> q;
            q.push(nodeId);
            visited.insert(nodeId);

            while (!q.empty()) {
                string curr = q.front();
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

    cout << "--- Graph Statistics ---" << endl;
    cout << "Nodes: " << totalNodes << " (" << hiddenNodes << " hidden)" << endl;
    cout << "Edges: " << totalEdges << " (" << bidirectionalEdges << " bidirectional, " << oneWayEdges << " one-way)" << endl;
    cout << "Connected Components: " << components << endl;
}

optional<Node> Graph::findNodeById(const string& id) const {
    auto it = nodesMap_.find(id);
    if (it != nodesMap_.end()) {
        return it->second;
    }
    return nullopt;
}

vector<Node> Graph::findNodesByName(const string& nameQuery) const {
    vector<Node> results;
    string queryLower = toLower(nameQuery);

    for (const auto& [id, node] : nodesMap_) {
        if (node.isHidden) continue;

        string nodeNameLower = toLower(node.name);
        if (nodeNameLower.find(queryLower) != string::npos) {
            results.push_back(node);
        }
    }

    return results;
}
