import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initTaskRun, requiredArtifacts, requiredDirectories, validateTaskRunDir } from "../lib/task-packet.mjs";

test("initTaskRun creates and validates the full M1/M3 packet", () => {
  const repo = makeRepo();
  const result = initTaskRun({
    repoPath: repo,
    task: "build a chrome extension that asks before opening every page",
    runId: "test-run"
  });

  for (const artifact of requiredArtifacts) {
    assert.match(result.artifacts.join("\n"), new RegExp(`${artifact.replace(".", "\\.")}$`, "m"));
  }

  const validation = validateTaskRunDir(result.runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));

  const spec = readJson(join(result.runDir, "spec.json"));
  assert.equal(spec.taskClass, "browser-extension");
  assert.ok(spec.requirements.length >= 6);
  assert.ok(spec.requirements.every((requirement) => requirement.proofObligationIds.length > 0));
  assert.equal(spec.repoSignals.packageManager, "npm");
  assert.equal(spec.requiredTests[0].command, "npm run test");
  assert.ok(spec.requirements.some((requirement) => /extension|manifest|chrome/i.test(requirement.text)));
  assert.ok(spec.userFlows[0].negativePath.includes("decline"));
});

test("initTaskRun seeds target M3 placeholder artifacts and directories", () => {
  const repo = makeRepo();
  const result = initTaskRun({
    repoPath: repo,
    task: "build a local CLI tool that validates task packets",
    runId: "placeholder-run"
  });

  for (const artifact of ["runner-config.json", "command-log.jsonl", "transcript.jsonl", "diff.patch", "changed-files.json", "runner-state.json", "verifier-report.json", "policy-decision.json"]) {
    assert.ok(existsSync(join(result.runDir, artifact)), `${artifact} should exist`);
  }
  for (const directory of requiredDirectories) {
    assert.ok(existsSync(join(result.runDir, directory)), `${directory} should exist`);
  }
  assert.equal(readFileSync(join(result.runDir, "command-log.jsonl"), "utf8"), "");
  assert.equal(readFileSync(join(result.runDir, "transcript.jsonl"), "utf8"), "");
  assert.equal(readFileSync(join(result.runDir, "diff.patch"), "utf8"), "");
  assert.equal(readJson(join(result.runDir, "runner-config.json")).status, "pending");
  assert.equal(readJson(join(result.runDir, "changed-files.json")).status, "pending");
  assert.equal(readJson(join(result.runDir, "runner-state.json")).status, "pending");
  assert.equal(readJson(join(result.runDir, "verifier-report.json")).status, "pending");
  assert.equal(readJson(join(result.runDir, "policy-decision.json")).decision, "pending");
});

test("task compiler uses repo scripts and browse/search cues for concrete proof", () => {
  const repo = makeRepo({
    scripts: {
      "dev:clean": "next dev -p 3001",
      test: "vitest run",
      "test:e2e": "playwright test",
      "smoke:browse": "node scripts/smoke-browse.mjs"
    },
    packageManager: "pnpm@10.30.0"
  });
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");

  const result = initTaskRun({
    repoPath: repo,
    task: "Improve the browse no-results search empty state and add a reset action",
    runId: "browse-task"
  });
  const spec = readJson(join(result.runDir, "spec.json"));

  assert.equal(spec.taskClass, "web-ui");
  assert.deepEqual(spec.repoSignals.inferredTaskCues, ["browse", "search", "empty-state", "reset-action"]);
  assert.ok(spec.requirements.some((requirement) => /no-results|empty state/i.test(requirement.text)));
  assert.ok(spec.requirements.some((requirement) => /reset|clear|restore/i.test(requirement.text)));
  assert.ok(spec.userFlows[0].steps.some((step) => step.includes("`/browse`")));
  assert.ok(spec.userFlows[0].steps.some((step) => step.includes("zzzzxqwerty999")));
  assert.ok(spec.userFlows[0].steps.some((step) => step.includes("reset")));
  assert.ok(spec.requiredTests.some((item) => item.command === "pnpm run test"));
  assert.ok(spec.requiredTests.some((item) => item.command === "pnpm run test:e2e e2e/browse-to-purchase.spec.ts"));
  assert.ok(spec.requiredTests.some((item) => item.command === "BASE_URL=http://127.0.0.1:3001 pnpm run smoke:browse"));
});

