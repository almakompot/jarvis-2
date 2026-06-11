#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { caseRelative, loadCase, readJson, replayRoot } from "./lib.mjs";

const roots = [join(replayRoot, "cases"), join(replayRoot, "private-cases")].filter(existsSync);
const failures = [];
const cases = [];

for (const root of roots) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const caseDir = join(root, entry.name);
    if (existsSync(join(caseDir, "case.json"))) {
      cases.push(caseDir);
    }
  }
}

function fail(caseDir, message) {
  failures.push(`${relative(process.cwd(), caseDir)}: ${message}`);
}

for (const caseDir of cases) {
  let loaded;
  try {
    loaded = loadCase(caseDir);
  } catch (error) {
    failures.push(`${relative(process.cwd(), caseDir)}: ${error.message}`);
    continue;
  }

  const { manifest } = loaded;
  const requiredTop = ["schemaVersion", "caseId", "title", "visibility", "workspace", "goal", "sourceTruth", "checks", "evaluation"];
  for (const key of requiredTop) {
    if (!(key in manifest)) {
      fail(caseDir, `missing manifest key ${key}`);
    }
  }

  if (manifest.schemaVersion !== 1) {
    fail(caseDir, "schemaVersion must be 1");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.caseId || "")) {
    fail(caseDir, "caseId must be kebab-case");
  }

  const goalPath = caseRelative(caseDir, manifest.goal?.path || "");
  const prPath = caseRelative(caseDir, manifest.sourceTruth?.prMetadataPath || "");
  const patchPath = caseRelative(caseDir, manifest.sourceTruth?.mergedPatchPath || "");
  const selectedPaths = [
    ["selected patch", manifest.sourceTruth?.selectedPatchPath],
    ["selected stat", manifest.sourceTruth?.selectedStatPath],
    ["selected numstat", manifest.sourceTruth?.selectedNumstatPath],
    ["selected files", manifest.sourceTruth?.selectedFilesPath],
    ["selected stats", manifest.sourceTruth?.selectedStatsPath]
  ].filter(([, path]) => path);

  for (const [path, label] of [
    [goalPath, "goal"],
    [prPath, "source PR metadata"],
    [patchPath, "source merged patch"]
  ]) {
    if (!existsSync(path)) {
      fail(caseDir, `missing ${label}: ${path}`);
    }
  }
  for (const [label, relativePath] of selectedPaths) {
    const path = caseRelative(caseDir, relativePath);
    if (!existsSync(path)) {
      fail(caseDir, `missing ${label}: ${path}`);
    }
  }

  if (manifest.workspace?.kind === "copy-fixture") {
    const fixturePath = resolve(caseDir, manifest.workspace.fixturePath || "");
    if (!existsSync(fixturePath)) {
      fail(caseDir, `missing fixturePath: ${fixturePath}`);
    }
  } else if (manifest.workspace?.kind === "git-worktree") {
    if (!manifest.workspace.sourceRepo || !(manifest.workspace.preSha || manifest.workspace.baseRef)) {
      fail(caseDir, "git-worktree cases require workspace.sourceRepo and workspace.preSha or legacy workspace.baseRef");
    }
    if (manifest.workspace.snapshotSensitive && (!manifest.workspace.headSha || !manifest.workspace.prHeadRef)) {
      fail(caseDir, "snapshot-sensitive git-worktree cases require workspace.headSha and workspace.prHeadRef");
    }
  } else {
    fail(caseDir, "workspace.kind must be copy-fixture or git-worktree");
  }

  if (existsSync(prPath) && existsSync(goalPath)) {
    const pr = readJson(prPath);
    const goal = readFileSync(goalPath, "utf8");
    if (/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.test(goal)) {
      fail(caseDir, "goal leaks source PR URL");
    }
    for (const file of pr.files || []) {
      if (file.path && goal.includes(file.path)) {
        fail(caseDir, `goal leaks changed file path: ${file.path}`);
      }
    }
  }

  if (manifest.goal?.leakageReportPath) {
    const reportPath = caseRelative(caseDir, manifest.goal.leakageReportPath);
    if (!existsSync(reportPath)) {
      fail(caseDir, `missing leakage report: ${reportPath}`);
    } else {
      const report = readJson(reportPath);
      if ((report.blockingFindings || []).length > 0) {
        fail(caseDir, `leakage report has ${report.blockingFindings.length} blocking finding(s)`);
      }
    }
  }

  for (const [index, check] of (manifest.checks || []).entries()) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(check.name || "")) {
      fail(caseDir, `check ${index} has invalid name`);
    }
    if (!check.command) {
      fail(caseDir, `check ${index} is missing command`);
    }
  }
}

if (cases.length === 0) {
  failures.push("no cases found");
}

if (failures.length > 0) {
  console.error("Case validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${cases.length} PR replay case(s).`);
