#pragma once

#include <string>
#include <vector>
#include <utility>

struct Edge {
    std::string id;
    std::string fromNodeId;
    std::string toNodeId;
    std::vector<std::pair<double, double>> geometry; // [(lat, lng), ...]
    double distance{0.0};
    double walkingTime{0.0};
    std::string pathType{"road"};
    bool isBidirectional{true};
};

struct AdjEdge {
    std::string toNodeId;
    std::string edgeId;
    double distance{0.0};
    double walkingTime{0.0};
    std::string pathType{"road"};
    bool isBidirectional{true};
};
