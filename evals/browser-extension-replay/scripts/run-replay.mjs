#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runCommandProofExecutor } from "../../../meta-harness/lib/command-executor.mjs";
import { runFakeCodex } from "../../../meta-harness/lib/fake-runner.mjs";
import { runPolicyEngine } from "../../../meta-harness/lib/policy-engine.mjs";
import { writeRunReport } from "../../../meta-harness/lib/report-ux.mjs";
import { runSurfaceProofExecutor } from "../../../meta-harness/lib/surface-executor.mjs";
import { initTaskRun, validateTaskRunDir } from "../../../meta-harness/lib/task-packet.mjs";
import { readJson, writeJson } from "../../../meta-harness/lib/runner-utils.mjs";
import { runCompletedRunVerifier } from "../../../meta-harness/lib/verifier.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const siteGateSourceRoot = join(repoRoot, "apps/site-gate-extension");
const defaultCasePath = join(repoRoot, "evals/browser-extension-replay/cases/site-gate-extension/case.json");
const defaultOutputDir = join(repoRoot, "tmp/browser-extension-replay/site-gate-extension");
const replayMarkerFile = ".browser-extension-replay-output";

export async function runBrowserExtensionReplay({
  casePath = defaultCasePath,
  outputDir = defaultOutputDir,
  keepOutput = false,
  json = false
} = {}) {
  const replayCase = readJson(resolve(casePath));
  const absoluteOutputDir = resolve(outputDir);
  prepareOutputDir({ outputDir: absoluteOutputDir, keepOutput });

  const acceptedRepo = join(absoluteOutputDir, "accepted-repo");
  const syntaxOnlyRepo = join(absoluteOutputDir, "syntax-only-repo");
  writeFixtureRepo({ repoPath: acceptedRepo });
  writeFixtureRepo({ repoPath: syntaxOnlyRepo });

  const startedAt = new Date("2026-06-24T14:00:00.000Z");
  const accepted = await runAcceptedReplay({
    replayCase,
    repoPath: acceptedRepo,
    runId: replayCase.runId,
    startedAt
  });
  const syntaxOnly = await runSyntaxOnlyReplay({
    replayCase,
    repoPath: syntaxOnlyRepo,
    runId: `${replayCase.runId}-syntax-only`,
    startedAt: atMinute(startedAt, 20)
  });

  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.browser-extension-replay-summary",
    caseId: replayCase.id,
    outputDir: absoluteOutputDir,
    accepted,
    syntaxOnly
  };
  writeJson(join(absoluteOutputDir, "summary.json"), summary);
  assertReplayOutcomes({ replayCase, summary });
  if (!json) {
    printSummary(summary);
  }
  return summary;
}

async function runAcceptedReplay({ replayCase, repoPath, runId, startedAt }) {
  const run = initTaskRun({
    repoPath,
    task: replayCase.task.raw,
    runId,
    now: atMinute(startedAt, 0),
    overwrite: true
  });
  configureAcceptedRun({ runDir: run.runDir });
  appendBridgeEvidence({
    runDir: run.runDir,
    now: atMinute(startedAt, 1),
    evidence: {
      id: "E.repo-profile.0001",
      type: "repo-profile",
      status: "passed",
      path: "repo-profile.json",
      requirementIds: ["R1"],
      proofObligationIds: ["P1"],
      message: "Repo profile captured Manifest V3, service worker, extension pages, scripts, and smoke entrypoints before implementation."
    }
  });

  const runner = await runFakeCodex({
    runDir: run.runDir,
    scenario: "browser-extension-success",
    now: atMinute(startedAt, 2),
    totalTimeoutMs: 5000
  });
  const command = await runCommandProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 3),
    timeoutMs: 60000
  });
  const surface = await runSurfaceProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 4),
    timeoutMs: 30000
  });

  writeAcceptedFinalReport({ runDir: run.runDir, now: atMinute(startedAt, 5) });
  appendBridgeEvidence({
    runDir: run.runDir,
    now: atMinute(startedAt, 6),
    evidence: {
      id: "E.final-report.0001",
      type: "final-report",
      status: "passed",
      path: "final-report.json",
      requirementIds: ["R6"],
      proofObligationIds: ["P5"],
      message: "Final report maps extension requirements to manifest, command, smoke, and residual-risk evidence."
    }
  });

  const verifier = runCompletedRunVerifier({ runDir: run.runDir, now: atMinute(startedAt, 7) });
  const policy = runPolicyEngine({ runDir: run.runDir, now: atMinute(startedAt, 8) });
  const textReport = writeRunReport({ runDir: run.runDir, format: "text" });
  const htmlReport = writeRunReport({ runDir: run.runDir, format: "html" });
  return summarizeRun({
    label: "accepted",
    repoPath,
    run,
    runner,
    command,
    surface,
    verifier,
    policy,
    textReport,
    htmlReport
  });
}

