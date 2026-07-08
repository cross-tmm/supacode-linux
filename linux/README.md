# Supacode Linux

Supacode Linux is the Linux implementation track for this fork. The product goal is feature
parity with the macOS Swift app: worktree-first coding-agent workflows, persistent terminal
sessions, agent presence, notifications, GitHub PR state, command palette, scripts, CLI, and
native packaging for Ubuntu and Arch.

Current status: the Linux core is implemented and verified, and a GTK/libadwaita shell exists
under the working name Agent Workbench. Embedded Ghostty terminals and full UI/UX parity are not
implemented yet, so feature parity cannot be claimed until the shell is upgraded into the full
terminal host.

## Implemented Now

- SQLite state database for repositories, worktrees, terminal layouts, notifications, agent
  integrations, agent events, and GitHub PR state.
- CLI entrypoint at `linux/src/supacode-linux.mjs`.
- Repository registration and listing.
- Git worktree discovery and creation.
- SSH-backed remote repository registration and worktree discovery/creation.
- Terminal tab/surface ID allocation, zmx-first launch planning with shell fallback, layout
  snapshot persistence, listing, and closure.
- Auto-installed managed hooks with preview/status/install/uninstall for Codex and Copilot.
- Durable agent hook event capture in SQLite.
- GitHub PR/check state normalization through `gh`.
- GTK/libadwaita desktop shell that reads core state and auto-installs supported managed hooks.
- Ubuntu/Debian, Arch, and AppImage packaging metadata.
- GitHub Actions workflow for Linux core verification.

## Not Implemented Yet

These are required before claiming "no feature difference" with the Swift app:

- Embedded Ghostty terminal surfaces.
- Embedded zmx-backed live session attach/reattach in the GTK/Ghostty host.
- Sidebar UI, tab strip, split panes, search UI, command palette, settings window, and menus.
- System notifications and sounds.
- Remote SSH repository UI and zmx session transport.
- Global/per-repo scripts UI.
- Deeplink handling.
- Full agent integration coverage beyond Codex and Copilot.
- Real `.deb`, AUR, and AppImage release artifacts.

See [`FEATURE_PARITY.md`](FEATURE_PARITY.md) for the release gate.

## Requirements

Minimum runtime requirements for the current CLI core:

- Linux, tested on Ubuntu-like environments.
- Node.js 20+.
- SQLite 3.44+.
- Git.
- OpenSSH client.
- GitHub CLI (`gh`) for PR/check status.

Future GTK host requirements:

- GJS.
- GTK4 development package.
- libadwaita development package.
- Ghostty/libghostty build dependencies.
- zmx when persistent sessions are enabled. Without it, terminal launch plans degrade to shell
  mode.

Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y git gh nodejs openssh-client sqlite3 pkg-config

# Required later for the GTK host:
sudo apt-get install -y gjs libgtk-4-dev libadwaita-1-dev
```

Arch Linux:

```bash
sudo pacman -S git github-cli nodejs openssh sqlite pkgconf

# Required later for the GTK host:
sudo pacman -S gjs gtk4 libadwaita
```

## Setup

Clone your fork:

```bash
git clone https://github.com/cross-tmm/supacode-linux.git
cd supacode-linux
```

Run verification:

```bash
make linux-verify
```

Initialize the default state database:

```bash
mkdir -p ~/.supacode
make linux-state-db LINUX_STATE_DB="$HOME/.supacode/state.sqlite3"
```

Or use the CLI directly:

```bash
node linux/src/supacode-linux.mjs init
node linux/src/supacode-linux.mjs status
```

The default database path is:

```text
~/.supacode/state.sqlite3
```

Override it for development or tests:

```bash
SUPACODE_LINUX_DB=/tmp/supacode-linux.sqlite3 node linux/src/supacode-linux.mjs status
```

## Local CLI Usage

Register a repository:

```bash
node linux/src/supacode-linux.mjs repo add /path/to/repo
node linux/src/supacode-linux.mjs repo list
```

List and create worktrees:

```bash
node linux/src/supacode-linux.mjs worktree list --repo /path/to/repo
node linux/src/supacode-linux.mjs worktree create \
  --repo /path/to/repo \
  --name task/example
```

Register an SSH repository:

```bash
node linux/src/supacode-linux.mjs repo add-remote \
  --host user@example.com \
  --path /srv/projects/repo \
  --name "Remote repo"
```

Remote repositories use IDs shaped like:

```text
remote:user@example.com:/srv/projects/repo
```

List and create remote worktrees:

```bash
node linux/src/supacode-linux.mjs worktree list \
  --repo remote:user@example.com:/srv/projects/repo

node linux/src/supacode-linux.mjs worktree create \
  --repo remote:user@example.com:/srv/projects/repo \
  --name task/remote-example \
  --path /srv/projects/task-remote-example
```

SSH execution is key/agent based and uses `BatchMode=yes` with a short connection timeout, so it
will not stop the desktop shell on password prompts. Run `ssh user@example.com` once first if you
need to accept the host key or configure agent/key access.

Allocate terminal layout state for a worktree:

```bash
node linux/src/supacode-linux.mjs terminal create \
  --worktree /path/to/worktree \
  --title "Task example" \
  --command codex

