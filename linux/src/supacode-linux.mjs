#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  installAgent,
  installState,
  previewAgent,
  recordAgentState,
  supportedAgents,
  uninstallAgent,
} from "./agent-integrations.mjs";
import { normalizePullRequest, pullRequestFields } from "./github-status.mjs";
import { remoteGitSSHArgs } from "./remote-git.mjs";
import { findZmxExecutable, resolveTerminalLaunch } from "./terminal-launch.mjs";
import { spawnFile, spawnFileJSON, sqlString } from "./utils.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const migrationDir =
  process.env.SUPACODE_LINUX_MIGRATION_DIR ??
  [join(repoRoot, "linux/state/migrations"), "/usr/share/supacode-linux/state/migrations"].find((path) =>
    existsSync(path)
  ) ??
  join(repoRoot, "linux/state/migrations");

async function main(argv) {
  const { args, dbPath } = parseGlobalArgs(argv);
  const [command, subcommand, ...rest] = args;

  try {
    switch (command) {
      case "doctor":
        await doctor();
        return;
      case "init":
        await migrate(dbPath);
        console.log(`initialized ${dbPath}`);
        return;
      case "app":
        await handleApp(subcommand, rest, dbPath);
        return;
      case "repo":
        await handleRepo(subcommand, rest, dbPath);
        return;
      case "worktree":
        await handleWorktree(subcommand, rest, dbPath);
        return;
      case "terminal":
        await handleTerminal(subcommand, rest, dbPath);
        return;
      case "tab":
        await handleTab(subcommand, rest, dbPath);
        return;
      case "surface":
        await handleSurface(subcommand, rest, dbPath);
        return;
      case "github":
        await handleGithub(subcommand, rest, dbPath);
        return;
      case "agent":
        await handleAgent(subcommand, rest, dbPath);
        return;
      case "settings":
        await handleSettings(subcommand, rest, dbPath);
        return;
      case "notification":
        await handleNotification(subcommand, rest, dbPath);
        return;
      case "script":
        await handleScript(subcommand, rest, dbPath);
        return;
      case "deeplink":
        await handleDeeplink(subcommand, rest, dbPath);
        return;
      case "status":
        await status(dbPath);
        return;
      case "reset-dev-state":
        await resetDevState(dbPath);
        return;
      case undefined:
      case "-h":
      case "--help":
        usage();
        return;
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      usage();
      process.exitCode = 64;
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function handleApp(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "snapshot":
      await appSnapshot(argv, dbPath);
      return;
    default:
      throw new UsageError("app requires snapshot");
  }
}

async function appSnapshot(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  if (options.refresh === "true") {
    await refreshRegisteredRepositories(dbPath);
  }
  const repositories = await querySQL(
    dbPath,
    `SELECT id, kind, root_path AS rootPath, COALESCE(remote_host, '') AS remoteHost,
            display_name AS displayName, color, sort_order AS sortOrder,
            added_at AS addedAt, last_opened_at AS lastOpenedAt
       FROM repositories
      ORDER BY sort_order, display_name, root_path;`
  );
  const worktrees = await querySQL(
    dbPath,
    `SELECT w.id, w.repository_id AS repositoryID, w.working_directory AS workingDirectory,
            w.branch_name AS branchName, w.detail, w.is_attached AS isAttached,
            w.is_missing AS isMissing, w.is_pinned AS isPinned, w.is_archived AS isArchived,
            w.custom_title AS customTitle, w.color, w.sort_order AS sortOrder,
            w.created_at AS createdAt, w.last_seen_at AS lastSeenAt, w.archived_at AS archivedAt,
            r.kind AS repositoryKind, COALESCE(r.remote_host, '') AS remoteHost
       FROM worktrees w
       JOIN repositories r ON r.id = w.repository_id
      ORDER BY w.is_archived, w.sort_order, w.branch_name, w.working_directory;`
  );
  const terminalTabs = await querySQL(
    dbPath,
    `SELECT id, worktree_id AS worktreeID, title, sort_order AS sortOrder,
            selected_surface_id AS selectedSurfaceID, created_at AS createdAt,
            updated_at AS updatedAt
       FROM terminal_tabs
      ORDER BY sort_order, created_at;`
  );
  const terminalSurfaces = (
    await querySQL(
      dbPath,
      `SELECT id AS surfaceID, tab_id AS tabID, worktree_id AS worktreeID,
              zmx_session_id AS zmxSessionID, title, working_directory AS workingDirectory,
              split_parent_id AS splitParentID, split_direction AS splitDirection,
              agent, task_status AS taskStatus, launch_command AS launchCommand,
              launch_backend AS launchBackend, launch_plan_json AS launchPlanJSON,
              is_closed AS isClosed, created_at AS createdAt, updated_at AS updatedAt
         FROM terminal_surfaces
        ORDER BY is_closed, updated_at DESC, created_at DESC;`
    )
  ).map(parseLaunchPlan);
  const layouts = (
    await querySQL(
      dbPath,
      `SELECT worktree_id AS worktreeID, layout_json AS layoutJSON, updated_at AS updatedAt
         FROM terminal_layout_snapshots;`
    )
  ).map((row) => ({ ...row, layout: parseJSON(row.layoutJSON, {}) }));
  const notifications = await notificationRows(dbPath, {});
  const agents = await querySQL(
    dbPath,
    `SELECT agent, install_state AS installState, installed_hash AS installedHash,
            last_checked_at AS lastCheckedAt, last_error AS lastError, updated_at AS updatedAt
       FROM agent_integrations
      ORDER BY agent;`
  );
  const pullRequests = await querySQL(
    dbPath,
    `SELECT worktree_id AS worktreeID, number, title, url, state,
            head_ref AS headRef, base_ref AS baseRef, is_draft AS isDraft,
            review_decision AS reviewDecision, merge_state AS mergeState,
            checks_state AS checksState, merge_readiness AS mergeReadiness,
            updated_at AS updatedAt
       FROM github_pull_requests
      ORDER BY updated_at DESC, number DESC;`
  );
  const scripts = await scriptRows(dbPath, {});
  const runningScripts = await runningScriptRows(dbPath, {});
  const settings = await settingsObject(dbPath);
  const selectedWorktreeID = settings.selectedWorktreeID ?? null;
  const selectedTabID = settings.selectedTabID ?? null;
  const selectedSurfaceID = settings.selectedSurfaceID ?? null;
  const snapshot = {
    schemaVersion: 6,
    generatedAt: Math.floor(Date.now() / 1000),
    settings,
    selectedWorktreeID,
    selectedTabID,
    selectedSurfaceID,
    repositories,
    worktrees,
    sidebar: sidebarSnapshot(repositories, worktrees, selectedWorktreeID),
    terminalTabs,
    terminalSurfaces,
    layouts,
    notifications,
    agents,
    pullRequests,
    scripts,
    runningScripts,
    commandPaletteItems: commandPaletteItems(repositories, worktrees, scripts, runningScripts, selectedWorktreeID),
  };
  console.log(JSON.stringify(snapshot, null, 2));
}

function sidebarSnapshot(repositories, worktrees, selectedWorktreeID) {
  const sections = [];
  const activeWorktrees = worktrees.filter((worktree) => !truthy(worktree.isArchived));
  const pinnedIDs = activeWorktrees.filter((worktree) => truthy(worktree.isPinned)).map((worktree) => worktree.id);
  if (pinnedIDs.length > 0) {
    sections.push({ kind: "highlight", id: "pinned", title: "Pinned", worktreeIDs: pinnedIDs });
  }
  for (const repo of repositories) {
    const rows = activeWorktrees
      .filter((worktree) => worktree.repositoryID === repo.id)
      .map((worktree) => worktree.id);
    sections.push({
      kind: repo.kind === "remote" ? "remoteRepository" : "repository",
      id: repo.id,
      repositoryID: repo.id,
      title: repo.displayName || basename(repo.rootPath),
      color: repo.color,
      worktreeIDs: rows,
      selected: rows.includes(selectedWorktreeID),
    });
  }
  const archivedIDs = worktrees.filter((worktree) => truthy(worktree.isArchived)).map((worktree) => worktree.id);
  if (archivedIDs.length > 0) {
    sections.push({ kind: "archived", id: "archived", title: "Archived Worktrees", worktreeIDs: archivedIDs });
  }
  return { sections, selectedWorktreeID };
}

function commandPaletteItems(repositories, worktrees, scripts, runningScripts, selectedWorktreeID) {
  const items = [
    { id: "global.openRepository", title: "Open Repository or Folder", kind: "openRepository", isGlobal: true },
    { id: "global.addRemoteRepository", title: "Add Remote Repository", kind: "addRemoteRepository", isGlobal: true },
    { id: "global.cloneRepository", title: "Clone Repository", kind: "cloneRepository", isGlobal: true },
    { id: "global.newWorktree", title: "New Worktree", kind: "newWorktree", isGlobal: true },
    { id: "global.refreshWorktrees", title: "Refresh Worktrees", kind: "refreshWorktrees", isGlobal: true },
    { id: "global.archivedWorktrees", title: "View Archived Worktrees", kind: "viewArchivedWorktrees", isGlobal: true },
    { id: "global.settings", title: "Open Settings", kind: "openSettings", isGlobal: true },
  ];
  const repoByID = new Map(repositories.map((repo) => [repo.id, repo]));
  for (const worktree of worktrees) {
    if (truthy(worktree.isArchived)) continue;
    const repo = repoByID.get(worktree.repositoryID);
    const repoName = repo?.displayName || basename(repo?.rootPath ?? "Repository");
    const title = worktree.customTitle || worktree.branchName || basename(worktree.workingDirectory);
    items.push({
      id: `worktree.${worktree.id}`,
      title: `${repoName} / ${title}`,
      subtitle: worktree.workingDirectory,
      kind: "selectWorktree",
      worktreeID: worktree.id,
      repositoryID: worktree.repositoryID,
      isGlobal: false,
    });
  }
  for (const script of scripts) {
    const isRunning = runningScripts.some(
      (running) => running.scriptID === script.id && !running.stoppedAt
    );
    items.push({
      id: `script.${script.id}.${isRunning ? "stop" : "run"}`,
      title: `${isRunning ? "Stop" : "Run"} ${script.name}`,
      subtitle: script.scope === "global" ? "Global Script" : "Repository Script",
      kind: isRunning ? "stopScript" : "runScript",
      scriptID: script.id,
      worktreeID: selectedWorktreeID,
      isGlobal: false,
    });
  }
  return items;
}

async function handleGithub(subcommand, argv, dbPath) {
  if (subcommand !== "pr") {
    throw new UsageError("github requires pr");
  }
  const [prCommand, ...rest] = argv;
  switch (prCommand) {
    case "sync":
      await syncPullRequest(rest, dbPath);
      return;
    case "list":
      await listPullRequests(rest, dbPath);
      return;
    default:
      throw new UsageError("github pr requires sync or list");
  }
}

async function syncPullRequest(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.worktree) {
    throw new UsageError("github pr sync requires --worktree");
  }
  await migrate(dbPath);
  const worktree = await resolveWorktree(dbPath, options.worktree);
  const args = ["pr", "view"];
  if (options.number) {
    args.push(options.number);
  }
  args.push("--json", pullRequestFields);
  if (options.repo) {
    args.push("--repo", options.repo);
  }
  const raw = await spawnFileJSON("gh", args, { cwd: worktree.workingDirectory });
  const normalized = normalizePullRequest(raw);
  await persistPullRequest(dbPath, worktree.id, normalized);
  console.log(JSON.stringify({ worktreeID: worktree.id, ...withoutRaw(normalized) }, null, 2));
}

async function listPullRequests(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const worktree = options.worktree ? await resolveWorktree(dbPath, options.worktree) : null;
  const where = worktree ? `WHERE worktree_id = ${sqlString(worktree.id)}` : "";
  const rows = await querySQL(
    dbPath,
    `SELECT worktree_id AS worktreeID, number, title, url, state,
            head_ref AS headRef, base_ref AS baseRef, is_draft AS isDraft,
            review_decision AS reviewDecision, merge_state AS mergeState,
            checks_state AS checksState, merge_readiness AS mergeReadiness,
            updated_at AS updatedAt
       FROM github_pull_requests
       ${where}
      ORDER BY updated_at DESC, number DESC;`
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function persistPullRequest(dbPath, worktreeID, pr) {
  await execSQL(
    dbPath,
    `INSERT INTO github_pull_requests(
       worktree_id, number, title, url, state, head_ref, base_ref, is_draft,
       review_decision, merge_state, checks_state, merge_readiness, raw_json, updated_at
     )
     VALUES (
       ${sqlString(worktreeID)}, ${Number(pr.number)}, ${sqlString(pr.title)}, ${sqlString(pr.url)},
       ${sqlString(pr.state)}, ${sqlString(pr.headRef)}, ${sqlString(pr.baseRef)}, ${pr.isDraft ? 1 : 0},
       ${sqlString(pr.reviewDecision)}, ${sqlString(pr.mergeState)}, ${sqlString(pr.checksState)},
       ${sqlString(pr.mergeReadiness)}, ${sqlString(JSON.stringify(pr.raw))}, unixepoch()
     )
     ON CONFLICT(worktree_id, number) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       state = excluded.state,
       head_ref = excluded.head_ref,
       base_ref = excluded.base_ref,
       is_draft = excluded.is_draft,
       review_decision = excluded.review_decision,
       merge_state = excluded.merge_state,
       checks_state = excluded.checks_state,
       merge_readiness = excluded.merge_readiness,
       raw_json = excluded.raw_json,
       updated_at = excluded.updated_at;`
  );
}

function withoutRaw(pr) {
  const { raw, ...rest } = pr;
  return rest;
}

async function handleAgent(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      console.log(JSON.stringify(supportedAgents, null, 2));
      return;
    case "preview":
      await previewAgentCommand(argv);
      return;
    case "status":
      await agentStatus(argv, dbPath);
      return;
    case "install":
      await installAgentCommand(argv, dbPath);
      return;
    case "auto-install":
      await autoInstallAgents(argv, dbPath);
      return;
    case "uninstall":
      await uninstallAgentCommand(argv, dbPath);
      return;
    case "event":
      await recordAgentEvent(argv, dbPath);
      return;
    default:
      throw new UsageError("agent requires list, preview, status, auto-install, install, uninstall, or event");
  }
}

async function autoInstallAgents(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const home = options.home ?? homedir();
  const results = [];
  for (const agent of supportedAgents) {
    try {
      const state = installAgent(agent, home);
      await recordAgentState(execSQL, dbPath, agent, state);
      results.push({ agent, state, installed: state === "installed" });
    } catch (error) {
      await recordAgentState(execSQL, dbPath, agent, "failed", error.message);
      results.push({ agent, state: "failed", installed: false, error: error.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

async function handleTerminal(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "create":
      await createTerminal(argv, dbPath);
      return;
    case "list":
      await listTerminals(argv, dbPath);
      return;
    case "close":
      await closeTerminal(argv, dbPath);
      return;
    default:
      throw new UsageError("terminal requires create, list, or close");
  }
}

async function handleTab(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      await listTabs(argv, dbPath);
      return;
    case "focus":
      await focusTab(argv, dbPath);
      return;
    case "new":
      await newTab(argv, dbPath);
      return;
    case "close":
      await closeTab(argv, dbPath);
      return;
    default:
      throw new UsageError("tab requires list, focus, new, or close");
  }
}

async function handleSurface(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      await listSurfaces(argv, dbPath);
      return;
    case "focus":
      await focusSurface(argv, dbPath);
      return;
    case "split":
      await splitSurface(argv, dbPath);
      return;
    case "close":
      await closeSurface(argv, dbPath);
      return;
    default:
      throw new UsageError("surface requires list, focus, split, or close");
  }
}

async function createTerminal(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.worktree) {
    throw new UsageError("terminal create requires --worktree");
  }
  await migrate(dbPath);
  const created = await createTerminalRecord(dbPath, {
    worktree: await resolveWorktree(dbPath, options.worktree),
    title: options.title,
    cwd: options.cwd,
    command: options.command,
  });
  console.log(JSON.stringify(created));
}

async function createTerminalRecord(dbPath, { worktree, title, cwd: rawCwd, command, tabID = randomUUID(), surfaceID = randomUUID() }) {
  const terminalTitle = title ?? worktree.branchName ?? basename(worktree.workingDirectory);
  await execSQL(
    dbPath,
    `INSERT INTO terminal_tabs(id, worktree_id, title, sort_order, selected_surface_id)
     VALUES (${sqlString(tabID)}, ${sqlString(worktree.id)}, ${sqlString(terminalTitle)}, 0, ${sqlString(surfaceID)});`
  );
  const surface = await createSurfaceRecord(dbPath, {
    worktree,
    tabID,
    surfaceID,
    title: terminalTitle,
    cwd: rawCwd,
    command,
  });
  await setSelectedTerminal(dbPath, {
    worktreeID: worktree.id,
    tabID,
    surfaceID,
  });
  return {
    worktreeID: worktree.id,
    tabID,
    surfaceID,
    zmxSessionID: surface.zmxSessionID,
    launch: surface.launch,
    env: surface.env,
  };
}

async function createSurfaceRecord(
  dbPath,
  { worktree, tabID, surfaceID = randomUUID(), title, cwd: rawCwd, command, splitParentID = null, splitDirection = null }
) {
  const terminalTitle = title ?? worktree.branchName ?? basename(worktree.workingDirectory);
  const cwd = cwdForWorktree(worktree, rawCwd);
  const launchCommand = command ?? null;
  const launch = resolveTerminalLaunch({
    surfaceID,
    worktree,
    cwd,
    command: launchCommand,
    zmxPath: findZmxExecutable(),
  });
  await execSQL(
    dbPath,
    `INSERT INTO terminal_surfaces(
       id, tab_id, worktree_id, zmx_session_id, title, working_directory,
       split_parent_id, split_direction, launch_command, launch_backend,
       launch_plan_json, task_status
     )
     VALUES (${sqlString(surfaceID)}, ${sqlString(tabID)}, ${sqlString(worktree.id)}, ${sqlString(launch.zmxSessionID)},
             ${sqlString(terminalTitle)}, ${sqlString(cwd)}, ${sqlString(splitParentID)},
             ${sqlString(splitDirection)}, ${sqlString(launchCommand)}, ${sqlString(launch.backend)},
             ${sqlString(JSON.stringify(launch))}, 'idle');`
  );
  await execSQL(
    dbPath,
    `UPDATE terminal_tabs
        SET selected_surface_id = ${sqlString(surfaceID)}, updated_at = unixepoch()
      WHERE id = ${sqlString(tabID)};`
  );
  await saveLayoutSnapshot(dbPath, worktree.id);
  return {
    worktreeID: worktree.id,
    tabID,
    surfaceID,
    splitParentID,
    splitDirection,
    zmxSessionID: launch.zmxSessionID,
    launch,
    env: {
      SUPACODE_REPO_ID: worktree.repositoryID,
      SUPACODE_WORKTREE_ID: worktree.id,
      SUPACODE_TAB_ID: tabID,
      SUPACODE_SURFACE_ID: surfaceID,
    },
  };
}

async function listTabs(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const worktree = await optionalResolvedWorktree(dbPath, options);
  const focusedTabID = options.focused ? await getSettingValue(dbPath, "selectedTabID") : null;
  const clauses = [];
  if (worktree) clauses.push(`t.worktree_id = ${sqlString(worktree.id)}`);
  if (focusedTabID) clauses.push(`t.id = ${sqlString(focusedTabID)}`);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await querySQL(
    dbPath,
    `SELECT t.id AS tabID, t.worktree_id AS worktreeID, t.title,
            t.sort_order AS sortOrder, t.selected_surface_id AS selectedSurfaceID,
            t.created_at AS createdAt, t.updated_at AS updatedAt,
            SUM(CASE WHEN s.is_closed = 0 THEN 1 ELSE 0 END) AS openSurfaceCount
       FROM terminal_tabs t
       LEFT JOIN terminal_surfaces s ON s.tab_id = t.id
       ${where}
      GROUP BY t.id
      HAVING openSurfaceCount > 0 OR ${options.closed ? 1 : 0} = 1
      ORDER BY t.sort_order, t.created_at;`
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function focusTab(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const tab = await resolveTab(dbPath, optionOrEnv(options, "tab", "SUPACODE_TAB_ID"));
  const selectedSurfaceID = tab.selectedSurfaceID ?? (await firstOpenSurfaceID(dbPath, tab.tabID));
  await setSelectedTerminal(dbPath, {
    worktreeID: tab.worktreeID,
    tabID: tab.tabID,
    surfaceID: selectedSurfaceID,
  });
  console.log(JSON.stringify({ ...tab, selectedSurfaceID, focused: true }, null, 2));
}

async function newTab(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const rawWorktree = optionOrEnv(options, "worktree", "SUPACODE_WORKTREE_ID");
  if (!rawWorktree) {
    throw new UsageError("tab new requires --worktree or SUPACODE_WORKTREE_ID");
  }
  const created = await createTerminalRecord(dbPath, {
    worktree: await resolveWorktree(dbPath, rawWorktree),
    title: options.title,
    cwd: options.cwd,
    command: options.input ?? options.command,
    tabID: options.id ?? randomUUID(),
  });
  console.log(JSON.stringify(created, null, 2));
}

async function closeTab(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const tab = await resolveTab(dbPath, optionOrEnv(options, "tab", "SUPACODE_TAB_ID"));
  await execSQL(
    dbPath,
    `UPDATE terminal_surfaces
        SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
      WHERE tab_id = ${sqlString(tab.tabID)};`
  );
  await saveLayoutSnapshot(dbPath, tab.worktreeID);
  console.log(JSON.stringify({ tabID: tab.tabID, worktreeID: tab.worktreeID, isClosed: true }));
}

async function listSurfaces(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const worktree = await optionalResolvedWorktree(dbPath, options);
  const tabID = optionOrEnv(options, "tab", "SUPACODE_TAB_ID");
  const focusedSurfaceID = options.focused ? await getSettingValue(dbPath, "selectedSurfaceID") : null;
  const clauses = [];
  if (worktree) clauses.push(`s.worktree_id = ${sqlString(worktree.id)}`);
  if (tabID) clauses.push(`s.tab_id = ${sqlString(tabID)}`);
  if (focusedSurfaceID) clauses.push(`s.id = ${sqlString(focusedSurfaceID)}`);
  if (!options.closed) clauses.push("s.is_closed = 0");
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await querySQL(
    dbPath,
    `SELECT s.id AS surfaceID, s.tab_id AS tabID, s.worktree_id AS worktreeID,
            s.title, s.working_directory AS workingDirectory,
            s.split_parent_id AS splitParentID, s.split_direction AS splitDirection,
            s.zmx_session_id AS zmxSessionID, s.launch_backend AS launchBackend,
            s.launch_plan_json AS launchPlanJSON,
            s.launch_command AS launchCommand, s.task_status AS taskStatus,
            s.is_closed AS isClosed, s.created_at AS createdAt, s.updated_at AS updatedAt
       FROM terminal_surfaces s
       ${where}
      ORDER BY s.tab_id, s.created_at;`
  );
  console.log(JSON.stringify(rows.map(parseLaunchPlan), null, 2));
}

async function focusSurface(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const surface = await resolveSurface(dbPath, optionOrEnv(options, "surface", "SUPACODE_SURFACE_ID"));
  await setSelectedTerminal(dbPath, {
    worktreeID: surface.worktreeID,
    tabID: surface.tabID,
    surfaceID: surface.surfaceID,
  });
  if (options.input) {
    await setSettingValue(dbPath, `pendingSurfaceInput.${surface.surfaceID}`, options.input);
  }
  console.log(JSON.stringify({ ...surface, focused: true, input: options.input ?? null }, null, 2));
}

async function splitSurface(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const parent = await resolveSurface(dbPath, optionOrEnv(options, "surface", "SUPACODE_SURFACE_ID"));
  const worktree = await resolveWorktree(dbPath, parent.worktreeID);
  const splitDirection = normalizeSplitDirection(options.direction ?? "horizontal");
  const created = await createSurfaceRecord(dbPath, {
    worktree,
    tabID: parent.tabID,
    surfaceID: options.id ?? randomUUID(),
    title: options.title ?? parent.title,
    cwd: options.cwd ?? parent.workingDirectory,
    command: options.input ?? options.command,
    splitParentID: parent.surfaceID,
    splitDirection,
  });
  await setSelectedTerminal(dbPath, {
    worktreeID: worktree.id,
    tabID: parent.tabID,
    surfaceID: created.surfaceID,
  });
  console.log(JSON.stringify(created, null, 2));
}

async function closeSurface(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const surface = await resolveSurface(dbPath, optionOrEnv(options, "surface", "SUPACODE_SURFACE_ID"));
  await execSQL(
    dbPath,
    `UPDATE terminal_surfaces
        SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
      WHERE id = ${sqlString(surface.surfaceID)};`
  );
  const fallbackSurfaceID = await firstOpenSurfaceID(dbPath, surface.tabID);
  if (fallbackSurfaceID) {
    await setSelectedTerminal(dbPath, {
      worktreeID: surface.worktreeID,
      tabID: surface.tabID,
      surfaceID: fallbackSurfaceID,
    });
  }
  await saveLayoutSnapshot(dbPath, surface.worktreeID);
  console.log(JSON.stringify({ surfaceID: surface.surfaceID, isClosed: true, selectedSurfaceID: fallbackSurfaceID }));
}

async function listTerminals(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const worktree = options.worktree ? await resolveWorktree(dbPath, options.worktree) : null;
  const where = worktree ? `WHERE s.worktree_id = ${sqlString(worktree.id)}` : "";
  const rows = await querySQL(
    dbPath,
    `SELECT s.id AS surfaceID, s.tab_id AS tabID, s.worktree_id AS worktreeID,
            s.title, s.working_directory AS workingDirectory,
            s.zmx_session_id AS zmxSessionID, s.launch_backend AS launchBackend,
            s.launch_plan_json AS launchPlanJSON,
            s.launch_command AS launchCommand, s.task_status AS taskStatus,
            s.is_closed AS isClosed, s.created_at AS createdAt, s.updated_at AS updatedAt
       FROM terminal_surfaces s
       ${where}
      ORDER BY s.is_closed, s.updated_at DESC, s.created_at DESC;`
  );
  console.log(JSON.stringify(rows.map(parseLaunchPlan), null, 2));
}

async function closeTerminal(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.surface) {
    throw new UsageError("terminal close requires --surface");
  }
  await migrate(dbPath);
  const surface = await resolveSurface(dbPath, options.surface);
  await execSQL(
    dbPath,
    `UPDATE terminal_surfaces
        SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
      WHERE id = ${sqlString(options.surface)};`
  );
  const fallbackSurfaceID = await firstOpenSurfaceID(dbPath, surface.tabID);
  if (fallbackSurfaceID) {
    await setSelectedTerminal(dbPath, {
      worktreeID: surface.worktreeID,
      tabID: surface.tabID,
      surfaceID: fallbackSurfaceID,
    });
  }
  await saveLayoutSnapshot(dbPath, surface.worktreeID);
  console.log(JSON.stringify({ surfaceID: options.surface, isClosed: true, selectedSurfaceID: fallbackSurfaceID }));
}

async function previewAgentCommand(argv) {
  const options = parseOptions(argv);
  const agent = requireAgent(options._[0]);
  console.log(JSON.stringify(previewAgent(agent, options.home ?? homedir()), null, 2));
}

async function agentStatus(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const agents = options._[0] ? [requireAgent(options._[0])] : supportedAgents;
  const rows = [];
  for (const agent of agents) {
    let state = "failed";
    let error = null;
    try {
      state = installState(agent, options.home ?? homedir());
    } catch (caught) {
      error = caught.message;
    }
    await recordAgentState(execSQL, dbPath, agent, state, error);
    rows.push({ agent, state, error });
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function installAgentCommand(argv, dbPath) {
  const options = parseOptions(argv);
  const agent = requireAgent(options._[0]);
  await migrate(dbPath);
  try {
    const state = installAgent(agent, options.home ?? homedir());
    await recordAgentState(execSQL, dbPath, agent, state);
    console.log(JSON.stringify({ agent, state }));
  } catch (error) {
    await recordAgentState(execSQL, dbPath, agent, "failed", error.message);
    throw error;
  }
}

async function uninstallAgentCommand(argv, dbPath) {
  const options = parseOptions(argv);
  const agent = requireAgent(options._[0]);
  await migrate(dbPath);
  try {
    const state = uninstallAgent(agent, options.home ?? homedir());
    await recordAgentState(execSQL, dbPath, agent, state);
    console.log(JSON.stringify({ agent, state }));
  } catch (error) {
    await recordAgentState(execSQL, dbPath, agent, "failed", error.message);
    throw error;
  }
}

async function recordAgentEvent(argv, dbPath) {
  const options = parseOptions(argv);
  const agent = requireAgent(options.agent);
  const event = requireEvent(options.event);
  await migrate(dbPath);
  const payload = {
    notify: options.notify === "true",
  };
  await execSQL(
    dbPath,
    `INSERT INTO agent_events(agent, event, worktree_id, tab_id, surface_id, payload_json)
     VALUES (${sqlString(agent)}, ${sqlString(event)}, ${sqlString(options.worktree ?? "")},
             ${sqlString(options.tab ?? "")}, ${sqlString(options.surface ?? "")},
             ${sqlString(JSON.stringify(payload))});`
  );
  if (payload.notify) {
    await createNotificationRecord(dbPath, {
      worktreeID: options.worktree ?? null,
      surfaceID: options.surface ?? null,
      title: agentEventTitle(agent, event),
      body: options.body ?? "",
    });
  }
  console.log(JSON.stringify({ agent, event, recorded: true }));
}

async function handleSettings(subcommand, argv, dbPath) {
  switch (subcommand) {
    case undefined:
    case "list":
      await listSettings(dbPath);
      return;
    case "get":
      await getSetting(argv, dbPath);
      return;
    case "set":
      await setSetting(argv, dbPath);
      return;
    default:
      throw new UsageError("settings requires list, get, or set");
  }
}

async function listSettings(dbPath) {
  await migrate(dbPath);
  console.log(JSON.stringify(await settingsObject(dbPath), null, 2));
}

async function getSetting(argv, dbPath) {
  const options = parseOptions(argv);
  const key = options._[0];
  if (!key) {
    throw new UsageError("settings get requires a key");
  }
  await migrate(dbPath);
  const settings = await settingsObject(dbPath);
  console.log(JSON.stringify({ key, value: settings[key] ?? null }, null, 2));
}

async function setSetting(argv, dbPath) {
  const options = parseOptions(argv);
  const [key, rawValue] = options._;
  if (!key) {
    throw new UsageError("settings set requires a key");
  }
  if (rawValue === undefined) {
    throw new UsageError("settings set requires a JSON value");
  }
  await migrate(dbPath);
  const value = parseJSON(rawValue, rawValue);
  await setSettingValue(dbPath, key, value);
  console.log(JSON.stringify({ key, value }, null, 2));
}

async function handleNotification(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      await listNotifications(argv, dbPath);
      return;
    case "create":
      await createNotification(argv, dbPath);
      return;
    case "read":
      await markNotificationRead(argv, dbPath);
      return;
    case "dismiss":
      await dismissNotification(argv, dbPath);
      return;
    case "dismiss-all":
      await dismissAllNotifications(argv, dbPath);
      return;
    default:
      throw new UsageError("notification requires list, create, read, dismiss, or dismiss-all");
  }
}

async function listNotifications(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  console.log(
    JSON.stringify(
      await notificationRows(dbPath, {
        worktreeID: options.worktree,
        unreadOnly: options.unread === "true",
        includeDismissed: options.dismissed === "true",
      }),
      null,
      2
    )
  );
}

async function createNotification(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.title) {
    throw new UsageError("notification create requires --title");
  }
  await migrate(dbPath);
  const notification = await createNotificationRecord(dbPath, {
    worktreeID: options.worktree ?? null,
    surfaceID: options.surface ?? null,
    title: options.title,
    body: options.body ?? "",
  });
  console.log(JSON.stringify(notification, null, 2));
}

async function markNotificationRead(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.id) {
    throw new UsageError("notification read requires --id");
  }
  await migrate(dbPath);
  await execSQL(
    dbPath,
    `UPDATE notifications SET is_read = 1 WHERE id = ${sqlString(options.id)};`
  );
  console.log(JSON.stringify({ id: options.id, isRead: true }));
}

async function dismissNotification(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.id) {
    throw new UsageError("notification dismiss requires --id");
  }
  await migrate(dbPath);
  await execSQL(
    dbPath,
    `UPDATE notifications
        SET is_dismissed = 1, dismissed_at = unixepoch(), is_read = 1
      WHERE id = ${sqlString(options.id)};`
  );
  console.log(JSON.stringify({ id: options.id, isDismissed: true }));
}

async function dismissAllNotifications(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const where = options.worktree ? `AND worktree_id = ${sqlString(options.worktree)}` : "";
  await execSQL(
    dbPath,
    `UPDATE notifications
        SET is_dismissed = 1, dismissed_at = unixepoch(), is_read = 1
      WHERE is_dismissed = 0 ${where};`
  );
  console.log(JSON.stringify({ dismissed: true, worktreeID: options.worktree ?? null }));
}

async function handleScript(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      await listScripts(argv, dbPath);
      return;
    case "save":
      await saveScript(argv, dbPath);
      return;
    case "delete":
      await deleteScript(argv, dbPath);
      return;
    case "run":
      await runScript(argv, dbPath);
      return;
    case "stop":
      await stopScript(argv, dbPath);
      return;
    default:
      throw new UsageError("script requires list, save, delete, run, or stop");
  }
}

async function listScripts(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  console.log(
    JSON.stringify(
      await scriptRows(dbPath, {
        repositoryID: options.repo,
        includeGlobal: options.global !== "false",
      }),
      null,
      2
    )
  );
}

async function saveScript(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.name) {
    throw new UsageError("script save requires --name");
  }
  if (!options.command) {
    throw new UsageError("script save requires --command");
  }
  const id = options.id ?? randomUUID();
  const scope = options.repo ? "repository" : options.scope ?? "global";
  if (!["global", "repository"].includes(scope)) {
    throw new UsageError("script --scope must be global or repository");
  }
  if (scope === "repository" && !options.repo) {
    throw new UsageError("repository scripts require --repo");
  }
  const kind = options.kind ?? "custom";
  if (!["custom", "run", "setup", "archive", "delete"].includes(kind)) {
    throw new UsageError("script --kind must be custom, run, setup, archive, or delete");
  }
  await migrate(dbPath);
  await execSQL(
    dbPath,
    `INSERT INTO scripts(id, scope, repository_id, kind, name, color, command, sort_order, is_enabled, updated_at)
     VALUES (${sqlString(id)}, ${sqlString(scope)}, ${sqlString(options.repo ?? null)}, ${sqlString(kind)},
             ${sqlString(options.name)}, ${sqlString(options.color ?? null)}, ${sqlString(options.command)},
             ${Number(options.order ?? 0)}, ${options.enabled === "false" ? 0 : 1}, unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       scope = excluded.scope,
       repository_id = excluded.repository_id,
       kind = excluded.kind,
       name = excluded.name,
       color = excluded.color,
       command = excluded.command,
       sort_order = excluded.sort_order,
       is_enabled = excluded.is_enabled,
       updated_at = excluded.updated_at;`
  );
  console.log(JSON.stringify((await scriptRows(dbPath, { id }))[0], null, 2));
}

