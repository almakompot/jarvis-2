#!/usr/bin/env node

import process from "node:process";

import { runSurfaceProofExecutor } from "../lib/surface-executor.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await runSurfaceProofExecutor({
    runDir: args.runDir,
    timeoutMs: args.timeoutMs,
    onlyProofIds: args.onlyProofIds.length > 0 ? args.onlyProofIds : null,
    onlySurfaceIds: args.onlySurfaceIds.length > 0 ? args.onlySurfaceIds : null
  });
  console.log(`Surface proof status: ${result.status}`);
  console.log(`Run dir: ${result.runDir}`);
  console.log(`Surface proofs this run: ${result.surfaceResults.length}`);
  const failed = result.surfaceResults.filter((proof) => ["failed", "timed-out", "blocked"].includes(proof.status));
  if (failed.length > 0) {
    console.log(`Non-passing surface proofs: ${failed.map((proof) => `${proof.id}:${proof.status}`).join(", ")}`);
  }
  process.exit(result.status === "passed" || result.status === "pending" ? 0 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    runDir: null,
    timeoutMs: 30000,
    onlyProofIds: [],
    onlySurfaceIds: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index]);
    } else if (item === "--proof-id") {
      args.onlyProofIds.push(argv[++index]);
    } else if (item === "--surface-id") {
      args.onlySurfaceIds.push(argv[++index]);
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
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-surface-executor.mjs --run-dir /path/to/.task-runs/<id> [--timeout-ms 30000] [--proof-id P4] [--surface-id S1]

Runs non-shell M5 surface proof from proof-plan surfaceProofs, writes typed evidence artifacts, and updates verification.json.
`);
}
