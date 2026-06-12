#!/usr/bin/env node

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, requiredArg, runCommand, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const runDir = resolve(process.cwd(), requiredArg(args, "run-dir"));
const execute = args.execute === true;
const summaryPath = resolve(runDir, "summary.json");

if (!existsSync(summaryPath)) {
  throw new Error(`Missing run summary: ${summaryPath}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const candidates = collectCandidates(summary, runDir);
const result = {
  runDir,
  execute,
  candidates,
  removed: [],
  refused: []
};

for (const candidate of candidates) {
  if (!isHarnessPath(candidate, runDir)) {
    result.refused.push({ path: candidate, reason: "outside harness run directory" });
    continue;
  }
  if (!existsSync(candidate)) {
    result.removed.push({ path: candidate, status: "already-missing" });
    continue;
  }
  if (!execute) {
    result.removed.push({ path: candidate, status: "dry-run" });
    continue;
  }
  const remove = removeWorktreeOrDirectory(candidate);
  result.removed.push({
    path: candidate,
    status: remove.status === 0 ? "removed" : "failed",
    stderr: remove.stderr
  });
}

writeJson(resolve(runDir, "cleanup-summary.json"), result);
console.log(JSON.stringify(result, null, 2));

if (result.refused.length > 0 || result.removed.some((item) => item.status === "failed")) {
  process.exit(1);
}

function collectCandidates(summary, runDir) {
  const candidates = new Set();
  for (const run of summary.runs || []) {
    if (run.workdir) {
      candidates.add(resolve(run.workdir));
    }
  }
  for (const variant of ["baseline", "resilient"]) {
    candidates.add(resolve(runDir, variant, "workdir"));
  }
  return [...candidates].sort();
}

function isHarnessPath(path, runDir) {
  const absolute = resolve(path);
  return absolute.startsWith(`${runDir}/`) && /\/(baseline|resilient)\/workdir$/.test(absolute);
}

function removeWorktreeOrDirectory(path) {
  if (isLinkedGitWorktree(path)) {
    const commonDir = runCommand("git rev-parse --path-format=absolute --git-common-dir", path);
    if (commonDir.status !== 0) {
      return { status: commonDir.status, stderr: commonDir.stderr };
    }
    return spawnSync("git", ["--git-dir", commonDir.stdout.trim(), "worktree", "remove", "--force", path], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10
    });
  }
  rmSync(path, { recursive: true, force: true });
  return { status: 0, stderr: "" };
}

function isLinkedGitWorktree(path) {
  const gitMarker = resolve(path, ".git");
  if (!existsSync(gitMarker)) {
    return false;
  }
  const stat = statSync(gitMarker);
  return stat.isFile() && readFileSync(gitMarker, "utf8").startsWith("gitdir:");
}
