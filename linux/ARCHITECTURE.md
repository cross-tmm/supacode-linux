# Linux Architecture

## Boundaries

The Linux implementation is split into a headless core and a native Qt terminal host.

- The core owns persistence, repository/worktree commands, settings IO, notification/script/
  deeplink state, packageable CLI behavior, terminal surface ID allocation, zmx/shell/SSH launch
  plans, layout snapshots, and the `app snapshot` JSON contract consumed by Qt.
- GitHub status is pulled through `gh` and normalized before being written to SQLite. The app
  never stores GitHub credentials.
- The Qt host owns windows, sidebar rendering, command palette, terminal tabs/splits, and
  notification presentation.
- Ghostty/libghostty should remain the terminal implementation. Do not rebuild terminal rendering
  with xterm.js for the main product path.

## Persistence

SQLite owns high-churn state:

- repositories and display ordering
- worktrees, archived/pinned flags, and sort ordering
- terminal tabs, surfaces, launch plans, and layout snapshots
- notification read/dismiss state
- agent integration install/drift state
- script definitions and running-script state
- deeplink policy

The `app_settings` table owns user-editable settings until the Swift-compatible settings-file
schema is ported:

- global preferences
- repository appearance and workflow preferences
- notification preferences
- agent integration preferences

Runtime default paths:

- database: `~/.supacode/state.sqlite3`
- settings: `~/.supacode/settings.json`

## Packaging

The Linux package should eventually install:

- `supacode` app binary
- `supacode-linux` core CLI entrypoint
- desktop entry
- icon assets
- license and documentation

Ubuntu/Debian and Arch are first-class targets. Flatpak should only be added after native package
flows work because terminal apps need broad filesystem, PTY, SSH agent, and shell access.