async function runSyntaxOnlyReplay({ replayCase, repoPath, runId, startedAt }) {
  const run = initTaskRun({
    repoPath,
    task: replayCase.task.raw,
    runId,
    now: atMinute(startedAt, 0),
    overwrite: true
  });
  configureSyntaxOnlyRun({ runDir: run.runDir });
  appendBridgeEvidence({
    runDir: run.runDir,
    now: atMinute(startedAt, 1),
    evidence: {
      id: "E.repo-profile.0001",
      type: "repo-profile",
      status: "passed",
      path: "repo-profile.json",
      requirementIds: ["R1"],
      proofObligationIds: ["P1"],
      message: "Repo profile captured extension files, but this replay intentionally omits extension smoke."
    }
  });

  const runner = await runFakeCodex({
    runDir: run.runDir,
    scenario: "browser-extension-success",
    now: atMinute(startedAt, 2),
    totalTimeoutMs: 5000
  });
  const command = await runCommandProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 3),
    timeoutMs: 30000
  });
  const surface = await runSurfaceProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 4),
    timeoutMs: 10000
  });
  writeSyntaxOnlyOverclaimReport({ runDir: run.runDir, now: atMinute(startedAt, 5) });
  appendBridgeEvidence({
    runDir: run.runDir,
    now: atMinute(startedAt, 6),
    evidence: {
      id: "E.final-report.0001",
      type: "final-report",
      status: "passed",
      path: "final-report.json",
      requirementIds: ["R6"],
      proofObligationIds: ["P5"],
      message: "Intentional false-pass report used to prove syntax-only proof rejects."
    }
  });
  const verifier = runCompletedRunVerifier({ runDir: run.runDir, now: atMinute(startedAt, 7) });
  const policy = runPolicyEngine({ runDir: run.runDir, now: atMinute(startedAt, 8) });
  const textReport = writeRunReport({ runDir: run.runDir, format: "text" });
  const htmlReport = writeRunReport({ runDir: run.runDir, format: "html" });
  return summarizeRun({
    label: "syntax-only",
    repoPath,
    run,
    runner,
    command,
    surface,
    verifier,
    policy,
    textReport,
    htmlReport
  });
}

function prepareOutputDir({ outputDir, keepOutput }) {
  if (existsSync(outputDir) && !keepOutput) {
    const marker = join(outputDir, replayMarkerFile);
    const isEmpty = readdirSync(outputDir).length === 0;
    if (!existsSync(marker) && !isEmpty) {
      throw new Error(`Refusing to remove unmarked browser-extension replay output directory: ${outputDir}`);
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, replayMarkerFile), "browser-extension replay output\n");
}

function writeFixtureRepo({ repoPath }) {
  rmSync(repoPath, { recursive: true, force: true });
  const files = [
    "README.md",
    "manifest.json",
    "background.js",
    "blocked.html",
    "blocked.js",
    "gate.css",
    "gate.html",
    "gate.js",
    "scripts/smoke-cdp.mjs",
    "scripts/validate-extension.mjs"
  ];
  for (const relativePath of files) {
    const absoluteTarget = join(repoPath, relativePath);
    mkdirSync(dirname(absoluteTarget), { recursive: true });
    writeFileSync(absoluteTarget, readFileSync(join(siteGateSourceRoot, relativePath)));
  }
  writeFileSync(join(repoPath, "package.json"), `${JSON.stringify({
    name: "synthetic-site-gate-extension-replay",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      test: "node scripts/validate-extension.mjs",
      smoke: "node scripts/smoke-cdp.mjs",
      "assert:negative": "node scripts/assert-negative-scenario.mjs",
      syntax: "node --check background.js && node --check gate.js && node --check blocked.js",
      check: "npm run test && npm run smoke"
    }
  }, null, 2)}\n`);
  writeFileSync(join(repoPath, "AGENTS.md"), [
    "# Synthetic Site Gate Fixture",
    "",
    "Use local scripts only. Do not publish the extension or broaden host permissions.",
    "The requested user surface is the unpacked browser extension."
  ].join("\n") + "\n");
  writeFileSync(join(repoPath, "scripts/assert-negative-scenario.mjs"), negativeScenarioScript());
  initializeFixtureGit(repoPath);
}

