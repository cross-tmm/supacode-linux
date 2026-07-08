# Linux Packaging

Packaging currently installs the Agent Workbench GTK shell, Linux core CLI, SQLite migrations,
and desktop metadata.

Run `make linux-package-check` before committing packaging changes. Full package smoke tests will
be added once the GTK/Ghostty host produces a real app binary.

## Ubuntu/Debian

The Debian metadata declares runtime dependencies on `git`, `gh`, `nodejs`, `openssh-client`,
and `sqlite3`.
GTK/libadwaita are build dependencies for the planned native host.

## Arch

`arch/PKGBUILD` installs the same CLI core and migrations, depends on `openssh` for remote
repositories, and is structured for eventual AUR use.

## AppImage

The AppImage files provide the desktop entry and launcher contract. A full AppImage build recipe
will be added once the GTK host produces an app binary.
