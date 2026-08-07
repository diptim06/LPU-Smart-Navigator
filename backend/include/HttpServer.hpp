#pragma once

#include "RoutingManager.hpp"
#include "SearchIndex.hpp"
#include "Graph.hpp"
#include <string>
#include <atomic>
#include <thread>

class HttpServer {
public:
    HttpServer(Graph& graph, SearchIndex& searchIndex, RoutingManager& routingManager, uint16_t port = 8080);
    ~HttpServer();

    // Start non-blocking background HTTP server
    void startAsync();

    // Start blocking HTTP server
    void start();

    // Stop HTTP server
    void stop();

    bool isRunning() const { return running_; }

private:
    Graph& graph_;
    SearchIndex& searchIndex_;
    RoutingManager& routingManager_;
    uint16_t port_;
    std::atomic<bool> running_{false};
    int serverFd_{-1};
    std::thread serverThread_;

    void listenLoop();
    void handleClient(int clientFd);
    std::string serializeRouteResult(const RouteResult& res) const;
    void handleSaveGraph(int clientFd, const std::string& requestBody);
};
