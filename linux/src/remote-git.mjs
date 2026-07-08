import { shellQuote } from "./utils.mjs";

const safeShellToken = /^[A-Za-z0-9_./:=@%+-]+$/;
const defaultControlPath = "~/.ssh/agent-workbench-%C";
const backgroundProbeOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
const interactiveOptions = ["-o", "ConnectTimeout=30"];

export function remoteGitCommand(repoPath, args) {
  return ["git", "-C", repoPath, ...args].map(shellToken).join(" ");
}

export function remoteGitSSHArgs(remoteHost, repoPath, args) {
  return [
    ...sshControlOptions(),
    ...backgroundProbeOptions,
    remoteHost,
    loginShellWrapped(remoteGitCommand(repoPath, args)),
  ];
}

export function sshCommandLine(remoteHost, remoteCommand, { allocateTTY = true } = {}) {
  const tokens = ["/usr/bin/ssh", ...sshControlOptions(), ...interactiveOptions];
  if (allocateTTY) {
    tokens.push("-tt");
  }
  tokens.push(remoteHost, loginShellWrapped(remoteCommand));
  return tokens.map(shellToken).join(" ");
}

export function loginShellWrapped(script) {
  return `exec "$SHELL" -l -c ${shellQuote(script)}`;
}

function sshControlOptions() {
  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${defaultControlPath}`,
    "-o",
    "ControlPersist=10m",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=3",
  ];
}

function shellToken(value) {
  const token = String(value);
  return safeShellToken.test(token) ? token : shellQuote(token);
}
