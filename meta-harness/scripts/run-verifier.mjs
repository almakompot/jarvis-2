#!/usr/bin/env node

import process from "node:process";

import { runCompletedRunVerifier } from "../lib/verifier.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = runCompletedRunVerifier({ runDir: args.runDir });
  console.log(`Verifier status: ${result.status}`);
  console.log(`Decision recommendation: ${result.decisionRecommendation}`);
  console.log(`Run dir: ${result.runDir}`);
  console.log(`Findings: ${result.findings.length}`);
  const blocking = result.findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length > 0) {
    console.log(`Blocking findings: ${blocking.map((finding) => `${finding.id}:${finding.ruleId}`).join(", ")}`);
  }
  process.exit(result.status === "passed" ? 0 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = { runDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  if (!args.runDir) {
    throw new Error("--run-dir is required.");
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-verifier.mjs --run-dir /path/to/.task-runs/<id>

Runs the M6 completed-run verifier and writes verifier-report.json.
`);
}
