#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { gateRoot, verifyRunDir } from "./verify-run.mjs";

const args = parseArgs(process.argv.slice(2));
const caseRoot = resolve(process.cwd(), args["case-root"] || join(gateRoot, "cases"));
const outDir = resolve(process.cwd(), args["out-dir"] || join(dirnameRepoRoot(), "tmp", "acceptance-gate"));
mkdirSync(outDir, { recursive: true });

const cases = discoverCases(caseRoot);
const results = cases.map((caseDir) => {
  const result = verifyRunDir(caseDir);
  const manifest = JSON.parse(readFileSync(join(caseDir, "manifest.json"), "utf8"));
  const expectedPass = manifest.expectation === "accept";
  return {
    caseId: manifest.caseId,
    caseDir,
    expectation: manifest.expectation,
    verifierPassed: result.passed,
    expectationMet: expectedPass === result.passed,
    errors: result.errors
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  caseRoot,
  results,
  passed: results.length > 0 && results.every((result) => result.expectationMet)
};

writeFileSync(join(outDir, "suite-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, "suite-summary.md"), renderSummary(summary));
console.log(`Acceptance gate suite: ${join(outDir, "suite-summary.json")}`);

if (!summary.passed) {
  process.exit(1);
}

function discoverCases(root) {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((caseDir) => existsSync(join(caseDir, "manifest.json")))
    .sort();
}

function renderSummary(summary) {
  return [
    "# Acceptance Gate Suite",
    "",
    `Generated: ${summary.generatedAt}`,
    `Case root: ${relative(dirnameRepoRoot(), summary.caseRoot)}`,
    "",
    "## Results",
    "",
    ...summary.results.map((result) => {
      const status = result.expectationMet ? "ok" : "failed";
      return `- ${result.caseId}: ${status} (expected ${result.expectation}, verifier ${result.verifierPassed ? "accepted" : "rejected"})`;
    })
  ].join("\n");
}

function dirnameRepoRoot() {
  return resolve(gateRoot, "..", "..");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}
