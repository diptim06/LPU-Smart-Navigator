#include "SearchIndex.hpp"
#include <algorithm>
#include <cctype>
#include <iostream>
#include <unordered_map>

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
    const auto& adj = graph.getAdjacencyList();

    // Map lowercase name to best representative POI node
    std::unordered_map<std::string, Node> bestNodeMap;
    std::unordered_map<std::string, int> bestDegreeMap;

    for (const auto& [id, node] : nodes) {
        // Sprint 8.1 Specification: NEVER index hidden nodes or Navigation nodes
        if (node.isHidden || node.category == "Navigation") {
            continue;
        }

        std::string lowerName = toLower(node.name);
        int degree = 0;
        auto adjIt = adj.find(id);
        if (adjIt != adj.end()) {
            degree = static_cast<int>(adjIt->second.size());
        }

        auto it = bestNodeMap.find(lowerName);
        if (it == bestNodeMap.end()) {
            bestNodeMap[lowerName] = node;
            bestDegreeMap[lowerName] = degree;
        } else {
            int existingDegree = bestDegreeMap[lowerName];
            // If new duplicate node is connected and existing is isolated, or has higher degree, prioritize connected node
            if (degree > existingDegree) {
                bestNodeMap[lowerName] = node;
                bestDegreeMap[lowerName] = degree;
            }
        }
    }

    for (const auto& [lowerName, node] : bestNodeMap) {
        SearchResult res{
            node.id,
            node.name,
            node.category,
            node.type,
            node.latitude,
            node.longitude
        };

        index_.push_back(res);
        nameToIdMap_[lowerName] = node.id;
    }

    // Sort index alphabetically by POI name for clean presentation
    std::sort(index_.begin(), index_.end(), [](const SearchResult& a, const SearchResult& b) {
        return a.name < b.name;
    });

    std::cout << "[Search Index] Indexed " << index_.size() 
              << " unique searchable POIs (prioritizing connected nodes over isolated duplicates)." << std::endl;
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
