#pragma once

#include "Node.hpp"
#include "Edge.hpp"
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <iostream>
#include <algorithm>

class SimpleJson {
public:
    static std::string readFile(const std::string& filepath) {
        std::ifstream file(filepath);
        if (!file.is_open()) {
            throw std::runtime_error("Could not open file: " + filepath);
        }
        std::stringstream buffer;
        buffer << file.rdbuf();
        return buffer.str();
    }

    static std::vector<Node> parseNodes(const std::string& jsonContent) {
        std::vector<Node> nodes;
        size_t pos = 0;

        while ((pos = jsonContent.find('{', pos)) != std::string::npos) {
            size_t end = jsonContent.find('}', pos);
            if (end == std::string::npos) break;

            std::string objectStr = jsonContent.substr(pos, end - pos + 1);
            Node n;
            n.id = extractStringField(objectStr, "id");
            n.name = extractStringField(objectStr, "name");
            n.category = extractStringField(objectStr, "category");
            if (n.category.empty()) n.category = "POI";
            n.type = extractStringField(objectStr, "type");
            if (n.type.empty()) n.type = "custom";
            n.latitude = extractDoubleField(objectStr, "latitude");
            n.longitude = extractDoubleField(objectStr, "longitude");
            n.isHidden = extractBooleanField(objectStr, "isHidden");

            if (!n.id.empty()) {
                nodes.push_back(n);
            }
            pos = end + 1;
        }

        return nodes;
    }

    static std::vector<Edge> parseEdges(const std::string& jsonContent) {
        std::vector<Edge> edges;
        size_t pos = 0;

        while ((pos = jsonContent.find('{', pos)) != std::string::npos) {
            size_t end = findMatchingBrace(jsonContent, pos);
            if (end == std::string::npos) break;

            std::string objectStr = jsonContent.substr(pos, end - pos + 1);
            Edge e;
            e.id = extractStringField(objectStr, "id");
            e.fromNodeId = extractStringField(objectStr, "fromNodeId");
            e.toNodeId = extractStringField(objectStr, "toNodeId");
            e.distance = extractDoubleField(objectStr, "distance");
            e.walkingTime = extractDoubleField(objectStr, "walkingTime");
            e.pathType = extractStringField(objectStr, "pathType");
            if (e.pathType.empty()) e.pathType = "road";
            
            // Default isBidirectional to true if key not present or explicitly true
            if (objectStr.find("\"isBidirectional\"") != std::string::npos) {
                e.isBidirectional = extractBooleanField(objectStr, "isBidirectional");
            } else {
                e.isBidirectional = true;
            }

            e.geometry = extractGeometryField(objectStr);

            if (!e.id.empty()) {
                edges.push_back(e);
            }
            pos = end + 1;
        }

        return edges;
    }

private:
    static size_t findMatchingBrace(const std::string& str, size_t startPos) {
        int depth = 0;
        for (size_t i = startPos; i < str.length(); ++i) {
            if (str[i] == '{') depth++;
            else if (str[i] == '}') {
                depth--;
                if (depth == 0) return i;
            }
        }
        return std::string::npos;
    }

    static std::string extractStringField(const std::string& obj, const std::string& field) {
        std::string key = "\"" + field + "\"";
        size_t pos = obj.find(key);
        if (pos == std::string::npos) return "";

        size_t colon = obj.find(':', pos);
        if (colon == std::string::npos) return "";

        size_t startQuote = obj.find('"', colon + 1);
        if (startQuote == std::string::npos) return "";

        size_t endQuote = obj.find('"', startQuote + 1);
        if (endQuote == std::string::npos) return "";

        return obj.substr(startQuote + 1, endQuote - startQuote - 1);
    }

    static double extractDoubleField(const std::string& obj, const std::string& field) {
        std::string key = "\"" + field + "\"";
        size_t pos = obj.find(key);
        if (pos == std::string::npos) return 0.0;

        size_t colon = obj.find(':', pos);
        if (colon == std::string::npos) return 0.0;

        size_t start = colon + 1;
        while (start < obj.length() && (obj[start] == ' ' || obj[start] == '\t' || obj[start] == '\n' || obj[start] == '\r')) {
            start++;
        }

        size_t end = start;
        while (end < obj.length() && (isdigit(obj[end]) || obj[end] == '.' || obj[end] == '-')) {
            end++;
        }

        if (start == end) return 0.0;
        try {
            return std::stod(obj.substr(start, end - start));
        } catch (...) {
            return 0.0;
        }
    }

    static bool extractBooleanField(const std::string& obj, const std::string& field) {
        std::string key = "\"" + field + "\"";
        size_t pos = obj.find(key);
        if (pos == std::string::npos) return false;

        size_t colon = obj.find(':', pos);
        if (colon == std::string::npos) return false;

        std::string rest = obj.substr(colon + 1, 20);
        return rest.find("true") != std::string::npos;
    }

    static std::vector<std::pair<double, double>> extractGeometryField(const std::string& obj) {
        std::vector<std::pair<double, double>> geom;
        size_t geomPos = obj.find("\"geometry\"");
        if (geomPos == std::string::npos) return geom;

        size_t startArray = obj.find('[', geomPos);
        if (startArray == std::string::npos) return geom;

        size_t endArray = obj.find(']', startArray);
        if (endArray == std::string::npos) return geom;

        std::string arrayStr = obj.substr(startArray, endArray - startArray + 1);

        size_t ptPos = 0;
        while ((ptPos = arrayStr.find('[', ptPos)) != std::string::npos) {
            size_t ptEnd = arrayStr.find(']', ptPos);
            if (ptEnd == std::string::npos) break;

            std::string ptStr = arrayStr.substr(ptPos + 1, ptEnd - ptPos - 1);
            size_t comma = ptStr.find(',');
            if (comma != std::string::npos) {
                try {
                    double lat = std::stod(ptStr.substr(0, comma));
                    double lng = std::stod(ptStr.substr(comma + 1));
                    geom.push_back({lat, lng});
                } catch (...) {}
            }
            ptPos = ptEnd + 1;
        }

        return geom;
    }
};
