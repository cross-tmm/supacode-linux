#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

gjs -m linux/src/app/agent-workbench.gjs --help >/dev/null

if ! command -v xvfb-run >/dev/null 2>&1 || ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "xvfb-run and dbus-run-session are not available; skipped GTK launch smoke"
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
log_file="$tmp_dir/gtk-smoke.log"

set +e
HOME="$tmp_dir/home" \
SUPACODE_LINUX_DB="$tmp_dir/state.sqlite3" \
timeout 5s dbus-run-session -- xvfb-run -a gjs -m linux/src/app/agent-workbench.gjs >"$log_file" 2>&1
status=$?
set -e

if [ "$status" -eq 124 ]; then
  echo "GTK launch smoke passed"
  exit 0
fi

cat "$log_file" >&2
exit "$status"
