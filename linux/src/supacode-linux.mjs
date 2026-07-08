#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
      case "repo":
        await handleRepo(subcommand, rest, dbPath);
        return;
      case "worktree":
        await handleWorktree(subcommand, rest, dbPath);
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      options[name] = requireValue(argv, index, arg);
      index += 1;
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
    case "list":
      await listRepos(dbPath);
      return;
    default:
      throw new UsageError("repo requires add or list");
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
  await refreshWorktrees(dbPath, id, rootPath);
  console.log(JSON.stringify({ id, rootPath, displayName }));
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
    default:
      throw new UsageError("worktree requires list or create");
  }
}

async function listWorktrees(argv, dbPath) {
  const options = parseOptions(argv);
  await migrate(dbPath);
  const repo = await resolveRepo(dbPath, options.repo);
  await refreshWorktrees(dbPath, repo.id, repo.rootPath);
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
  const worktreePath = resolve(options.path ?? join(dirname(repo.rootPath), safePathSegment(name)));
  const gitArgs = ["-C", repo.rootPath, "worktree", "add", worktreePath, "-b", name];
  if (options.base) {
    gitArgs.push(options.base);
  }
  await spawnFile("git", gitArgs);
  await refreshWorktrees(dbPath, repo.id, repo.rootPath);
  console.log(JSON.stringify({ repositoryID: repo.id, branchName: name, workingDirectory: worktreePath }));
}

async function resolveRepo(dbPath, rawRepo) {
  if (!rawRepo) {
    const rows = await querySQL(
      dbPath,
      `SELECT id, root_path AS rootPath FROM repositories ORDER BY last_opened_at DESC, added_at DESC LIMIT 2;`
    );
    if (rows.length === 1) {
      return rows[0];
    }
    throw new UsageError("pass --repo when zero or multiple repositories are registered");
  }

  const byID = await querySQL(
    dbPath,
    `SELECT id, root_path AS rootPath FROM repositories WHERE id = ${sqlString(rawRepo)} LIMIT 1;`
  );
  if (byID.length === 1) {
    return byID[0];
  }

  const rootPath = await gitRepoRoot(rawRepo);
  const id = repositoryID("local", rootPath);
  const rows = await querySQL(
    dbPath,
    `SELECT id, root_path AS rootPath FROM repositories WHERE id = ${sqlString(id)} LIMIT 1;`
  );
  if (rows.length === 1) {
    return rows[0];
  }
  throw new UsageError(`repository is not registered: ${rawRepo}`);
}

async function refreshWorktrees(dbPath, repositoryIDValue, repoPath) {
  const entries = parseWorktreePorcelain(
    await spawnFile("git", ["-C", repoPath, "worktree", "list", "--porcelain"])
  );
  for (const entry of entries) {
    const id = worktreeID(repositoryIDValue, entry.workingDirectory);
    await execSQL(
      dbPath,
      `INSERT INTO worktrees(id, repository_id, working_directory, branch_name, detail, is_attached, is_missing, last_seen_at)
       VALUES (${sqlString(id)}, ${sqlString(repositoryIDValue)}, ${sqlString(entry.workingDirectory)},
               ${sqlString(entry.branchName)}, ${sqlString(relativeDetail(repoPath, entry.workingDirectory))},
               ${entry.isAttached ? 1 : 0}, ${existsSync(entry.workingDirectory) ? 0 : 1}, unixepoch())
       ON CONFLICT(repository_id, working_directory) DO UPDATE SET
         branch_name = excluded.branch_name,
         detail = excluded.detail,
         is_attached = excluded.is_attached,
         is_missing = excluded.is_missing,
         last_seen_at = excluded.last_seen_at;`
    );
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

async function status(dbPath) {
  await migrate(dbPath);
  const [repoCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM repositories;");
  const [worktreeCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM worktrees;");
  const [notificationCount] = await querySQL(dbPath, "SELECT count(*) AS count FROM notifications WHERE is_read = 0;");
  console.log(
    JSON.stringify(
      {
        dbPath,
        repositories: repoCount.count,
        worktrees: worktreeCount.count,
        unreadNotifications: notificationCount.count,
      },
      null,
      2
    )
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
    ["sqlite3", ["-version"]],
    ["node", ["--version"]],
    ["pkg-config", ["--version"]],
  ];
  const results = [];
  for (const [command, args] of checks) {
    try {
      const output = await spawnFile(command, args);
      results.push({ command, ok: true, version: output.split("\n")[0] });
    } catch (error) {
      results.push({ command, ok: false, error: error.message });
    }
  }
  try {
    const gtk = await spawnFile("pkg-config", ["--modversion", "gtk4"]);
    results.push({ command: "gtk4", ok: true, optional: true, version: gtk.trim() });
  } catch (error) {
    results.push({
      command: "gtk4",
      ok: false,
      optional: true,
      error: "Install libgtk-4-dev on Ubuntu or gtk4 on Arch before building the GTK host",
    });
  }
  try {
    const adwaita = await spawnFile("pkg-config", ["--modversion", "libadwaita-1"]);
    results.push({ command: "libadwaita-1", ok: true, optional: true, version: adwaita.trim() });
  } catch (error) {
    results.push({
      command: "libadwaita-1",
      ok: false,
      optional: true,
      error: "Install libadwaita-1-dev on Ubuntu or libadwaita on Arch",
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

function repositoryID(kind, rootPath) {
  return `${kind}:${rootPath}`;
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
  supacode-linux repo add <path> [--name display-name] [--db path]
  supacode-linux repo list [--db path]
  supacode-linux worktree list --repo <repo-id-or-path> [--db path]
  supacode-linux worktree create --repo <repo-id-or-path> --name <branch> [--base ref] [--path path] [--db path]`);
}

class UsageError extends Error {}

await main(process.argv.slice(2));
