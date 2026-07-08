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

    const noZmxEnv = { ...process.env, SUPACODE_LINUX_ZMX: join(dir, "missing-zmx") };
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

    const tabs = await spawnFileJSON("node", [cli, "--db", db, "tab", "list", "-w", worktreePath]);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].tabID, createdTerminal.tabID);
    assert.equal(tabs[0].selectedSurfaceID, createdTerminal.surfaceID);

    const secondTabID = "22222222-2222-4222-8222-222222222222";
    const secondTab = await spawnFileJSON(
      "node",
      [
        cli,
        "--db",
        db,
        "tab",
        "new",
        "-w",
        worktreePath,
        "--title",
        "Second task",
        "-i",
        "echo second",
        "-n",
        secondTabID,
      ],
      { env: noZmxEnv }
    );
    assert.equal(secondTab.tabID, secondTabID);
    assert.equal(secondTab.launch.backend, "shell");

    const splitSurfaceID = "33333333-3333-4333-8333-333333333333";
    const splitSurface = await spawnFileJSON(
      "node",
      [
        cli,
        "--db",
        db,
        "surface",
        "split",
        "-s",
        createdTerminal.surfaceID,
        "-d",
        "v",
        "-i",
        "npm test",
        "-n",
        splitSurfaceID,
      ],
      { env: noZmxEnv }
    );
    assert.equal(splitSurface.surfaceID, splitSurfaceID);
    assert.equal(splitSurface.splitParentID, createdTerminal.surfaceID);
    assert.equal(splitSurface.splitDirection, "vertical");
    assert.equal(splitSurface.launch.backend, "shell");

    const surfaces = await spawnFileJSON("node", [cli, "--db", db, "surface", "list", "-t", createdTerminal.tabID]);
    assert.equal(surfaces.length, 2);
    assert.ok(surfaces.some((surface) => surface.surfaceID === splitSurfaceID));

    const focused = await spawnFileJSON("node", [cli, "--db", db, "surface", "focus", "-s", createdTerminal.surfaceID]);
    assert.equal(focused.focused, true);
    assert.equal(focused.surfaceID, createdTerminal.surfaceID);

    const closedSplit = await spawnFileJSON("node", [cli, "--db", db, "surface", "close", "-s", splitSurfaceID]);
    assert.equal(closedSplit.isClosed, true);
    assert.equal(closedSplit.selectedSurfaceID, createdTerminal.surfaceID);

    const closedTab = await spawnFileJSON("node", [cli, "--db", db, "tab", "close", "-t", secondTabID]);
    assert.equal(closedTab.isClosed, true);
    const openTabs = await spawnFileJSON("node", [cli, "--db", db, "tab", "list", "-w", worktreePath]);
    assert.equal(openTabs.length, 1);

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

test("exposes parity snapshot, settings, notifications, scripts, and deeplinks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supacode-linux-test-"));
  try {
    const db = join(dir, "state.sqlite3");
    const repo = join(dir, "repo");
    await spawnFile("git", ["init", repo]);
    await spawnFile("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
    await spawnFile("git", ["-C", repo, "config", "user.name", "Supacode Test"]);
    writeFileSync(join(repo, "README.md"), "# parity\n");
    await spawnFile("git", ["-C", repo, "add", "README.md"]);
    await spawnFile("git", ["-C", repo, "commit", "-m", "Initial commit"]);

    const added = await spawnFileJSON("node", [cli, "--db", db, "repo", "add", repo, "--name", "Parity Repo"]);
    const worktrees = await spawnFileJSON("node", [cli, "--db", db, "worktree", "list", "--repo", added.id]);
    const worktree = worktrees[0];

    const setting = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "settings",
      "set",
      "selectedWorktreeID",
      JSON.stringify(worktree.id),
    ]);
    assert.equal(setting.value, worktree.id);

    const notification = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "notification",
      "create",
      "--worktree",
      worktree.id,
      "--title",
      "Agent needs input",
      "--body",
      "Review the pending command.",
    ]);
    assert.equal(notification.title, "Agent needs input");
    const unread = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "notification",
      "list",
      "--unread",
      "true",
    ]);
    assert.equal(unread.length, 1);

    const script = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "script",
      "save",
      "--name",
      "Run tests",
      "--kind",
      "run",
      "--command",
      "echo parity",
    ]);
    assert.equal(script.scope, "global");
    assert.equal(script.kind, "run");

    const noZmxEnv = { ...process.env, SUPACODE_LINUX_ZMX: join(dir, "missing-zmx") };
    const running = await spawnFileJSON(
      "node",
      [cli, "--db", db, "script", "run", "--id", script.id, "--worktree", worktree.id],
      { env: noZmxEnv }
    );
    assert.equal(running.script.id, script.id);
    assert.equal(running.terminal.launch.backend, "shell");

    const encodedWorktree = encodeURIComponent(worktree.id);
    const pinURL = `supacode://worktree/${encodedWorktree}/pin`;
    const parsed = await spawnFileJSON("node", [cli, "--db", db, "deeplink", "parse", pinURL]);
    assert.equal(parsed.requiresConfirmation, true);
    const blocked = await spawnFileJSON("node", [cli, "--db", db, "deeplink", "run", pinURL]);
    assert.equal(blocked.executed, false);
    assert.equal(blocked.confirmationRequired, true);
    const executed = await spawnFileJSON("node", [
      cli,
      "--db",
      db,
      "deeplink",
      "run",
      pinURL,
      "--allowUnconfirmed",
      "true",
    ]);
    assert.equal(executed.executed, true);

    const deeplinkTabID = "44444444-4444-4444-8444-444444444444";
    const tabURL = `supacode://worktree/${encodedWorktree}/tab/new?input=echo%20deeplink&id=${deeplinkTabID}`;
    const deeplinkTab = await spawnFileJSON(
      "node",
      [cli, "--db", db, "deeplink", "run", tabURL, "--allowUnconfirmed", "true"],
      { env: noZmxEnv }
    );
    assert.equal(deeplinkTab.executed, true);
    assert.equal(deeplinkTab.result.tabID, deeplinkTabID);

    const deeplinkSurfaceID = "55555555-5555-4555-8555-555555555555";
    const splitURL =
      `supacode://worktree/${encodedWorktree}/tab/${running.terminal.tabID}` +
      `/surface/${running.terminal.surfaceID}/split?direction=horizontal&id=${deeplinkSurfaceID}`;
    const deeplinkSplit = await spawnFileJSON(
      "node",
      [cli, "--db", db, "deeplink", "run", splitURL, "--allowUnconfirmed", "true"],
      { env: noZmxEnv }
    );
    assert.equal(deeplinkSplit.executed, true);
    assert.equal(deeplinkSplit.result.surfaceID, deeplinkSurfaceID);
    assert.equal(deeplinkSplit.result.splitDirection, "horizontal");

    const snapshot = await spawnFileJSON("node", [cli, "--db", db, "app", "snapshot"]);
    assert.equal(snapshot.selectedWorktreeID, worktree.id);
    assert.equal(snapshot.selectedSurfaceID, deeplinkSurfaceID);
    assert.equal(snapshot.repositories.length, 1);
    assert.equal(snapshot.worktrees.length, 1);
    assert.equal(snapshot.notifications.length, 1);
    assert.equal(snapshot.scripts.length, 1);
    assert.ok(snapshot.sidebar.sections.some((section) => section.repositoryID === added.id));
    assert.ok(snapshot.commandPaletteItems.some((item) => item.kind === "runScript" || item.kind === "stopScript"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
