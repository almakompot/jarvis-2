#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
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

  for (const [path, label] of [
    [goalPath, "goal"],
    [prPath, "source PR metadata"],
    [patchPath, "source merged patch"]
  ]) {
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
    if (!manifest.workspace.sourceRepo || !manifest.workspace.baseRef) {
      fail(caseDir, "git-worktree cases require workspace.sourceRepo and workspace.baseRef");
    }
  } else {
    fail(caseDir, "workspace.kind must be copy-fixture or git-worktree");
  }

  if (existsSync(prPath) && existsSync(goalPath)) {
    const pr = readJson(prPath);
    const goal = String(await import("node:fs").then((fs) => fs.readFileSync(goalPath, "utf8")));
    if (/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.test(goal)) {
      fail(caseDir, "goal leaks source PR URL");
    }
    for (const file of pr.files || []) {
      if (file.path && goal.includes(file.path)) {
        fail(caseDir, `goal leaks changed file path: ${file.path}`);
      }
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