function initializeFixtureGit(repoPath) {
  const init = spawnSync("git", ["init", "--quiet"], { cwd: repoPath, encoding: "utf8" });
  if (init.status !== 0) {
    throw new Error(`Failed to initialize synthetic Site Gate git repo: ${init.stderr || init.stdout}`);
  }
}

function negativeScenarioScript() {
  return [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "",
    "const scenario = JSON.parse(readFileSync('tmp/site-gate-smoke/scenario.json', 'utf8'));",
    "const trace = JSON.parse(readFileSync('tmp/site-gate-smoke/trace.json', 'utf8'));",
    "const assertions = (scenario.assertions || []).join('\\n');",
    "const actions = new Set((trace.steps || []).map((step) => step.action));",
    "",
    "assert.equal(scenario.status, 'passed');",
    "assert.equal(scenario.extensionLoaded, true);",
    "assert.equal(scenario.extensionContext, true);",
    "assert.match(scenario.page || '', /blocked\\.html/);",
    "for (const text of [",
    "  'invalid custom minutes',",
    "  '1 min opened the target',",
    "  '5 min opened a separate target',",
    "  'custom 2 min opened a separate target',",
    "  'Actually no navigated to extension blocked page'",
    "]) {",
    "  assert.match(assertions, new RegExp(text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'i'));",
    "}",
    "for (const action of [",
    "  'gate-render',",
    "  'invalid-custom-minutes',",
    "  'allow-one-minute',",
    "  'same-origin-reuse',",
    "  'allow-five-minutes',",
    "  'allow-custom-minutes',",
    "  'decline-to-blocked'",
    "]) {",
    "  assert.ok(actions.has(action), `missing trace action ${action}`);",
    "}",
    "console.log('ok - Site Gate negative and edge paths represented in smoke scenario');"
  ].join("\n") + "\n";
}

function configureAcceptedRun({ runDir }) {
  const specPath = join(runDir, "spec.json");
  const proofPlanPath = join(runDir, "proof-plan.json");
  const spec = readJson(specPath);
  const proofPlan = readJson(proofPlanPath);
  spec.requiredTests = [
    {
      id: "T1",
      type: "repo-native-check",
      command: "npm run test",
      description: "Validate Manifest V3, service worker wiring, extension pages, permissions, and gate source checks.",
      requirementIds: ["R1", "R2", "R4"]
    },
    {
      id: "T2",
      type: "user-smoke",
      command: "npm run smoke",
      description: "Run the unpacked-extension CDP smoke against Site Gate.",
      requirementIds: ["R2", "R3", "R4", "R5"]
    },
    {
      id: "T3",
      type: "negative-or-edge-path",
      command: "npm run assert:negative",
      description: "Assert invalid custom minutes, allow durations, same-origin reuse, and decline-to-blocked evidence from the smoke scenario.",
      requirementIds: ["R3", "R5"]
    }
  ];
  proofPlan.surfaceProofs = [{
    id: "surface-site-gate-extension-smoke",
    handler: "browser-extension",
    evidenceType: "browser-extension-smoke",
    scenarioPath: "tmp/site-gate-smoke/scenario.json",
    manifestPath: "manifest.json",
    proofObligationIds: ["P3", "P4"],
    requirementIds: ["R2", "R3", "R5"],
    description: "Validate the recorded unpacked-extension CDP smoke scenario for Site Gate."
  }];
  writeJson(specPath, spec);
  writeJson(proofPlanPath, proofPlan);
}

