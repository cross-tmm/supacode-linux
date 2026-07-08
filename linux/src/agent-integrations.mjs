import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sqlString } from "./utils.mjs";

export const supportedAgents = ["codex", "copilot"];

const managedMarker = "# supacode-managed-hook";

export function agentDefinition(agent, homeDirectory) {
  const home = resolve(homeDirectory);
  switch (agent) {
    case "codex":
      return {
        agent,
        displayName: "Codex",
        files: [
          {
            path: join(home, ".codex/hooks.json"),
            content: codexHooksSource(),
          },
        ],
      };
    case "copilot":
      return {
        agent,
        displayName: "Copilot CLI",
        files: [
          {
            path: join(home, ".copilot/hooks/supacode.json"),
            content: copilotHooksSource(),
          },
        ],
      };
    default:
      throw new Error(`unsupported agent: ${agent}`);
  }
}

export function previewAgent(agent, homeDirectory) {
  const definition = agentDefinition(agent, homeDirectory);
  return {
    agent: definition.agent,
    displayName: definition.displayName,
    files: definition.files.map((file) => ({
      path: file.path,
      operation: existsSync(file.path) ? "replace-managed-file" : "create",
      managed: existingFileIsManaged(file.path),
      sha256: sha256(file.content),
    })),
  };
}

export function installState(agent, homeDirectory) {
  const definition = agentDefinition(agent, homeDirectory);
  const states = definition.files.map((file) => {
    if (!existsSync(file.path)) {
      return "not_installed";
    }
    const actual = readFileSync(file.path, "utf8");
    if (!actual.includes(managedMarker)) {
      return "failed";
    }
    return actual === file.content ? "installed" : "outdated";
  });
  if (states.includes("failed")) {
    return "failed";
  }
  if (states.every((state) => state === "installed")) {
    return "installed";
  }
  if (states.every((state) => state === "not_installed")) {
    return "not_installed";
  }
  return "outdated";
}

export function installAgent(agent, homeDirectory) {
  const definition = agentDefinition(agent, homeDirectory);
  for (const file of definition.files) {
    if (existsSync(file.path) && !existingFileIsManaged(file.path)) {
      throw new Error(`refusing to overwrite unmanaged file: ${file.path}`);
    }
  }
  for (const file of definition.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf8");
  }
  return installState(agent, homeDirectory);
}

export function uninstallAgent(agent, homeDirectory) {
  const definition = agentDefinition(agent, homeDirectory);
  for (const file of definition.files) {
    if (!existsSync(file.path)) {
      continue;
    }
    if (!existingFileIsManaged(file.path)) {
      throw new Error(`refusing to remove unmanaged file: ${file.path}`);
    }
    rmSync(file.path);
  }
  return installState(agent, homeDirectory);
}

export async function recordAgentState(execSQL, dbPath, agent, state, error = null) {
  await execSQL(
    dbPath,
    `INSERT INTO agent_integrations(agent, install_state, installed_hash, last_checked_at, last_error, updated_at)
     VALUES (${sqlString(agent)}, ${sqlString(state)}, ${sqlString(agentHash(agent))}, unixepoch(), ${sqlString(error)}, unixepoch())
     ON CONFLICT(agent) DO UPDATE SET
       install_state = excluded.install_state,
       installed_hash = excluded.installed_hash,
       last_checked_at = excluded.last_checked_at,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at;`
  );
}

function codexHooksSource() {
  return sortedJSON({
    hooks: {
      SessionStart: [{ hooks: [{ command: hookCommand("codex", "session_start"), timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ command: hookCommand("codex", "busy"), timeout: 10 }] }],
      Stop: [{ hooks: [{ command: hookCommand("codex", "idle", { notify: true }), timeout: 10 }] }],
    },
  });
}

function copilotHooksSource() {
  return sortedJSON({
    version: 1,
    managedBy: "supacode-linux",
    marker: managedMarker,
    hooks: {
      sessionStart: [{ type: "command", bash: hookCommand("copilot", "session_start"), timeoutSec: 5 }],
      userPromptSubmitted: [{ type: "command", bash: hookCommand("copilot", "busy"), timeoutSec: 10 }],
      preToolUse: [{ type: "command", bash: hookCommand("copilot", "busy"), timeoutSec: 5 }],
      postToolUse: [{ type: "command", bash: hookCommand("copilot", "busy"), timeoutSec: 5 }],
      agentStop: [{ type: "command", bash: hookCommand("copilot", "idle", { notify: true }), timeoutSec: 10 }],
      sessionEnd: [{ type: "command", bash: hookCommand("copilot", "session_end"), timeoutSec: 5 }],
      notification: [
        {
          type: "command",
          bash: hookCommand("copilot", "awaiting_input", { notify: true, conditionalNotification: true }),
          timeoutSec: 10,
        },
      ],
    },
  });
}

function hookCommand(agent, event, options = {}) {
  const eventArgs = [
    "supacode-linux agent event",
    `--agent ${shellQuote(agent)}`,
    `--event ${shellQuote(event)}`,
    '--surface "${SUPACODE_SURFACE_ID:-}"',
    '--worktree "${SUPACODE_WORKTREE_ID:-}"',
    '--tab "${SUPACODE_TAB_ID:-}"',
  ];
  if (options.notify) {
    eventArgs.push("--notify true");
  }
  const command = `[ -n "\${SUPACODE_SURFACE_ID:-}" ] && ${eventArgs.join(" ")} || true ${managedMarker}`;
  if (!options.conditionalNotification) {
    return command;
  }
  return `__supacode_in=$(cat); case "$__supacode_in" in *permission_prompt*|*elicitation_dialog*) ${command} ;; esac`;
}

function existingFileIsManaged(path) {
  return existsSync(path) && readFileSync(path, "utf8").includes(managedMarker);
}

function sortedJSON(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function agentHash(agent) {
  return sha256(agentDefinition(agent, "/").files.map((file) => file.content).join("\n"));
}
