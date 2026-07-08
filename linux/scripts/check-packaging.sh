#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$root/linux/packaging/debian/control"
  "$root/linux/packaging/debian/rules"
  "$root/linux/packaging/debian/install"
  "$root/linux/packaging/bin/supacode-linux"
  "$root/linux/packaging/arch/PKGBUILD"
  "$root/linux/packaging/appimage/supacode-linux.desktop"
  "$root/linux/packaging/appimage/AppRun"
)

for file in "${required_files[@]}"; do
  if [ ! -s "$file" ]; then
    echo "missing packaging file: $file" >&2
    exit 1
  fi
done

bash -n "$root/linux/packaging/debian/rules"
bash -n "$root/linux/packaging/bin/supacode-linux"
bash -n "$root/linux/packaging/appimage/AppRun"

echo "Linux packaging metadata is present"
