#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

echo "==> Linux doctor"
node linux/src/supacode-linux.mjs doctor

echo "==> SQLite migrations"
tmp_db="${TMPDIR:-/tmp}/supacode-linux-verify.sqlite3"
rm -f "$tmp_db" "$tmp_db-shm" "$tmp_db-wal"
node linux/src/supacode-linux.mjs init --db "$tmp_db"
sqlite3 "$tmp_db" "select name from sqlite_schema where type = 'table' order by name;"
rm -f "$tmp_db" "$tmp_db-shm" "$tmp_db-wal"

echo "==> Linux tests"
node --test linux/test/*.test.mjs

echo "==> Packaging metadata"
bash linux/scripts/check-packaging.sh

echo "==> Qt shell smoke"
if command -v cmake >/dev/null 2>&1 && pkg-config --exists Qt6Widgets Qt6Svg; then
  bash linux/scripts/check-qt-ui.sh
else
  echo "Qt build dependencies are not installed; skipped Qt shell smoke"
fi

echo "==> CLI help"
node linux/src/supacode-linux.mjs --help >/dev/null

echo "Linux verification passed"
