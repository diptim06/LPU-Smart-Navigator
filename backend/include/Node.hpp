#pragma once

#include <string>

struct Node {
    std::string id;
    std::string name;
    std::string category{"POI"}; // "POI" or "Navigation"
    std::string type{"custom"};
    double latitude{0.0};
    double longitude{0.0};
    bool isHidden{false};
};