function configureSyntaxOnlyRun({ runDir }) {
  const specPath = join(runDir, "spec.json");
  const proofPlanPath = join(runDir, "proof-plan.json");
  const spec = readJson(specPath);
  const proofPlan = readJson(proofPlanPath);
  spec.requiredTests = [
    {
      id: "T1",
      type: "repo-native-check",
      command: "npm run test",
      description: "Validate manifest and source structure.",
      requirementIds: ["R1", "R2", "R4"]
    },
    {
      id: "T2",
      type: "user-smoke",
      command: "npm run syntax",
      description: "Intentionally mislabeled syntax-only proof for browser-extension behavior.",
      requirementIds: ["R2", "R3", "R4", "R5"]
    }
  ];
  proofPlan.surfaceProofs = [];
  writeJson(specPath, spec);
  writeJson(proofPlanPath, proofPlan);
}

function appendBridgeEvidence({ runDir, now, evidence }) {
  const verification = readJson(join(runDir, "verification.json"));
  verification.evidence = [
    ...(verification.evidence || []).filter((item) => item.id !== evidence.id),
    evidence
  ];
  recomputeVerification({ runDir, verification, now });
  writeJson(join(runDir, "verification.json"), verification);
}

function recomputeVerification({ runDir, verification, now }) {
  const spec = readJson(join(runDir, "spec.json"));
  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  const evidenceByProof = new Map();
  for (const evidence of verification.evidence || []) {
    for (const proofId of evidence.proofObligationIds || []) {
      if (!evidenceByProof.has(proofId)) {
        evidenceByProof.set(proofId, []);
      }
      evidenceByProof.get(proofId).push(evidence);
    }
  }
  verification.proofObligations = (proofPlan.obligations || []).map((obligation) => {
    const items = evidenceByProof.get(obligation.id) || [];
    const passed = items.filter((item) => item.status === "passed");
    const failed = items.filter((item) => item.status === "failed" || item.status === "timed-out");
    const blocked = items.filter((item) => item.status === "blocked");
    const status = passed.length >= obligation.minimumEvidence
      ? "passed"
      : failed.length > 0
        ? "failed"
        : blocked.length > 0
          ? "blocked"
          : "pending";
    return {
      id: obligation.id,
      status,
      evidence: passed.map((item) => item.id),
      failedEvidence: failed.map((item) => item.id),
      blockedEvidence: blocked.map((item) => item.id)
    };
  });
  const proofStatusById = new Map(verification.proofObligations.map((proof) => [proof.id, proof.status]));
  verification.requirementCoverage = (spec.requirements || []).map((requirement) => {
    const statuses = (requirement.proofObligationIds || [])
      .map((proofId) => proofStatusById.get(proofId))
      .filter(Boolean);
    return {
      requirementId: requirement.id,
      status: statuses.length > 0 && statuses.every((status) => status === "passed")
        ? "passed"
        : statuses.includes("failed")
          ? "failed"
          : statuses.includes("blocked")
            ? "blocked"
            : "pending",
      proofObligationIds: requirement.proofObligationIds || []
    };
  });
  verification.status = statusFromProofs(verification.proofObligations);
  verification.scope = "browser-extension-replay-full-pipeline";
  verification.updatedAt = now.toISOString();
  verification.summary = {
    ...(verification.summary || {}),
    replayBridgeEvidence: (verification.evidence || []).filter((item) => item.id.startsWith("E.repo-profile.") || item.id.startsWith("E.final-report.")).length,
    note: "Browser-extension replay recomputed after bridge evidence for repo inspection and final report."
  };
}

function statusFromProofs(proofs) {
  if (proofs.some((proof) => proof.status === "failed")) {
    return "failed";
  }
  if (proofs.some((proof) => proof.status === "blocked")) {
    return "blocked";
  }
  if (proofs.some((proof) => proof.status === "pending")) {
    return "pending";
  }
  return "passed";
}

