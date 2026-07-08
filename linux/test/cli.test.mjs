import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnFile, spawnFileJSON } from "../src/utils.mjs";

const cli = join(import.meta.dirname, "../src/supacode-linux.mjs");

test("initializes state database and reports status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    await spawnFile("node", [cli, "--db", db, "init"]);
    const status = await spawnFileJSON("node", [cli, "--db", db, "status"]);
    assert.equal(status.dbPath, db);
    assert.equal(status.repositories, 0);
    assert.equal(status.worktrees, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registers a git repository and creates a worktree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const repo = join(dir, "repo");
    await spawnFile("git", ["init", repo]);
    await spawnFile("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
    await spawnFile("git", ["-C", repo, "config", "user.name", "Supacode Test"]);
    writeFileSync(join(repo, "README.md"), "# test\n");
    await spawnFile("git", ["-C", repo, "add", "README.md"]);
    await spawnFile("git", ["-C", repo, "commit", "-m", "Initial commit"]);

    const added = await spawnFileJSON("node", [cli, "--db", db, "repo", "add", repo]);
    assert.equal(added.rootPath, repo);

    const repos = await spawnFileJSON("node", [cli, "--db", db, "repo", "list"]);
    assert.equal(repos.length, 1);
    assert.equal(repos[0].rootPath, repo);

    const worktreePath = join(dir, "worktree-feature");
    const created = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "worktree",
      "create",
      "--repo",
      repo,
      "--name",
      "feature/linux-core",
      "--path",
      worktreePath,
    ]);
    assert.equal(created.workingDirectory, worktreePath);

    const worktrees = await spawnFileJSON("node", [cli, "--db", db, "worktree", "list", "--repo", repo]);
    assert.equal(worktrees.length, 2);
    assert.ok(worktrees.some((worktree) => worktree.branchName === "feature/linux-core"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