test("validator rejects generic concrete task requirements", () => {
  const repo = makeRepo({
    scripts: {
      test: "vitest run",
      "smoke:browse": "node scripts/smoke-browse.mjs"
    }
  });
  const runDir = initTaskRun({
    repoPath: repo,
    task: "Improve the browse no-results search empty state and add a reset action",
    runId: "generic-browse-task"
  }).runDir;
  const spec = readJson(join(runDir, "spec.json"));
  spec.requirements[1].text = "Implement the requested behavior: Improve the browse no-results search empty state and add a reset action";
  writeJson(join(runDir, "spec.json"), spec);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /spec\.specificity\.generic-requirement/);
});

test("validator rejects missing concrete repo script proof", () => {
  const repo = makeRepo({
    scripts: {
      test: "vitest run",
      "test:e2e": "playwright test",
      "smoke:browse": "node scripts/smoke-browse.mjs"
    },
    packageManager: "pnpm@10.30.0"
  });
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "Improve the browse no-results search empty state and add a reset action",
    runId: "missing-smoke-task"
  }).runDir;
  const spec = readJson(join(runDir, "spec.json"));
  spec.requiredTests = spec.requiredTests.filter((testCase) => !String(testCase.command || "").includes("smoke:browse"));
  writeJson(join(runDir, "spec.json"), spec);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /spec\.required-tests\.missing-smoke-browse/);
});

test("initTaskRun rejects unsafe custom run ids", () => {
  const repo = makeRepo();
  assert.throws(
    () => initTaskRun({
      repoPath: repo,
      task: "build a local CLI tool that validates task packets",
      runId: "../escape"
    }),
    /Invalid run id/
  );
});

test("overwrite refuses a non-seed run with captured implementation artifacts", () => {
  const repo = makeRepo();
  const first = initTaskRun({
    repoPath: repo,
    task: "build a local CLI tool that validates task packets",
    runId: "overwrite-guard"
  });
  writeFileSync(join(first.runDir, "diff.patch"), "diff --git a/src/tool.js b/src/tool.js\n");
  assert.throws(
    () => initTaskRun({
      repoPath: repo,
      task: "build a local CLI tool that validates task packets",
      runId: "overwrite-guard",
      overwrite: true
    }),
    /Refusing to overwrite non-seed run/
  );
});

test("validator rejects missing required artifact", () => {
  const runDir = createRun();
  rmSync(join(runDir, "spec.json"));
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /artifact\.missing/);
});

test("validator rejects requirements without proof obligations", () => {
  const runDir = createRun();
  const spec = readJson(join(runDir, "spec.json"));
  spec.requirements[0].proofObligationIds = [];
  writeJson(join(runDir, "spec.json"), spec);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /spec\.requirement\.unmapped/);
});

test("validator rejects proof obligations that point at unknown requirements", () => {
  const runDir = createRun();
  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.obligations[0].requirementIds = ["R404"];
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /proof-plan\.unknown-requirement/);
});

test("validator rejects fake passed verification without evidence", () => {
  const runDir = createRun();
  const verification = readJson(join(runDir, "verification.json"));
  verification.status = "passed";
  writeJson(join(runDir, "verification.json"), verification);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /verification\.fake-pass/);
});

test("validator rejects passed final report without passed verification or evidence", () => {
  const runDir = createRun();
  const report = readJson(join(runDir, "final-report.json"));
  report.outcome = "passed";
  writeJson(join(runDir, "final-report.json"), report);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /final-report\.passed-without-verification|final-report\.claim-no-evidence/);
});

test("validator rejects allowed-file policy that omits secret protections", () => {
  const runDir = createRun();
  const allowed = readJson(join(runDir, "allowed-files.json"));
  allowed.forbiddenPatterns = [".git/**"];
  writeJson(join(runDir, "allowed-files.json"), allowed);
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, false);
  assert.match(ids(validation), /allowed-files\.forbidden-pattern/);
});

function createRun() {
  const repo = makeRepo();
  return initTaskRun({
    repoPath: repo,
    task: "build a local tool that validates task packets",
    runId: "test-run"
  }).runDir;
}

function makeRepo({ scripts = { test: "node --test" }, packageManager } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-test-repo-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts, packageManager }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Test Repo\n");
  return repo;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function ids(result) {
  return result.errors.map((item) => item.id).join("\n");
}
