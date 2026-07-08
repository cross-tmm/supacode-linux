# Linux Architecture

## Boundaries

The Linux implementation is split into a headless core and a future GTK terminal host.

- The core owns persistence, repository/worktree commands, settings IO, and packageable CLI
  behavior.
- The GTK host should own windows, sidebar rendering, command palette, terminal tabs/splits, and
  notification presentation.
- Ghostty/libghostty should remain the terminal implementation. Do not rebuild terminal rendering
  with xterm.js for the main product path.

## Persistence

SQLite owns high-churn state:

- repositories and display ordering
- worktrees, archived/pinned flags, and sort ordering
- terminal tabs, surfaces, and layout snapshots
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

- `supacode-linux` app binary
- `supacode-linux-cli` or compatible CLI entrypoint
- desktop entry
- icon assets
- license and documentation

Ubuntu/Debian and Arch are first-class targets. Flatpak should only be added after native package
flows work because terminal apps need broad filesystem, PTY, SSH agent, and shell access.
