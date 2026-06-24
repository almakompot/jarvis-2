import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runFakeCodex } from "../lib/fake-runner.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";

test("fake runner captures transcript, command log, diff, changed files, events, and terminal state", async (t) => {
  const { repo, runDir } = createRun("fake-success");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({
    runDir,
    scenario: "success",
    now: new Date("2026-06-24T10:00:00.000Z")
  });

  assert.equal(result.status, "implemented");
  assert.equal(result.runnerState.status, "implemented");
  assert.equal(result.runnerState.failures.length, 0);
  assert.ok(result.commandEntries.some((entry) => entry.phase === "inspect"));
  assert.ok(result.commandEntries.some((entry) => entry.phase === "verify"));
  assert.ok(result.transcriptEntries.some((entry) => entry.type === "prompt"));
  assert.ok(result.transcriptEntries.some((entry) => entry.type === "file_edit"));
  assert.ok(result.changedFiles.files.some((file) => file.path === "src/site-gate.js" && file.status === "added"));
  assert.match(readFileSync(join(runDir, "diff.patch"), "utf8"), /diff --git a\/src\/site-gate\.js b\/src\/site-gate\.js/);
  assert.ok(existsSync(join(runDir, "evidence", "commands", "cmd.0001.stdout.txt")));
  assert.ok(existsSync(join(runDir, "evidence", "runner", "fake-codex.stdout.jsonl")));

  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
});

test("fake runner rejects failed verification command", async (t) => {
  const { repo, runDir } = createRun("fake-failed-command");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "failed-command" });

  assert.equal(result.status, "rejected");
  assertFailure(result.runnerState, "failed-command");
  assert.ok(result.commandEntries.some((entry) => entry.exitCode === 1));
  assertStructuralValidation(runDir);
});

test("fake runner rejects edits before inspection evidence", async (t) => {
  const { repo, runDir } = createRun("fake-edit-before-inspection");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "edit-before-inspection" });

  assert.equal(result.status, "rejected");
  assertFailure(result.runnerState, "edit-before-inspection");
  assert.ok(result.transcriptEntries.findIndex((entry) => entry.type === "file_edit")
    < result.transcriptEntries.findIndex((entry) => entry.phase === "inspect"));
  assertStructuralValidation(runDir);
});

test("fake runner rejects forbidden edits without capturing secret content", async (t) => {
  const { repo, runDir } = createRun("fake-forbidden-edit");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "forbidden-edit" });

  assert.equal(result.status, "rejected");
  assertFailure(result.runnerState, "forbidden-edit");
  const changedFiles = readJson(join(runDir, "changed-files.json"));
  const envChange = changedFiles.files.find((file) => file.path === ".env");
  assert.equal(envChange.forbidden, true);
  assert.equal(envChange.contentCaptured, false);
  const diff = readFileSync(join(runDir, "diff.patch"), "utf8");
  assert.match(diff, /redacted/);
  assert.doesNotMatch(diff, /fake-runner-secret/);
  assertStructuralValidation(runDir);
});

test("fake runner blocks timed-out fake process and preserves terminal state", async (t) => {
  const { repo, runDir } = createRun("fake-timeout");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "timeout", totalTimeoutMs: 100 });

  assert.equal(result.status, "blocked");
  assertFailure(result.runnerState, "timeout");
  assert.equal(result.runnerState.process.timedOut, true);
  assert.equal(result.runnerState.terminalState.reason, "timeout");
  assertStructuralValidation(runDir);
});

test("fake runner records interruptions as interrupted, not accepted", async (t) => {
  const { repo, runDir } = createRun("fake-interrupt");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "interrupt" });

  assert.equal(result.status, "interrupted");
  assert.equal(result.runnerState.process.interrupted, true);
  assert.equal(result.runnerState.terminalState.reason, "interrupted");
  assertStructuralValidation(runDir);
});

test("fake runner rejects final overclaim before verification is passed", async (t) => {
  const { repo, runDir } = createRun("fake-final-overclaim");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runFakeCodex({ runDir, scenario: "final-overclaim" });

  assert.equal(result.status, "rejected");
  assertFailure(result.runnerState, "final-overclaim");
  assert.ok(result.transcriptEntries.some((entry) => entry.type === "final_message" && entry.claimStatus === "passed"));
  assertStructuralValidation(runDir);
});

function createRun(runId) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-fake-runner-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Fake Runner Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a chrome extension that asks before opening every page",
    runId
  }).runDir;
  return { repo, runDir };
}

function assertFailure(runnerState, id) {
  assert.ok(runnerState.failures.some((failure) => failure.id === id), `Missing failure ${id}`);
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
