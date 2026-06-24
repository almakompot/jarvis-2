import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCommandProofExecutor } from "../lib/command-executor.mjs";
import { runFakeCodex } from "../lib/fake-runner.mjs";
import { runPolicyEngine } from "../lib/policy-engine.mjs";
import { runSurfaceProofExecutor } from "../lib/surface-executor.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";
import { runCompletedRunVerifier } from "../lib/verifier.mjs";

test("M9 policy engine accepts a fully verified command run", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-accepted-command");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "accepted");
  assert.deepEqual(result.blockingRules.filter((rule) => !rule.overridden), []);
  assert.equal(readJson(join(runDir, "policy-decision.json")).decision, "accepted");
  assertStructuralValidation(runDir);
});

test("M9 policy engine rejects missing required artifacts", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-missing-artifact");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  unlinkSync(join(runDir, "verification.json"));

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-ARTIFACT-001");
});

test("M9 policy engine rejects unmapped requirements", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-unmapped-requirement");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const spec = readJson(join(runDir, "spec.json"));
  spec.requirements[0].proofObligationIds = [];
  writeJson(join(runDir, "spec.json"), spec);

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-TRACE-001");
});

test("M9 policy engine rejects failed verification", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-failed-verification");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  verification.status = "failed";
  verification.commands[0].status = "failed";
  verification.commands[0].exitCode = 1;
  writeJson(join(runDir, "verification.json"), verification);

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-VERIFY-002");
});

test("M9 policy engine rejects missing required browser smoke", async (t) => {
  const { repo, runDir } = await createCompletedBrowserRun("policy-missing-smoke");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  verification.evidence = [];
  verification.proofObligations = verification.proofObligations.map((proof) => ({ ...proof, status: "pending", evidence: [] }));
  verification.requirementCoverage = verification.requirementCoverage.map((coverage) => ({ ...coverage, status: "pending" }));
  writeJson(join(runDir, "verification.json"), verification);

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-UI-001");
});

test("M9 policy engine rejects forbidden file edits", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-forbidden-edit");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const changedFiles = readJson(join(runDir, "changed-files.json"));
  changedFiles.files.push({
    path: ".env",
    status: "modified",
    forbidden: false,
    contentCaptured: false,
    hashBefore: null,
    hashAfter: null,
    bytesBefore: 8,
    bytesAfter: 12
  });
  writeJson(join(runDir, "changed-files.json"), changedFiles);

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-FILES-001");
});

test("M9 policy engine rejects unknown evidence citations from verifier findings", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-unknown-evidence");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims.automatedVerification.evidence = ["E.fake.missing"];
  writeJson(join(runDir, "final-report.json"), finalReport);
  runCompletedRunVerifier({ runDir, now: verifierNow() });

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-HONESTY-001");
});

test("M9 policy engine rejects corpus regressions", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-corpus-regression");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeJson(join(runDir, "corpus-replay.json"), {
    schemaVersion: 1,
    kind: "meta-harness.corpus-replay",
    runId: "policy-corpus-regression",
    status: "failed",
    caseIds: ["fake-verification/unknown-evidence"],
    message: "Known fake-verification case regressed."
  });

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "rejected");
  assertRule(result, "POL-CORPUS-001");
});

test("M9 policy engine distinguishes blocked conditions from rejection", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-blocked-runner");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runnerState = readJson(join(runDir, "runner-state.json"));
  runnerState.status = "blocked";
  runnerState.terminalState.status = "blocked";
  runnerState.terminalState.reason = "awaiting-approval";
  writeJson(join(runDir, "runner-state.json"), runnerState);

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "blocked");
  assertRule(result, "POL-BLOCKED-001");
});

test("M9 policy engine records explicit overrides without erasing failed evidence", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-explicit-override");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.residualRisk = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
  runCompletedRunVerifier({ runDir, now: verifierNow() });
  writeJson(join(runDir, "policy-overrides.json"), {
    overrides: [{
      id: "override.risk.1",
      ruleId: "POL-RISK-001",
      user: "Levente",
      timestamp: "2026-06-24T12:30:00.000Z",
      reason: "Fixture intentionally tests explicit override handling.",
      remainingRisk: "Residual risk omission remains visible in policy-decision.json."
    }]
  });

  const result = runPolicyEngine({ runDir, now: policyNow() });

  assert.equal(result.decision, "accepted");
  const riskRules = result.blockingRules.filter((rule) => rule.ruleId === "POL-RISK-001");
  assert.ok(riskRules.length > 0, "risk rules must remain recorded");
  assert.ok(riskRules.every((rule) => rule.overridden), "risk rules must be explicitly overridden");
  assert.equal(result.overrides.length, 1);
  const policyDecision = readJson(join(runDir, "policy-decision.json"));
  assert.equal(policyDecision.approvalEvents.length, 1);
  assert.equal(policyDecision.approvalEvents[0].type, "approval-event");
  assert.equal(policyDecision.approvalEvents[0].status, "applied");
  assert.equal(policyDecision.approvalEvents[0].overrideId, "override.risk.1");
  assert.equal(policyDecision.approvalEvents[0].remainingRisk, "Residual risk omission remains visible in policy-decision.json.");
  const approvalEvents = readJsonl(join(runDir, "events.jsonl")).filter((event) => event.type === "approval-event");
  assert.ok(approvalEvents.some((event) => event.overrideId === "override.risk.1" && event.status === "applied"));
});

test("M9 policy recomputation is deterministic for the same inputs", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("policy-deterministic");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const first = runPolicyEngine({ runDir, now: policyNow() }).policyDecision;
  const second = runPolicyEngine({ runDir, now: policyNow() }).policyDecision;

  assert.deepEqual(second, first);
});

