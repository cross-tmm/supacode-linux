# Linux Packaging

Packaging currently installs the Supacode Qt shell, Linux core CLI, SQLite migrations, and
desktop metadata.

Run `make linux-package-check` before committing packaging changes.

## Ubuntu/Debian

The Debian metadata declares runtime dependencies on `git`, `gh`, Qt6 libraries, `nodejs`,
`openssh-client`, and `sqlite3`. Qt6 is also required at build time.

Build the current package:

```bash
make linux-build-deb VERSION=0.1.0
```

The artifact is written to `build/linux/deb/supacode_0.1.0_<arch>.deb`.

## Arch

`arch/PKGBUILD` builds the Qt shell, installs the same CLI core and migrations, depends on
`openssh` for remote repositories, and is structured for eventual AUR use.

## AppImage

The AppImage files provide the desktop entry and launcher contract. A full AppImage build recipe
will be added after the Qt package smoke flow is stable.
