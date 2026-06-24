#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
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
const defaultCasePath = join(repoRoot, "evals/web-ui-replay/cases/voovo-browse-empty-state/case.json");
const defaultOutputDir = join(repoRoot, "tmp/web-ui-replay/voovo-browse-empty-state");
const replayMarkerFile = ".web-ui-replay-output";

export async function runWebUiReplay({
  casePath = defaultCasePath,
  outputDir = defaultOutputDir,
  keepOutput = false,
  json = false
} = {}) {
  const replayCase = readJson(resolve(casePath));
  const absoluteOutputDir = resolve(outputDir);
  prepareOutputDir({ outputDir: absoluteOutputDir, keepOutput });

  const repoPath = join(absoluteOutputDir, "repo");
  writeFixtureRepo({ repoPath, replayCase });

  const startedAt = new Date("2026-06-24T13:00:00.000Z");
  const run = initTaskRun({
    repoPath,
    task: replayCase.task.raw,
    runId: replayCase.runId,
    now: atMinute(startedAt, 0),
    overwrite: true
  });

  configureRunForReplay({ runDir: run.runDir });
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
      message: "Repo profile was generated before implementation and captured browse route plus proof scripts."
    }
  });

  const runner = await runFakeCodex({
    runDir: run.runDir,
    scenario: "web-ui-success",
    now: atMinute(startedAt, 2),
    totalTimeoutMs: 5000
  });
  const command = await runCommandProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 3),
    timeoutMs: 10000
  });
  const surface = await runSurfaceProofExecutor({
    runDir: run.runDir,
    now: atMinute(startedAt, 4),
    timeoutMs: 10000
  });

  writePassingFinalReport({ runDir: run.runDir, now: atMinute(startedAt, 5) });
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
      message: "Final report maps requirements to evidence and residual risk."
    }
  });

  const verifier = runCompletedRunVerifier({ runDir: run.runDir, now: atMinute(startedAt, 7) });
  const policy = runPolicyEngine({ runDir: run.runDir, now: atMinute(startedAt, 8) });
  const textReport = writeRunReport({ runDir: run.runDir, format: "text" });
  const htmlReport = writeRunReport({ runDir: run.runDir, format: "html" });
  const validation = validateTaskRunDir(run.runDir);
  const verification = readJson(join(run.runDir, "verification.json"));

  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.web-ui-replay-summary",
    caseId: replayCase.id,
    runId: run.runId,
    outputDir: absoluteOutputDir,
    repoPath,
    runDir: run.runDir,
    runnerStatus: runner.status,
    commandStatus: command.status,
    surfaceStatus: surface.status,
    verificationStatus: verification.status,
    verifierStatus: verifier.status,
    policyDecision: policy.decision,
    validationPassed: validation.passed,
    evidenceTypes: [...new Set((verification.evidence || []).map((item) => item.type))].sort(),
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
  writeJson(join(absoluteOutputDir, "summary.json"), summary);

  assertReplayAccepted({ replayCase, summary, validation, textReport: textReport.report });
  if (!json) {
    printSummary(summary);
  }
  return summary;
}

function prepareOutputDir({ outputDir, keepOutput }) {
  if (existsSync(outputDir) && !keepOutput) {
    const marker = join(outputDir, replayMarkerFile);
    const isEmpty = readdirSync(outputDir).length === 0;
    if (!existsSync(marker) && !isEmpty) {
      throw new Error(`Refusing to remove unmarked replay output directory: ${outputDir}`);
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, replayMarkerFile), "web-ui replay output\n");
}

