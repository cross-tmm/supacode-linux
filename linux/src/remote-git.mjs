import { shellQuote } from "./utils.mjs";

const safeShellToken = /^[A-Za-z0-9_./:=@%+-]+$/;

export function remoteGitCommand(repoPath, args) {
  return ["git", "-C", repoPath, ...args].map(shellToken).join(" ");
}

export function remoteGitSSHArgs(remoteHost, repoPath, args) {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", remoteHost, remoteGitCommand(repoPath, args)];
}

function shellToken(value) {
  const token = String(value);
  return safeShellToken.test(token) ? token : shellQuote(token);
}
