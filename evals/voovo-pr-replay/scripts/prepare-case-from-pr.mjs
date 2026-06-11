#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, readJson, requiredArg, runCommand, slugify, writeCommandLog, writeJson, replayRoot } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const githubRepo = requiredArg(args, "github-repo");
const prNumber = requiredArg(args, "pr");
const sourceRepo = requiredArg(args, "source-repo");
const outRoot = resolve(process.cwd(), args["out-dir"] || join(replayRoot, "private-cases"));

const prView = runCommand(
  `gh pr view ${shellQuote(prNumber)} --repo ${shellQuote(githubRepo)} --json number,title,body,state,mergedAt,baseRefName,headRefName,baseRefOid,headRefOid,mergeCommit,url,author,files,commits`,
  process.cwd()
);
if (prView.status !== 0) {
  writeCommandLog(join(outRoot, "prepare-pr-error.log"), prView);
  throw new Error(`gh pr view failed for ${githubRepo}#${prNumber}`);
}

const pr = JSON.parse(prView.stdout);
if (pr.state !== "MERGED") {
  throw new Error(`PR ${githubRepo}#${prNumber} is ${pr.state}, expected MERGED`);
}

const caseId = args["case-id"] || `${githubRepo.split("/").pop()}-pr${pr.number}-${slugify(pr.title)}`;
const caseDir = join(outRoot, caseId);
mkdirSync(join(caseDir, "source"), { recursive: true });

writeJson(join(caseDir, "source", "pr.json"), pr);

const prDiff = runCommand(`gh pr diff ${shellQuote(prNumber)} --repo ${shellQuote(githubRepo)} --patch`, process.cwd());
if (prDiff.status !== 0) {
  writeCommandLog(join(caseDir, "source", "diff-error.log"), prDiff);
  throw new Error(`gh pr diff failed for ${githubRepo}#${prNumber}`);
}
writeFileSync(join(caseDir, "source", "merged.patch"), prDiff.stdout);

const goal = buildGoalDraft(pr);
writeFileSync(join(caseDir, "goal.md"), goal);

writeJson(join(caseDir, "case.json"), {
  schemaVersion: 1,
  caseId,
  title: pr.title,
  visibility: "private-voovo",
  workspace: {
    kind: "git-worktree",
    sourceRepo: resolve(sourceRepo),
    baseRef: pr.baseRefOid
  },
  goal: {
    path: "goal.md",
    humanReviewed: false
  },
  sourceTruth: {
    prMetadataPath: "source/pr.json",
    mergedPatchPath: "source/merged.patch"
  },
  checks: [
    {
      name: "test",
      command: "npm test",
      required: false
    },
    {
      name: "build",
      command: "npm run build",
      required: false
    }
  ],
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
console.log("Review goal.md for leakage before running agents.");

function buildGoalDraft(pr) {
  const body = pr.body || "";
  const why = extractSection(body, "Why");
  const impact = extractSection(body, "Impact");
  const fallback = body
    .replace(/## What changed[\s\S]*?(?=\n## |\n# |$)/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
  const context = [why, impact].filter(Boolean).join("\n\n") || fallback || "Review the PR title and write an outcome-only goal before running this case.";

  return [
    "# Goal",
    "",
    "This is an auto-generated outcome-only draft. Human review is required before running agents.",
    "",
    "## Desired Outcome",
    "",
    redactImplementationHints(context),
    "",
    "## Done Means",
    "",
    "- the original user-facing or developer-facing problem is fixed",
    "- existing behavior outside the goal is preserved",
    "- the allowed checks in `case.json` are run or explicitly reported as unavailable",
    "- the final answer states verification and remaining risk"
  ].join("\n");
}

function extractSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"));
  return match ? match[1].trim() : "";
}

function redactImplementationHints(text) {
  return text
    .replace(/`[^`]*`/g, "[redacted implementation detail]")
    .replace(/\b[A-Za-z0-9_./()[\]-]+\.(tsx|ts|jsx|js|mjs|cjs|css|scss)\b/g, "[redacted file path]")
    .trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
