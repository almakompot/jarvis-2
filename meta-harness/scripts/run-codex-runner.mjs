#!/usr/bin/env node

import process from "node:process";

import { runCodexCli } from "../lib/codex-runner.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCodexCli({
    runDir: args.runDir,
    executable: args.executable,
    sandbox: args.sandbox,
    dryRun: args.dryRun,
    totalTimeoutMs: args.totalTimeoutMs
  });
  console.log(`Codex runner status: ${result.status}`);
  console.log(`Run dir: ${result.runDir}`);
  console.log(`Changed files: ${result.changedFiles.files.length}`);
  if (result.runnerState.failures.length > 0) {
    console.log(`Failures: ${result.runnerState.failures.map((failure) => failure.id).join(", ")}`);
  }
  process.exit(["implemented", "blocked"].includes(result.status) ? 0 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    runDir: null,
    executable: "codex",
    sandbox: "workspace-write",
    dryRun: false,
    totalTimeoutMs: 120000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--executable") {
      args.executable = argv[++index];
    } else if (item === "--sandbox") {
      args.sandbox = argv[++index];
    } else if (item === "--dry-run") {
      args.dryRun = true;
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
  if (!["read-only", "workspace-write", "danger-full-access"].includes(args.sandbox)) {
    throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access.");
  }
  if (!Number.isInteger(args.totalTimeoutMs) || args.totalTimeoutMs < 1) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-codex-runner.mjs --run-dir /path/to/.task-runs/<id> [--dry-run] [--sandbox workspace-write] [--timeout-ms 120000]

Runs Codex CLI through the M4 harness and records prompt, process output, transcript, diff, changed files, events, and runner state.
Dry-run mode requests read-only Codex execution and must not claim implementation acceptance.
`);
}
