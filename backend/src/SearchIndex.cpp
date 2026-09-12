#include "SearchIndex.hpp"
#include <algorithm>
#include <cctype>
#include <iostream>
#include <unordered_map>

using namespace std;

static string toLower(const string& str) {
    string lower = str;
    transform(lower.begin(), lower.end(), lower.begin(),
              [](unsigned char c) { return tolower(c); });
    return lower;
}

void SearchIndex::buildIndex(const Graph& graph) {
    index_.clear();
    nameToIdMap_.clear();

    const auto& nodes = graph.getNodes();
    const auto& adj = graph.getAdjacencyList();

    unordered_map<string, Node> bestNodeMap;
    unordered_map<string, int> bestDegreeMap;

    for (const auto& [id, node] : nodes) {
        if (node.isHidden || node.category == "Navigation") {
            continue;
        }

        string lowerName = toLower(node.name);
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

    sort(index_.begin(), index_.end(), [](const SearchResult& a, const SearchResult& b) {
        return a.name < b.name;
    });

    cout << "Indexed " << index_.size() << " searchable POIs." << endl;
}

vector<SearchResult> SearchIndex::search(const string& query) const {
    vector<SearchResult> results;
    if (query.empty()) return index_;

    string queryLower = toLower(query);

    for (const auto& item : index_) {
        string nameLower = toLower(item.name);
        string typeLower = toLower(item.type);

        if (nameLower.find(queryLower) != string::npos || typeLower.find(queryLower) != string::npos) {
            results.push_back(item);
        }
    }

    return results;
}

string SearchIndex::getNodeIdByName(const string& exactName) const {
    string lowerName = toLower(exactName);
    auto it = nameToIdMap_.find(lowerName);
    if (it != nameToIdMap_.end()) {
        return it->second;
    }
    return "";
}
