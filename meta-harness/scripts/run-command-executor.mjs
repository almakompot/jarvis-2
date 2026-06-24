#!/usr/bin/env node

import process from "node:process";

import { runCommandProofExecutor } from "../lib/command-executor.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCommandProofExecutor({
    runDir: args.runDir,
    timeoutMs: args.timeoutMs,
    onlyTestIds: args.onlyTestIds.length > 0 ? args.onlyTestIds : null
  });
  console.log(`Command proof status: ${result.status}`);
  console.log(`Run dir: ${result.runDir}`);
  console.log(`Commands this run: ${result.commandResults.length}`);
  const failed = result.commandResults.filter((command) => ["failed", "timed-out", "blocked"].includes(command.status));
  if (failed.length > 0) {
    console.log(`Non-passing commands: ${failed.map((command) => `${command.id}:${command.status}`).join(", ")}`);
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
    onlyTestIds: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index]);
    } else if (item === "--test-id") {
      args.onlyTestIds.push(argv[++index]);
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
  node meta-harness/scripts/run-command-executor.mjs --run-dir /path/to/.task-runs/<id> [--timeout-ms 30000] [--test-id T1]

Runs command-shaped proof from spec.requiredTests, writes command evidence under evidence/commands, appends command-log.jsonl, and updates verification.json.
`);
}
