#pragma once

#include <string>
#include <vector>
#include <utility>

struct RouteResult {
    bool found{false};
    double totalDistance{0.0};
    double walkingTime{0.0};
    std::vector<std::string> nodeIds;
    std::vector<std::string> edgeIds;
    std::vector<std::pair<double, double>> geometry; // [(lat, lng), ...]
};
