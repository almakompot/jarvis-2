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
import { runSurfaceProofExecutor } from "../lib/surface-executor.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";
import { runCompletedRunVerifier } from "../lib/verifier.mjs";

test("M6 adversarial suite keeps expected-good command and browser runs satisfiable", async (t) => {
  const commandRun = await createCompletedCommandRun("mutation-good-command");
  const browserRun = await createCompletedBrowserRun("mutation-good-browser");
  t.after(() => {
    rmSync(commandRun.repo, { recursive: true, force: true });
    rmSync(browserRun.repo, { recursive: true, force: true });
  });

  assertVerifierPasses(commandRun.runDir);
  assertVerifierPasses(browserRun.runDir);
});

test("M6 adversarial suite rejects deleted evidence artifacts", async (t) => {
  const { repo, runDir } = await createCompletedBrowserRun("mutation-deleted-evidence");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  const evidencePath = verification.evidence.find((evidence) => evidence.status === "passed")?.path;
  assert.ok(evidencePath, "fixture must have a passed evidence artifact path");
  unlinkSync(join(runDir, evidencePath));

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "evidence.artifact.missing", "blocking");
});

test("M6 adversarial suite rejects passed commands with failing exit codes", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-exit-code");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  verification.commands[0].exitCode = 1;
  verification.commands[0].status = "passed";
  writeJson(join(runDir, "verification.json"), verification);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "command.exit.passed-nonzero", "blocking");
});

test("M6 adversarial suite rejects removed browser smoke evidence", async (t) => {
  const { repo, runDir } = await createCompletedBrowserRun("mutation-removed-browser-smoke");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  verification.evidence = [];
  verification.surfaceResults = verification.surfaceResults.map((result) => ({ ...result, evidenceIds: [] }));
  verification.proofObligations = verification.proofObligations.map((proof) => ({ ...proof, evidence: [] }));
  writeJson(join(runDir, "verification.json"), verification);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "surface.required-evidence.missing", "blocking");
});

test("M6 adversarial suite rejects forbidden .env edits", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-env-edit");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const changedFiles = readJson(join(runDir, "changed-files.json"));
  changedFiles.files.push({
    path: ".env.local",
    status: "modified",
    forbidden: false,
    contentCaptured: false,
    hashBefore: null,
    hashAfter: null,
    bytesBefore: 12,
    bytesAfter: 18
  });
  writeJson(join(runDir, "changed-files.json"), changedFiles);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "changed-files.forbidden-path", "blocking");
});

test("M6 adversarial suite rejects proof commands moved before final edits", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-tests-before-edits");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const commandLogPath = join(runDir, "command-log.jsonl");
  const rows = readJsonl(commandLogPath).map((row) => {
    if (row.id === "cmd.verify.0001") {
      return {
        ...row,
        startedAt: "2026-06-24T08:30:00.000Z",
        finishedAt: "2026-06-24T08:30:01.000Z"
      };
    }
    return row;
  });
  writeJsonl(commandLogPath, rows);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "event.verification-before-final-edit", "blocking");
});

test("M6 adversarial suite rejects final claims citing unknown evidence", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-unknown-evidence");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims.automatedVerification.evidence = ["E.missing.fake"];
  writeJson(join(runDir, "final-report.json"), finalReport);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "final-report.claim.unknown-evidence", "blocking");
});

test("M6 adversarial suite rejects passed reports with no residual risk", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-no-residual-risk");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.residualRisk = [];
  writeJson(join(runDir, "final-report.json"), finalReport);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "final-report.residual-risk.missing", "major");
});

test("M6 adversarial suite rejects pass claims after failed verification", async (t) => {
  const { repo, runDir } = await createCompletedCommandRun("mutation-pass-after-failure");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const verification = readJson(join(runDir, "verification.json"));
  const evidenceId = verification.evidence[0].id;
  verification.status = "failed";
  verification.commands[0].status = "failed";
  verification.commands[0].exitCode = 1;
  verification.evidence[0].status = "failed";
  verification.proofObligations[0].status = "failed";
  verification.proofObligations[0].evidence = [];
  verification.proofObligations[0].failedEvidence = [evidenceId];
  verification.requirementCoverage[0].status = "failed";
  writeJson(join(runDir, "verification.json"), verification);

  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });

  assertVerifierRejects(result);
  assertFinding(result, "final-report.outcome.exceeds-verification", "blocking");
  assertFinding(result, "final-report.claim.nonpassing-evidence", "blocking");
});

async function createCompletedCommandRun(runId) {
  const { repo, runDir } = createBaseRun({
    runId,
    task: "build a local internal helper with command proof",
    files: {
      "scripts/pass.mjs": "console.log('verifier proof passed');\n"
    },
    packageJson: { scripts: { test: "node scripts/pass.mjs" }, type: "module" }
  });
  configureCommandProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runCommandProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir, claimId: "automatedVerification" });
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
  assertStructuralValidation(runDir);
  return { repo, runDir };
}

function createBaseRun({ runId, task, files, packageJson }) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-verifier-mutation-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Verifier Mutation Fixture\n");
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
    source: "goal-9-mutation-fixture",
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
    source: "goal-9-mutation-fixture",
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
  finalReport.residualRisk = ["Mutation fixture uses deterministic local artifacts."];
  finalReport.stillUnenforced = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function assertVerifierPasses(runDir) {
  const result = runCompletedRunVerifier({ runDir, now: verifierNow() });
  assert.equal(result.status, "passed", JSON.stringify(result.findings, null, 2));
  assert.equal(result.decisionRecommendation, "accept");
  assert.deepEqual(result.findings.filter((finding) => ["blocking", "major"].includes(finding.severity)), []);
}

function assertVerifierRejects(result) {
  assert.equal(result.status, "failed", JSON.stringify(result.findings, null, 2));
  assert.equal(result.decisionRecommendation, "reject");
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

function verifierNow() {
  return new Date("2026-06-24T12:00:00.000Z");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8").trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}
