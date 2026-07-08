# Feature Parity Gate

The Linux version must not be released as feature-equivalent to the Swift macOS app until every
required row below is implemented and verified on Ubuntu and Arch Linux.

Status values:

- `Implemented`: works in this repository and is covered by checks.
- `Core only`: persistence or CLI boundary exists, but no visual UI.
- `Missing`: no implementation yet.

| Area | macOS Swift app behavior | Linux status | Release requirement |
| --- | --- | --- | --- |
| Repository registration | Add local repositories and folders from UI/CLI | Core only | GTK add/open flow, folder support, CLI parity |
| Git worktrees | Discover, create, archive, pin, delete, sort | Core only | Sidebar controls for create/archive/pin/delete/sort |
| Terminal engine | Embedded Ghostty terminal | Missing | GTK host embeds Ghostty/libghostty |
| Tabs and splits | Per-worktree tabs, surfaces, split panes | Core only | Visual tab/split UI and persistence |
| zmx sessions | Background persistence and reattach | Missing | zmx attach/reattach, cleanup, crash recovery |
| Agent presence | Live badges and attention state | Core only | Hook events update visible badges in real time |
| Agent integrations | Managed hooks for all supported agents | Core only | Cover all Swift-supported agents with preview/install/uninstall |
| Notifications | In-app and system notifications with sound | Missing | Notification center, sound, click-to-focus |
| GitHub PR/check state | Sidebar PR/check/merge readiness | Core only | Visible badges and refresh strategy |
| Command palette | Fuzzy command palette for app actions | Missing | GTK command palette with keyboard flow |
| Settings | Appearance, notifications, scripts, agents | Missing | GTK settings window |
| Scripts | Global and per-repo setup/run/archive scripts | Missing | Script editor, runner, output terminal |
| Remote SSH repos | SSH-backed repo/worktree/session flows | Missing | SSH transport, auth reuse, remote zmx integration |
| CLI | Repo/worktree/tab/split automation | Core only | Command coverage matching macOS CLI surface |
| Deeplinks | `supacode://` action routing | Missing | Linux desktop URL handler |
| Packaging | Signed app distribution | Core only | `.deb`, AUR/PKGBUILD, AppImage smoke-tested |
| Auto-update | Sparkle update channels on macOS | Missing | Linux update strategy chosen and documented |
| UI/UX | Native command-center experience | Missing | Screenshot/interaction tests pass on Ubuntu and Arch |

## Verification Required Before Release

Run in CI and on real Ubuntu and Arch desktops:

```bash
make linux-verify
```

Additional future UI checks:

- Launch packaged app from desktop entry.
- Add a repository through the UI.
- Create a worktree from the sidebar.
- Open a terminal surface and split it both directions.
- Run Codex or Copilot and verify badge updates.
- Trigger a hook notification and click through to the correct surface.
- Restart the app and verify layout/session restoration.
- Sync GitHub PR state and verify sidebar badges.
- Open settings and install/uninstall each supported agent integration.

The current repository does not yet satisfy the full parity gate because the Linux visual host is
not implemented.
