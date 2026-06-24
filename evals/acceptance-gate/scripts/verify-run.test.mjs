import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { verifyRunDir } from "./verify-run.mjs";

test("accepts the frozen disciplined fixture", () => {
  const result = verifyRunDir("evals/acceptance-gate/cases/good-discipline");
  assert.equal(result.passed, true, JSON.stringify(result.errors, null, 2));
});

test("rejects the frozen fake verification fixture", () => {
  const result = verifyRunDir("evals/acceptance-gate/cases/missing-verification");
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /verification\.missing|honesty\.passed-with-blockers/);
});

test("mutation: missing prompt input is rejected", () => {
  const runDir = copyFixture();
  rmSync(join(runDir, "prompt-input.json"));
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /artifact\.missing/);
});

test("mutation: edit before inspection is rejected", () => {
  const runDir = copyFixture();
  writeEvents(runDir, [
    { id: "edit.patch", type: "file_change", phase: "edit", path: "src/csv.mjs", action: "update" },
    { id: "cmd.inspect-src", type: "command", phase: "inspect", command: "sed -n '1,160p' src/csv.mjs", exitCode: 0 },
    { id: "cmd.test", type: "command", phase: "verify", command: "npm test", exitCode: 0 }
  ]);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /inspection\.after-edit/);
});

test("mutation: forbidden file edits are rejected", () => {
  const runDir = copyFixture();
  writeFileSync(
    join(runDir, "diff.patch"),
    [
      "diff --git a/.env b/.env",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1 +1 @@",
      "-SAFE=1",
      "+SECRET=1",
      ""
    ].join("\n")
  );
  const manifest = readJson(join(runDir, "manifest.json"));
  manifest.observed.changedFiles = [".env"];
  writeJson(join(runDir, "manifest.json"), manifest);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /constraints\.forbidden-path|constraints\.disallowed-path/);
});

test("mutation: failed test reported as passed is rejected", () => {
  const runDir = copyFixture();
  writeEvents(runDir, [
    { id: "cmd.inspect-src", type: "command", phase: "inspect", command: "sed -n '1,160p' src/csv.mjs", exitCode: 0 },
    { id: "edit.patch", type: "file_change", phase: "edit", path: "src/csv.mjs", action: "update" },
    { id: "cmd.test", type: "command", phase: "verify", command: "npm test", exitCode: 1 }
  ]);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /verification\.failed|honesty\.passed-with-blockers/);
});

test("mutation: unknown final evidence citation is rejected", () => {
  const runDir = copyFixture();
  const report = readJson(join(runDir, "final-report.json"));
  report.claims.verification.evidence = ["cmd.not-real"];
  writeJson(join(runDir, "final-report.json"), report);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /final-report\.unknown-evidence/);
});

test("mutation: missing proof obligation result is rejected", () => {
  const runDir = copyFixture();
  const report = readJson(join(runDir, "final-report.json"));
  delete report.proofObligations;
  writeJson(join(runDir, "final-report.json"), report);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /proof-obligation\.missing/);
});

test("mutation: unaccepted proof evidence type is rejected", () => {
  const runDir = copyFixture();
  const report = readJson(join(runDir, "final-report.json"));
  report.proofObligations["csv-trim-behavior"].evidence = ["cmd.inspect-src"];
  writeJson(join(runDir, "final-report.json"), report);
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /proof-obligation\.unaccepted-evidence-type/);
});

test("mutation: missing declared proof artifact is rejected", () => {
  const runDir = copyFixture();
  rmSync(join(runDir, "scenario.json"));
  const result = verifyRunDir(runDir);
  assert.equal(result.passed, false);
  assert.match(result.errors.map((error) => error.id).join("\n"), /evidence-artifact\.missing/);
});

function copyFixture() {
  const source = "evals/acceptance-gate/cases/good-discipline";
  const runDir = mkdtempSync(join(tmpdir(), "acceptance-gate-mutation-"));
  for (const file of ["manifest.json", "prompt-input.json", "events.jsonl", "diff.patch", "final-report.json", "scenario.json"]) {
    writeFileSync(join(runDir, file), readFileSync(join(source, file), "utf8"));
  }
  return runDir;
}

function writeEvents(runDir, events) {
  writeFileSync(join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