async function deleteScript(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.id) {
    throw new UsageError("script delete requires --id");
  }
  await migrate(dbPath);
  await execSQL(dbPath, `DELETE FROM scripts WHERE id = ${sqlString(options.id)};`);
  console.log(JSON.stringify({ id: options.id, deleted: true }));
}

async function runScript(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.id) {
    throw new UsageError("script run requires --id");
  }
  if (!options.worktree) {
    throw new UsageError("script run requires --worktree");
  }
  await migrate(dbPath);
  const script = (await scriptRows(dbPath, { id: options.id }))[0];
  if (!script) {
    throw new UsageError(`script not found: ${options.id}`);
  }
  if (!truthy(script.isEnabled)) {
    throw new UsageError(`script is disabled: ${options.id}`);
  }
  const terminal = await createTerminalRecord(dbPath, {
    worktree: await resolveWorktree(dbPath, options.worktree),
    title: script.name,
    command: script.command,
    cwd: options.cwd,
  });
  const runningID = randomUUID();
  await execSQL(
    dbPath,
    `INSERT INTO running_scripts(id, script_id, worktree_id, terminal_surface_id)
     VALUES (${sqlString(runningID)}, ${sqlString(script.id)}, ${sqlString(terminal.worktreeID)},
             ${sqlString(terminal.surfaceID)});`
  );
  console.log(JSON.stringify({ id: runningID, script, terminal }, null, 2));
}

