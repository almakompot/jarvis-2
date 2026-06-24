#!/usr/bin/env node

import { replayCorpus } from "../lib/corpus-manager.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const summary = await replayCorpus({
    corpusRoot: args.corpusRoot,
    outputDir: args.outputDir,
    keepRuns: args.keepRuns
  });
  console.log(`Corpus replay status: ${summary.status}`);
  console.log(`Cases: ${summary.caseCount}`);
  console.log(`Expected fail: ${summary.expectedFailCount}`);
  console.log(`Expected pass: ${summary.expectedPassCount}`);
  console.log(`Summary: ${args.outputDir}/replay-summary.json`);
  for (const result of summary.results) {
    const marker = result.passed ? "ok" : "not ok";
    console.log(`${marker} ${result.id}: expected ${result.expectedDecision}, got ${result.actualDecision}`);
  }
  process.exit(summary.status === "passed" ? 0 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    corpusRoot: "corpus/meta-harness",
    outputDir: "tmp/meta-harness-corpus",
    keepRuns: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--corpus-root") {
      args.corpusRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === "--keep-runs") {
      args.keepRuns = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-corpus-replay.mjs [--corpus-root corpus/meta-harness] [--output-dir tmp/meta-harness-corpus] [--keep-runs]

Replays the M7 failure corpus against the current verifier and policy engine.`);
}
