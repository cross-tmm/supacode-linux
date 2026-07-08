#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="${VERSION:-0.1.0}"
build_root="${root}/build/linux/deb"
arch="$(dpkg --print-architecture)"
pkgroot="${build_root}/supacode_${version}_${arch}"
output="${build_root}/supacode_${version}_${arch}.deb"
qt_binary="${root}/build/linux/qt/supacode"

umask 022
if [ ! -x "$qt_binary" ]; then
  bash "${root}/linux/scripts/build-qt.sh" >/dev/null
fi

rm -rf "$pkgroot"
mkdir -p \
  "$pkgroot/DEBIAN" \
  "$pkgroot/usr/bin" \
  "$pkgroot/usr/lib/supacode-linux" \
  "$pkgroot/usr/share/applications" \
  "$pkgroot/usr/share/doc/supacode" \
  "$pkgroot/usr/share/licenses/supacode" \
  "$pkgroot/usr/share/supacode-linux/state"

cat >"$pkgroot/DEBIAN/control" <<CONTROL
Package: supacode
Version: ${version}
Section: devel
Priority: optional
Architecture: ${arch}
Maintainer: Supacode Maintainers <maintainers@example.invalid>
Depends: git, gh, libqt6core6t64 | libqt6core6, libqt6dbus6, libqt6gui6, libqt6svg6, libqt6widgets6, nodejs, openssh-client, sqlite3
Homepage: https://github.com/cross-tmm/supacode-linux
Description: Terminal-native command center for coding agents
 Supacode manages repository worktrees, terminal sessions, and coding agent
 presence from a native Linux desktop app.
CONTROL

install -m 0755 "$qt_binary" "$pkgroot/usr/bin/supacode"
install -m 0755 "$root/linux/packaging/bin/supacode-linux" "$pkgroot/usr/bin/supacode-linux"
install -m 0644 "$root/linux/src/"*.mjs "$pkgroot/usr/lib/supacode-linux/"
install -m 0644 "$root/linux/packaging/appimage/supacode.desktop" \
  "$pkgroot/usr/share/applications/supacode.desktop"
cp -R "$root/linux/state/migrations" "$pkgroot/usr/share/supacode-linux/state/"
find "$pkgroot/usr/share/supacode-linux/state/migrations" -type f -exec chmod 0644 {} +
install -m 0644 "$root/LICENSE" "$pkgroot/usr/share/doc/supacode/copyright"
install -m 0644 "$root/LICENSE" "$pkgroot/usr/share/licenses/supacode/LICENSE"

dpkg-deb --root-owner-group --build "$pkgroot" "$output"
echo "$output"
