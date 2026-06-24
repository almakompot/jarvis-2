import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { runCommandProofExecutor } from "../lib/command-executor.mjs";
import { runFakeCodex } from "../lib/fake-runner.mjs";
import { runPolicyEngine } from "../lib/policy-engine.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";
import { runCompletedRunVerifier } from "../lib/verifier.mjs";

test("M8 meta report snapshot for an accepted run leads with findings and evidence links", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-accepted-report");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = runMeta(["report", "--run", runDir, "--format", "text"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(normalizeReport(result.stdout), acceptedSnapshot());
});

test("M8 meta report snapshot for a rejected run shows blocking findings first", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-rejected-report");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims.automatedVerification.evidence = ["E.fake.missing"];
  writeJson(join(runDir, "final-report.json"), finalReport);
  runCompletedRunVerifier({ runDir, now: verifierNow() });
  runPolicyEngine({ runDir, now: policyNow() });

  const result = runMeta(["report", "--run", runDir]);

  assert.equal(result.status, 0, result.stderr);
  const output = normalizeReport(result.stdout);
  assert.match(output, /^Findings:\n- \[blocking\] POL-HONESTY-001:/);
  assert.match(output, /Decision: rejected/);
  assert.match(output, /Blocking reason: Final report claim automatedVerification cites unknown evidence E\.fake\.missing\./);
  assert.match(output, /Next action:\n- Fix the evidence\/final-report mismatch/);
});

test("M8 meta report snapshot for a blocked run shows blocker and next action", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-blocked-report");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runnerState = readJson(join(runDir, "runner-state.json"));
  runnerState.status = "blocked";
  runnerState.terminalState.status = "blocked";
  runnerState.terminalState.reason = "awaiting-approval";
  writeJson(join(runDir, "runner-state.json"), runnerState);
  runPolicyEngine({ runDir, now: policyNow() });

  const result = runMeta(["report", "--run", runDir]);

  assert.equal(result.status, 0, result.stderr);
  const output = normalizeReport(result.stdout);
  assert.match(output, /^Findings:\n- \[blocking\] POL-BLOCKED-001: Runner state is blocked\./);
  assert.match(output, /Decision: blocked/);
  assert.match(output, /Next action:\n- Resolve the blocking condition/);
});

test("M8 meta report gives a useful missing-file CLI error", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-missing-file-report");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  unlinkSync(join(runDir, "policy-decision.json"));

  const result = runMeta(["report", "--run", runDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required report artifact\(s\): policy-decision\.json/);
});

test("M8 meta report writes HTML with evidence links", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-html-report");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = runMeta(["report", "--run", runDir, "--format", "html"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Report written:/);
  const html = readFileSync(join(runDir, "html-report", "index.html"), "utf8");
  assert.match(html, /<h2>Evidence Links<\/h2>/);
  assert.match(html, /href="\.\.\/evidence\/commands\//);
});

test("M8 meta rerun and cleanup operate only on harness run folders", async (t) => {
  const { repo, runDir } = await createAcceptedCommandRun("m8-rerun-source");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const rerun = runMeta(["rerun", "--from", runDir, "--id", "m8-rerun-child"]);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /Created child run:/);
  assert.match(readFileSync(join(repo, ".task-runs", "m8-rerun-child", "parent-run.json"), "utf8"), /m8-rerun-source/);

  mkdirSync(join(repo, ".task-runs", "not-a-harness-run"), { recursive: true });
  writeFileSync(join(repo, ".task-runs", "not-a-harness-run", "note.txt"), "do not delete\n");

  const cleanup = runMeta(["cleanup", "--repo", repo, "--dry-run"]);
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.match(cleanup.stdout, /Harness run folders: 2/);
  assert.doesNotMatch(cleanup.stdout, /not-a-harness-run/);
});