function writeAcceptedFinalReport({ runDir, now }) {
  const spec = readJson(join(runDir, "spec.json"));
  const verification = readJson(join(runDir, "verification.json"));
  const proofEvidence = Object.fromEntries((verification.proofObligations || []).map((proof) => [proof.id, proof.evidence || []]));
  proofEvidence.P5 = ["E.final-report.0001"];
  const evidenceForProofs = (proofIds) => [...new Set(proofIds.flatMap((proofId) => proofEvidence[proofId] || []))];
  const allBehaviorEvidence = evidenceForProofs(["P2", "P3", "P4"]);
  writeJson(join(runDir, "final-report.json"), {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId: spec.runId,
    createdAt: now.toISOString(),
    outcome: "passed",
    summary: "Site Gate browser-extension replay passed with manifest validation, unpacked-extension smoke, allow durations, validation, reuse, and decline evidence.",
    claims: {
      manifestValidation: passedClaim(["R2", "R4"], ["P2"], proofEvidence.P2 || [], "Manifest V3, service worker, pages, permissions, and source checks passed."),
      extensionLoad: passedClaim(["R2", "R5"], ["P4"], evidenceForProofs(["P4"]), "The unpacked extension loaded in a Chromium-family browser context."),
      invalidCustomMinutes: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "Invalid custom minutes remained on the gate with visible validation."),
      oneMinuteAllow: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "The one-minute allow opened the target."),
      fiveMinuteAllow: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "The five-minute allow opened a separate target."),
      customAllow: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "The custom-minute allow opened a separate target."),
      sameOriginReuse: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "The one-minute allow persisted for same-origin reuse."),
      declineBlocked: passedClaim(["R3", "R5"], ["P3", "P4"], allBehaviorEvidence, "Actually no navigated to the extension blocked page."),
      finalMapping: passedClaim(["R6"], ["P5"], ["E.final-report.0001"], "This report maps requirements, proof obligations, evidence IDs, and residual risk.")
    },
    proofObligations: Object.fromEntries(["P1", "P2", "P3", "P4", "P5"].map((proofId) => [
      proofId,
      { status: "passed", evidence: proofEvidence[proofId] || [] }
    ])),
    requirementResults: (spec.requirements || []).map((requirement) => ({
      requirementId: requirement.id,
      status: "passed",
      proofObligationIds: requirement.proofObligationIds || [],
      evidence: [...new Set((requirement.proofObligationIds || []).flatMap((proofId) => proofEvidence[proofId] || []))]
    })),
    residualRisk: [
      "Replay uses a local copied Site Gate fixture rather than a published Chrome Web Store package.",
      "The smoke runner may fall back from Google Chrome to Microsoft Edge when the local Chrome build does not expose the service worker target."
    ],
    stillUnenforced: [
      "Future hardening should separate browser runner lifecycle into a first-class reusable extension adapter."
    ]
  });
}

function writeSyntaxOnlyOverclaimReport({ runDir, now }) {
  const spec = readJson(join(runDir, "spec.json"));
  const verification = readJson(join(runDir, "verification.json"));
  const passedEvidence = (verification.evidence || []).filter((evidence) => evidence.status === "passed").map((evidence) => evidence.id);
  writeJson(join(runDir, "final-report.json"), {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId: spec.runId,
    createdAt: now.toISOString(),
    outcome: "passed",
    summary: "Intentional false pass: syntax-only evidence claims the browser extension works.",
    claims: {
      syntaxOnlyClaim: {
        status: "passed",
        requirementIds: ["R2", "R3", "R5"],
        proofObligationIds: ["P2", "P3", "P4"],
        evidence: passedEvidence,
        summary: "This intentionally overclaims extension behavior from syntax-only proof."
      }
    },
    proofObligations: Object.fromEntries((verification.proofObligations || []).map((proof) => [
      proof.id,
      { status: proof.status, evidence: proof.evidence || [] }
    ])),
    requirementResults: verification.requirementCoverage || [],
    residualRisk: [
      "This run intentionally lacks unpacked-extension smoke and must be rejected."
    ],
    stillUnenforced: []
  });
}

function passedClaim(requirementIds, proofObligationIds, evidence, summary) {
  return {
    status: "passed",
    requirementIds,
    proofObligationIds,
    evidence,
    summary
  };
}

