#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCase, parseArgs, requiredArg, runCommand, writeCommandLog, writeJson } from "./lib.mjs";
import { assertSafeReplayCommand } from "./replay-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const { manifest } = loadCase(requiredArg(args, "case"));
const runDir = requiredArg(args, "run-dir");
const variants = args.variant ? [args.variant] : ["baseline", "resilient"];
const allowUnsafeChecks = args["allow-unsafe-checks"] === true;
const summaries = {};

for (const variant of variants) {
  const workdir = join(runDir, variant, "workdir");
  const checkDir = join(runDir, variant, "checks");
  mkdirSync(checkDir, { recursive: true });
  const checks = [];

  for (const check of manifest.checks || []) {
    let safety;
    let result;
    try {
      safety = assertSafeReplayCommand(check.command, allowUnsafeChecks);
      result = runCommand(check.command, workdir);
    } catch (error) {
      safety = { safe: false, reason: error.message, command: check.command };
      result = {
        command: check.command,
        cwd: workdir,
        status: 126,
        signal: null,
        stdout: "",
        stderr: `${error.message}\n`
      };
    }
    const logPath = join(checkDir, `${check.name}.log`);
    writeCommandLog(logPath, result);
    checks.push({
      name: check.name,
      command: check.command,
      required: check.required !== false,
      safety,
      status: result.status,
      logPath
    });
  }

  const failedRequired = checks.filter((check) => check.required && check.status !== 0);
  const failedOptional = checks.filter((check) => !check.required && check.status !== 0);
  const unavailable = checks.filter((check) => check.status === 127).map((check) => check.name);
  const summary = {
    variant,
    workdir,
    checks,
    requiredPassed: failedRequired.length === 0,
    allPassed: checks.every((check) => check.status === 0),
    failedRequired: failedRequired.map((check) => check.name),
    failedOptional: failedOptional.map((check) => check.name),
    unavailable
  };
  summaries[variant] = summary;
  writeJson(join(runDir, variant, "checks-summary.json"), summary);
  if (summary.allPassed) {
    console.log(`${variant}: all checks passed`);
  } else if (summary.requiredPassed) {
    console.log(`${variant}: required checks passed; optional failed: ${summary.failedOptional.join(", ") || "none"}`);
  } else {
    console.log(`${variant}: required checks failed: ${summary.failedRequired.join(", ")}`);
  }
}

writeJson(join(runDir, "checks-summary.json"), summaries);

if (Object.values(summaries).some((summary) => !summary.requiredPassed)) {
  process.exit(1);
}