function writeFixtureRepo({ repoPath, replayCase }) {
  rmSync(repoPath, { recursive: true, force: true });
  const files = fixtureFiles({ replayCase });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(repoPath, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  initializeFixtureGit(repoPath);
}

function initializeFixtureGit(repoPath) {
  const init = spawnSync("git", ["init", "--quiet"], { cwd: repoPath, encoding: "utf8" });
  if (init.status !== 0) {
    throw new Error(`Failed to initialize synthetic fixture git repo: ${init.stderr || init.stdout}`);
  }
}

function fixtureFiles({ replayCase }) {
  return {
    "package.json": `${JSON.stringify({
      name: "synthetic-voovo-browse-replay",
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        test: "node scripts/test-browse.mjs",
        "test:e2e": "node scripts/e2e-browse-to-purchase.mjs",
        "smoke:browse": "node scripts/smoke-browse.mjs",
        build: "node scripts/build-browse.mjs",
        "dev:clean": "node scripts/dev-clean.mjs"
      }
    }, null, 2)}\n`,
    "AGENTS.md": [
      "# Synthetic Browse Fixture",
      "",
      "Use local scripts only. Do not deploy, publish, send messages, or read env files.",
      "The requested user surface is `/browse`."
    ].join("\n") + "\n",
    "app/(browse)/browse/page.tsx": [
      "import { allOfferings, resetBrowse, searchCatalog } from '../../../src/browse-catalog.mjs';",
      "",
      "export default function BrowsePage() {",
      "  const initial = searchCatalog('');",
      "  const reset = resetBrowse();",
      "  return (",
      "    <main data-route=\"/browse\">",
      "      <h1>Browse offerings</h1>",
      "      <p>{initial.visibleOfferings.join(', ')}</p>",
      "      <button type=\"button\">{reset.emptyState ? 'Retry' : 'Reset filters'}</button>",
      "      <pre>{JSON.stringify(allOfferings())}</pre>",
      "    </main>",
      "  );",
      "}"
    ].join("\n") + "\n",
    "src/browse-catalog.mjs": [
      "const offerings = [",
      "  { id: 'algorithms', title: 'Algorithms Sprint', checkoutPath: '/checkout/algorithms' },",
      "  { id: 'biology', title: 'Biology Exam Pack', checkoutPath: '/checkout/biology' },",
      "  { id: 'calculus', title: 'Calculus Crash Course', checkoutPath: '/checkout/calculus' }",
      "];",
      "",
      "export function allOfferings() {",
      "  return offerings.map((offering) => ({ ...offering }));",
      "}",
      "",
      "export function searchCatalog(query = '') {",
      "  return {",
      "    status: 'ready',",
      "    query,",
      "    items: allOfferings(),",
      "    visibleOfferings: offerings.map((offering) => offering.title),",
      "    emptyState: null",
      "  };",
      "}",
      "",
      "export function resetBrowse() {",
      "  return {",
      "    status: 'stale',",
      "    query: 'previous-search',",
      "    items: [],",
      "    visibleOfferings: [],",
      "    emptyState: null",
      "  };",
      "}"
    ].join("\n") + "\n",
    "scripts/assertions.mjs": assertionsScript(),
    "scripts/test-browse.mjs": [
      "import { assertBrowseBehavior } from './assertions.mjs';",
      "",
      "assertBrowseBehavior({ source: 'unit-test', query: 'zzzzxqwerty999' });",
      "console.log('ok - browse no-results empty state and reset');"
    ].join("\n") + "\n",
    "scripts/e2e-browse-to-purchase.mjs": [
      "import { assertBrowseBehavior } from './assertions.mjs';",
      "",
      "assertBrowseBehavior({ source: 'browser-e2e', query: 'zzzzxqwerty999' });",
      "console.log('ok - /browse search zzzzxqwerty999 shows empty state and reset restores offerings');"
    ].join("\n") + "\n",
    "scripts/smoke-browse.mjs": smokeBrowseScript(),
    "scripts/build-browse.mjs": buildBrowseScript(),
    "scripts/dev-clean.mjs": [
      "console.log('synthetic dev server placeholder for /browse on http://127.0.0.1:3001');"
    ].join("\n") + "\n",
    "README.md": [
      "# Synthetic VOOVO Browse Fixture",
      "",
      replayCase.task.raw,
      "",
      "This is a public synthetic fixture for the meta-harness web UI replay."
    ].join("\n") + "\n"
  };
}

function assertionsScript() {
  return [
    "import assert from 'node:assert/strict';",
    "import { resetBrowse, searchCatalog } from '../src/browse-catalog.mjs';",
    "",
    "export function assertBrowseBehavior({ source, query }) {",
    "  const empty = searchCatalog(query);",
    "  assert.equal(empty.status, 'empty', `${source}: no-match query must enter empty state`);",
    "  assert.deepEqual(empty.items, [], `${source}: no-match query must not show stale offerings`);",
    "  assert.equal(empty.emptyState?.title, 'No offerings found', `${source}: empty-state title is visible`);",
    "  assert.match(empty.emptyState?.body || '', new RegExp(query), `${source}: empty-state body names the query`);",
    "  assert.equal(empty.emptyState?.resetLabel, 'Reset filters', `${source}: reset action is visible`);",
    "",
    "  const reset = resetBrowse();",
    "  assert.equal(reset.status, 'ready', `${source}: reset returns the browse surface to ready state`);",
    "  assert.equal(reset.query, '', `${source}: reset clears the query`);",
    "  assert.ok(reset.items.length >= 2, `${source}: reset restores visible offerings`);",
    "  assert.equal(reset.emptyState, null, `${source}: reset clears the empty state`);",
    "  assert.ok(reset.items.every((item) => item.checkoutPath.startsWith('/checkout/')), `${source}: checkout paths remain intact`);",
    "",
    "  return { empty, reset };",
    "}"
  ].join("\n") + "\n";
}

function smokeBrowseScript() {
  return [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { assertBrowseBehavior } from './assertions.mjs';",
    "",
    "const query = 'zzzzxqwerty999';",
    "const negativePath = process.argv.includes('--negative-path');",
    "const result = assertBrowseBehavior({ source: negativePath ? 'negative-browser-smoke' : 'browser-smoke', query });",
    "",
    "mkdirSync('smoke', { recursive: true });",
    "writeFileSync('smoke/reset.png', 'synthetic screenshot: no offerings found, reset filters restores offerings\\n');",
    "writeFileSync('smoke/reset-trace.zip', 'synthetic trace: /browse -> search -> empty -> reset\\n');",
    "writeFileSync('smoke/console.log', [",
    "  'route=/browse',",
    "  `query=${query}`,",
    "  `emptyTitle=${result.empty.emptyState.title}`,",
    "  `resetVisibleOfferings=${result.reset.visibleOfferings.join('|')}`",
    "].join('\\n') + '\\n');",
    "writeFileSync('smoke/scenario.json', `${JSON.stringify({",
    "  schemaVersion: 1,",
    "  status: 'passed',",
    "  url: 'http://127.0.0.1:3001/browse',",
    "  route: '/browse',",
    "  assertions: [",
    "    'searching zzzzxqwerty999 shows No offerings found',",
    "    'reset filters restores visible offerings',",
    "    'checkout paths remain intact'",
    "  ],",
    "  screenshotPath: 'reset.png',",
    "  tracePath: 'reset-trace.zip',",
    "  consoleLogPath: 'console.log'",
    "}, null, 2)}\\n`);",
    "console.log(`ok - browser smoke /browse ${query} empty state and reset`);"
  ].join("\n") + "\n";
}

function buildBrowseScript() {
  return [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import { allOfferings } from '../src/browse-catalog.mjs';",
    "",
    "const page = readFileSync('app/(browse)/browse/page.tsx', 'utf8');",
    "assert.match(page, /data-route=\\\"\\/browse\\\"/);",
    "assert.ok(allOfferings().length >= 2);",
    "console.log('ok - synthetic browse build check');"
  ].join("\n") + "\n";
}

function configureRunForReplay({ runDir }) {
  const specPath = join(runDir, "spec.json");
  const proofPlanPath = join(runDir, "proof-plan.json");
  const spec = readJson(specPath);
  const proofPlan = readJson(proofPlanPath);

  spec.requiredTests = spec.requiredTests.map((test) => {
    if (test.type !== "negative-or-edge-path") {
      return test;
    }
    return {
      ...test,
      command: "BASE_URL=http://127.0.0.1:3001 npm run smoke:browse -- --negative-path",
      description: "Run the no-match browse search and reset recovery path as the negative proof."
    };
  });
  proofPlan.surfaceProofs = [{
    id: "surface-browse-empty-reset",
    handler: "browser",
    evidenceType: "browser-smoke",
    scenarioPath: "smoke/scenario.json",
    proofObligationIds: ["P3", "P4"],
    requirementIds: ["R2", "R3", "R5"],
    description: "Validate the recorded /browse smoke scenario for no-results and reset recovery."
  }];

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
  verification.scope = "web-ui-replay-full-pipeline";
  verification.updatedAt = now.toISOString();
  verification.summary = {
    ...(verification.summary || {}),
    replayBridgeEvidence: (verification.evidence || []).filter((item) => item.id.startsWith("E.repo-profile.") || item.id.startsWith("E.final-report.")).length,
    note: "Full web UI replay recomputed after bridge evidence for repo inspection and final report."
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

function writePassingFinalReport({ runDir, now }) {
  const spec = readJson(join(runDir, "spec.json"));
  const verification = readJson(join(runDir, "verification.json"));
  const proofEvidence = Object.fromEntries((verification.proofObligations || []).map((proof) => [proof.id, proof.evidence || []]));
  proofEvidence.P5 = ["E.final-report.0001"];
  const evidenceForProofs = (proofIds) => [...new Set(proofIds.flatMap((proofId) => proofEvidence[proofId] || []))];
  const evidenceForRequirement = (requirement) => evidenceForProofs(requirement.proofObligationIds || []);

  const finalReport = {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId: spec.runId,
    createdAt: now.toISOString(),
    outcome: "passed",
    summary: "Synthetic VOOVO-style browse replay passed: no-match search shows a clear empty state and reset restores visible offerings.",
    claims: {
      repoInspection: {
        status: "passed",
        requirementIds: ["R1"],
        proofObligationIds: ["P1"],
        evidence: proofEvidence.P1 || [],
        summary: "Repo profile and runner inspection captured the browse route, catalog module, and proof scripts before edits."
      },
      implementation: {
        status: "passed",
        requirementIds: ["R2"],
        proofObligationIds: ["P2", "P4"],
        evidence: evidenceForProofs(["P2", "P4"]),
        summary: "Automated checks and browser-smoke evidence cover the visible no-results behavior."
      },
      negativePath: {
        status: "passed",
        requirementIds: ["R3", "R5"],
        proofObligationIds: ["P3", "P4"],
        evidence: evidenceForProofs(["P3", "P4"]),
        summary: "The zzzzxqwerty999 no-match path and reset recovery path were exercised."
      },
      finalMapping: {
        status: "passed",
        requirementIds: ["R6"],
        proofObligationIds: ["P5"],
        evidence: ["E.final-report.0001"],
        summary: "This report maps requirements, proof obligations, evidence IDs, and residual risk."
      }
    },
    proofObligations: Object.fromEntries(["P1", "P2", "P3", "P4", "P5"].map((proofId) => [
      proofId,
      {
        status: "passed",
        evidence: proofEvidence[proofId] || []
      }
    ])),
    requirementResults: (spec.requirements || []).map((requirement) => ({
      requirementId: requirement.id,
      status: "passed",
      proofObligationIds: requirement.proofObligationIds || [],
      evidence: evidenceForRequirement(requirement)
    })),
    residualRisk: [
      "Replay uses a deterministic public synthetic fixture rather than live VOOVO production data.",
      "Browser proof is a recorded smoke artifact produced by fixture scripts, not a full Playwright-controlled browser session."
    ],
    stillUnenforced: [
      "Automatic dev-server lifecycle management and full browser automation remain future hardening work."
    ]
  };
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function assertReplayAccepted({ replayCase, summary, validation, textReport }) {
  const expected = replayCase.expected || {};
  const requiredTypes = expected.requiredEvidenceTypes || [];
  const missingEvidenceTypes = requiredTypes.filter((type) => !summary.evidenceTypes.includes(type));
  const failures = [];
  if (summary.runnerStatus !== expected.runnerStatus) {
    failures.push(`runner status ${summary.runnerStatus} != ${expected.runnerStatus}`);
  }
  if (summary.verificationStatus !== expected.verificationStatus) {
    failures.push(`verification status ${summary.verificationStatus} != ${expected.verificationStatus}`);
  }
  if (summary.verifierStatus !== expected.verifierStatus) {
    failures.push(`verifier status ${summary.verifierStatus} != ${expected.verifierStatus}`);
  }
  if (summary.policyDecision !== expected.policyDecision) {
    failures.push(`policy decision ${summary.policyDecision} != ${expected.policyDecision}`);
  }
  if (!validation.passed) {
    failures.push(`run folder validation failed: ${validation.errors.map((error) => error.id).join(", ")}`);
  }
  if (missingEvidenceTypes.length > 0) {
    failures.push(`missing evidence types: ${missingEvidenceTypes.join(", ")}`);
  }
  if (!/Decision:\s+accepted/i.test(textReport)) {
    failures.push("text report did not render accepted decision");
  }
  if (failures.length > 0) {
    throw new Error(`Web UI replay failed acceptance:\n- ${failures.join("\n- ")}`);
  }
}

function printSummary(summary) {
  process.stdout.write([
    `case: ${summary.caseId}`,
    `run: ${summary.runId}`,
    `runner: ${summary.runnerStatus}`,
    `verification: ${summary.verificationStatus}`,
    `verifier: ${summary.verifierStatus}`,
    `policy: ${summary.policyDecision}`,
    `report: ${summary.reports.text}`,
    `html: ${summary.reports.html}`,
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
    const summary = await runWebUiReplay(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
