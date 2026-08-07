#include "HttpServer.hpp"
#include "SimpleJson.hpp"
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <unordered_set>
#include <cctype>

HttpServer::HttpServer(Graph& graph, SearchIndex& searchIndex, RoutingManager& routingManager, uint16_t port)
    : graph_(graph), searchIndex_(searchIndex), routingManager_(routingManager), port_(port) {}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::startAsync() {
    running_ = true;
    serverThread_ = std::thread(&HttpServer::listenLoop, this);
}

void HttpServer::start() {
    running_ = true;
    listenLoop();
}

void HttpServer::stop() {
    if (running_) {
        running_ = false;
        if (serverFd_ >= 0) {
            ::close(serverFd_);
            serverFd_ = -1;
        }
        if (serverThread_.joinable()) {
            serverThread_.join();
        }
    }
}

static std::string extractJsonField(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";

    pos = json.find(':', pos);
    if (pos == std::string::npos) return "";

    size_t startQuote = json.find('"', pos);
    if (startQuote == std::string::npos) return "";

    size_t endQuote = json.find('"', startQuote + 1);
    if (endQuote == std::string::npos) return "";

    return json.substr(startQuote + 1, endQuote - startQuote - 1);
}

static std::string extractQueryParam(const std::string& url, const std::string& param) {
    std::string key = param + "=";
    size_t pos = url.find(key);
    if (pos == std::string::npos) return "";

    pos += key.length();
    size_t end = url.find('&', pos);
    if (end == std::string::npos) {
        end = url.find(' ', pos);
    }
    if (end == std::string::npos) {
        end = url.length();
    }
    return url.substr(pos, end - pos);
}

static std::string extractRawJsonArray(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";

    pos = json.find('[', pos);
    if (pos == std::string::npos) return "";

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

std::string HttpServer::serializeRouteResult(const RouteResult& res) const {
    std::stringstream ss;
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

void HttpServer::listenLoop() {
    serverFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd_ < 0) {
        std::cerr << "❌ HttpServer Error: Failed to create socket." << std::endl;
        return;
    }

    int opt = 1;
    ::setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port_);

    if (::bind(serverFd_, (struct sockaddr*)&address, sizeof(address)) < 0) {
        std::cerr << "❌ HttpServer Error: Failed to bind port " << port_ << std::endl;
        ::close(serverFd_);
        serverFd_ = -1;
        return;
    }

    if (::listen(serverFd_, 10) < 0) {
        std::cerr << "❌ HttpServer Error: Failed to listen on port " << port_ << std::endl;
        ::close(serverFd_);
        serverFd_ = -1;
        return;
    }

    std::cout << "[C++ Backend HTTP Server] Live on http://localhost:" << port_ 
              << " (Exposing POST /api/route & POST /api/save-graph)" << std::endl;

    while (running_) {
        sockaddr_in clientAddr{};
        socklen_t clientLen = sizeof(clientAddr);
        int clientFd = ::accept(serverFd_, (struct sockaddr*)&clientAddr, &clientLen);

        if (clientFd < 0) {
            if (!running_) break;
            continue;
        }

        handleClient(clientFd);
    }
}

