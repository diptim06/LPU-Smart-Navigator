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

using namespace std;

HttpServer::HttpServer(Graph& graph, SearchIndex& searchIndex, RoutingManager& routingManager, uint16_t port)
    : graph_(graph), searchIndex_(searchIndex), routingManager_(routingManager), port_(port) {}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::startAsync() {
    running_ = true;
    serverThread_ = thread(&HttpServer::listenLoop, this);
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

static string extractQueryParam(const string& url, const string& param) {
    string key = param + "=";
    size_t pos = url.find(key);
    if (pos == string::npos) return "";

    pos += key.length();
    size_t end = url.find('&', pos);
    if (end == string::npos) {
        end = url.find(' ', pos);
    }
    if (end == string::npos) {
        end = url.length();
    }
    return url.substr(pos, end - pos);
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

void HttpServer::listenLoop() {
    serverFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd_ < 0) {
        cerr << "HttpServer Error: Failed to create socket." << endl;
        return;
    }

    int opt = 1;
    ::setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port_);

    if (::bind(serverFd_, (struct sockaddr*)&address, sizeof(address)) < 0) {
        cerr << "HttpServer Error: Failed to bind port " << port_ << endl;
        ::close(serverFd_);
        serverFd_ = -1;
        return;
    }

    if (::listen(serverFd_, 10) < 0) {
        cerr << "HttpServer Error: Failed to listen on port " << port_ << endl;
        ::close(serverFd_);
        serverFd_ = -1;
        return;
    }

    cout << "HTTP Server running on http://localhost:" << port_ << endl;

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
    string request;
    char buffer[16384];
    ssize_t bytesRead = 0;

    while ((bytesRead = ::read(clientFd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[bytesRead] = '\0';
        request.append(buffer, bytesRead);

        size_t headerEnd = request.find("\r\n\r\n");
        if (headerEnd != string::npos) {
            size_t contentLength = 0;
            size_t clPos = request.find("Content-Length:");
            if (clPos == string::npos) clPos = request.find("content-length:");
            if (clPos != string::npos) {
                size_t valPos = request.find(':', clPos) + 1;
                contentLength = stoul(request.substr(valPos));
            }
            if (request.length() - (headerEnd + 4) >= contentLength) {
                break;
            }
        }
    }

    if (request.empty()) {
        ::close(clientFd);
        return;
    }

    stringstream responseHeaders;
    responseHeaders << "Access-Control-Allow-Origin: *\r\n"
                    << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    << "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

    if (request.rfind("OPTIONS", 0) == 0) {
        string resp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() + "Content-Length: 0\r\n\r\n";
        ::write(clientFd, resp.c_str(), resp.length());
        ::close(clientFd);
        return;
    }

    if (request.find("/api/save-graph") != string::npos) {
        size_t bodyPos = request.find("\r\n\r\n");
        string requestBody = (bodyPos != string::npos) ? request.substr(bodyPos + 4) : "";
        handleSaveGraph(clientFd, requestBody);
        ::close(clientFd);
        return;
    }

    if (request.find("/api/route") != string::npos) {
        string startNodeId;
        string destNodeId;

        size_t bodyPos = request.find("\r\n\r\n");
        if (bodyPos != string::npos) {
            string body = request.substr(bodyPos + 4);
            startNodeId = extractJsonField(body, "startNodeId");
            if (startNodeId.empty()) startNodeId = extractJsonField(body, "start");

            destNodeId = extractJsonField(body, "destinationNodeId");
            if (destNodeId.empty()) destNodeId = extractJsonField(body, "dest");
        }

        if (startNodeId.empty()) startNodeId = extractQueryParam(request, "startNodeId");
        if (startNodeId.empty()) startNodeId = extractQueryParam(request, "start");
        if (destNodeId.empty()) destNodeId = extractQueryParam(request, "destinationNodeId");
        if (destNodeId.empty()) destNodeId = extractQueryParam(request, "dest");

        cout << "POST /api/route | Start: " << startNodeId << " -> Dest: " << destNodeId << endl;

        RouteResult routeRes = routingManager_.findRoute(startNodeId, destNodeId);
        string jsonBody = serializeRouteResult(routeRes);

        string fullResp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() +
                          "Content-Type: application/json\r\n" +
                          "Content-Length: " + to_string(jsonBody.length()) + "\r\n\r\n" + jsonBody;

        ::write(clientFd, fullResp.c_str(), fullResp.length());
    } else {
        string body = "{\"error\": \"Endpoint Not Found\"}";
        string respStr = "HTTP/1.1 404 Not Found\r\n" + responseHeaders.str() +
                         "Content-Type: application/json\r\n" +
                         "Content-Length: " + to_string(body.length()) + "\r\n\r\n" + body;
        ::write(clientFd, respStr.c_str(), respStr.length());
    }

    ::close(clientFd);
}

void HttpServer::handleSaveGraph(int clientFd, const string& requestBody) {
    string nodesJson = extractRawJsonArray(requestBody, "nodes");
    string edgesJson = extractRawJsonArray(requestBody, "edges");

    stringstream responseHeaders;
    responseHeaders << "Access-Control-Allow-Origin: *\r\n"
                    << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    << "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

    if (nodesJson.empty() || edgesJson.empty()) {
        string errorJson = "{\"success\": false, \"error\": \"Invalid JSON payload: missing nodes or edges array\"}";
        string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                      "Content-Type: application/json\r\n" +
                      "Content-Length: " + to_string(errorJson.length()) + "\r\n\r\n" + errorJson;
        ::write(clientFd, resp.c_str(), resp.length());
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
                string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                              "Content-Type: application/json\r\n" +
                              "Content-Length: " + to_string(err.length()) + "\r\n\r\n" + err;
                ::write(clientFd, resp.c_str(), resp.length());
                return;
            }
            if (validNodeIds.find(e.toNodeId) == validNodeIds.end()) {
                string err = "{\"success\": false, \"error\": \"Edge '" + e.id + "' references missing toNodeId '" + e.toNodeId + "'\"}";
                string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                              "Content-Type: application/json\r\n" +
                              "Content-Length: " + to_string(err.length()) + "\r\n\r\n" + err;
                ::write(clientFd, resp.c_str(), resp.length());
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

        string resp = "HTTP/1.1 200 OK\r\n" + responseHeaders.str() +
                      "Content-Type: application/json\r\n" +
                      "Content-Length: " + to_string(successJson.length()) + "\r\n\r\n" + successJson;
        ::write(clientFd, resp.c_str(), resp.length());
    } catch (const exception& ex) {
        string err = "{\"success\": false, \"error\": \"Failed to parse and save graph: " + string(ex.what()) + "\"}";
        string resp = "HTTP/1.1 400 Bad Request\r\n" + responseHeaders.str() +
                      "Content-Type: application/json\r\n" +
                      "Content-Length: " + to_string(err.length()) + "\r\n\r\n" + err;
        ::write(clientFd, resp.c_str(), resp.length());
    }
}