async function stopScript(argv, dbPath) {
  const options = parseOptions(argv);
  if (!options.id) {
    throw new UsageError("script stop requires --id");
  }
  await migrate(dbPath);
  const worktreeWhere = options.worktree ? `AND worktree_id = ${sqlString(options.worktree)}` : "";
  const rows = await querySQL(
    dbPath,
    `SELECT id, terminal_surface_id AS terminalSurfaceID
       FROM running_scripts
      WHERE script_id = ${sqlString(options.id)}
        AND stopped_at IS NULL
        ${worktreeWhere};`
  );
  await execSQL(
    dbPath,
    `UPDATE running_scripts
        SET stopped_at = unixepoch()
      WHERE script_id = ${sqlString(options.id)}
        AND stopped_at IS NULL
        ${worktreeWhere};`
  );
  for (const row of rows) {
    if (!row.terminalSurfaceID) continue;
    await execSQL(
      dbPath,
      `UPDATE terminal_surfaces
          SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
        WHERE id = ${sqlString(row.terminalSurfaceID)};`
    );
  }
  console.log(JSON.stringify({ scriptID: options.id, stopped: rows.length }));
}

async function handleDeeplink(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "parse":
      await parseDeeplinkCommand(argv, dbPath);
      return;
    case "run":
      await runDeeplinkCommand(argv, dbPath);
      return;
    default:
      throw new UsageError("deeplink requires parse or run");
  }
}

