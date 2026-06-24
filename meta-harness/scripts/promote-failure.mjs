#!/usr/bin/env node

import { promoteFailureRun } from "../lib/corpus-manager.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = promoteFailureRun({
    runDir: args.runDir,
    category: args.category,
    caseId: args.caseId,
    title: args.title,
    corpusRoot: args.corpusRoot
  });
  console.log(`Promoted failure skeleton: ${result.caseDir}`);
  console.log("Privacy: private-staging; sanitize and minimize before committing.");
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    runDir: null,
    category: null,
    caseId: null,
    title: null,
    corpusRoot: "corpus/meta-harness",
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--run-dir" || arg === "--run") {
      args.runDir = argv[index + 1];
      index += 1;
    } else if (arg === "--category") {
      args.category = argv[index + 1];
      index += 1;
    } else if (arg === "--case-id") {
      args.caseId = argv[index + 1];
      index += 1;
    } else if (arg === "--title") {
      args.title = argv[index + 1];
      index += 1;
    } else if (arg === "--corpus-root") {
      args.corpusRoot = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.help && (!args.runDir || !args.category || !args.caseId)) {
    throw new Error("--run-dir, --category, and --case-id are required");
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/promote-failure.mjs --run-dir /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset

Creates a private-staging failure corpus skeleton from a rejected or blocked run.
The command intentionally does not copy full run artifacts; minimize and sanitize before committing.`);
}
