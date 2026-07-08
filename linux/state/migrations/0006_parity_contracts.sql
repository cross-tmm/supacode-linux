PRAGMA foreign_keys = ON;

ALTER TABLE worktrees ADD COLUMN custom_title TEXT;
ALTER TABLE worktrees ADD COLUMN color TEXT;
ALTER TABLE worktrees ADD COLUMN archived_at INTEGER;

ALTER TABLE notifications ADD COLUMN is_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (is_dismissed IN (0, 1));
ALTER TABLE notifications ADD COLUMN dismissed_at INTEGER;

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'repository')),
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom', 'run', 'setup', 'archive', 'delete')),
  name TEXT NOT NULL,
  color TEXT,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS running_scripts (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  terminal_surface_id TEXT REFERENCES terminal_surfaces(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  stopped_at INTEGER
);

CREATE TABLE IF NOT EXISTS deeplink_policy (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scripts_scope_repo
  ON scripts(scope, repository_id, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_running_scripts_open
  ON running_scripts(worktree_id, stopped_at, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_visible
  ON notifications(is_dismissed, is_read, created_at DESC);
