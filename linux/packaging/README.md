# Linux Packaging

Packaging currently installs the Agent Workbench GTK shell, Linux core CLI, SQLite migrations,
and desktop metadata.

Run `make linux-package-check` before committing packaging changes.

## Ubuntu/Debian

The Debian metadata declares runtime dependencies on `git`, `gh`, `nodejs`, `openssh-client`,
and `sqlite3`.
GTK/libadwaita are build dependencies for the planned native host.

Build the current package:

```bash
make linux-build-deb VERSION=0.1.0
```

The artifact is written to `build/linux/deb/agent-workbench_0.1.0_all.deb`.

## Arch

`arch/PKGBUILD` installs the same CLI core and migrations, depends on `openssh` for remote
repositories, and is structured for eventual AUR use.

## AppImage

The AppImage files provide the desktop entry and launcher contract. A full AppImage build recipe
will be added once the GTK host produces an app binary.
