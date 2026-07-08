PRAGMA foreign_keys = ON;

ALTER TABLE terminal_surfaces ADD COLUMN launch_command TEXT;
ALTER TABLE terminal_surfaces ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_terminal_surfaces_open
  ON terminal_surfaces(worktree_id, is_closed, updated_at DESC);
