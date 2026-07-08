#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="${VERSION:-0.1.0}"
build_root="${root}/build/linux/deb"
pkgroot="${build_root}/agent-workbench_${version}_all"
output="${build_root}/agent-workbench_${version}_all.deb"

umask 022
rm -rf "$pkgroot"
mkdir -p \
  "$pkgroot/DEBIAN" \
  "$pkgroot/usr/bin" \
  "$pkgroot/usr/lib/agent-workbench/app" \
  "$pkgroot/usr/lib/supacode-linux" \
  "$pkgroot/usr/share/applications" \
  "$pkgroot/usr/share/doc/agent-workbench" \
  "$pkgroot/usr/share/licenses/agent-workbench" \
  "$pkgroot/usr/share/supacode-linux/state"

cat >"$pkgroot/DEBIAN/control" <<CONTROL
Package: agent-workbench
Version: ${version}
Section: devel
Priority: optional
Architecture: all
Maintainer: Agent Workbench Maintainers <maintainers@example.invalid>
Depends: git, gh, gjs, libadwaita-1-0, libgtk-4-1, nodejs, openssh-client, sqlite3
Homepage: https://github.com/cross-tmm/supacode-linux
Description: Linux command center for coding agents
 Agent Workbench manages repository worktrees, terminal sessions, and coding
 agent presence from a native Linux desktop app.
CONTROL

install -m 0755 "$root/linux/packaging/bin/agent-workbench" "$pkgroot/usr/bin/agent-workbench"
install -m 0755 "$root/linux/packaging/bin/supacode-linux" "$pkgroot/usr/bin/supacode-linux"
install -m 0755 "$root/linux/src/app/agent-workbench.gjs" "$pkgroot/usr/lib/agent-workbench/app/agent-workbench.gjs"
install -m 0644 "$root/linux/src/"*.mjs "$pkgroot/usr/lib/supacode-linux/"
install -m 0644 "$root/linux/packaging/appimage/agent-workbench.desktop" \
  "$pkgroot/usr/share/applications/agent-workbench.desktop"
cp -R "$root/linux/state/migrations" "$pkgroot/usr/share/supacode-linux/state/"
find "$pkgroot/usr/share/supacode-linux/state/migrations" -type f -exec chmod 0644 {} +
install -m 0644 "$root/LICENSE" "$pkgroot/usr/share/doc/agent-workbench/copyright"
install -m 0644 "$root/LICENSE" "$pkgroot/usr/share/licenses/agent-workbench/LICENSE"

dpkg-deb --root-owner-group --build "$pkgroot" "$output"
echo "$output"
