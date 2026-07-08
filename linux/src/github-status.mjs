export const pullRequestFields = [
  "baseRefName",
  "headRefName",
  "isDraft",
  "mergeStateStatus",
  "mergeable",
  "number",
  "reviewDecision",
  "state",
  "statusCheckRollup",
  "title",
  "updatedAt",
  "url",
].join(",");

export function normalizePullRequest(raw) {
  const checksState = normalizeChecks(raw.statusCheckRollup ?? []);
  const mergeReadiness = normalizeMergeReadiness(raw, checksState);
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url ?? "",
    state: raw.state ?? "UNKNOWN",
    headRef: raw.headRefName ?? null,
    baseRef: raw.baseRefName ?? null,
    isDraft: Boolean(raw.isDraft),
    reviewDecision: raw.reviewDecision ?? null,
    mergeState: raw.mergeStateStatus ?? null,
    checksState,
    mergeReadiness,
    raw,
  };
}

export function normalizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return "unknown";
  }
  const states = checks.map(checkState);
  if (states.some((state) => state === "failing")) {
    return "failing";
  }
  if (states.some((state) => state === "pending")) {
    return "pending";
  }
  if (states.every((state) => state === "passing")) {
    return "passing";
  }
  return "unknown";
}

function checkState(check) {
  const conclusion = upper(check.conclusion);
  const status = upper(check.status);
  const state = upper(check.state);
  if (["FAILURE", "FAILED", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(conclusion)) {
    return "failing";
  }
  if (["FAILURE", "FAILED", "ERROR"].includes(state)) {
    return "failing";
  }
  if (["QUEUED", "IN_PROGRESS", "PENDING", "EXPECTED", "WAITING", "REQUESTED"].includes(status)) {
    return "pending";
  }
  if (["PENDING", "EXPECTED"].includes(state)) {
    return "pending";
  }
  if (["SUCCESS", "SKIPPED", "NEUTRAL"].includes(conclusion) || state === "SUCCESS") {
    return "passing";
  }
  return "unknown";
}

function normalizeMergeReadiness(raw, checksState) {
  if (raw.isDraft) {
    return "draft";
  }
  if (raw.state && raw.state !== "OPEN") {
    return raw.state.toLowerCase();
  }
  if (raw.reviewDecision === "CHANGES_REQUESTED") {
    return "blocked";
  }
  if (["DIRTY", "BLOCKED", "UNKNOWN"].includes(raw.mergeStateStatus)) {
    return "blocked";
  }
  if (raw.mergeStateStatus === "BEHIND") {
    return "behind";
  }
  if (checksState === "failing") {
    return "checks_failing";
  }
  if (checksState === "pending") {
    return "checks_pending";
  }
  if (["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(raw.mergeStateStatus) && checksState === "passing") {
    return "ready";
  }
  return "unknown";
}

function upper(value) {
  return typeof value === "string" ? value.toUpperCase() : null;
}
