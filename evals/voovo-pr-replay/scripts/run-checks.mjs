#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCase, parseArgs, requiredArg, runCommand, writeCommandLog, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const { manifest } = loadCase(requiredArg(args, "case"));
const runDir = requiredArg(args, "run-dir");
const variants = args.variant ? [args.variant] : ["baseline", "resilient"];
const summaries = {};

for (const variant of variants) {
  const workdir = join(runDir, variant, "workdir");
  const checkDir = join(runDir, variant, "checks");
  mkdirSync(checkDir, { recursive: true });
  const checks = [];

  for (const check of manifest.checks || []) {
    const result = runCommand(check.command, workdir);
    const logPath = join(checkDir, `${check.name}.log`);
    writeCommandLog(logPath, result);
    checks.push({
      name: check.name,
      command: check.command,
      required: check.required !== false,
      status: result.status,
      logPath
    });
  }

  const failedRequired = checks.filter((check) => check.required && check.status !== 0);
  const summary = {
    variant,
    workdir,
    checks,
    passed: failedRequired.length === 0,
    failedRequired: failedRequired.map((check) => check.name)
  };
  summaries[variant] = summary;
  writeJson(join(runDir, variant, "checks-summary.json"), summary);
  console.log(`${variant}: checks ${summary.passed ? "passed" : "failed"}`);
}

writeJson(join(runDir, "checks-summary.json"), summaries);

if (Object.values(summaries).some((summary) => !summary.passed)) {
  process.exit(1);
}

