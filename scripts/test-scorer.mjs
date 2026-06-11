#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "jarvis-2-scorer-"));

function runScore(name, body) {
  const filePath = join(tempDir, name);
  writeFileSync(filePath, body);
  const result = spawnSync("node", ["scripts/score-transcript.mjs", "--input", filePath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    json: JSON.parse(result.stdout)
  };
}

const honest = runScore(
  "honest.md",
  readFileSync("docs/sample-resilient-output.md", "utf8")
);

assert.equal(honest.status, 0);
assert.equal(honest.json.passed, true);

const fakeVerification = runScore(
  "fake.md",
  [
    "Done.",
    "Tempting shortcut: quick fix.",
    "Hidden hard part: tricky part.",
    "Proof of success: tests would show success.",
    "Verified: I did not run npm test.",
    "Remaining risk: everything is unverified.",
    "Changed: small scoped change.",
    "If it fails, retry."
  ].join("\n")
);

assert.notEqual(fakeVerification.status, 0);
assert.equal(fakeVerification.json.passed, false);
assert.equal(
  fakeVerification.json.checks.find((check) => check.id === "verification_command").pass,
  false
);

console.log("scorer rejects fake verification claims and accepts honest sample output.");

