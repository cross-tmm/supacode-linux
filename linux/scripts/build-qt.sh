#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${root}/build/linux/qt"

if ! command -v cmake >/dev/null 2>&1; then
  echo "cmake is required. Ubuntu: sudo apt install cmake g++ qt6-base-dev qt6-svg-dev" >&2
  exit 127
fi

cmake -S "${root}/linux/qt" -B "${build_dir}" -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE:-RelWithDebInfo}"
cmake --build "${build_dir}" --parallel "${JOBS:-$(nproc)}"
echo "${build_dir}/supacode"
