import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCommandProofExecutor } from "../lib/command-executor.mjs";
import { runFakeCodex } from "../lib/fake-runner.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";
import { runCompletedRunVerifier } from "../lib/verifier.mjs";

test("M6 verifier writes a passing verifier-report for a traceable completed run", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-valid");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T12:00:00.000Z") });

  assert.equal(result.status, "passed");
  assert.equal(result.decisionRecommendation, "accept");
  assert.deepEqual(result.findings.filter((finding) => ["blocking", "major"].includes(finding.severity)), []);
  const report = readJson(join(runDir, "verifier-report.json"));
  assert.equal(report.kind, "meta-harness.verifier-report");
  assert.equal(report.coverage.requirementsWithPassingProof.length, 1);
  assertStructuralValidation(runDir);
});

test("M6 verifier rejects a run folder with missing required artifacts", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-missing-artifact");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  unlinkSync(join(runDir, "verification.json"));

  const result = runCompletedRunVerifier({ runDir });

  assert.equal(result.status, "failed");
  assertFinding(result, "artifact.missing", "blocking");
  assert.equal(readJson(join(runDir, "verifier-report.json")).decisionRecommendation, "reject");
});

test("M6 verifier rejects edits before inspection evidence", async (t) => {
  const { repo, runDir } = createBaseRun("verifier-edit-before-inspection");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  await runFakeCodex({ runDir, scenario: "edit-before-inspection" });

  const result = runCompletedRunVerifier({ runDir });

  assertFinding(result, "event.edit-before-inspection", "blocking");
});

test("M6 verifier tolerates legacy repeated verification event batches", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-legacy-verification-events");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(runDir, "events.jsonl"), [
    JSON.stringify({
      id: "event.verification.legacy.2",
      type: "verification-event",
      phase: "verify",
      status: "blocked",
      timestamp: "2026-06-24T11:00:00.020Z"
    }),
    JSON.stringify({
      id: "event.verification.legacy.1",
      type: "verification-event",
      phase: "verify",
      status: "blocked",
      timestamp: "2026-06-24T11:00:00.010Z"
    })
  ].join("\n") + "\n", { flag: "a" });

  const result = runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T12:00:00.000Z") });

  assert.equal(result.findings.some((finding) => finding.ruleId === "event.timestamp.nonmonotonic"), false);
});

test("M6 verifier still rejects nonmonotonic runner evidence events", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-runner-event-order");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(runDir, "events.jsonl"), [
    JSON.stringify({
      id: "event.runner-order.2",
      type: "runner-event",
      phase: "run",
      status: "captured",
      timestamp: "2026-06-24T11:00:00.020Z"
    }),
    JSON.stringify({
      id: "event.runner-order.1",
      type: "runner-event",
      phase: "run",
      status: "captured",
      timestamp: "2026-06-24T11:00:00.010Z"
    })
  ].join("\n") + "\n", { flag: "a" });

  const result = runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T12:00:00.000Z") });

  assertFinding(result, "event.timestamp.nonmonotonic", "blocking");
});

test("M6 verifier rejects command exits that contradict passed status", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-command-exit");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  verification.commands[0].status = "passed";
  verification.commands[0].exitCode = 1;
  writeJson(join(runDir, "verification.json"), verification);

  const result = runCompletedRunVerifier({ runDir });

  assertFinding(result, "command.exit.passed-nonzero", "blocking");
});

test("M6 verifier rejects unaccepted evidence types", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-unaccepted-evidence");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.obligations[0].acceptedEvidenceTypes = ["build-command"];
  writeJson(join(runDir, "proof-plan.json"), proofPlan);

  const result = runCompletedRunVerifier({ runDir });

  assert.ok(result.findings.some((finding) =>
    ["traceability.evidence.unaccepted-type", "schema.verification.evidence-type-unaccepted"].includes(finding.ruleId)
      && finding.severity === "blocking"
  ));
});

test("M6 verifier rejects forbidden changed-file boundaries", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-forbidden-change");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const changedFiles = readJson(join(runDir, "changed-files.json"));
  changedFiles.files.push({
    path: ".env",
    status: "added",
    forbidden: true,
    contentCaptured: false,
    hashBefore: null,
    hashAfter: null,
    bytesBefore: null,
    bytesAfter: 12
  });
  writeJson(join(runDir, "changed-files.json"), changedFiles);

  const result = runCompletedRunVerifier({ runDir });

  assertFinding(result, "changed-files.forbidden-path", "blocking");
});

