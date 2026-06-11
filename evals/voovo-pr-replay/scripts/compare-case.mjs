#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { caseRelative, loadCase, parseArgs, requiredArg, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const { caseDir, manifest } = loadCase(requiredArg(args, "case"));
const runDir = requiredArg(args, "run-dir");
const outputDir = join(runDir, "comparison");
mkdirSync(outputDir, { recursive: true });

const evidence = {
  caseId: manifest.caseId,
  title: manifest.title,
  goalPath: caseRelative(caseDir, manifest.goal.path),
  sourcePrPath: caseRelative(caseDir, manifest.sourceTruth.prMetadataPath),
  mergedPatchPath: caseRelative(caseDir, manifest.sourceTruth.mergedPatchPath),
  variants: {}
};

for (const variant of ["baseline", "resilient"]) {
  const variantDir = join(runDir, variant);
  evidence.variants[variant] = {
    finalPath: join(variantDir, "final.md"),
    implementationPatchPath: join(variantDir, "implementation.patch"),
    changedFilesPath: join(variantDir, "changed-files.txt"),
    checksSummaryPath: join(variantDir, "checks-summary.json")
  };
}

writeJson(join(outputDir, "evidence-manifest.json"), evidence);

const report = [
  `# Comparison Report: ${manifest.caseId}`,
  "",
  "Status: draft scaffold. An evaluator should fill this using the evidence below.",
  "",
  "## Goal",
  "",
  fence(readMaybe(evidence.goalPath)),
  "",
  "## Evidence Files",
  "",
  `- Source PR metadata: ${relative(process.cwd(), evidence.sourcePrPath)}`,
  `- Merged PR patch: ${relative(process.cwd(), evidence.mergedPatchPath)}`,
  `- Baseline patch: ${relative(process.cwd(), evidence.variants.baseline.implementationPatchPath)}`,
  `- Resilient patch: ${relative(process.cwd(), evidence.variants.resilient.implementationPatchPath)}`,
  `- Baseline checks: ${relative(process.cwd(), evidence.variants.baseline.checksSummaryPath)}`,
  `- Resilient checks: ${relative(process.cwd(), evidence.variants.resilient.checksSummaryPath)}`,
  "",
  "## Verdict",
  "",
  "- Winner: TBD",
  "- Confidence: TBD",
  "- Reason: TBD",
  "",
  "## Criteria",
  "",
  ...manifest.evaluation.criteria.map((criterion) => `- ${criterion}: TBD`),
  "",
  "## Notes For Eval Agent",
  "",
  "Do not reward similarity to the merged patch by itself. Compare whether each implementation satisfies the goal with lower risk, clearer structure, stronger tests, and better fit to repo patterns. Cite exact evidence from patches and check logs."
].join("\n");

writeFileSync(join(outputDir, "comparison-report.md"), report);

const evalPrompt = [
  "Use resilient execution Level 3.",
  "",
  "Evaluate this PR replay case. You are allowed to inspect the evidence files listed in `comparison/evidence-manifest.json`.",
  "",
  "Compare the merged PR, baseline implementation, and resilient implementation. Do not judge by diff similarity alone. Produce a verdict with concrete citations to patches, changed files, checks, and unresolved assumptions.",
  "",
  `Case directory: ${caseDir}`,
  `Run directory: ${runDir}`
].join("\n");
writeFileSync(join(outputDir, "eval-agent-prompt.md"), evalPrompt);

console.log(`Comparison scaffold: ${join(outputDir, "comparison-report.md")}`);

function readMaybe(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function fence(value) {
  return ["```text", value.trim(), "```"].join("\n");
}

