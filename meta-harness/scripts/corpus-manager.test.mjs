import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCorpusCases, promoteFailureRun, replayCorpus } from "../lib/corpus-manager.mjs";
import { runPolicyEngine } from "../lib/policy-engine.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";

test("M7 corpus cases are sanitized, labeled, and replayable", async () => {
  const cases = loadCorpusCases("corpus/meta-harness");

  assert.equal(cases.length, 6);
  assert.ok(cases.filter((corpusCase) => corpusCase.label === "expected-fail").length >= 5);
  assert.ok(cases.some((corpusCase) => corpusCase.label === "expected-pass"));
  for (const corpusCase of cases) {
    assert.equal(corpusCase.privacy.classification, "public-synthetic");
    assert.equal(corpusCase.privacy.sanitized, true);
    assert.equal(corpusCase.privacy.containsPrivateData, false);
    assert.equal(corpusCase.privacy.allowedForCommit, true);
    assert.ok(corpusCase.mutation, `case ${corpusCase.id} must load mutation`);
  }

  const summary = await replayCorpus({
    corpusRoot: "corpus/meta-harness",
    outputDir: join(tmpdir(), "meta-harness-corpus-test")
  });

  assert.equal(summary.status, "passed", JSON.stringify(summary.results, null, 2));
  assert.equal(summary.expectedFailCount, 5);
  assert.equal(summary.expectedPassCount, 1);
  assert.ok(summary.results.every((result) => result.passed));
  assert.ok(summary.results.some((result) => result.actualDecision === "accepted"));
  assert.ok(summary.results.filter((result) => result.actualDecision === "rejected").length >= 5);
});

test("M7 promotion workflow writes private-staging skeleton without copying raw run artifacts", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-corpus-promote-repo-"));
  const corpusRoot = mkdtempSync(join(tmpdir(), "meta-harness-corpus-promote-root-"));
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpusRoot, { recursive: true, force: true });
  });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: {}, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Promotion Fixture\n");
  const { runDir } = initTaskRun({
    repoPath: repo,
    task: "build a feature but leave verification pending",
    runId: "promotion-rejected",
    now: new Date("2026-06-24T09:00:00.000Z")
  });
  const policy = runPolicyEngine({ runDir, now: new Date("2026-06-24T12:30:00.000Z") });
  assert.equal(policy.decision, "rejected");

  const result = promoteFailureRun({
    runDir,
    category: "missing-verification",
    caseId: "pending-proof",
    title: "Pending proof promoted fixture",
    corpusRoot,
    now: new Date("2026-06-24T13:00:00.000Z")
  });

  const caseJson = readJson(join(result.caseDir, "case.json"));
  assert.equal(caseJson.privacy.classification, "private-staging");
  assert.equal(caseJson.privacy.sanitized, false);
  assert.equal(caseJson.privacy.allowedForCommit, false);
  assert.equal(caseJson.expected.decision, "rejected");
  assert.ok(caseJson.expected.policyRules.includes("POL-VERIFY-001"));
  assert.match(readFileSync(join(result.caseDir, "run", "README.md"), "utf8"), /intentionally not copied/);
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
