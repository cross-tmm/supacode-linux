import { accessSync, constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { sshCommandLine } from "./remote-git.mjs";
import { shellQuote } from "./utils.mjs";

export function findZmxExecutable(env = process.env) {
  const override = env.SUPACODE_LINUX_ZMX ?? env.AGENT_WORKBENCH_ZMX;
  if (override) {
    return executablePath(override);
  }
  for (const directory of (env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(directory, "zmx");
    if (executablePath(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveTerminalLaunch({ surfaceID, worktree, cwd, command, zmxPath }) {
  const normalizedCommand = normalizeCommand(command);
  const sessionID = zmxSessionID(surfaceID);
  if (worktree.repositoryKind === "remote") {
    return remoteLaunch({ worktree, cwd, command: normalizedCommand, sessionID, zmxPath });
  }
  return localLaunch({ cwd, command: normalizedCommand, sessionID, zmxPath });
}

export function zmxSessionID(surfaceID) {
  return `supa-${String(surfaceID).toLowerCase()}`;
}

function localLaunch({ cwd, command, sessionID, zmxPath }) {
  if (!zmxPath) {
    return {
      backend: "shell",
      degraded: true,
      reason: "zmx not found; session will not survive app quit",
      zmxSessionID: null,
      cwd,
      command,
      commandWrapper: [],
    };
  }
  if (!command) {
    return {
      backend: "zmx",
      degraded: false,
      zmxSessionID: sessionID,
      cwd,
      command: null,
      commandWrapper: [zmxPath, "attach", sessionID],
    };
  }
  return {
    backend: "zmx",
    degraded: false,
    zmxSessionID: sessionID,
    cwd,
    command: `${shellQuote(zmxPath)} attach ${sessionID} /bin/sh -c ${shellQuote(command)}`,
    commandWrapper: [],
  };
}

function remoteLaunch({ worktree, cwd, command, sessionID, zmxPath }) {
  const remoteCommand = remoteSessionCommand({ cwd, command, sessionID });
  const sshLine = sshCommandLine(worktree.remoteHost, remoteCommand);
  if (!zmxPath) {
    return {
      backend: "remote_ssh",
      degraded: true,
      reason: "local zmx not found; SSH surface will not survive app quit",
      zmxSessionID: null,
      cwd,
      command: sshLine,
      commandWrapper: [],
      remoteHost: worktree.remoteHost,
      hostPersistence: true,
    };
  }
  return {
    backend: "zmx",
    degraded: false,
    zmxSessionID: sessionID,
    cwd,
    command: `${shellQuote(zmxPath)} attach ${sessionID} /bin/sh -c ${shellQuote(sshLine)}`,
    commandWrapper: [],
    remoteHost: worktree.remoteHost,
    hostPersistence: true,
  };
}

function remoteSessionCommand({ cwd, command, sessionID }) {
  const connectCommand = command
    ? `cd ${shellQuote(cwd)} 2>/dev/null; exec "$SHELL" -l -c ${shellQuote(command)}`
    : remoteDefaultShellCommand(cwd);
  const hostSession = `"$SHELL" -l -c ${shellQuote(connectCommand)}`;
  return (
    `if command -v zmx >/dev/null 2>&1; then exec zmx attach ${sessionID} ${hostSession}; fi; ` +
    connectCommand
  );
}

function remoteDefaultShellCommand(cwd) {
  const trimmed = String(cwd ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return 'exec "$SHELL" -l';
  }
  return `cd ${shellQuote(trimmed)} 2>/dev/null; exec "$SHELL" -l`;
}

function executablePath(path) {
  if (!isAbsolute(path)) {
    return null;
  }
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch (error) {
    return null;
  }
}

function normalizeCommand(command) {
  const trimmed = command?.trim();
  return trimmed ? trimmed : null;
}
