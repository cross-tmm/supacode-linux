import { spawn } from "node:child_process";

export async function spawnFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const rendered = [command, ...args].join(" ");
      reject(new Error(`${rendered} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export async function spawnFileJSON(command, args, options = {}) {
  const output = await spawnFile(command, args, options);
  if (!output.trim()) {
    return [];
  }
  return JSON.parse(output);
}

export function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}
