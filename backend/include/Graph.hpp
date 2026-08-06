#pragma once

#include "Node.hpp"
#include "Edge.hpp"
#include <string>
#include <vector>
#include <unordered_map>
#include <optional>
#include <iostream>

class Graph {
public:
    Graph() = default;

    bool loadNodes(const std::string& filepath);
    bool loadEdges(const std::string& filepath);

    bool validateGraph() const;
    void printStatistics() const;

    std::optional<Node> findNodeById(const std::string& id) const;
    std::vector<Node> findNodesByName(const std::string& nameQuery) const;

    const std::unordered_map<std::string, Node>& getNodes() const { return nodesMap_; }
    const std::vector<Edge>& getEdges() const { return edgesList_; }
    const std::unordered_map<std::string, std::vector<AdjEdge>>& getAdjacencyList() const { return adjList_; }

private:
    std::unordered_map<std::string, Node> nodesMap_;
    std::vector<Edge> edgesList_;
    std::unordered_map<std::string, std::vector<AdjEdge>> adjList_;

    std::vector<std::string> validationErrors_;
    std::vector<std::string> validationWarnings_;

    void buildAdjacencyList();
    int countConnectedComponents() const;
};
