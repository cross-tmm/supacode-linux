# Supacode Linux

This directory contains the Linux implementation track for this fork. It is isolated from the
macOS SwiftUI app so the existing app can continue to build while Linux support grows behind a
stable state and command boundary.

## What is implemented

- SQLite schema for repositories, worktrees, terminal layouts, notifications, and agent
  integration state.
- A runnable Linux core CLI at `linux/src/supacode-linux.mjs`.
- Repository registration and listing.
- Git worktree discovery and creation.
- Ubuntu/Debian, Arch, and AppImage packaging skeletons.
- CI-friendly checks through Makefile targets.

## Commands

```bash
make linux-doctor
make linux-state-check
make linux-test
make linux-package-check
```

Create or migrate a state database:

```bash
make linux-state-db LINUX_STATE_DB=$HOME/.supacode/state.sqlite3
```

Use the CLI directly:

```bash
node linux/src/supacode-linux.mjs init
node linux/src/supacode-linux.mjs repo add /path/to/repo
node linux/src/supacode-linux.mjs repo list
node linux/src/supacode-linux.mjs worktree list --repo /path/to/repo
node linux/src/supacode-linux.mjs worktree create --repo /path/to/repo --name task/example
```

Use `SUPACODE_LINUX_DB=/path/to/state.sqlite3` to override the default state path.

## Product direction

- UI and terminal base: Ghostty GTK/libadwaita, not Electron.
- State: SQLite for mutable/indexed app state, JSON under `~/.supacode` for user-editable
  settings.
- Session persistence: integrate `zmx` where available.
- GitHub integration: shell out to `gh`; do not store GitHub credentials.
- Distros: Ubuntu and Arch first. AppImage is for early testers. Flatpak is deferred until the
  sandboxing model is proven compatible with Git, SSH, PTY, and agent hooks.

## License and branding

Upstream Supacode is licensed under FSL-1.1-ALv2 and restricts competing commercial use before
the future Apache 2.0 grant. Clear licensing and trademark usage before distributing a public
Linux product under the Supacode name.
