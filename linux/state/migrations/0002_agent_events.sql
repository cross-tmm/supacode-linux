PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('session_start', 'session_end', 'busy', 'awaiting_input', 'idle')),
  worktree_id TEXT,
  tab_id TEXT,
  surface_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_agent_events_surface
  ON agent_events(surface_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_created
  ON agent_events(created_at DESC);
