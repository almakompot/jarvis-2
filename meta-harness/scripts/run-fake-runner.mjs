#!/usr/bin/env node

import process from "node:process";

import { fakeRunnerScenarios, runFakeCodex } from "../lib/fake-runner.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await runFakeCodex({
    runDir: args.runDir,
    scenario: args.scenario,
    totalTimeoutMs: args.totalTimeoutMs
  });
  console.log(`Fake runner status: ${result.status}`);
  console.log(`Run dir: ${result.runDir}`);
  if (result.runnerState.failures.length > 0) {
    console.log(`Failures: ${result.runnerState.failures.map((failure) => failure.id).join(", ")}`);
  }
  process.exit(result.status === "implemented" ? 0 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    runDir: null,
    scenario: "success",
    totalTimeoutMs: 2000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--scenario") {
      args.scenario = argv[++index];
    } else if (item === "--timeout-ms") {
      args.totalTimeoutMs = Number(argv[++index]);
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
  if (!fakeRunnerScenarios.includes(args.scenario)) {
    throw new Error(`--scenario must be one of: ${fakeRunnerScenarios.join(", ")}`);
  }
  if (!Number.isInteger(args.totalTimeoutMs) || args.totalTimeoutMs < 1) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-fake-runner.mjs --run-dir /path/to/.task-runs/<id> [--scenario success] [--timeout-ms 2000]

Scenarios:
  ${fakeRunnerScenarios.join("\n  ")}
`);
}
