#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { caseRelative, loadCase, parseArgs, readJson, requiredArg, writeJson } from "./lib.mjs";
import {
  buildDefaultComparisonResult,
  buildEvaluatorPrompt,
  renderComparisonReport,
  validateComparisonResult,
  validateManualProofs
} from "./replay-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const { caseDir, manifest } = loadCase(requiredArg(args, "case"));
const runDir = requiredArg(args, "run-dir");
const outputDir = join(runDir, "comparison");
mkdirSync(outputDir, { recursive: true });
const evidenceManifestPath = join(outputDir, "evidence-manifest.json");
const checksSummaryPath = join(runDir, "checks-summary.json");
const manualProofSummary = validateManualProofs(caseDir, manifest);

const evidence = {
  caseId: manifest.caseId,
  title: manifest.title,
  caseDir,
  goalPath: caseRelative(caseDir, manifest.goal.path),
  sourcePrPath: caseRelative(caseDir, manifest.sourceTruth.prMetadataPath),
  mergedPatchPath: caseRelative(caseDir, manifest.sourceTruth.mergedPatchPath),
  selectedPatchPath: caseRelative(caseDir, manifest.sourceTruth.selectedPatchPath || manifest.sourceTruth.mergedPatchPath),
  selectedStatPath: manifest.sourceTruth.selectedStatPath ? caseRelative(caseDir, manifest.sourceTruth.selectedStatPath) : null,
  selectedNumstatPath: manifest.sourceTruth.selectedNumstatPath ? caseRelative(caseDir, manifest.sourceTruth.selectedNumstatPath) : null,
  selectedFilesPath: manifest.sourceTruth.selectedFilesPath ? caseRelative(caseDir, manifest.sourceTruth.selectedFilesPath) : null,
  selectedStatsPath: manifest.sourceTruth.selectedStatsPath ? caseRelative(caseDir, manifest.sourceTruth.selectedStatsPath) : null,
  statsMismatch: Boolean(manifest.sourceTruth.statsMismatch),
  evidenceManifestPath,
  checksSummaryPath,
  manualProofs: manualProofSummary.proofs.map(({ errors, ...proof }) => ({
    ...proof,
    errors
  })),
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

writeJson(evidenceManifestPath, evidence);

const checksSummary = existsSync(checksSummaryPath) ? readJson(checksSummaryPath) : null;
const result = buildDefaultComparisonResult({
  manifest,
  evidence,
  checksSummary,
  manualProofSummary
});
const resultErrors = validateComparisonResult(result, manifest.evaluation.criteria);
if (resultErrors.length > 0) {
  throw new Error(`generated comparison result is invalid:\n- ${resultErrors.join("\n- ")}`);
}

writeJson(join(outputDir, "comparison-result.json"), result);
writeFileSync(join(outputDir, "comparison-report.md"), renderComparisonReport(result, manifest, evidence, readMaybe(evidence.goalPath)));
writeFileSync(join(outputDir, "evaluator-prompt.md"), buildEvaluatorPrompt({ caseDir, runDir, evidence }));

console.log(`Comparison result: ${join(outputDir, "comparison-result.json")}`);
console.log(`Comparison report: ${join(outputDir, "comparison-report.md")}`);

function readMaybe(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