function summarizeRun({ label, repoPath, run, runner, command, surface, verifier, policy, textReport, htmlReport }) {
  const validation = validateTaskRunDir(run.runDir);
  const verification = readJson(join(run.runDir, "verification.json"));
  return {
    label,
    runId: run.runId,
    repoPath,
    runDir: run.runDir,
    runnerStatus: runner.status,
    commandStatus: command.status,
    surfaceStatus: surface.status,
    verificationStatus: verification.status,
    verifierStatus: verifier.status,
    policyDecision: policy.decision,
    activePolicyRules: policy.blockingRules.filter((rule) => !rule.overridden).map((rule) => rule.ruleId),
    validationPassed: validation.passed,
    validationErrors: validation.errors.map((error) => error.id),
    evidenceTypes: [...new Set((verification.evidence || []).map((item) => item.type))].sort(),
    passedEvidenceTypes: [...new Set((verification.evidence || []).filter((item) => item.status === "passed").map((item) => item.type))].sort(),
    passedSurfaceEvidenceTypes: [...new Set((verification.evidence || []).filter((item) => item.status === "passed" && item.surfaceResultId).map((item) => item.type))].sort(),
    proofStatuses: Object.fromEntries((verification.proofObligations || []).map((proof) => [proof.id, proof.status])),
    reports: {
      text: textReport.outputPath,
      html: htmlReport.outputPath
    },
    artifacts: {
      spec: join(run.runDir, "spec.json"),
      proofPlan: join(run.runDir, "proof-plan.json"),
      verification: join(run.runDir, "verification.json"),
      verifierReport: join(run.runDir, "verifier-report.json"),
      policyDecision: join(run.runDir, "policy-decision.json"),
      finalReport: join(run.runDir, "final-report.json")
    }
  };
}

function assertReplayOutcomes({ replayCase, summary }) {
  const acceptedExpected = replayCase.expected.accepted;
  const accepted = summary.accepted;
  const syntaxExpected = replayCase.expected.syntaxOnly;
  const syntaxOnly = summary.syntaxOnly;
  const failures = [];
  if (accepted.runnerStatus !== acceptedExpected.runnerStatus) {
    failures.push(`accepted runner status ${accepted.runnerStatus} != ${acceptedExpected.runnerStatus}`);
  }
  if (accepted.verificationStatus !== acceptedExpected.verificationStatus) {
    failures.push(`accepted verification status ${accepted.verificationStatus} != ${acceptedExpected.verificationStatus}`);
  }
  if (accepted.verifierStatus !== acceptedExpected.verifierStatus) {
    failures.push(`accepted verifier status ${accepted.verifierStatus} != ${acceptedExpected.verifierStatus}`);
  }
  if (accepted.policyDecision !== acceptedExpected.policyDecision) {
    failures.push(`accepted policy decision ${accepted.policyDecision} != ${acceptedExpected.policyDecision}`);
  }
  for (const type of acceptedExpected.requiredEvidenceTypes || []) {
    if (!accepted.evidenceTypes.includes(type)) {
      failures.push(`accepted run missing evidence type ${type}`);
    }
  }
  if (syntaxOnly.policyDecision !== syntaxExpected.policyDecision) {
    failures.push(`syntax-only policy decision ${syntaxOnly.policyDecision} != ${syntaxExpected.policyDecision}`);
  }
  for (const ruleId of syntaxExpected.requiredPolicyRules || []) {
    if (!syntaxOnly.activePolicyRules.includes(ruleId)) {
      failures.push(`syntax-only run missing policy rule ${ruleId}`);
    }
  }
  if (syntaxOnly.passedSurfaceEvidenceTypes.includes("browser-extension-smoke")) {
    failures.push("syntax-only run unexpectedly produced passing surface browser-extension-smoke evidence");
  }
  if (failures.length > 0) {
    throw new Error(`Browser-extension replay failed acceptance:\n- ${failures.join("\n- ")}`);
  }
}

function printSummary(summary) {
  process.stdout.write([
    `case: ${summary.caseId}`,
    `accepted run: ${summary.accepted.runId}`,
    `accepted policy: ${summary.accepted.policyDecision}`,
    `accepted report: ${summary.accepted.reports.text}`,
    `syntax-only run: ${summary.syntaxOnly.runId}`,
    `syntax-only policy: ${summary.syntaxOnly.policyDecision}`,
    `syntax-only rules: ${summary.syntaxOnly.activePolicyRules.join(", ")}`,
    `summary: ${join(summary.outputDir, "summary.json")}`
  ].join("\n") + "\n");
}

function atMinute(base, minutes) {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

function parseArgs(argv) {
  const args = {
    casePath: defaultCasePath,
    outputDir: defaultOutputDir,
    keepOutput: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--case") {
      args.casePath = argv[++index];
    } else if (item === "--output-dir") {
      args.outputDir = argv[++index];
    } else if (item === "--keep-output") {
      args.keepOutput = true;
    } else if (item === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = await runBrowserExtensionReplay(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
