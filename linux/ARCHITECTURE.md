# Linux Architecture

## Boundaries

The Linux implementation is split into a headless core and a native Qt terminal host.

- The core owns persistence, repository/worktree commands, settings IO, packageable CLI behavior,
  terminal surface ID allocation, zmx/shell/SSH launch plans, and layout snapshots.
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
- notification read state
- agent integration install/drift state

JSON owns user-editable settings:

- global preferences
- repository scripts
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
