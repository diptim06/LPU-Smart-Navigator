#include "HttpServer.hpp"
#include "SimpleJson.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <unordered_set>

using namespace std;

static string extractJsonField(const string& json, const string& key) {
    string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == string::npos) return "";

    pos = json.find(':', pos);
    if (pos == string::npos) return "";

    size_t startQuote = json.find('"', pos);
    if (startQuote == string::npos) return "";

    size_t endQuote = json.find('"', startQuote + 1);
    if (endQuote == string::npos) return "";

    return json.substr(startQuote + 1, endQuote - startQuote - 1);
}

static string extractRawJsonArray(const string& json, const string& key) {
    string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == string::npos) return "";

    pos = json.find('[', pos);
    if (pos == string::npos) return "";

    int bracketCount = 1;
    size_t i = pos + 1;
    while (i < json.length() && bracketCount > 0) {
        if (json[i] == '[') bracketCount++;
        else if (json[i] == ']') bracketCount--;
        i++;
    }

    if (bracketCount == 0) {
        return json.substr(pos, i - pos);
    }
    return "";
}

HttpServer::HttpServer(Graph& graph, SearchIndex& searchIndex, RoutingManager& routingManager, uint16_t port)
    : graph_(graph), searchIndex_(searchIndex), routingManager_(routingManager), port_(port) {
    setupRoutes();
}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::startAsync() {
    serverThread_ = thread([this]() {
        cout << "HTTP Server running on http://localhost:" << port_ << endl;
        server_.listen("0.0.0.0", port_);
    });
}

void HttpServer::start() {
    cout << "HTTP Server running on http://localhost:" << port_ << endl;
    server_.listen("0.0.0.0", port_);
}

void HttpServer::stop() {
    if (server_.is_running()) {
        server_.stop();
    }
    if (serverThread_.joinable()) {
        serverThread_.join();
    }
}

string HttpServer::serializeRouteResult(const RouteResult& res) const {
    stringstream ss;
    ss << "{\n";
    ss << "  \"found\": " << (res.found ? "true" : "false") << ",\n";
    ss << "  \"totalDistance\": " << res.totalDistance << ",\n";
    ss << "  \"walkingTime\": " << res.walkingTime << ",\n";

    ss << "  \"nodeIds\": [";
    for (size_t i = 0; i < res.nodeIds.size(); ++i) {
        ss << "\"" << res.nodeIds[i] << "\"" << (i + 1 < res.nodeIds.size() ? ", " : "");
    }
    ss << "],\n";

    ss << "  \"edgeIds\": [";
    for (size_t i = 0; i < res.edgeIds.size(); ++i) {
        ss << "\"" << res.edgeIds[i] << "\"" << (i + 1 < res.edgeIds.size() ? ", " : "");
    }
    ss << "],\n";

    ss << "  \"geometry\": [";
    for (size_t i = 0; i < res.geometry.size(); ++i) {
        ss << "[" << res.geometry[i].first << ", " << res.geometry[i].second << "]"
           << (i + 1 < res.geometry.size() ? ", " : "");
    }
    ss << "]\n";
    ss << "}";

    return ss.str();
}

void HttpServer::setupRoutes() {
    // Set CORS headers for all responses
    server_.set_post_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    });

    // OPTIONS handler for CORS preflight
    server_.Options(R"(.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.status = 200;
    });

    // POST /api/route endpoint
    server_.Post("/api/route", [this](const httplib::Request& req, httplib::Response& res) {
        string startNodeId;
        string destNodeId;

        if (!req.body.empty()) {
            startNodeId = extractJsonField(req.body, "startNodeId");
            if (startNodeId.empty()) startNodeId = extractJsonField(req.body, "start");

            destNodeId = extractJsonField(req.body, "destinationNodeId");
            if (destNodeId.empty()) destNodeId = extractJsonField(req.body, "dest");
        }

        if (startNodeId.empty() && req.has_param("startNodeId")) {
            startNodeId = req.get_param_value("startNodeId");
        }
        if (startNodeId.empty() && req.has_param("start")) {
            startNodeId = req.get_param_value("start");
        }
        if (destNodeId.empty() && req.has_param("destinationNodeId")) {
            destNodeId = req.get_param_value("destinationNodeId");
        }
        if (destNodeId.empty() && req.has_param("dest")) {
            destNodeId = req.get_param_value("dest");
        }

        cout << "POST /api/route | Start: " << startNodeId << " -> Dest: " << destNodeId << endl;

        RouteResult routeRes = routingManager_.findRoute(startNodeId, destNodeId);
        string jsonBody = serializeRouteResult(routeRes);

        res.set_content(jsonBody, "application/json");
        res.status = 200;
    });

    // POST /api/save-graph endpoint
    server_.Post("/api/save-graph", [this](const httplib::Request& req, httplib::Response& res) {
        string nodesJson = extractRawJsonArray(req.body, "nodes");
        string edgesJson = extractRawJsonArray(req.body, "edges");

        if (nodesJson.empty() || edgesJson.empty()) {
            string errorJson = "{\"success\": false, \"error\": \"Invalid JSON payload: missing nodes or edges array\"}";
            res.set_content(errorJson, "application/json");
            res.status = 400;
            return;
        }

        try {
            vector<Node> parsedNodes = SimpleJson::parseNodes(nodesJson);
            vector<Edge> parsedEdges = SimpleJson::parseEdges(edgesJson);

            unordered_set<string> validNodeIds;
            for (const auto& n : parsedNodes) {
                validNodeIds.insert(n.id);
            }

            for (const auto& e : parsedEdges) {
                if (validNodeIds.find(e.fromNodeId) == validNodeIds.end()) {
                    string err = "{\"success\": false, \"error\": \"Edge '" + e.id + "' references missing fromNodeId '" + e.fromNodeId + "'\"}";
                    res.set_content(err, "application/json");
                    res.status = 400;
                    return;
                }
                if (validNodeIds.find(e.toNodeId) == validNodeIds.end()) {
                    string err = "{\"success\": false, \"error\": \"Edge '" + e.id + "' references missing toNodeId '" + e.toNodeId + "'\"}";
                    res.set_content(err, "application/json");
                    res.status = 400;
                    return;
                }
            }

            ofstream nodesFile("data/nodes.json");
            nodesFile << nodesJson;
            nodesFile.close();

            ofstream edgesFile("data/edges.json");
            edgesFile << edgesJson;
            edgesFile.close();

            graph_.loadNodes("data/nodes.json");
            graph_.loadEdges("data/edges.json");
            graph_.validateGraph();
            searchIndex_.buildIndex(graph_);

            cout << "Save Graph: Reloaded " << parsedNodes.size() << " nodes, " << parsedEdges.size() << " edges." << endl;

            string successJson = "{\"success\": true, \"nodes\": " + to_string(parsedNodes.size()) +
                                 ", \"edges\": " + to_string(parsedEdges.size()) + "}";
            res.set_content(successJson, "application/json");
            res.status = 200;
        } catch (const exception& ex) {
            string err = "{\"success\": false, \"error\": \"Failed to parse and save graph: " + string(ex.what()) + "\"}";
            res.set_content(err, "application/json");
            res.status = 400;
        }
    });

    // 404 Error handler
    server_.set_error_handler([](const httplib::Request&, httplib::Response& res) {
        if (res.status == 404) {
            res.set_content("{\"error\": \"Endpoint Not Found\"}", "application/json");
        }
    });
}
