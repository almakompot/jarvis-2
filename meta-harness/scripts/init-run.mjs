#!/usr/bin/env node

import process from "node:process";

import { initTaskRun } from "../lib/task-packet.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const result = initTaskRun({
    repoPath: args.repo,
    task: args.task,
    runId: args.id,
    overwrite: args.overwrite
  });
  console.log(`Created task run: ${result.runDir}`);
  console.log(`Run id: ${result.runId}`);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    repo: null,
    task: null,
    id: null,
    overwrite: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--repo") {
      args.repo = argv[++index];
    } else if (item === "--task") {
      args.task = argv[++index];
    } else if (item === "--id") {
      args.id = argv[++index];
    } else if (item === "--overwrite") {
      args.overwrite = true;
    } else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/init-run.mjs --repo /path/to/repo --task "build X" [--id run-id] [--overwrite]

Creates:
  /path/to/repo/.task-runs/<id>/
`);
}
