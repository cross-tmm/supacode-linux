import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizePullRequest } from "../src/github-status.mjs";
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
    assert.equal(status.openTerminalSurfaces, 0);
    assert.equal(status.pullRequests, 0);
    assert.equal(status.agentEvents, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizes GitHub pull request check and merge readiness", () => {
  const ready = normalizePullRequest({
    number: 42,
    title: "Add Linux core",
    url: "https://github.com/example/repo/pull/42",
    state: "OPEN",
    headRefName: "linux-core",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [
      { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
      { context: "lint", state: "SUCCESS" },
    ],
  });
  assert.equal(ready.checksState, "passing");
  assert.equal(ready.mergeReadiness, "ready");

  const blocked = normalizePullRequest({
    number: 43,
    title: "Broken",
    state: "OPEN",
    isDraft: false,
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }],
  });
  assert.equal(blocked.checksState, "failing");
  assert.equal(blocked.mergeReadiness, "checks_failing");
});

test("previews, installs, tracks, and uninstalls managed Copilot hooks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const home = join(dir, "home");
    const preview = await spawnFileJSON("node", [cli, "--db", db, "agent", "preview", "copilot", "--home", home]);
    assert.equal(preview.agent, "copilot");
    assert.equal(preview.files.length, 1);
    assert.equal(preview.files[0].operation, "create");

    const installed = await spawnFileJSON("node", [cli, "--db", db, "agent", "install", "copilot", "--home", home]);
    assert.equal(installed.state, "installed");
    const hookPath = join(home, ".copilot/hooks/supacode.json");
    assert.equal(existsSync(hookPath), true);
    assert.match(readFileSync(hookPath, "utf8"), /supacode-managed-hook/);

    const status = await spawnFileJSON("node", [cli, "--db", db, "agent", "status", "copilot", "--home", home]);
    assert.equal(status[0].state, "installed");

    const event = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "agent",
      "event",
      "--agent",
      "copilot",
      "--event",
      "busy",
      "--surface",
      "surface-1",
    ]);
    assert.equal(event.recorded, true);
    const summary = await spawnFileJSON("node", [cli, "--db", db, "status"]);
    assert.equal(summary.agentEvents, 1);

    const uninstalled = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "agent",
      "uninstall",
      "copilot",
      "--home",
      home,
    ]);
    assert.equal(uninstalled.state, "not_installed");
    assert.equal(existsSync(hookPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installs Codex hooks into an owned hooks file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const home = join(dir, "home");
    const installed = await spawnFileJSON("node", [cli, "--db", db, "agent", "install", "codex", "--home", home]);
    assert.equal(installed.state, "installed");

    const hookPath = join(home, ".codex/hooks.json");
    const hooks = JSON.parse(readFileSync(hookPath, "utf8"));
    assert.ok(hooks.hooks.SessionStart);
    assert.match(JSON.stringify(hooks), /supacode-managed-hook/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to overwrite unmanaged agent hook files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const home = join(dir, "home");
    const hookPath = join(home, ".copilot/hooks/supacode.json");
    mkdirSync(join(home, ".copilot/hooks"), { recursive: true });
    writeFileSync(hookPath, "{}\n");

    await assert.rejects(
      () => spawnFile("node", [cli, "--db", db, "agent", "install", "copilot", "--home", home]),
      /refusing to overwrite unmanaged file/
    );
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

    const createdTerminal = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "terminal",
      "create",
      "--worktree",
      worktreePath,
      "--title",
      "Feature task",
      "--command",
      "codex",
    ]);
    assert.equal(createdTerminal.env.SUPACODE_WORKTREE_ID.includes("worktree:"), true);
    assert.equal(createdTerminal.env.SUPACODE_TAB_ID, createdTerminal.tabID);
    assert.equal(createdTerminal.env.SUPACODE_SURFACE_ID, createdTerminal.surfaceID);

    const terminals = await spawnFileJSON("node", [cli, "--db", db, "terminal", "list", "--worktree", worktreePath]);
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].title, "Feature task");
    assert.equal(terminals[0].launchCommand, "codex");

    const closed = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "terminal",
      "close",
      "--surface",
      createdTerminal.surfaceID,
    ]);
    assert.equal(closed.isClosed, true);
    const summary = await spawnFileJSON("node", [cli, "--db", db, "status"]);
    assert.equal(summary.openTerminalSurfaces, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
