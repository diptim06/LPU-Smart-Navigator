#pragma once

#include "Node.hpp"
#include "Graph.hpp"
#include <string>
#include <vector>
#include <unordered_map>

struct SearchResult {
    std::string nodeId;
    std::string name;
    std::string category;
    std::string type;
    double latitude;
    double longitude;
};

class SearchIndex {
public:
    SearchIndex() = default;

    // Build searchable POI index from Graph
    void buildIndex(const Graph& graph);

    // Instant case-insensitive search by query string (filters out hidden & navigation nodes)
    std::vector<SearchResult> search(const std::string& query) const;

    // Direct lookup by exact name returning Node ID
    std::string getNodeIdByName(const std::string& exactName) const;

    size_t getIndexSize() const { return index_.size(); }

private:
    std::vector<SearchResult> index_;
    std::unordered_map<std::string, std::string> nameToIdMap_;
};
