#pragma once

#include "httplib.h"
#include "RoutingManager.hpp"
#include "SearchIndex.hpp"
#include "Graph.hpp"
#include <string>
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

    bool isRunning() const { return server_.is_running(); }

private:
    Graph& graph_;
    SearchIndex& searchIndex_;
    RoutingManager& routingManager_;
    uint16_t port_;
    httplib::Server server_;
    std::thread serverThread_;

    void setupRoutes();
    std::string serializeRouteResult(const RouteResult& res) const;
};
