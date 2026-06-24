#!/usr/bin/env node

import { runPolicyEngine } from "../lib/policy-engine.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = runPolicyEngine({ runDir: args.runDir });
  console.log(`Policy decision: ${result.decision}`);
  console.log(`Run dir: ${result.runDir}`);
  console.log(`Rules: ${result.blockingRules.length}`);
  const activeRules = result.blockingRules.filter((rule) => !rule.overridden);
  console.log(`Active rules: ${activeRules.length}`);
  for (const rule of activeRules.slice(0, 5)) {
    console.log(`- ${rule.ruleId}: ${rule.message}`);
  }
  process.exit(result.decision === "accepted" ? 0 : result.decision === "blocked" ? 3 : 2);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const args = { runDir: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--run-dir" || arg === "--run") {
      args.runDir = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.help && !args.runDir) {
    throw new Error("--run-dir is required");
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node meta-harness/scripts/run-policy-engine.mjs --run-dir /path/to/.task-runs/<id>

Runs the M9 deterministic policy engine and writes policy-decision.json.
Exit codes:
  0 accepted
  2 rejected
  3 blocked`);
}