async function parseDeeplinkCommand(argv, dbPath) {
  const options = parseOptions(argv);
  const url = options._[0] ?? options.url;
  if (!url) {
    throw new UsageError("deeplink parse requires a URL");
  }
  await migrate(dbPath);
  console.log(JSON.stringify(parseDeeplink(url), null, 2));
}

async function runDeeplinkCommand(argv, dbPath) {
  const options = parseOptions(argv);
  const url = options._[0] ?? options.url;
  if (!url) {
    throw new UsageError("deeplink run requires a URL");
  }
  await migrate(dbPath);
  const parsed = parseDeeplink(url);
  const allowUnconfirmed =
    options.allowUnconfirmed === "true" ||
    (await getSettingValue(dbPath, "deeplink.allowArbitraryActions")) === true;
  if (parsed.requiresConfirmation && !allowUnconfirmed) {
    console.log(JSON.stringify({ ...parsed, executed: false, confirmationRequired: true }, null, 2));
    return;
  }
  const result = await executeDeeplink(dbPath, parsed);
  console.log(JSON.stringify({ ...parsed, executed: true, result }, null, 2));
}

function requireAgent(agent) {
  if (!supportedAgents.includes(agent)) {
    throw new UsageError(`agent must be one of: ${supportedAgents.join(", ")}`);
  }
  return agent;
}

function requireEvent(event) {
  const events = ["session_start", "session_end", "busy", "awaiting_input", "idle"];
  if (!events.includes(event)) {
    throw new UsageError(`event must be one of: ${events.join(", ")}`);
  }
  return event;
}

function parseGlobalArgs(argv) {
  const args = [];
  let dbPath = process.env.SUPACODE_LINUX_DB ?? join(homedir(), ".supacode/state.sqlite3");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      dbPath = requireValue(argv, index, "--db");
      index += 1;
    } else {
      args.push(arg);
    }
  }
  return { args, dbPath: resolve(dbPath) };
}

