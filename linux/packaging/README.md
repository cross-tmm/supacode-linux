# Linux Packaging

Packaging is intentionally thin until the GTK/Ghostty host lands. The current package installs
the Linux core CLI, SQLite migrations, and desktop metadata.

## Ubuntu/Debian

The Debian metadata declares runtime dependencies on `git`, `gh`, `nodejs`, and `sqlite3`.
GTK/libadwaita are build dependencies for the planned native host.

## Arch

`arch/PKGBUILD` installs the same CLI core and migrations and is structured for eventual AUR use.

## AppImage

The AppImage files provide the desktop entry and launcher contract. A full AppImage build recipe
will be added once the GTK host produces an app binary.
