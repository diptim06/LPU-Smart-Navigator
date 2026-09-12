#include "HttpServer.hpp"
#include <iostream>
#include <sstream>

using namespace std;

static string extractJsonField(const string& json, const string& key) {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == string::npos) return "";

    size_t startPos = json.find(':', pos);
    if (startPos == string::npos) return "";

    size_t startQuote = json.find('"', startPos);
    if (startQuote == string::npos) return "";

    size_t endQuote = json.find('"', startQuote + 1);
    if (endQuote == string::npos) return "";

    return json.substr(startQuote + 1, endQuote - startQuote - 1);
}

HttpServer::HttpServer(Graph& graph, SearchIndex& searchIndex, RoutingManager& routingManager, uint16_t port)
    : graph_(graph), searchIndex_(searchIndex), routingManager_(routingManager), port_(port) {
    setupRoutes();
}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::start() {
    cout << "HTTP Server running on http://localhost:" << port_ << endl;
    server_.listen("0.0.0.0", port_);
}

void HttpServer::startAsync() {
    serverThread_ = thread([this]() {
        cout << "HTTP Server running on http://localhost:" << port_ << endl;
        server_.listen("0.0.0.0", port_);
    });
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
    ss << "{\n"
       << "  \"found\": " << (res.found ? "true" : "false") << ",\n"
       << "  \"totalDistance\": " << res.totalDistance << ",\n"
       << "  \"walkingTime\": " << res.walkingTime << ",\n"
       << "  \"nodeIds\": [";

    for (size_t i = 0; i < res.nodeIds.size(); ++i) {
        ss << "\"" << res.nodeIds[i] << "\"" << (i + 1 < res.nodeIds.size() ? ", " : "");
    }

    ss << "],\n  \"edgeIds\": [";
    for (size_t i = 0; i < res.edgeIds.size(); ++i) {
        ss << "\"" << res.edgeIds[i] << "\"" << (i + 1 < res.edgeIds.size() ? ", " : "");
    }

    ss << "],\n  \"geometry\": [";
    for (size_t i = 0; i < res.geometry.size(); ++i) {
        ss << "[" << res.geometry[i].first << ", " << res.geometry[i].second << "]"
           << (i + 1 < res.geometry.size() ? ", " : "");
    }

    ss << "]\n}";
    return ss.str();
}

void HttpServer::setupRoutes() {
    // OPTIONS preflight handler for CORS
    server_.Options(R"(.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.status = 200;
    });

    // POST /api/route endpoint
    server_.Post("/api/route", [this](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");

        string startNodeId = extractJsonField(req.body, "startNodeId");
        string destNodeId = extractJsonField(req.body, "destinationNodeId");

        cout << "POST /api/route | Start: " << startNodeId << " -> Dest: " << destNodeId << endl;

        RouteResult routeRes = routingManager_.findRoute(startNodeId, destNodeId);
        string jsonBody = serializeRouteResult(routeRes);

        res.set_content(jsonBody, "application/json");
        res.status = 200;
    });
}