async function createCompletedCommandRun(runId) {
  const { repo, runDir } = createBaseRun({
    runId,
    task: "build a local internal helper with command proof",
    files: {
      "scripts/pass.mjs": "console.log('policy proof passed');\n"
    },
    packageJson: { scripts: { test: "node scripts/pass.mjs" }, type: "module" }
  });
  configureCommandProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runCommandProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir, claimId: "automatedVerification" });
  runCompletedRunVerifier({ runDir, now: verifierNow() });
  assertStructuralValidation(runDir);
  return { repo, runDir };
}

async function createCompletedBrowserRun(runId) {
  const { repo, runDir } = createBaseRun({
    runId,
    task: "build a web UI reset flow with browser proof",
    files: {
      "smoke/scenario.json": `${JSON.stringify({
        status: "passed",
        url: "http://127.0.0.1:4173/browse",
        assertions: ["empty state appears", "reset returns visible offerings"],
        screenshotPath: "reset.png",
        tracePath: "reset-trace.zip",
        consoleLogPath: "console.log"
      }, null, 2)}\n`,
      "smoke/reset.png": "fake screenshot bytes\n",
      "smoke/reset-trace.zip": "fake trace bytes\n",
      "smoke/console.log": "no browser console errors\n"
    },
    packageJson: { scripts: {}, type: "module" }
  });
  configureBrowserProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runSurfaceProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir, claimId: "userSmoke" });
  runCompletedRunVerifier({ runDir, now: verifierNow() });
  assertStructuralValidation(runDir);
  return { repo, runDir };
}

function createBaseRun({ runId, task, files, packageJson }) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-policy-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Policy Fixture\n");
  for (const [path, content] of Object.entries(files || {})) {
    const directory = path.split("/").slice(0, -1).join("/");
    if (directory) {
      mkdirSync(join(repo, directory), { recursive: true });
    }
    writeFileSync(join(repo, path), content);
  }
  const runDir = initTaskRun({
    repoPath: repo,
    task,
    runId,
    now: new Date("2026-06-24T09:00:00.000Z")
  }).runDir;
  return { repo, runDir };
}

function configureCommandProof(runDir) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = "internal";
  spec.task.class = "internal";
  spec.requirements = [{
    id: "R1",
    text: "The internal helper behavior is covered by command proof.",
    source: "goal-10-policy-fixture",
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
  proofPlan.requirementCoverage = [{ requirementId: "R1", proofObligationIds: ["P2"] }];
  proofPlan.surfaceProofs = [];
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
}

function configureBrowserProof(runDir) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = "web-ui";
  spec.task.class = "web-ui";
  spec.repoSignals.inferredTaskCues = [];
  spec.repoSignals.availableScripts = [];
  spec.requirements = [{
    id: "R5",
    text: "The reset flow is exercised through browser-visible proof.",
    source: "goal-10-policy-fixture",
    proofObligationIds: ["P4"]
  }];
  spec.proofObligations = [{ id: "P4", requirementIds: ["R5"] }];
  spec.requiredTests = [{
    id: "T1",
    type: "user-smoke",
    command: null,
    description: "Browser smoke proves the reset flow at the user surface.",
    requirementIds: ["R5"]
  }];
  spec.userFlows = [{
    id: "F1",
    name: "Browse reset smoke",
    steps: ["Open /browse", "Search for unavailable content", "Click reset"],
    negativePath: "Missing browser smoke is rejected.",
    expectedOutcome: "Visible offerings return after reset."
  }];
  writeJson(join(runDir, "spec.json"), spec);

  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.taskClass = "web-ui";
  proofPlan.obligations = [{
    id: "P4",
    statement: "The web UI flow is exercised from the user's point of view.",
    requirementIds: ["R5"],
    acceptedEvidenceTypes: ["browser-smoke"],
    minimumEvidence: 1,
    status: "pending"
  }];
  proofPlan.requirementCoverage = [{ requirementId: "R5", proofObligationIds: ["P4"] }];
  proofPlan.surfaceProofs = [{
    id: "S.browser-reset",
    handler: "browser",
    evidenceType: "browser-smoke",
    proofObligationIds: ["P4"],
    scenarioPath: "smoke/scenario.json"
  }];
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
}

function writePassingFinalReportFromVerification({ runDir, claimId }) {
  const verification = readJson(join(runDir, "verification.json"));
  const proof = verification.proofObligations.find((item) => item.status === "passed");
  assert.ok(proof, "fixture must have a passed proof obligation");
  const requirement = verification.requirementCoverage.find((item) => item.status === "passed");
  assert.ok(requirement, "fixture must have passed requirement coverage");
  const evidence = proof.evidence;
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.outcome = "passed";
  finalReport.claims = {
    implementation: { status: "passed", requirementIds: [requirement.requirementId], evidence },
    [claimId]: { status: "passed", requirementIds: [requirement.requirementId], evidence },
    requirementMapping: { status: "passed", requirementIds: [requirement.requirementId], evidence }
  };
  finalReport.proofObligations = {
    [proof.id]: { status: "passed", evidence }
  };
  finalReport.requirementResults = [{
    requirementId: requirement.requirementId,
    status: "passed",
    evidence
  }];
  finalReport.residualRisk = ["Policy fixture uses deterministic local artifacts."];
  finalReport.stillUnenforced = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function assertRule(result, ruleId) {
  assert.ok(
    result.blockingRules.some((rule) => rule.ruleId === ruleId),
    `Missing policy rule ${ruleId}; got ${JSON.stringify(result.blockingRules, null, 2)}`
  );
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function verifierNow() {
  return new Date("2026-06-24T12:00:00.000Z");
}

function policyNow() {
  return new Date("2026-06-24T12:30:00.000Z");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path) {
  return readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
