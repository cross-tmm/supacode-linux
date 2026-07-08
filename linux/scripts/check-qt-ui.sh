#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
binary="${root}/build/linux/qt/supacode"

if [ ! -x "$binary" ]; then
  bash "${root}/linux/scripts/build-qt.sh" >/dev/null
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/home"

QT_QPA_PLATFORM=offscreen \
HOME="$tmp_dir/home" \
SUPACODE_LINUX_DB="$tmp_dir/state.sqlite3" \
timeout 10s "$binary" --smoke --quit-after-ms 1200 >/dev/null

QT_QPA_PLATFORM=offscreen \
HOME="$tmp_dir/home" \
SUPACODE_LINUX_DB="$tmp_dir/state.sqlite3" \
timeout 10s "$binary" --screenshot "$tmp_dir/main.png" --quit-after-ms 1500 >/dev/null

test -s "$tmp_dir/main.png"
echo "Qt UI smoke passed"
