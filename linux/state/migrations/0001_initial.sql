PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'remote')),
  root_path TEXT NOT NULL,
  remote_host TEXT,
  display_name TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_opened_at INTEGER,
  UNIQUE (kind, root_path, remote_host)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_local_root
  ON repositories(root_path)
  WHERE kind = 'local';

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  working_directory TEXT NOT NULL,
  branch_name TEXT,
  detail TEXT,
  is_attached INTEGER NOT NULL DEFAULT 1 CHECK (is_attached IN (0, 1)),
  is_missing INTEGER NOT NULL DEFAULT 0 CHECK (is_missing IN (0, 1)),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (repository_id, working_directory)
);

CREATE TABLE IF NOT EXISTS terminal_tabs (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  title TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  selected_surface_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS terminal_surfaces (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL REFERENCES terminal_tabs(id) ON DELETE CASCADE,
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  zmx_session_id TEXT,
  title TEXT,
  working_directory TEXT,
  split_parent_id TEXT,
  split_direction TEXT CHECK (split_direction IN ('horizontal', 'vertical')),
  agent TEXT,
  task_status TEXT CHECK (task_status IN ('idle', 'busy', 'waiting', 'unknown')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS terminal_layout_snapshots (
  worktree_id TEXT PRIMARY KEY REFERENCES worktrees(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
  surface_id TEXT REFERENCES terminal_surfaces(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_integrations (
  agent TEXT PRIMARY KEY,
  install_state TEXT NOT NULL CHECK (install_state IN ('not_installed', 'installed', 'outdated', 'failed')),
  installed_hash TEXT,
  last_checked_at INTEGER,
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_worktrees_repository_sort
  ON worktrees(repository_id, is_archived, sort_order, branch_name);

CREATE INDEX IF NOT EXISTS idx_terminal_surfaces_worktree
  ON terminal_surfaces(worktree_id);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(is_read, created_at DESC);
