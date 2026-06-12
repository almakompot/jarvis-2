#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCase, parseArgs, repoRoot, replayRoot, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const tier = args.tier || "smoke";
const execute = args.execute === true;
const includeStress = args["include-stress"] === true;
const continueOnFailure = args["continue-on-failure"] === true;
const caseRoots = args["case-root"]
  ? [resolve(process.cwd(), args["case-root"])]
  : [join(replayRoot, "cases"), join(replayRoot, "private-cases")].filter(existsSync);

if (!["smoke", "medium", "stress"].includes(tier)) {
  throw new Error("--tier must be smoke, medium, or stress");
}
if (tier === "stress" && !includeStress) {
  throw new Error("stress tier requires --include-stress");
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outDir = resolve(process.cwd(), args["out-dir"] || join(repoRoot, "tmp", "voovo-pr-replay-suite", `${tier}-${timestamp}`));
mkdirSync(outDir, { recursive: true });

const discoveredCases = discoverCases(caseRoots)
  .map((caseDir) => loadCase(caseDir))
  .map(({ caseDir, manifest }) => ({ caseDir, manifest }))
  .sort((left, right) => left.manifest.caseId.localeCompare(right.manifest.caseId));
const cases = discoveredCases.filter(({ manifest }) => (manifest.tier || "smoke") === tier);

const summary = {
  tier,
  execute,
  includeStress,
  generatedAt: new Date().toISOString(),
  outDir,
  selected: cases.map(({ caseDir, manifest }) => ({
    caseId: manifest.caseId,
    caseDir,
    tier: manifest.tier || "smoke",
    requiresManualProof: Boolean(manifest.requiresManualProof),
    automationConfidence: manifest.automationConfidence || null
  })),
  skipped: discoveredCases
    .filter(({ manifest }) => (manifest.tier || "smoke") !== tier)
    .map(({ caseDir, manifest }) => ({
      caseId: manifest.caseId,
      caseDir,
      tier: manifest.tier || "smoke",
      reason: `tier is ${manifest.tier || "smoke"}`
    })),
  results: []
};

for (const { caseDir, manifest } of cases) {
  if (!execute) {
    summary.results.push({
      caseId: manifest.caseId,
      status: "dry-run",
      caseDir,
      comparison: "not-run"
    });
    continue;
  }

  const runCase = spawnSync("node", [join(replayRoot, "scripts", "run-case.mjs"), "--case", caseDir], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
  const caseOutDir = join(outDir, manifest.caseId);
  mkdirSync(caseOutDir, { recursive: true });
  writeFileSync(join(caseOutDir, "run-case.stdout.log"), runCase.stdout || "");
  writeFileSync(join(caseOutDir, "run-case.stderr.log"), runCase.stderr || "");
  const runDir = extractRunOutput(runCase.stdout || "");

  let compareStatus = null;
  if (runCase.status === 0 && runDir) {
    const compare = spawnSync("node", [join(replayRoot, "scripts", "compare-case.mjs"), "--case", caseDir, "--run-dir", runDir], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20
    });
    compareStatus = compare.status;
    writeFileSync(join(caseOutDir, "compare.stdout.log"), compare.stdout || "");
    writeFileSync(join(caseOutDir, "compare.stderr.log"), compare.stderr || "");
  }

  const status = runCase.status === 0 && compareStatus === 0 ? "passed" : "failed";
  summary.results.push({
    caseId: manifest.caseId,
    status,
    runCaseStatus: runCase.status,
    compareStatus,
    runDir
  });

  if (status === "failed" && !continueOnFailure) {
    break;
  }
}

writeJson(join(outDir, "suite-summary.json"), summary);
writeFileSync(join(outDir, "suite-summary.md"), renderSummary(summary));
console.log(`Suite summary: ${join(outDir, "suite-summary.json")}`);
if (execute && summary.results.some((result) => result.status === "failed")) {
  process.exit(1);
}

function discoverCases(roots) {
  const caseDirs = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const caseDir = join(root, entry.name);
      if (existsSync(join(caseDir, "case.json"))) {
        caseDirs.push(caseDir);
      }
    }
  }
  return caseDirs;
}

function extractRunOutput(stdout) {
  const match = stdout.match(/^Run output:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function renderSummary(summary) {
  return [
    `# VOOVO PR Replay Suite: ${summary.tier}`,
    "",
    `Mode: ${summary.execute ? "execute" : "dry-run"}`,
    `Generated: ${summary.generatedAt}`,
    "",
    "## Selected Cases",
    "",
    ...(summary.selected.length
      ? summary.selected.map((item) => `- ${item.caseId}: ${relative(repoRoot, item.caseDir)}`)
      : ["- none"]),
    "",
    "## Skipped Cases",
    "",
    ...(summary.skipped.length
      ? summary.skipped.map((item) => `- ${item.caseId}: ${item.reason}`)
      : ["- none"]),
    "",
    "## Results",
    "",
    ...(summary.results.length
      ? summary.results.map((item) => `- ${item.caseId}: ${item.status}${item.runDir ? ` (${item.runDir})` : ""}`)
      : ["- none"])
  ].join("\n");
}