void HttpServer::handleClient(int clientFd) {
    // Read up to 2MB to support saving large graph datasets
    std::string request;
    char buffer[16384];
    ssize_t bytesRead = 0;

    while ((bytesRead = ::read(clientFd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[bytesRead] = '\0';
        request.append(buffer, bytesRead);

        // Check if full HTTP headers and body received
        size_t headerEnd = request.find("\r\n\r\n");
        if (headerEnd != std::string::npos) {
            size_t contentLength = 0;
            size_t clPos = request.find("Content-Length:");
            if (clPos == std::string::npos) clPos = request.find("content-length:");
            if (clPos != std::string::npos) {
                size_t valPos = request.find(':', clPos) + 1;
                contentLength = std::stoul(request.substr(valPos));
            }
            if (request.length() - (headerEnd + 4) >= contentLength) {
                break; // Complete HTTP request received
            }
        }
    }

    if (request.empty()) {
        ::close(clientFd);
        return;
    }

    std::stringstream responseHeaders;
    responseHeaders << "Access-Control-Allow-Origin: *\r\n"
                    << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    << "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

    // Handle OPTIONS CORS preflight
    if (request.rfind("OPTIONS", 0) == 0) {
        std::string resp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() + "Content-Length: 0\r\n\r\n";
        ::write(clientFd, resp.c_str(), resp.length());
        ::close(clientFd);
        return;
    }

    // Handle POST /api/save-graph (Sprint 8.6)
    if (request.find("/api/save-graph") != std::string::npos) {
        size_t bodyPos = request.find("\r\n\r\n");
        std::string requestBody = (bodyPos != std::string::npos) ? request.substr(bodyPos + 4) : "";
        handleSaveGraph(clientFd, requestBody);
        ::close(clientFd);
        return;
    }

    // Handle POST or GET /api/route
    if (request.find("/api/route") != std::string::npos) {
        std::string startNodeId;
        std::string destNodeId;

        size_t bodyPos = request.find("\r\n\r\n");
        if (bodyPos != std::string::npos) {
            std::string body = request.substr(bodyPos + 4);
            startNodeId = extractJsonField(body, "startNodeId");
            if (startNodeId.empty()) startNodeId = extractJsonField(body, "start");

            destNodeId = extractJsonField(body, "destinationNodeId");
            if (destNodeId.empty()) destNodeId = extractJsonField(body, "dest");
        }

        if (startNodeId.empty()) startNodeId = extractQueryParam(request, "startNodeId");
        if (startNodeId.empty()) startNodeId = extractQueryParam(request, "start");
        if (destNodeId.empty()) destNodeId = extractQueryParam(request, "destinationNodeId");
        if (destNodeId.empty()) destNodeId = extractQueryParam(request, "dest");

        std::cout << "\n[C++ API Request] POST /api/route | Start: " 
                  << startNodeId << " ➔ Dest: " << destNodeId << std::endl;

        RouteResult routeRes = routingManager_.findRoute(startNodeId, destNodeId);
        std::string jsonBody = serializeRouteResult(routeRes);

        std::string fullResp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() +
                               "Content-Type: application/json\r\n" +
                               "Content-Length: " + std::to_string(jsonBody.length()) + "\r\n\r\n" + jsonBody;

        ::write(clientFd, fullResp.c_str(), fullResp.length());
    } else {
        std::string body = "{\"error\": \"Endpoint Not Found\"}";
        std::string respStr = "HTTP/1.1 404 Not Found\r\n" + responseHeaders.str() +
                              "Content-Type: application/json\r\n" +
                              "Content-Length: " + std::to_string(body.length()) + "\r\n\r\n" + body;
        ::write(clientFd, respStr.c_str(), respStr.length());
    }

    ::close(clientFd);
}

void HttpServer::handleSaveGraph(int clientFd, const std::string& requestBody) {
    std::string nodesJson = extractRawJsonArray(requestBody, "nodes");
    std::string edgesJson = extractRawJsonArray(requestBody, "edges");

    std::stringstream responseHeaders;
    responseHeaders << "Access-Control-Allow-Origin: *\r\n"
                    << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    << "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

    if (nodesJson.empty() || edgesJson.empty()) {
        std::string errorJson = "{\"success\": false, \"error\": \"Invalid JSON payload: missing nodes or edges array\"}";
        std::string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                           "Content-Type: application/json\r\n" +
                           "Content-Length: " + std::to_string(errorJson.length()) + "\r\n\r\n" + errorJson;
        ::write(clientFd, resp.c_str(), resp.length());
        return;
    }

    try {
        std::vector<Node> parsedNodes = SimpleJson::parseNodes(nodesJson);
        std::vector<Edge> parsedEdges = SimpleJson::parseEdges(edgesJson);

        std::unordered_set<std::string> validNodeIds;
        for (const auto& n : parsedNodes) {
            validNodeIds.insert(n.id);
        }

        // Validate edge node references
        for (const auto& e : parsedEdges) {
            if (validNodeIds.find(e.fromNodeId) == validNodeIds.end()) {
                std::string err = "{\"success\": false, \"error\": \"Validation Error: Edge '" + e.id + "' references missing fromNodeId '" + e.fromNodeId + "'\"}";
                std::string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                                   "Content-Type: application/json\r\n" +
                                   "Content-Length: " + std::to_string(err.length()) + "\r\n\r\n" + err;
                ::write(clientFd, resp.c_str(), resp.length());
                return;
            }
            if (validNodeIds.find(e.toNodeId) == validNodeIds.end()) {
                std::string err = "{\"success\": false, \"error\": \"Validation Error: Edge '" + e.id + "' references missing toNodeId '" + e.toNodeId + "'\"}";
                std::string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                                   "Content-Type: application/json\r\n" +
                                   "Content-Length: " + std::to_string(err.length()) + "\r\n\r\n" + err;
                ::write(clientFd, resp.c_str(), resp.length());
                return;
            }
        }

        // Overwrite disk files
        std::ofstream nodesFile("data/nodes.json");
        nodesFile << nodesJson;
        nodesFile.close();

        std::ofstream edgesFile("data/edges.json");
        edgesFile << edgesJson;
        edgesFile.close();

        // Hot Reload Graph, Validation, SearchIndex, and RoutingManager in memory
        graph_.loadNodes("data/nodes.json");
        graph_.loadEdges("data/edges.json");
        graph_.validateGraph();
        searchIndex_.buildIndex(graph_);

        std::cout << "\n[C++ API Save Graph] Hot Reloaded Graph Engine: " 
                  << parsedNodes.size() << " nodes, " << parsedEdges.size() << " edges saved to disk." << std::endl;

        std::string successJson = "{\"success\": true, \"nodes\": " + std::to_string(parsedNodes.size()) +
                                  ", \"edges\": " + std::to_string(parsedEdges.size()) + "}";

        std::string resp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() +
                           "Content-Type: application/json\r\n" +
                           "Content-Length: " + std::to_string(successJson.length()) + "\r\n\r\n" + successJson;
        ::write(clientFd, resp.c_str(), resp.length());
    } catch (const std::exception& ex) {
        std::string err = "{\"success\": false, \"error\": \"Failed to parse and save graph: " + std::string(ex.what()) + "\"}";
        std::string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                           "Content-Type: application/json\r\n" +
                           "Content-Length: " + std::to_string(err.length()) + "\r\n\r\n" + err;
        ::write(clientFd, resp.c_str(), resp.length());
    }
}
