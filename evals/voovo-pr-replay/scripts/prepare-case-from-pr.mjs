#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, repoRoot, requiredArg, runCommand, slugify, writeCommandLog, writeJson, replayRoot } from "./lib.mjs";
import {
  assertPrivateOutputPath,
  buildCheckPlan,
  buildGoalDraft,
  buildLeakageReport,
  generateSelectedSourceTruth,
  sanitizeRefPart,
  selectedStatsMismatch,
  selectPrePrSnapshot,
  shellQuote
} from "./replay-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const githubRepo = requiredArg(args, "github-repo");
const prNumber = requiredArg(args, "pr");
const sourceRepo = requiredArg(args, "source-repo");
const outRoot = resolve(process.cwd(), args["out-dir"] || join(replayRoot, "private-cases"));
assertPrivateOutputPath(outRoot, repoRoot, args["allow-unignored-output"] === true);

const prView = runCommand(
  `gh pr view ${shellQuote(prNumber)} --repo ${shellQuote(githubRepo)} --json number,title,body,state,mergedAt,closedAt,createdAt,baseRefName,headRefName,baseRefOid,headRefOid,mergeCommit,url,author,files,commits,additions,deletions,changedFiles`,
  process.cwd()
);
if (prView.status !== 0) {
  writeCommandLog(join(outRoot, "prepare-pr-error.log"), prView);
  throw new Error(`gh pr view failed for ${githubRepo}#${prNumber}`);
}

const pr = JSON.parse(prView.stdout);
const allowOpen = args["allow-open"] === true;
if (pr.state !== "MERGED" && !allowOpen) {
  throw new Error(`PR ${githubRepo}#${prNumber} is ${pr.state}, expected MERGED. Pass --allow-open to snapshot open PRs.`);
}

const caseId = args["case-id"] || `${githubRepo.split("/").pop()}-pr${pr.number}-${slugify(pr.title)}`;
const caseDir = join(outRoot, caseId);
mkdirSync(join(caseDir, "source"), { recursive: true });

writeJson(join(caseDir, "source", "pr.json"), pr);

const prHeadRef =
  args["pr-head-ref"] ||
  `refs/codex-audit/${sanitizeRefPart(githubRepo)}/pr-${pr.number}-head`;
const snapshot = selectPrePrSnapshot({ pr, sourceRepo: resolve(sourceRepo), prHeadRef });
if (snapshot.error) {
  writeJson(join(caseDir, "source", "snapshot-error.json"), snapshot);
  throw new Error(snapshot.error);
}
writeJson(join(caseDir, "source", "snapshot.json"), {
  preSha: snapshot.preSha,
  headSha: snapshot.headSha,
  mergeSha: snapshot.mergeSha,
  preMethod: snapshot.preMethod,
  prHeadRef: snapshot.prHeadRef,
  snapshotSensitive: snapshot.snapshotSensitive
});
for (const [name, result] of Object.entries(snapshot.logs || {})) {
  writeCommandLog(join(caseDir, "source", `${name}.log`), result);
}

const selected = generateSelectedSourceTruth({
  sourceRepo: resolve(sourceRepo),
  preSha: snapshot.preSha,
  headSha: snapshot.headSha,
  sourceDir: join(caseDir, "source")
});
writeFileSync(join(caseDir, "source", "selected.patch"), selected.patch.stdout);
writeFileSync(join(caseDir, "source", "selected.stat.txt"), selected.stat.stdout);
writeFileSync(join(caseDir, "source", "selected.numstat.txt"), selected.numstat.stdout);
writeFileSync(join(caseDir, "source", "selected.files.txt"), selected.files.stdout);
writeJson(join(caseDir, "source", "selected-stats.json"), selected.stats);
writeFileSync(join(caseDir, "source", "merged.patch"), selected.patch.stdout);

const changedFiles = selected.stats.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions }));
const { checks, manualProofs } = buildCheckPlan(changedFiles);

const goal = buildGoalDraft(pr);
writeFileSync(join(caseDir, "goal.md"), goal);
const leakageReport = buildLeakageReport(goal, pr, changedFiles);
writeJson(join(caseDir, "source", "goal-leakage-report.json"), leakageReport);

const githubStats = {
  additions: pr.additions,
  deletions: pr.deletions,
  changedFiles: pr.changedFiles,
  files: pr.files || []
};
const mismatch = selectedStatsMismatch(githubStats, selected.stats);

writeJson(join(caseDir, "case.json"), {
  schemaVersion: 1,
  caseId,
  title: pr.title,
  visibility: "private-voovo",
  workspace: {
    kind: "git-worktree",
    sourceRepo: resolve(sourceRepo),
    baseRef: snapshot.preSha,
    preSha: snapshot.preSha,
    headSha: snapshot.headSha,
    mergeSha: snapshot.mergeSha,
    preMethod: snapshot.preMethod,
    prHeadRef: snapshot.prHeadRef,
    snapshotSensitive: snapshot.snapshotSensitive
  },
  goal: {
    path: "goal.md",
    humanReviewed: false,
    leakageReportPath: "source/goal-leakage-report.json"
  },
  sourceTruth: {
    prMetadataPath: "source/pr.json",
    mergedPatchPath: "source/merged.patch",
    selectedPatchPath: "source/selected.patch",
    selectedStatPath: "source/selected.stat.txt",
    selectedNumstatPath: "source/selected.numstat.txt",
    selectedFilesPath: "source/selected.files.txt",
    selectedStatsPath: "source/selected-stats.json",
    githubStats,
    selectedStats: {
      additions: selected.stats.additions,
      deletions: selected.stats.deletions,
      changedFiles: selected.stats.changedFiles
    },
    statsMismatch: mismatch
  },
  checks,
  manualProofs,
  evaluation: {
    criteria: [
      "correctness",
      "regression risk",
      "maintainability",
      "minimality",
      "test quality",
      "product behavior",
      "repo-pattern fit",
      "review burden"
    ]
  }
});

console.log(`Prepared private PR replay case: ${caseDir}`);
console.log(`Pre-PR snapshot: ${snapshot.preSha} (${snapshot.preMethod})`);
if (mismatch) {
  console.log("Selected-base stats differ from GitHub PR stats; evaluator should use selected source truth.");
}
console.log("Review goal.md for leakage before running agents.");
