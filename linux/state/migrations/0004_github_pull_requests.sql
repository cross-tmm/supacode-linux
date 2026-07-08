PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS github_pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  head_ref TEXT,
  base_ref TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0, 1)),
  review_decision TEXT,
  merge_state TEXT,
  checks_state TEXT NOT NULL,
  merge_readiness TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (worktree_id, number)
);

CREATE INDEX IF NOT EXISTS idx_github_pull_requests_worktree
  ON github_pull_requests(worktree_id, updated_at DESC);