node linux/src/supacode-linux.mjs terminal list --worktree /path/to/worktree
```

The `terminal create` command prints the environment values a future Ghostty surface must export:

```text
SUPACODE_WORKTREE_ID
SUPACODE_TAB_ID
SUPACODE_SURFACE_ID
```

Those IDs are how agent hooks route events back to the correct surface.

`terminal create` also persists a launch plan. The planner prefers zmx when `zmx` is on `PATH` or
`AGENT_WORKBENCH_ZMX` points at an executable. If zmx is missing, it records a degraded shell plan
instead of failing:

```json
{
  "backend": "shell",
  "degraded": true,
  "reason": "zmx not found; session will not survive app quit"
}
```

Remote worktree surfaces use SSH command lines with connection multiplexing. When local zmx is
available, the local surface wraps the SSH command in `zmx attach`; the remote command also tries
host-side `zmx attach` and falls back to the host shell when zmx is unavailable there.

## Agent Hooks

Supported today:

- Codex
- Copilot CLI

Preview files before writing:

```bash
node linux/src/supacode-linux.mjs agent preview codex
node linux/src/supacode-linux.mjs agent preview copilot
```

Install managed hooks manually:

```bash
node linux/src/supacode-linux.mjs agent install codex
node linux/src/supacode-linux.mjs agent install copilot
```

Auto-install all supported managed hooks, matching the desktop app's first-launch behavior:

```bash
node linux/src/supacode-linux.mjs agent auto-install
```

Check hook state:

```bash
node linux/src/supacode-linux.mjs agent status
```

Uninstall managed hooks:

```bash
node linux/src/supacode-linux.mjs agent uninstall codex
node linux/src/supacode-linux.mjs agent uninstall copilot
```

Safety behavior:

- The installer writes only managed hook files containing `# supacode-managed-hook`.
- It refuses to overwrite unmanaged files.
- It records install state in SQLite.

## GitHub PR State

GitHub status uses the installed `gh` CLI and never stores GitHub credentials.

Authenticate `gh` once:

```bash
gh auth login
```

Sync PR state for a registered worktree:

```bash
node linux/src/supacode-linux.mjs github pr sync --worktree /path/to/worktree
node linux/src/supacode-linux.mjs github pr list --worktree /path/to/worktree
```

The normalized state includes:

- PR number, title, URL, branch refs, draft state.
- Review decision.
- Merge state.
- Check state: `passing`, `pending`, `failing`, or `unknown`.
- Merge readiness: `ready`, `draft`, `blocked`, `behind`, `checks_pending`,
  `checks_failing`, `closed`, `merged`, or `unknown`.

## Verification

Run the full Linux core verification set:

```bash
make linux-verify
```

Individual checks:

```bash
make linux-doctor
make linux-state-check
make linux-test
make linux-package-check
make linux-ui-check
```

What this verifies:

- Required CLI tools are available.
- SQLite migrations apply from scratch.
- Repository/worktree flows work against a temporary Git repository.
- Remote SSH repository/worktree flows work through an SSH command shim.
- Terminal launch plans and layout state are persisted.
- Codex and Copilot hook safety behavior works.
- GitHub PR/check normalization works.
- Packaging metadata is present and shell launchers parse.
- GTK/libadwaita shell imports and, when `xvfb-run` is available, launches against a temporary
  home/database without touching real agent configs.

What this does not verify yet:

- Full UI/UX parity.
- Embedded terminal rendering.
- Embedded local and remote zmx attach/reattach in the GTK/Ghostty host.
- Desktop notifications.
- Real distro package installation.

Those checks must be added with Playwright/dogtail/screenshot-based GTK tests once the visual
host exists.

## Packaging Status

Current packaging files are metadata and install-layout scaffolding:

- `linux/packaging/debian/`
- `linux/packaging/arch/PKGBUILD`
- `linux/packaging/appimage/`

They are not release-ready artifacts because the GTK host and app binary do not exist yet.
Before release, package verification must install the app on clean Ubuntu and Arch images and run
the same smoke flow used by `make linux-verify`.

## UI/UX Acceptance Gate

Before a Linux release can claim parity with the Swift app:

- First launch must open into the usable command-center UI, not a setup-only screen.
- Sidebar must show repositories, folders, worktrees, pinned/archived state, PR/check state, and
  agent attention state.
- Terminal tabs and splits must behave like the macOS app.
- Command palette must cover repo, worktree, terminal, script, GitHub, and settings actions.
- Settings must expose appearance, notifications, scripts, and agent integrations.
- Agent events must update visible badges and system notifications.
- Restart must restore terminal layout and session attachment.

## Development Notes

The chosen stack remains Ghostty GTK/libadwaita for the UI/terminal host. Electron is not the
mainline implementation because terminal correctness, native key handling, PTY behavior, and
session restoration are core product requirements.

## License and Branding

Upstream Supacode is licensed under FSL-1.1-ALv2 and restricts competing commercial use before
the future Apache 2.0 grant. Clear licensing and trademark usage before distributing a public
Linux product under the Supacode name.
