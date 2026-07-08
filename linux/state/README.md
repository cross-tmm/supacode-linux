# Linux State

Apply migrations in lexical order. The CLI records applied versions in `schema_migrations`.

The runtime default is `~/.supacode/state.sqlite3`. Tests and development commands can override
that with `SUPACODE_LINUX_DB` or `--db`.
