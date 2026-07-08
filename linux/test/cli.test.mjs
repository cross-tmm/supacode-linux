import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizePullRequest } from "../src/github-status.mjs";
import { remoteGitCommand } from "../src/remote-git.mjs";
import { resolveTerminalLaunch, zmxSessionID } from "../src/terminal-launch.mjs";
import { shellQuote, spawnFile, spawnFileJSON } from "../src/utils.mjs";

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

test("quotes remote git commands for SSH", () => {
  assert.equal(shellQuote("repo's path"), "'repo'\"'\"'s path'");
  assert.equal(
    remoteGitCommand("/srv/repo path", ["worktree", "add", "/srv/wt path", "-b", "feature/with space"]),
    "git -C '/srv/repo path' worktree add '/srv/wt path' -b 'feature/with space'"
  );
});

test("plans zmx terminal launches with shell fallback", () => {
  const surfaceID = "11111111-2222-3333-4444-555555555555";
  assert.equal(zmxSessionID(surfaceID), "supa-11111111-2222-3333-4444-555555555555");

  const fallback = resolveTerminalLaunch({
    surfaceID,
    worktree: { repositoryKind: "local" },
    cwd: "/repo",
    command: null,
    zmxPath: null,
  });
  assert.equal(fallback.backend, "shell");
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.zmxSessionID, null);

  const zmx = resolveTerminalLaunch({
    surfaceID,
    worktree: { repositoryKind: "local" },
    cwd: "/repo",
    command: null,
    zmxPath: "/usr/bin/zmx",
  });
  assert.equal(zmx.backend, "zmx");
  assert.deepEqual(zmx.commandWrapper, ["/usr/bin/zmx", "attach", "supa-11111111-2222-3333-4444-555555555555"]);

  const remote = resolveTerminalLaunch({
    surfaceID,
    worktree: { repositoryKind: "remote", remoteHost: "dev.example.invalid" },
    cwd: "/srv/repo",
    command: "codex",
    zmxPath: "/usr/bin/zmx",
  });
  assert.equal(remote.backend, "zmx");
  assert.equal(remote.remoteHost, "dev.example.invalid");
  assert.match(remote.command, /zmx' attach supa-11111111-2222-3333-4444-555555555555/);
  assert.match(remote.command, /ssh/);
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

test("auto-installs all supported managed hooks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const home = join(dir, "home");
    const results = await spawnFileJSON("node", [cli, "--db", db, "agent", "auto-install", "--home", home]);
    assert.deepEqual(
      results.map((result) => [result.agent, result.state]),
      [
        ["codex", "installed"],
        ["copilot", "installed"],
      ]
    );
    assert.equal(existsSync(join(home, ".codex/hooks.json")), true);
    assert.equal(existsSync(join(home, ".copilot/hooks/supacode.json")), true);
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

    const noZmxEnv = { ...process.env, AGENT_WORKBENCH_ZMX: join(dir, "missing-zmx") };
    const createdTerminal = await spawnFileJSON(
      "node",
      [
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
      ],
      { env: noZmxEnv }
    );
    assert.equal(createdTerminal.env.SUPACODE_WORKTREE_ID.includes("worktree:"), true);
    assert.equal(createdTerminal.env.SUPACODE_TAB_ID, createdTerminal.tabID);
    assert.equal(createdTerminal.env.SUPACODE_SURFACE_ID, createdTerminal.surfaceID);
    assert.equal(createdTerminal.launch.backend, "shell");
    assert.equal(createdTerminal.launch.degraded, true);

    const terminals = await spawnFileJSON("node", [cli, "--db", db, "terminal", "list", "--worktree", worktreePath]);
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].title, "Feature task");
    assert.equal(terminals[0].launchCommand, "codex");
    assert.equal(terminals[0].launchBackend, "shell");
    assert.equal(terminals[0].launchPlan.backend, "shell");

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

test("registers an SSH repository and creates a remote worktree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const repo = join(dir, "remote-repo");
    await spawnFile("git", ["init", repo]);
    await spawnFile("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
    await spawnFile("git", ["-C", repo, "config", "user.name", "Supacode Test"]);
    writeFileSync(join(repo, "README.md"), "# remote test\n");
    await spawnFile("git", ["-C", repo, "add", "README.md"]);
    await spawnFile("git", ["-C", repo, "commit", "-m", "Initial commit"]);

    const fakeBin = join(dir, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeSSH = join(fakeBin, "ssh");
    writeFileSync(fakeSSH, '#!/usr/bin/env bash\nset -euo pipefail\ncommand="${@: -1}"\nexec bash -lc "$command"\n');
    chmodSync(fakeSSH, 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, SHELL: "/bin/bash" };

    const added = await spawnFileJSON(
      "node",
      [
        cli,
        "--db",
        db,
        "repo",
        "add-remote",
        "--host",
        "dev.example.invalid",
        "--path",
        repo,
        "--name",
        "Remote Repo",
      ],
      { env }
    );
    assert.equal(added.kind, "remote");
    assert.equal(added.id, `remote:dev.example.invalid:${repo}`);
    assert.equal(added.remoteHost, "dev.example.invalid");

    const worktreePath = join(dir, "remote-feature");
    const created = await spawnFileJSON(
      "node",
      [
        cli,
        "--db",
        db,
        "worktree",
        "create",
        "--repo",
        added.id,
        "--name",
        "feature/ssh-core",
        "--path",
        worktreePath,
      ],
      { env }
    );
    assert.equal(created.repositoryID, added.id);
    assert.equal(created.workingDirectory, worktreePath);

    const worktrees = await spawnFileJSON("node", [cli, "--db", db, "worktree", "list", "--repo", added.id], { env });
    assert.equal(worktrees.some((worktree) => worktree.branchName === "feature/ssh-core"), true);
    assert.equal(worktrees.some((worktree) => worktree.repositoryID === added.id), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