test("M6 verifier rejects unknown final-report evidence citations", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-final-unknown-evidence");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims.automatedVerification.evidence = ["E.unknown"];
  writeJson(join(runDir, "final-report.json"), finalReport);

  const result = runCompletedRunVerifier({ runDir });

  assertFinding(result, "final-report.claim.unknown-evidence", "blocking");
});

test("M6 verifier distinguishes blocking, major, and minor findings", async (t) => {
  const { repo, runDir } = await createCompletedVerifierRun("verifier-severity-levels");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims.automatedVerification.evidence = ["E.unknown"];
  writeJson(join(runDir, "final-report.json"), finalReport);

  const verification = readJson(join(runDir, "verification.json"));
  verification.commands[0].stdoutPath = "evidence/commands/missing.stdout.txt";
  writeJson(join(runDir, "verification.json"), verification);

  const runnerState = readJson(join(runDir, "runner-state.json"));
  runnerState.captureCompleteness.transcript = "partial";
  writeJson(join(runDir, "runner-state.json"), runnerState);

  const result = runCompletedRunVerifier({ runDir });

  assertFinding(result, "final-report.claim.unknown-evidence", "blocking");
  assertFinding(result, "command.log.missing-artifact", "major");
  assertFinding(result, "capture.partial", "minor");
  assert.equal(result.status, "failed");
});

test("M6 verifier CLI rejects nonexistent run folders", () => {
  const missingRunDir = join(tmpdir(), "missing-meta-harness-run-dir-for-verifier");
  assert.throws(() => runCompletedRunVerifier({ runDir: missingRunDir }), /Run directory does not exist/);
});

async function createCompletedVerifierRun(runId) {
  const { repo, runDir } = createBaseRun(runId);
  configureSingleCommandProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runCommandProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReport(runDir);
  assertStructuralValidation(runDir);
  return { repo, runDir };
}

function createBaseRun(runId) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-verifier-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('verifier proof passed');\n");
  writeFileSync(join(repo, "README.md"), "# Verifier Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a local internal helper with command proof",
    runId,
    now: new Date("2026-06-24T09:00:00.000Z")
  }).runDir;
  return { repo, runDir };
}

function configureSingleCommandProof(runDir) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = "internal";
  spec.task.class = "internal";
  spec.requirements = [{
    id: "R1",
    text: "The internal helper behavior is covered by command proof.",
    source: "goal-8-fixture",
    proofObligationIds: ["P2"]
  }];
  spec.proofObligations = [{ id: "P2", requirementIds: ["R1"] }];
  spec.requiredTests = [{
    id: "T1",
    type: "repo-native-check",
    command: "npm run test",
    description: "Run the repository test command.",
    requirementIds: ["R1"]
  }];
  spec.userFlows = [{
    id: "F1",
    name: "Internal command proof",
    steps: ["Run npm test."],
    negativePath: "A failing command rejects proof.",
    expectedOutcome: "The proof command exits zero."
  }];
  writeJson(join(runDir, "spec.json"), spec);

  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.taskClass = "internal";
  proofPlan.obligations = [{
    id: "P2",
    statement: "Command proof passes for the internal helper.",
    requirementIds: ["R1"],
    acceptedEvidenceTypes: ["test-command"],
    minimumEvidence: 1,
    status: "pending"
  }];
  proofPlan.requirementCoverage = [{
    requirementId: "R1",
    proofObligationIds: ["P2"]
  }];
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
}

function writePassingFinalReport(runDir) {
  const finalReport = readJson(join(runDir, "final-report.json"));
  const evidence = ["E.cmd.verify.0001"];
  finalReport.outcome = "passed";
  finalReport.claims = {
    implementation: { status: "passed", requirementIds: ["R1"], evidence },
    automatedVerification: { status: "passed", requirementIds: ["R1"], evidence },
    requirementMapping: { status: "passed", requirementIds: ["R1"], evidence }
  };
  finalReport.proofObligations = {
    P2: { status: "passed", evidence }
  };
  finalReport.requirementResults = [{
    requirementId: "R1",
    status: "passed",
    evidence
  }];
  finalReport.residualRisk = ["Verifier fixture uses a tiny local command proof."];
  finalReport.stillUnenforced = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function assertFinding(result, ruleId, severity) {
  assert.ok(
    result.findings.some((finding) => finding.ruleId === ruleId && finding.severity === severity),
    `Missing ${severity} finding ${ruleId}; got ${JSON.stringify(result.findings, null, 2)}`
  );
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
