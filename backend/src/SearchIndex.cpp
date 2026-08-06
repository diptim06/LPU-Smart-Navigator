#include "SearchIndex.hpp"
#include <algorithm>
#include <cctype>
#include <iostream>

static std::string toLower(const std::string& str) {
    std::string lower = str;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return lower;
}

void SearchIndex::buildIndex(const Graph& graph) {
    index_.clear();
    nameToIdMap_.clear();

    const auto& nodes = graph.getNodes();
    for (const auto& [id, node] : nodes) {
        // Sprint 8.1 Specification: NEVER index hidden nodes or Navigation nodes
        if (node.isHidden || node.category == "Navigation") {
            continue;
        }

        SearchResult res{
            node.id,
            node.name,
            node.category,
            node.type,
            node.latitude,
            node.longitude
        };

        index_.push_back(res);
        nameToIdMap_[toLower(node.name)] = node.id;
    }

    std::cout << "[Search Index] Indexed " << index_.size() 
              << " searchable POIs (filtered out hidden and navigation nodes)." << std::endl;
}

std::vector<SearchResult> SearchIndex::search(const std::string& query) const {
    std::vector<SearchResult> results;
    if (query.empty()) return index_; // Return all POIs if query is empty

    std::string queryLower = toLower(query);

    for (const auto& item : index_) {
        std::string nameLower = toLower(item.name);
        std::string typeLower = toLower(item.type);

        if (nameLower.find(queryLower) != std::string::npos || typeLower.find(queryLower) != std::string::npos) {
            results.push_back(item);
        }
    }

    return results;
}

std::string SearchIndex::getNodeIdByName(const std::string& exactName) const {
    std::string lowerName = toLower(exactName);
    auto it = nameToIdMap_.find(lowerName);
    if (it != nameToIdMap_.end()) {
        return it->second;
    }
    return "";
}
