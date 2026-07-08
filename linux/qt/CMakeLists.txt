cmake_minimum_required(VERSION 3.22)

project(SupacodeLinux VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets Svg DBus)

qt_add_executable(supacode
  src/main.cpp
  resources/supacode.qrc
)

target_compile_features(supacode PRIVATE cxx_std_20)
target_link_libraries(supacode PRIVATE Qt6::Widgets Qt6::Svg Qt6::DBus)

install(TARGETS supacode RUNTIME DESTINATION bin)
