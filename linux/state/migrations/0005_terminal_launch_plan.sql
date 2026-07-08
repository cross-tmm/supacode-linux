PRAGMA foreign_keys = ON;

ALTER TABLE terminal_surfaces
  ADD COLUMN launch_backend TEXT NOT NULL DEFAULT 'shell'
  CHECK (launch_backend IN ('shell', 'zmx', 'remote_ssh'));

ALTER TABLE terminal_surfaces
  ADD COLUMN launch_plan_json TEXT NOT NULL DEFAULT '{}';
