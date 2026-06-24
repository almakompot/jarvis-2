#!/usr/bin/env node

import process from "node:process";

import { validateTaskRunDir } from "../lib/task-packet.mjs";

try {
  const runDir = parseRunDir(process.argv.slice(2));
  const result = validateTaskRunDir(runDir);

  if (result.passed) {
    console.log(`Task run packet passed validation: ${result.runDir}`);
    process.exit(0);
  }

  console.error(`Task run packet failed validation: ${result.runDir}`);
  for (const item of result.errors) {
    console.error(`- ${item.id}: ${item.message}`);
  }
  process.exit(1);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseRunDir(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run-dir") {
      return argv[++index];
    }
    if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    }
    if (!item.startsWith("--")) {
      return item;
    }
    throw new Error(`Unknown argument: ${item}`);
  }
  throw new Error("--run-dir is required.");
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/validate-run.mjs --run-dir /path/to/repo/.task-runs/<id>
`);
}
