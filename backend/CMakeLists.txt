cmake_minimum_required(VERSION 3.16)
project(LPU_Smart_Navigator_Backend VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(Threads REQUIRED)

include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

add_executable(lpu_smart_navigator_backend
    main.cpp
    src/Graph.cpp
    src/SearchIndex.cpp
    src/DijkstraRouter.cpp
    src/AStarRouter.cpp
    src/RoutingManager.cpp
    src/HttpServer.cpp
)

target_link_libraries(lpu_smart_navigator_backend PRIVATE Threads::Threads)