function parseOptions(argv) {
  const options = { _: [] };
  const aliases = {
    w: "worktree",
    t: "tab",
    s: "surface",
    c: "script",
    r: "repo",
    i: "input",
    d: "direction",
    n: "id",
    f: "focused",
  };
  const booleanFlags = new Set(["focused", "fetch", "refresh", "unread", "dismissed", "allowUnconfirmed", "closed"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        options[rawName] = inlineValue;
      } else if (booleanFlags.has(rawName) && (argv[index + 1] === undefined || argv[index + 1].startsWith("-"))) {
        options[rawName] = "true";
      } else {
        options[rawName] = requireValue(argv, index, arg);
        index += 1;
      }
    } else if (/^-[A-Za-z]$/.test(arg)) {
      const key = aliases[arg.slice(1)];
      if (!key) {
        throw new UsageError(`unknown option: ${arg}`);
      }
      if (key === "focused") {
        options[key] = "true";
      } else {
        options[key] = requireValue(argv, index, arg);
        index += 1;
      }
    } else {
      options._.push(arg);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

async function handleRepo(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "add":
      await addRepo(argv, dbPath);
      return;
    case "add-remote":
      await addRemoteRepo(argv, dbPath);
      return;
    case "list":
      await listRepos(dbPath);
      return;
    default:
      throw new UsageError("repo requires add, add-remote, or list");
  }
}

async function addRepo(argv, dbPath) {
  const options = parseOptions(argv);
  const rawPath = options._[0];
  if (!rawPath) {
    throw new UsageError("repo add requires a path");
  }
  await migrate(dbPath);
  const rootPath = await gitRepoRoot(rawPath);
  const id = repositoryID("local", rootPath);
  const displayName = options.name ?? basename(rootPath);
  await execSQL(
    dbPath,
    `INSERT INTO repositories(id, kind, root_path, remote_host, display_name)
     VALUES (${sqlString(id)}, 'local', ${sqlString(rootPath)}, '', ${sqlString(displayName)})
     ON CONFLICT(root_path) WHERE kind = 'local' DO UPDATE SET
       display_name = excluded.display_name,
       last_opened_at = unixepoch();`
  );
  await refreshWorktrees(dbPath, { id, kind: "local", rootPath, remoteHost: "" });
  console.log(JSON.stringify({ id, kind: "local", rootPath, remoteHost: "", displayName }));
}

async function addRemoteRepo(argv, dbPath) {
  const options = parseOptions(argv);
  const remoteHost = options.host;
  const rootPath = options.path;
  if (!remoteHost) {
    throw new UsageError("repo add-remote requires --host");
  }
  if (!rootPath) {
    throw new UsageError("repo add-remote requires --path");
  }
  if (!rootPath.startsWith("/")) {
    throw new UsageError("repo add-remote --path must be an absolute remote path");
  }
  await migrate(dbPath);
  const id = repositoryID("remote", rootPath, remoteHost);
  const displayName = options.name ?? `${basename(rootPath)} on ${remoteHost}`;
  await execSQL(
    dbPath,
    `INSERT INTO repositories(id, kind, root_path, remote_host, display_name)
     VALUES (${sqlString(id)}, 'remote', ${sqlString(rootPath)}, ${sqlString(remoteHost)}, ${sqlString(displayName)})
     ON CONFLICT(kind, root_path, remote_host) DO UPDATE SET
       display_name = excluded.display_name,
       last_opened_at = unixepoch();`
  );
  await refreshWorktrees(dbPath, { id, kind: "remote", rootPath, remoteHost });
  console.log(JSON.stringify({ id, kind: "remote", rootPath, remoteHost, displayName }));
}

async function listRepos(dbPath) {
  await migrate(dbPath);
  const rows = await querySQL(
    dbPath,
    `SELECT id, kind, root_path AS rootPath, remote_host AS remoteHost,
            display_name AS displayName, color, sort_order AS sortOrder,
            added_at AS addedAt, last_opened_at AS lastOpenedAt
       FROM repositories
      ORDER BY sort_order, display_name, root_path;`
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function handleWorktree(subcommand, argv, dbPath) {
  switch (subcommand) {
    case "list":
      await listWorktrees(argv, dbPath);
      return;
    case "create":
      await createWorktree(argv, dbPath);
      return;
    case "archive":
      await setWorktreeArchive(argv, dbPath, true);
      return;
    case "unarchive":
      await setWorktreeArchive(argv, dbPath, false);
      return;
    case "pin":
      await setWorktreePin(argv, dbPath, true);
      return;
    case "unpin":
      await setWorktreePin(argv, dbPath, false);
      return;
    case "customize":
    case "appearance":
      await customizeWorktree(argv, dbPath);
      return;
    default:
      throw new UsageError("worktree requires list, create, archive, unarchive, pin, unpin, or customize");
  }
}

async function listWorktrees(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const repo = await resolveRepo(dbPath, options.repo);
  await refreshWorktrees(dbPath, repo);
  const rows = await querySQL(
    dbPath,
    `SELECT id, repository_id AS repositoryID, working_directory AS workingDirectory,
            branch_name AS branchName, detail, is_attached AS isAttached,
            is_missing AS isMissing, is_pinned AS isPinned, is_archived AS isArchived,
            sort_order AS sortOrder, created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM worktrees
      WHERE repository_id = ${sqlString(repo.id)}
      ORDER BY is_archived, sort_order, branch_name, working_directory;`
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function createWorktree(argv, dbPath) {
  const options = parseOptions(argv);
  const name = options.name ?? options._[0];
  if (!name) {
    throw new UsageError("worktree create requires --name");
  }
  await migrate(dbPath);
  const repo = await resolveRepo(dbPath, options.repo);
  const worktreePath = worktreePathForRepo(repo, options.path, name);
  const worktreeArgs = ["worktree", "add", worktreePath, "-b", name];
  if (options.base) {
    worktreeArgs.push(options.base);
  }
  if (repo.kind === "remote") {
    await spawnFile("ssh", remoteGitSSHArgs(repo.remoteHost, repo.rootPath, worktreeArgs));
  } else {
    await spawnFile("git", ["-C", repo.rootPath, ...worktreeArgs]);
  }
  await refreshWorktrees(dbPath, repo);
  console.log(JSON.stringify({ repositoryID: repo.id, branchName: name, workingDirectory: worktreePath }));
}

async function setWorktreeArchive(argv, dbPath, archived) {
  const options = parseOptions(argv);
  const rawWorktree = options.worktree ?? options._[0];
  if (!rawWorktree) {
    throw new UsageError(`worktree ${archived ? "archive" : "unarchive"} requires a worktree id or --worktree`);
  }
  await migrate(dbPath);
  const worktree = await resolveWorktree(dbPath, rawWorktree);
  await execSQL(
    dbPath,
    `UPDATE worktrees
        SET is_archived = ${archived ? 1 : 0},
            archived_at = ${archived ? "unixepoch()" : "NULL"}
      WHERE id = ${sqlString(worktree.id)};`
  );
  console.log(JSON.stringify({ worktreeID: worktree.id, isArchived: archived }));
}

async function setWorktreePin(argv, dbPath, pinned) {
  const options = parseOptions(argv);
  const rawWorktree = options.worktree ?? options._[0];
  if (!rawWorktree) {
    throw new UsageError(`worktree ${pinned ? "pin" : "unpin"} requires a worktree id or --worktree`);
  }
  await migrate(dbPath);
  const worktree = await resolveWorktree(dbPath, rawWorktree);
  await execSQL(
    dbPath,
    `UPDATE worktrees
        SET is_pinned = ${pinned ? 1 : 0}
      WHERE id = ${sqlString(worktree.id)};`
  );
  console.log(JSON.stringify({ worktreeID: worktree.id, isPinned: pinned }));
}

async function customizeWorktree(argv, dbPath) {
  const options = parseOptions(argv);
  const rawWorktree = options.worktree ?? options._[0];
  if (!rawWorktree) {
    throw new UsageError("worktree customize requires a worktree id or --worktree");
  }
  await migrate(dbPath);
  const worktree = await resolveWorktree(dbPath, rawWorktree);
  const hasTitle = Object.hasOwn(options, "title");
  const hasColor = Object.hasOwn(options, "color");
  if (!hasTitle && !hasColor) {
    const rows = await querySQL(
      dbPath,
      `SELECT id AS worktreeID, custom_title AS customTitle, color,
              COALESCE(custom_title, branch_name, working_directory) AS displayTitle
         FROM worktrees
        WHERE id = ${sqlString(worktree.id)}
        LIMIT 1;`
    );
    console.log(JSON.stringify(rows[0] ?? null, null, 2));
    return;
  }
  const assignments = [];
  if (hasTitle) assignments.push(`custom_title = ${sqlString(options.title === "" ? null : options.title)}`);
  if (hasColor) assignments.push(`color = ${sqlString(options.color === "none" ? null : options.color)}`);
  await execSQL(dbPath, `UPDATE worktrees SET ${assignments.join(", ")} WHERE id = ${sqlString(worktree.id)};`);
  const rows = await querySQL(
    dbPath,
    `SELECT id AS worktreeID, custom_title AS customTitle, color,
            COALESCE(custom_title, branch_name, working_directory) AS displayTitle
       FROM worktrees
      WHERE id = ${sqlString(worktree.id)}
      LIMIT 1;`
  );
  console.log(JSON.stringify(rows[0], null, 2));
}

async function resolveRepo(dbPath, rawRepo) {
  if (!rawRepo) {
    const rows = await querySQL(
      dbPath,
      `SELECT id, kind, root_path AS rootPath, COALESCE(remote_host, '') AS remoteHost
         FROM repositories
        ORDER BY last_opened_at DESC, added_at DESC
        LIMIT 2;`
    );
    if (rows.length === 1) {
      return rows[0];
    }
    throw new UsageError("pass --repo when zero or multiple repositories are registered");
  }

  const byID = await querySQL(
    dbPath,
    `SELECT id, kind, root_path AS rootPath, COALESCE(remote_host, '') AS remoteHost
       FROM repositories
      WHERE id = ${sqlString(rawRepo)}
      LIMIT 1;`
  );
  if (byID.length === 1) {
    return byID[0];
  }

  let rootPath;
  try {
    rootPath = await gitRepoRoot(rawRepo);
  } catch (error) {
    throw new UsageError(`repository is not registered: ${rawRepo}`);
  }
  const id = repositoryID("local", rootPath);
  const rows = await querySQL(
    dbPath,
    `SELECT id, kind, root_path AS rootPath, COALESCE(remote_host, '') AS remoteHost
       FROM repositories
      WHERE id = ${sqlString(id)}
      LIMIT 1;`
  );
  if (rows.length === 1) {
    return rows[0];
  }
  throw new UsageError(`repository is not registered: ${rawRepo}`);
}

async function resolveWorktree(dbPath, rawWorktree) {
  const byID = await querySQL(
    dbPath,
    `SELECT w.id, w.repository_id AS repositoryID,
            w.working_directory AS workingDirectory, w.branch_name AS branchName,
            r.kind AS repositoryKind, r.root_path AS repositoryRootPath,
            COALESCE(r.remote_host, '') AS remoteHost
       FROM worktrees w
       JOIN repositories r ON r.id = w.repository_id
      WHERE w.id = ${sqlString(rawWorktree)}
      LIMIT 1;`
  );
  if (byID.length === 1) {
    return byID[0];
  }

  const path = resolve(rawWorktree);
  const byPath = await querySQL(
    dbPath,
    `SELECT w.id, w.repository_id AS repositoryID,
            w.working_directory AS workingDirectory, w.branch_name AS branchName,
            r.kind AS repositoryKind, r.root_path AS repositoryRootPath,
            COALESCE(r.remote_host, '') AS remoteHost
       FROM worktrees w
       JOIN repositories r ON r.id = w.repository_id
      WHERE w.working_directory = ${sqlString(path)}
      LIMIT 1;`
  );
  if (byPath.length === 1) {
    return byPath[0];
  }
  throw new UsageError(`worktree is not registered: ${rawWorktree}`);
}

async function optionalResolvedWorktree(dbPath, options) {
  const rawWorktree = optionOrEnv(options, "worktree", "SUPACODE_WORKTREE_ID");
  return rawWorktree ? resolveWorktree(dbPath, rawWorktree) : null;
}

async function resolveTab(dbPath, rawTab) {
  if (!rawTab) {
    throw new UsageError("tab id is required");
  }
  const rows = await querySQL(
    dbPath,
    `SELECT t.id AS tabID, t.worktree_id AS worktreeID, t.title,
            t.sort_order AS sortOrder, t.selected_surface_id AS selectedSurfaceID,
            t.created_at AS createdAt, t.updated_at AS updatedAt
       FROM terminal_tabs t
      WHERE t.id = ${sqlString(rawTab)}
      LIMIT 1;`
  );
  if (rows.length === 1) {
    return rows[0];
  }
  throw new UsageError(`tab not found: ${rawTab}`);
}

async function resolveSurface(dbPath, rawSurface) {
  if (!rawSurface) {
    throw new UsageError("surface id is required");
  }
  const rows = await querySQL(
    dbPath,
    `SELECT s.id AS surfaceID, s.tab_id AS tabID, s.worktree_id AS worktreeID,
            s.title, s.working_directory AS workingDirectory,
            s.split_parent_id AS splitParentID, s.split_direction AS splitDirection,
            s.launch_command AS launchCommand, s.launch_backend AS launchBackend,
            s.launch_plan_json AS launchPlanJSON, s.is_closed AS isClosed
       FROM terminal_surfaces s
      WHERE s.id = ${sqlString(rawSurface)}
      LIMIT 1;`
  );
  if (rows.length === 1) {
    return parseLaunchPlan(rows[0]);
  }
  throw new UsageError(`surface not found: ${rawSurface}`);
}

async function firstOpenSurfaceID(dbPath, tabID) {
  const rows = await querySQL(
    dbPath,
    `SELECT id AS surfaceID
       FROM terminal_surfaces
      WHERE tab_id = ${sqlString(tabID)}
        AND is_closed = 0
      ORDER BY created_at
      LIMIT 1;`
  );
  return rows[0]?.surfaceID ?? null;
}

async function setSelectedTerminal(dbPath, { worktreeID, tabID, surfaceID }) {
  if (surfaceID) {
    await execSQL(
      dbPath,
      `UPDATE terminal_tabs
          SET selected_surface_id = ${sqlString(surfaceID)}, updated_at = unixepoch()
        WHERE id = ${sqlString(tabID)};`
    );
    await setSettingValue(dbPath, "selectedSurfaceID", surfaceID);
  }
  await setSettingValue(dbPath, "selectedWorktreeID", worktreeID);
  await setSettingValue(dbPath, "selectedTabID", tabID);
}

function normalizeSplitDirection(rawDirection) {
  const value = String(rawDirection ?? "").toLowerCase();
  if (value === "h" || value === "horizontal") return "horizontal";
  if (value === "v" || value === "vertical") return "vertical";
  throw new UsageError("--direction must be horizontal, vertical, h, or v");
}

function optionOrEnv(options, optionName, envName) {
  return options[optionName] ?? process.env[envName] ?? null;
}

async function refreshWorktrees(dbPath, repo) {
  const output =
    repo.kind === "remote"
      ? await spawnFile("ssh", remoteGitSSHArgs(repo.remoteHost, repo.rootPath, ["worktree", "list", "--porcelain"]))
      : await spawnFile("git", ["-C", repo.rootPath, "worktree", "list", "--porcelain"]);
  const entries = parseWorktreePorcelain(output);
  for (const entry of entries) {
    const id = worktreeID(repo.id, entry.workingDirectory);
    const isMissing = repo.kind === "local" && !existsSync(entry.workingDirectory);
    await execSQL(
      dbPath,
      `INSERT INTO worktrees(id, repository_id, working_directory, branch_name, detail, is_attached, is_missing, last_seen_at)
       VALUES (${sqlString(id)}, ${sqlString(repo.id)}, ${sqlString(entry.workingDirectory)},
               ${sqlString(entry.branchName)}, ${sqlString(relativeDetail(repo.rootPath, entry.workingDirectory))},
               ${entry.isAttached ? 1 : 0}, ${isMissing ? 1 : 0}, unixepoch())
       ON CONFLICT(repository_id, working_directory) DO UPDATE SET
         branch_name = excluded.branch_name,
         detail = excluded.detail,
         is_attached = excluded.is_attached,
         is_missing = excluded.is_missing,
         last_seen_at = excluded.last_seen_at;`
    );
  }
}

async function refreshRegisteredRepositories(dbPath) {
  const repos = await querySQL(
    dbPath,
    `SELECT id, kind, root_path AS rootPath, COALESCE(remote_host, '') AS remoteHost
       FROM repositories
      ORDER BY sort_order, added_at;`
  );
  for (const repo of repos) {
    await refreshWorktrees(dbPath, repo);
  }
}

function parseWorktreePorcelain(output) {
  return output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .flatMap((block) => {
      const entry = { workingDirectory: "", branchName: null, isBare: false, isAttached: true };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) {
          entry.workingDirectory = line.slice("worktree ".length);
        } else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length);
          entry.branchName = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
        } else if (line === "bare") {
          entry.isBare = true;
        } else if (line === "detached") {
          entry.isAttached = false;
        }
      }
      if (!entry.workingDirectory || entry.isBare) {
        return [];
      }
      if (!entry.branchName) {
        entry.branchName = basename(entry.workingDirectory);
      }
      return [entry];
    });
}

async function settingsObject(dbPath) {
  const rows = await querySQL(dbPath, "SELECT key, value_json AS valueJSON FROM app_settings ORDER BY key;");
  return Object.fromEntries(rows.map((row) => [row.key, parseJSON(row.valueJSON, null)]));
}

async function getSettingValue(dbPath, key) {
  const rows = await querySQL(
    dbPath,
    `SELECT value_json AS valueJSON
       FROM app_settings
      WHERE key = ${sqlString(key)}
      LIMIT 1;`
  );
  return rows.length === 0 ? null : parseJSON(rows[0].valueJSON, null);
}

async function setSettingValue(dbPath, key, value) {
  await execSQL(
    dbPath,
    `INSERT INTO app_settings(key, value_json, updated_at)
     VALUES (${sqlString(key)}, ${sqlString(JSON.stringify(value))}, unixepoch())
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at;`
  );
}

async function notificationRows(dbPath, { worktreeID, unreadOnly = false, includeDismissed = false }) {
  const clauses = [];
  if (worktreeID) clauses.push(`worktree_id = ${sqlString(worktreeID)}`);
  if (unreadOnly) clauses.push("is_read = 0");
  if (!includeDismissed) clauses.push("is_dismissed = 0");
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return querySQL(
    dbPath,
    `SELECT id, worktree_id AS worktreeID, surface_id AS surfaceID, title, body,
            is_read AS isRead, is_dismissed AS isDismissed,
            created_at AS createdAt, dismissed_at AS dismissedAt
       FROM notifications
       ${where}
      ORDER BY is_read, created_at DESC;`
  );
}

async function createNotificationRecord(dbPath, { worktreeID, surfaceID, title, body }) {
  const id = randomUUID();
  await execSQL(
    dbPath,
    `INSERT INTO notifications(id, worktree_id, surface_id, title, body)
     VALUES (${sqlString(id)}, ${sqlString(worktreeID)}, ${sqlString(surfaceID)},
             ${sqlString(title)}, ${sqlString(body ?? "")});`
  );
  return (await notificationRows(dbPath, { includeDismissed: true })).find((row) => row.id === id);
}

function agentEventTitle(agent, event) {
  const agentName = agent[0].toUpperCase() + agent.slice(1);
  switch (event) {
    case "awaiting_input":
      return `${agentName} is awaiting input`;
    case "busy":
      return `${agentName} is working`;
    case "session_start":
      return `${agentName} session started`;
    case "session_end":
      return `${agentName} session ended`;
    case "idle":
      return `${agentName} is idle`;
    default:
      return `${agentName} update`;
  }
}

async function scriptRows(dbPath, { id, repositoryID, includeGlobal = true }) {
  const clauses = [];
  if (id) {
    clauses.push(`id = ${sqlString(id)}`);
  } else if (repositoryID) {
    const repoClause = `scope = 'repository' AND repository_id = ${sqlString(repositoryID)}`;
    clauses.push(includeGlobal ? `(${repoClause} OR scope = 'global')` : repoClause);
  } else if (!includeGlobal) {
    clauses.push("scope != 'global'");
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return querySQL(
    dbPath,
    `SELECT id, scope, repository_id AS repositoryID, kind, name, color, command,
            sort_order AS sortOrder, is_enabled AS isEnabled,
            created_at AS createdAt, updated_at AS updatedAt
       FROM scripts
       ${where}
      ORDER BY scope, sort_order, name;`
  );
}

async function runningScriptRows(dbPath, { worktreeID, scriptID }) {
  const clauses = [];
  if (worktreeID) clauses.push(`worktree_id = ${sqlString(worktreeID)}`);
  if (scriptID) clauses.push(`script_id = ${sqlString(scriptID)}`);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return querySQL(
    dbPath,
    `SELECT id, script_id AS scriptID, worktree_id AS worktreeID,
            terminal_surface_id AS terminalSurfaceID,
            started_at AS startedAt, stopped_at AS stoppedAt
       FROM running_scripts
       ${where}
      ORDER BY stopped_at, started_at DESC;`
  );
}

function parseDeeplink(rawURL) {
  let url;
  try {
    url = new URL(rawURL);
  } catch (error) {
    throw new UsageError(`invalid deeplink URL: ${rawURL}`);
  }
  if (url.protocol !== "supacode:") {
    throw new UsageError("deeplink URL must use supacode://");
  }
  const host = url.hostname;
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const query = Object.fromEntries(url.searchParams.entries());
  if (!host) {
    return { url: rawURL, kind: "open", requiresConfirmation: false };
  }
  if (host === "help") {
    return { url: rawURL, kind: "help", requiresConfirmation: false };
  }
  if (host === "settings") {
    if (pathSegments[0] === "repo" && pathSegments[1]) {
      return {
        url: rawURL,
        kind: pathSegments[2] === "scripts" ? "settingsRepoScripts" : "settingsRepo",
        repositoryID: decodeURIComponent(pathSegments[1]),
        requiresConfirmation: false,
      };
    }
    return {
      url: rawURL,
      kind: "settings",
      section: pathSegments[0] ?? null,
      requiresConfirmation: false,
    };
  }
  if (host === "repo") {
    if (pathSegments[0] === "open") {
      if (!query.path?.startsWith("/")) {
        throw new UsageError("repo open deeplink requires absolute path query");
      }
      return { url: rawURL, kind: "repoOpen", path: query.path, requiresConfirmation: false };
    }
    if (pathSegments[0] && pathSegments[1] === "worktree" && pathSegments[2] === "new") {
      return {
        url: rawURL,
        kind: "repoWorktreeNew",
        repositoryID: decodeURIComponent(pathSegments[0]),
        branch: query.branch ?? null,
        baseRef: query.base ?? null,
        fetchOrigin: query.fetch === "true",
        worktreeName: query.name ?? null,
        worktreePath: query.location ?? null,
        requiresConfirmation: true,
      };
    }
  }
  if (host === "worktree") {
    if (!pathSegments[0]) {
      throw new UsageError("worktree deeplink requires worktree id");
    }
    const worktreeID = decodeURIComponent(pathSegments[0]).replace(/\/$/, "");
    const action = pathSegments[1] ?? "select";
    if (action === "appearance") {
      return {
        url: rawURL,
        kind: "worktreeAppearance",
        worktreeID,
        title: Object.hasOwn(query, "title") ? query.title : undefined,
        color: Object.hasOwn(query, "color") ? query.color : undefined,
        requiresConfirmation: true,
      };
    }
    if (action === "script" && pathSegments[2] && pathSegments[3]) {
      return {
        url: rawURL,
        kind: pathSegments[3] === "stop" ? "stopScript" : "runScript",
        worktreeID,
        scriptID: pathSegments[2],
        requiresConfirmation: true,
      };
    }
    if (action === "tab") {
      return {
        url: rawURL,
        kind: "worktreeTab",
        worktreeID,
        path: pathSegments.slice(2),
        input: query.input ?? null,
        direction: query.direction ?? null,
        requestedID: query.id ?? null,
        requiresConfirmation: pathSegments.includes("split") || pathSegments.includes("destroy") || Boolean(query.input),
      };
    }
    const confirmationActions = new Set(["run", "stop", "archive", "unarchive", "delete", "pin", "unpin"]);
    return {
      url: rawURL,
      kind: "worktreeAction",
      worktreeID,
      action,
      requiresConfirmation: confirmationActions.has(action),
    };
  }
  throw new UsageError(`unrecognized deeplink host: ${host}`);
}

async function executeDeeplink(dbPath, parsed) {
  switch (parsed.kind) {
    case "open":
    case "help":
      return { focused: true };
    case "settings":
      await setSettingValue(dbPath, "requestedSettingsSection", parsed.section);
      return { settingsSection: parsed.section };
    case "settingsRepo":
    case "settingsRepoScripts":
      await setSettingValue(dbPath, "requestedSettingsRepositoryID", parsed.repositoryID);
      await setSettingValue(dbPath, "requestedSettingsSection", parsed.kind === "settingsRepoScripts" ? "repoScripts" : "repoGeneral");
      return { repositoryID: parsed.repositoryID };
    case "worktreeAction":
      if (parsed.action === "select") {
        await setSettingValue(dbPath, "selectedWorktreeID", parsed.worktreeID);
        return { selectedWorktreeID: parsed.worktreeID };
      }
      if (parsed.action === "pin" || parsed.action === "unpin") {
        await execSQL(
          dbPath,
          `UPDATE worktrees SET is_pinned = ${parsed.action === "pin" ? 1 : 0}
            WHERE id = ${sqlString(parsed.worktreeID)};`
        );
        return { worktreeID: parsed.worktreeID, isPinned: parsed.action === "pin" };
      }
      if (parsed.action === "archive" || parsed.action === "unarchive") {
        await execSQL(
          dbPath,
          `UPDATE worktrees
              SET is_archived = ${parsed.action === "archive" ? 1 : 0},
                  archived_at = ${parsed.action === "archive" ? "unixepoch()" : "NULL"}
            WHERE id = ${sqlString(parsed.worktreeID)};`
        );
        return { worktreeID: parsed.worktreeID, isArchived: parsed.action === "archive" };
      }
      return { planned: parsed.action };
    case "worktreeAppearance": {
      const assignments = [];
      if (Object.hasOwn(parsed, "title")) {
        assignments.push(`custom_title = ${sqlString(parsed.title === "" ? null : parsed.title)}`);
      }
      if (Object.hasOwn(parsed, "color")) {
        assignments.push(`color = ${sqlString(parsed.color === "none" ? null : parsed.color)}`);
      }
      if (assignments.length > 0) {
        await execSQL(dbPath, `UPDATE worktrees SET ${assignments.join(", ")} WHERE id = ${sqlString(parsed.worktreeID)};`);
      }
      return { worktreeID: parsed.worktreeID };
    }
    case "runScript": {
      const script = (await scriptRows(dbPath, { id: parsed.scriptID }))[0];
      if (!script) return { error: `script not found: ${parsed.scriptID}` };
      const terminal = await createTerminalRecord(dbPath, {
        worktree: await resolveWorktree(dbPath, parsed.worktreeID),
        title: script.name,
        command: script.command,
      });
      return { scriptID: parsed.scriptID, terminal };
    }
    case "stopScript": {
      await execSQL(
        dbPath,
        `UPDATE running_scripts
            SET stopped_at = unixepoch()
          WHERE script_id = ${sqlString(parsed.scriptID)}
            AND worktree_id = ${sqlString(parsed.worktreeID)}
            AND stopped_at IS NULL;`
      );
      return { scriptID: parsed.scriptID, worktreeID: parsed.worktreeID };
    }
    case "worktreeTab": {
      const worktree = await resolveWorktree(dbPath, parsed.worktreeID);
      const [tabPath, surfacePath, surfaceID, verb] = parsed.path;
      if (tabPath === "new") {
        return createTerminalRecord(dbPath, {
          worktree,
          command: parsed.input,
          tabID: parsed.requestedID ?? randomUUID(),
        });
      }
      if (!tabPath) {
        return { error: "tab deeplink missing tab id" };
      }
      if (surfacePath === "destroy") {
        await execSQL(
          dbPath,
          `UPDATE terminal_surfaces
              SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
            WHERE tab_id = ${sqlString(tabPath)};`
        );
        await saveLayoutSnapshot(dbPath, worktree.id);
        return { tabID: tabPath, isClosed: true };
      }
      if (surfacePath !== "surface") {
        const tab = await resolveTab(dbPath, tabPath);
        const selectedSurfaceID = tab.selectedSurfaceID ?? (await firstOpenSurfaceID(dbPath, tab.tabID));
        await setSelectedTerminal(dbPath, { worktreeID: tab.worktreeID, tabID: tab.tabID, surfaceID: selectedSurfaceID });
        return { tabID: tab.tabID, selectedSurfaceID };
      }
      if (!surfaceID) {
        return { error: "surface deeplink missing surface id" };
      }
      const surface = await resolveSurface(dbPath, surfaceID);
      if (verb === "destroy") {
        await execSQL(
          dbPath,
          `UPDATE terminal_surfaces
              SET is_closed = 1, updated_at = unixepoch(), task_status = 'idle'
            WHERE id = ${sqlString(surface.surfaceID)};`
        );
        await saveLayoutSnapshot(dbPath, surface.worktreeID);
        return { surfaceID: surface.surfaceID, isClosed: true };
      }
      if (verb === "split") {
        const created = await createSurfaceRecord(dbPath, {
          worktree,
          tabID: surface.tabID,
          surfaceID: parsed.requestedID ?? randomUUID(),
          title: surface.title,
          cwd: surface.workingDirectory,
          command: parsed.input,
          splitParentID: surface.surfaceID,
          splitDirection: normalizeSplitDirection(parsed.direction ?? "horizontal"),
        });
        await setSelectedTerminal(dbPath, {
          worktreeID: worktree.id,
          tabID: surface.tabID,
          surfaceID: created.surfaceID,
        });
        return created;
      }
      await setSelectedTerminal(dbPath, {
        worktreeID: surface.worktreeID,
        tabID: surface.tabID,
        surfaceID: surface.surfaceID,
      });
      if (parsed.input) {
        await setSettingValue(dbPath, `pendingSurfaceInput.${surface.surfaceID}`, parsed.input);
      }
      return { surfaceID: surface.surfaceID, focused: true, input: parsed.input ?? null };
    }
    default:
      return { planned: parsed.kind };
  }
}

async function status(dbPath) {
  await migrate(dbPath);
  const [repoCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM repositories;");
  const [worktreeCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM worktrees;");
  const [notificationCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM notifications WHERE is_read = 0;");
  const [agentEventCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM agent_events;");
  const [surfaceCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM terminal_surfaces WHERE is_closed = 0;");
  const [pullRequestCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM github_pull_requests;");
  console.log(
    JSON.stringify(
      {
        dbPath,
        repositories: repoCount.count,
        worktrees: worktreeCount.count,
        openTerminalSurfaces: surfaceCount.count,
        pullRequests: pullRequestCount.count,
        unreadNotifications: notificationCount.count,
        agentEvents: agentEventCount.count,
      },
      null,
      2
    )
  );
}

async function saveLayoutSnapshot(dbPath, worktreeID) {
  const rows = await querySQL(
    dbPath,
    `SELECT t.id AS tabID, t.title AS tabTitle, t.sort_order AS sortOrder,
            t.selected_surface_id AS selectedSurfaceID,
            s.id AS surfaceID, s.title AS surfaceTitle,
            s.working_directory AS workingDirectory,
            s.split_parent_id AS splitParentID,
            s.split_direction AS splitDirection,
            s.zmx_session_id AS zmxSessionID,
            s.launch_backend AS launchBackend,
            s.launch_plan_json AS launchPlanJSON,
            s.launch_command AS launchCommand, s.task_status AS taskStatus,
            s.is_closed AS isClosed
       FROM terminal_tabs t
       LEFT JOIN terminal_surfaces s ON s.tab_id = t.id
      WHERE t.worktree_id = ${sqlString(worktreeID)}
      ORDER BY t.sort_order, t.created_at, s.created_at;`
  );
  await execSQL(
    dbPath,
    `INSERT INTO terminal_layout_snapshots(worktree_id, layout_json, updated_at)
     VALUES (${sqlString(worktreeID)}, ${sqlString(JSON.stringify({ tabs: rows }))}, unixepoch())
     ON CONFLICT(worktree_id) DO UPDATE SET
       layout_json = excluded.layout_json,
       updated_at = excluded.updated_at;`
  );
}

async function migrate(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  await execSQL(dbPath, "PRAGMA journal_mode = WAL;");
  const migrations = readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    const version = migration.replace(/\.sql$/, "");
    const applied = await querySQL(
      dbPath,
      `SELECT version FROM schema_migrations WHERE version = ${sqlString(version)} LIMIT 1;`
    ).catch(() => []);
    if (applied.length > 0) {
      continue;
    }
    await execSQL(dbPath, readFileSync(join(migrationDir, migration), "utf8"));
    await execSQL(dbPath, `INSERT OR IGNORE INTO schema_migrations(version) VALUES (${sqlString(version)});`);
  }
}

async function doctor() {
  const checks = [
    ["git", ["--version"]],
    ["gh", ["--version"]],
    ["ssh", ["-V"]],
    ["sqlite3", ["-version"]],
    ["node", ["--version"]],
    ["pkg-config", ["--version"]],
  ];
  const results = [];
  for (const [command, args] of checks) {
    try {
      const output = await spawnFile(command, args);
      const version = output.split("\n")[0];
      results.push(version ? { command, ok: true, version } : { command, ok: true });
    } catch (error) {
      results.push({ command, ok: false, error: error.message });
    }
  }
  const zmx = findZmxExecutable();
  results.push(
    zmx
      ? { command: "zmx", ok: true, optional: true, path: zmx }
      : {
          command: "zmx",
          ok: false,
          optional: true,
          error: "Install zmx for persistent terminal sessions; shell fallback remains available",
        }
  );
  try {
    const cmake = await spawnFile("cmake", ["--version"]);
    results.push({ command: "cmake", ok: true, optional: true, version: cmake.split("\n")[0] });
  } catch (error) {
    results.push({
      command: "cmake",
      ok: false,
      optional: true,
      error: "Install cmake before building the Qt shell",
    });
  }
  try {
    const qt = await spawnFile("pkg-config", ["--modversion", "Qt6Widgets"]);
    results.push({ command: "Qt6Widgets", ok: true, optional: true, version: qt.trim() });
  } catch (error) {
    results.push({
      command: "Qt6Widgets",
      ok: false,
      optional: true,
      error: "Install qt6-base-dev on Ubuntu or qt6-base on Arch before building the Qt shell",
    });
  }
  try {
    const qtSvg = await spawnFile("pkg-config", ["--modversion", "Qt6Svg"]);
    results.push({ command: "Qt6Svg", ok: true, optional: true, version: qtSvg.trim() });
  } catch (error) {
    results.push({
      command: "Qt6Svg",
      ok: false,
      optional: true,
      error: "Install qt6-svg-dev on Ubuntu or qt6-svg on Arch before building the Qt shell",
    });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.ok && !result.optional)) {
    process.exitCode = 1;
  }
}

async function resetDevState(dbPath) {
  if (!dbPath.includes("/tmp/") && !dbPath.includes("/var/folders/")) {
    throw new UsageError("reset-dev-state only operates on temporary databases");
  }
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  await migrate(dbPath);
  console.log(`reset ${dbPath}`);
}

async function execSQL(dbPath, sql) {
  await spawnFile("sqlite3", [dbPath, sql]);
}

async function querySQL(dbPath, sql) {
  return spawnFileJSON("sqlite3", ["-json", dbPath, sql]);
}

async function gitRepoRoot(path) {
  const output = await spawnFile("git", ["-C", resolve(path), "rev-parse", "--show-toplevel"]);
  return realpathSync(output.trim());
}

function repositoryID(kind, rootPath, remoteHost = "") {
  return kind === "remote" ? `${kind}:${remoteHost}:${rootPath}` : `${kind}:${rootPath}`;
}

function worktreeID(repositoryIDValue, workingDirectory) {
  return `${repositoryIDValue}:worktree:${workingDirectory}`;
}

function basename(path) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function safePathSegment(value) {
  return value.replaceAll("/", "-").replaceAll("..", ".");
}

function worktreePathForRepo(repo, rawPath, name) {
  if (repo.kind !== "remote") {
    return resolve(rawPath ?? join(dirname(repo.rootPath), safePathSegment(name)));
  }
  if (!rawPath) {
    return join(dirname(repo.rootPath), safePathSegment(name));
  }
  return rawPath.startsWith("/") ? rawPath : join(dirname(repo.rootPath), rawPath);
}

function cwdForWorktree(worktree, rawCwd) {
  if (worktree.repositoryKind !== "remote") {
    return resolve(rawCwd ?? worktree.workingDirectory);
  }
  if (!rawCwd) {
    return worktree.workingDirectory;
  }
  return rawCwd.startsWith("/") ? rawCwd : join(worktree.workingDirectory, rawCwd);
}

function parseLaunchPlan(row) {
  const { launchPlanJSON, ...rest } = row;
  return { ...rest, launchPlan: launchPlanJSON ? parseJSON(launchPlanJSON, {}) : {} };
}

function parseJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function truthy(value) {
  return value === true || value === 1 || value === "1";
}

function relativeDetail(repoPath, workingDirectory) {
  if (workingDirectory === repoPath) {
    return ".";
  }
  const parent = dirname(repoPath);
  return workingDirectory.startsWith(`${parent}/`) ? workingDirectory.slice(parent.length + 1) : workingDirectory;
}

function usage() {
  console.log(`Usage:
  supacode-linux doctor
  supacode-linux init [--db path]
  supacode-linux status [--db path]
  supacode-linux app snapshot [--refresh true] [--db path]
  supacode-linux repo add <path> [--name display-name] [--db path]
  supacode-linux repo add-remote --host <ssh-host> --path <absolute-remote-repo-path> [--name display-name] [--db path]
  supacode-linux repo list [--db path]
  supacode-linux worktree list --repo <repo-id-or-path> [--db path]
  supacode-linux worktree create --repo <repo-id-or-path> --name <branch> [--base ref] [--path path] [--db path]
  supacode-linux worktree archive|unarchive|pin|unpin --worktree <worktree-id-or-path>
  supacode-linux worktree customize --worktree <worktree-id-or-path> [--title title] [--color value]
  supacode-linux terminal create --worktree <worktree-id-or-path> [--title title] [--cwd path] [--command command]
  supacode-linux terminal list [--worktree <worktree-id-or-path>]
  supacode-linux terminal close --surface <surface-id>
  supacode-linux tab list [-w <worktree-id>] [-f]
  supacode-linux tab focus [-t <tab-id>]
  supacode-linux tab new [-w <worktree-id>] [-i <command>] [-n <tab-id>]
  supacode-linux tab close [-t <tab-id>]
  supacode-linux surface list [-w <worktree-id>] [-t <tab-id>] [-f]
  supacode-linux surface focus [-s <surface-id>] [-i <pending-input>]
  supacode-linux surface split [-s <surface-id>] [-d horizontal|vertical] [-i <command>] [-n <surface-id>]
  supacode-linux surface close [-s <surface-id>]
  supacode-linux github pr sync --worktree <worktree-id-or-path> [--number n] [--repo owner/name]
  supacode-linux github pr list [--worktree <worktree-id-or-path>]
  supacode-linux settings list|get|set
  supacode-linux notification list|create|read|dismiss|dismiss-all
  supacode-linux script list|save|delete|run|stop
  supacode-linux deeplink parse|run <supacode-url>
  supacode-linux agent list
  supacode-linux agent preview <agent> [--home path]
  supacode-linux agent status [agent] [--home path] [--db path]
  supacode-linux agent auto-install [--home path] [--db path]
  supacode-linux agent install <agent> [--home path] [--db path]
  supacode-linux agent uninstall <agent> [--home path] [--db path]
  supacode-linux agent event --agent <agent> --event <event> [--surface id] [--worktree id] [--tab id] [--db path]`);
}

class UsageError extends Error {}

await main(process.argv.slice(2));
