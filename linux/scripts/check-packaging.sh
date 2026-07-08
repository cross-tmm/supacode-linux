#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$root/linux/packaging/debian/control"
  "$root/linux/packaging/debian/rules"
  "$root/linux/packaging/debian/install"
  "$root/linux/packaging/bin/supacode-linux"
  "$root/linux/packaging/arch/PKGBUILD"
  "$root/linux/packaging/appimage/supacode.desktop"
  "$root/linux/packaging/appimage/AppRun"
  "$root/linux/scripts/build-deb.sh"
  "$root/linux/scripts/build-qt.sh"
  "$root/linux/scripts/check-qt-ui.sh"
  "$root/linux/qt/CMakeLists.txt"
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
bash -n "$root/linux/scripts/build-deb.sh"
bash -n "$root/linux/scripts/build-qt.sh"
bash -n "$root/linux/scripts/check-qt-ui.sh"

echo "Linux packaging metadata is present"