test("M8 meta init, fake run, verify, and promote-failure are wired through the CLI", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-m8-command-path-"));
  const corpusRoot = mkdtempSync(join(tmpdir(), "meta-harness-m8-corpus-"));
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpusRoot, { recursive: true, force: true });
  });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('meta command path passed');\n");
  writeFileSync(join(repo, "README.md"), "# M8 CLI Command Path\n");

  const init = runMeta(["init", "--repo", repo, "--task", "build a local internal helper with command proof", "--id", "m8-command-path"]);
  assert.equal(init.status, 0, init.stderr);
  const runDir = join(repo, ".task-runs", "m8-command-path");
  assert.match(init.stdout, /Created task run:/);

  const run = runMeta(["run", "--run", runDir, "--fake", "--scenario", "success"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Runner status: implemented/);

  const verify = runMeta(["verify", "--run", runDir, "--skip-surfaces", "--command-timeout-ms", "1000"]);
  assert.equal(verify.status, 2, verify.stderr);
  assert.match(verify.stdout, /Verification pipeline status: rejected/);
  assert.match(verify.stdout, /- policy: rejected/);

  const promote = runMeta([
    "promote-failure",
    "--run",
    runDir,
    "--category",
    "missing-final-report",
    "--case-id",
    "m8-command-path",
    "--corpus-root",
    corpusRoot
  ]);
  assert.equal(promote.status, 0, promote.stderr);
  assert.match(promote.stdout, /Promoted failure skeleton:/);
  const caseJson = readJson(join(corpusRoot, "missing-final-report", "m8-command-path", "case.json"));
  assert.equal(caseJson.privacy.classification, "private-staging");
});

test("M8 meta run can initialize from repo and task in one command", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-m8-combined-run-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('combined run proof');\n");
  writeFileSync(join(repo, "README.md"), "# M8 Combined Run\n");

  const result = runMeta([
    "run",
    "--repo",
    repo,
    "--task",
    "build a local internal helper with command proof",
    "--id",
    "m8-combined-run",
    "--fake",
    "--scenario",
    "success"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created task run:/);
  assert.match(result.stdout, /Runner status: implemented/);
  assert.match(result.stdout, /Run dir:/);
  assert.match(readFileSync(join(repo, ".task-runs", "m8-combined-run", "runner-state.json"), "utf8"), /implemented/);
});

async function createAcceptedCommandRun(runId) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-m8-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('m8 proof passed');\n");
  writeFileSync(join(repo, "README.md"), "# M8 Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a local internal helper with command proof",
    runId,
    now: new Date("2026-06-24T09:00:00.000Z")
  }).runDir;
  configureCommandProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runCommandProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir });
  runCompletedRunVerifier({ runDir, now: verifierNow() });
  runPolicyEngine({ runDir, now: policyNow() });
  return { repo, runDir };
}

function configureCommandProof(runDir) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = "internal";
  spec.task.class = "internal";
  spec.requirements = [{
    id: "R1",
    text: "The internal helper behavior is covered by command proof.",
    source: "goal-12-cli-fixture",
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

function writePassingFinalReportFromVerification({ runDir }) {
  const verification = readJson(join(runDir, "verification.json"));
  const proof = verification.proofObligations.find((item) => item.status === "passed");
  const requirement = verification.requirementCoverage.find((item) => item.status === "passed");
  const evidence = proof.evidence;
  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.outcome = "passed";
  finalReport.claims = {
    implementation: { status: "passed", requirementIds: [requirement.requirementId], evidence },
    automatedVerification: { status: "passed", requirementIds: [requirement.requirementId], evidence },
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
  finalReport.residualRisk = ["M8 fixture uses deterministic local artifacts."];
  finalReport.stillUnenforced = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function runMeta(args) {
  return spawnSync(process.execPath, ["meta-harness/scripts/meta.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function normalizeReport(output) {
  return output.replace(/\n$/g, "");
}

function acceptedSnapshot() {
  return `Findings:
- none
Decision: accepted
Blocking reason: none
Run: m8-accepted-report
Task: build a local internal helper with command proof
Policy rules:
- none active
Passed commands:
- cmd.verify.0001 npm run test (passed, exit 0) stdout evidence/commands/cmd.verify.0001.stdout.txt
Failed commands:
- none
Missing proof:
- none
Evidence:
- E.cmd.verify.0001 test-command passed -> evidence/commands/cmd.verify.0001.stdout.txt
Residual risk:
- M8 fixture uses deterministic local artifacts.
Next action:
- Archive the run artifacts and keep residual risk visible in handoff notes.`;
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

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
