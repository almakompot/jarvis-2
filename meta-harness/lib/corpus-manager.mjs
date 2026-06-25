import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { runCommandProofExecutor } from "./command-executor.mjs";
import { runFakeCodex } from "./fake-runner.mjs";
import { runPolicyEngine } from "./policy-engine.mjs";
import { runSurfaceProofExecutor } from "./surface-executor.mjs";
import { initTaskRun } from "./task-packet.mjs";
import { runCompletedRunVerifier } from "./verifier.mjs";

export const defaultCorpusRoot = "corpus/meta-harness";

export async function replayCorpus({
  corpusRoot = defaultCorpusRoot,
  outputDir = "tmp/meta-harness-corpus",
  keepRuns = false,
  now = new Date("2026-06-24T13:00:00.000Z")
} = {}) {
  const absoluteCorpusRoot = resolve(corpusRoot);
  const cases = loadCorpusCases(absoluteCorpusRoot);
  const absoluteOutputDir = resolve(outputDir);
  mkdirSync(absoluteOutputDir, { recursive: true });
  const runRoot = join(absoluteOutputDir, "runs");
  if (!keepRuns) {
    rmSync(runRoot, { recursive: true, force: true });
  }
  mkdirSync(runRoot, { recursive: true });

  const results = [];
  for (const corpusCase of cases) {
    results.push(await replayCorpusCase({ corpusCase, runRoot, keepRuns, now }));
  }

  const failedResults = results.filter((result) => !result.passed);
  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.corpus-replay",
    createdAt: now.toISOString(),
    status: failedResults.length === 0 ? "passed" : "failed",
    corpusRoot: relative(process.cwd(), absoluteCorpusRoot).replace(/\\/g, "/"),
    caseCount: results.length,
    expectedFailCount: results.filter((result) => result.label === "expected-fail").length,
    expectedPassCount: results.filter((result) => result.label === "expected-pass").length,
    caseIds: results.map((result) => result.id),
    failedCaseIds: failedResults.map((result) => result.id),
    results
  };
  writeJson(join(absoluteOutputDir, "replay-summary.json"), summary);
  return summary;
}

export function loadCorpusCases(corpusRoot = resolve(defaultCorpusRoot)) {
  if (!existsSync(corpusRoot)) {
    return [];
  }
  const files = findCaseFiles(corpusRoot).sort();
  return files.map((file) => {
    const definition = readJson(file);
    const caseDir = dirname(file);
    return validateCorpusCase({
      ...definition,
      caseDir,
      mutation: definition.mutationFile ? readJson(join(caseDir, definition.mutationFile)) : definition.mutation || null
    });
  });
}

export async function replayCorpusCase({ corpusCase, runRoot, keepRuns = false, now = new Date("2026-06-24T13:00:00.000Z") }) {
  const fixture = await createCorpusFixture({ corpusCase, runRoot });
  try {
    applyCorpusMutation({ runDir: fixture.runDir, mutation: corpusCase.mutation });
    if (corpusCase.replay?.runVerifier !== false) {
      runCompletedRunVerifier({ runDir: fixture.runDir, now: new Date("2026-06-24T12:00:00.000Z") });
    }
    const policy = runPolicyEngine({ runDir: fixture.runDir, now });
    const result = compareExpectedOutcome({ corpusCase, policy, runDir: fixture.runDir });
    return result;
  } finally {
    if (!keepRuns) {
      rmSync(fixture.repo, { recursive: true, force: true });
    }
  }
}

export function promoteFailureRun({
  runDir,
  category,
  caseId,
  title,
  corpusRoot = defaultCorpusRoot,
  now = new Date()
}) {
  if (!runDir) {
    throw new Error("--run-dir is required");
  }
  if (!category || !caseId) {
    throw new Error("--category and --case-id are required");
  }
  const absoluteRunDir = resolve(runDir);
  const policyDecision = readJson(join(absoluteRunDir, "policy-decision.json"));
  if (!["rejected", "blocked"].includes(policyDecision.decision)) {
    throw new Error(`Can only promote rejected or blocked runs; got ${policyDecision.decision}.`);
  }
  const spec = readJson(join(absoluteRunDir, "spec.json"));
  const verifierReport = readJson(join(absoluteRunDir, "verifier-report.json"));
  const safeCategory = safePathPart(category);
  const safeCaseId = safePathPart(caseId);
  const caseDir = resolve(corpusRoot, safeCategory, safeCaseId);
  if (existsSync(caseDir)) {
    throw new Error(`Corpus case already exists: ${caseDir}`);
  }
  mkdirSync(join(caseDir, "input"), { recursive: true });
  mkdirSync(join(caseDir, "expected"), { recursive: true });
  mkdirSync(join(caseDir, "run"), { recursive: true });
  const expectedRules = (policyDecision.blockingRules || [])
    .filter((rule) => !rule.overridden)
    .map((rule) => rule.ruleId);
  const corpusCase = {
    schemaVersion: 1,
    kind: "meta-harness.corpus-case",
    id: `${safeCategory}/${safeCaseId}`,
    title: title || `Promoted ${policyDecision.decision} run ${policyDecision.runId}`,
    label: "expected-fail",
    category: safeCategory,
    taskClass: spec.taskClass || "unknown",
    source: {
      type: "promoted-run",
      runId: policyDecision.runId,
      promotedAt: now.toISOString()
    },
    privacy: {
      classification: "private-staging",
      sanitized: false,
      containsPrivateData: true,
      allowedForCommit: false,
      note: "Promotion writes metadata only. Minimize and sanitize before committing fixtures."
    },
    fixture: {
      base: "promoted-placeholder"
    },
    mutationFile: "mutation.json",
    expected: {
      decision: policyDecision.decision,
      policyRules: [...new Set(expectedRules)]
    },
    replay: {
      mode: "manual-minimization-required",
      runVerifier: true,
      runPolicy: true
    }
  };
  writeJson(join(caseDir, "case.json"), corpusCase);
  writeJson(join(caseDir, "mutation.json"), {
    schemaVersion: 1,
    kind: "meta-harness.corpus-mutation",
    mutations: []
  });
  writeJson(join(caseDir, "sanitization-report.json"), buildPromotionSanitizationReport({
    corpusCase,
    policyDecision,
    now
  }));
  writeJson(join(caseDir, "expected", "policy-decision.json"), {
    decision: policyDecision.decision,
    policyRules: [...new Set(expectedRules)]
  });
  writeFileSync(join(caseDir, "input", "task.md"), renderPromotedTaskPlaceholder({ policyDecision }));
  writeFileSync(join(caseDir, "run", "README.md"), "Original run artifacts are intentionally not copied. Add a minimized sanitized run fixture here if needed.\n");
  writeFileSync(join(caseDir, "README.md"), renderPromotedReadme({ corpusCase, policyDecision, verifierReport }));
  return {
    caseDir,
    corpusCase
  };
}

function buildPromotionSanitizationReport({ corpusCase, policyDecision, now }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.corpus-sanitization-report",
    caseId: corpusCase.id,
    sourceRunId: policyDecision.runId,
    createdAt: now.toISOString(),
    rawArtifactsCopied: false,
    rawTaskCopied: false,
    sourceEvidenceCopied: false,
    copiedArtifacts: [
      "case.json",
      "mutation.json",
      "expected/policy-decision.json",
      "input/task.md",
      "run/README.md",
      "README.md"
    ],
    omittedSourceArtifacts: [
      "task.md",
      "repo-profile.json",
      "events.jsonl",
      "command-log.jsonl",
      "transcript.jsonl",
      "diff.patch",
      "changed-files.json",
      "runner-state.json",
      "verification.json",
      "verifier-report.json",
      "policy-decision.json",
      "final-report.json",
      "evidence/**"
    ],
    note: "Promotion creates a metadata-only private staging case. Reconstruct a minimized synthetic fixture before marking it sanitized or committing it."
  };
}

function findCaseFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCaseFiles(path));
    } else if (entry.isFile() && entry.name === "case.json") {
      files.push(path);
    }
  }
  return files;
}

function validateCorpusCase(corpusCase) {
  const required = ["schemaVersion", "kind", "id", "title", "label", "category", "privacy", "fixture", "expected"];
  for (const field of required) {
    if (corpusCase[field] === undefined) {
      throw new Error(`Corpus case ${corpusCase.id || "(unknown)"} missing ${field}.`);
    }
  }
  if (corpusCase.schemaVersion !== 1 || corpusCase.kind !== "meta-harness.corpus-case") {
    throw new Error(`Corpus case ${corpusCase.id} has invalid schema marker.`);
  }
  if (!["expected-fail", "expected-pass"].includes(corpusCase.label)) {
    throw new Error(`Corpus case ${corpusCase.id} has invalid label ${corpusCase.label}.`);
  }
  if (
    !corpusCase.privacy.classification ||
    corpusCase.privacy.sanitized !== true ||
    corpusCase.privacy.containsPrivateData !== false ||
    corpusCase.privacy.allowedForCommit !== true
  ) {
    throw new Error(`Corpus case ${corpusCase.id} is not marked as a committed sanitized fixture.`);
  }
  return corpusCase;
}

async function createCorpusFixture({ corpusCase, runRoot }) {
  if (corpusCase.fixture.base === "command-pass") {
    return createCompletedCommandRun({ corpusCase, runRoot });
  }
  if (corpusCase.fixture.base === "browser-pass") {
    return createCompletedBrowserRun({ corpusCase, runRoot });
  }
  throw new Error(`Unsupported corpus fixture base: ${corpusCase.fixture.base}`);
}

async function createCompletedCommandRun({ corpusCase, runRoot }) {
  const repo = makeFixtureRepo({ runRoot, caseId: corpusCase.id, packageJson: { scripts: { test: "node scripts/pass.mjs" }, type: "module" } });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('corpus proof passed');\n");
  writeFileSync(join(repo, "README.md"), "# Corpus Command Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a local internal helper with command proof",
    runId: runIdForCase(corpusCase),
    now: new Date("2026-06-24T09:00:00.000Z")
  }).runDir;
  configureCommandProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runCommandProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir, claimId: "automatedVerification" });
  runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T12:00:00.000Z") });
  return { repo, runDir };
}

async function createCompletedBrowserRun({ corpusCase, runRoot }) {
  const repo = makeFixtureRepo({ runRoot, caseId: corpusCase.id, packageJson: { scripts: {}, type: "module" } });
  mkdirSync(join(repo, "smoke"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "# Corpus Browser Fixture\n");
  writeJson(join(repo, "smoke", "scenario.json"), {
    status: "passed",
    url: "http://127.0.0.1:4173/browse",
    assertions: ["empty state appears", "reset returns visible offerings"],
    screenshotPath: "reset.png",
    tracePath: "reset-trace.zip",
    consoleLogPath: "console.log"
  });
  writeFileSync(join(repo, "smoke", "reset.png"), "fake screenshot bytes\n");
  writeFileSync(join(repo, "smoke", "reset-trace.zip"), "fake trace bytes\n");
  writeFileSync(join(repo, "smoke", "console.log"), "no browser console errors\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a web UI reset flow with browser proof",
    runId: runIdForCase(corpusCase),
    now: new Date("2026-06-24T09:00:00.000Z")
  }).runDir;
  configureBrowserProof(runDir);
  await runFakeCodex({ runDir, scenario: "success", now: new Date("2026-06-24T10:00:00.000Z") });
  await runSurfaceProofExecutor({ runDir, now: new Date("2026-06-24T11:00:00.000Z"), timeoutMs: 1000 });
  writePassingFinalReportFromVerification({ runDir, claimId: "userSmoke" });
  runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T12:00:00.000Z") });
  return { repo, runDir };
}

function makeFixtureRepo({ runRoot, caseId, packageJson }) {
  const repo = join(runRoot, safePathPart(caseId));
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  writeJson(join(repo, "package.json"), packageJson);
  return repo;
}

function applyCorpusMutation({ runDir, mutation }) {
  for (const item of mutation?.mutations || []) {
    if (item.type === "final-report.unknown-evidence") {
      const finalReport = readJson(join(runDir, "final-report.json"));
      const claim = finalReport.claims?.[item.claimId] || Object.values(finalReport.claims || {})[0];
      claim.evidence = [item.evidenceId || "E.fake.missing"];
      writeJson(join(runDir, "final-report.json"), finalReport);
    } else if (item.type === "verification.remove-surface-evidence") {
      const verification = readJson(join(runDir, "verification.json"));
      verification.evidence = [];
      verification.surfaceResults = (verification.surfaceResults || []).map((result) => ({ ...result, evidenceIds: [] }));
      verification.proofObligations = (verification.proofObligations || []).map((proof) => ({ ...proof, status: "pending", evidence: [] }));
      verification.requirementCoverage = (verification.requirementCoverage || []).map((coverage) => ({ ...coverage, status: "pending" }));
      writeJson(join(runDir, "verification.json"), verification);
    } else if (item.type === "changed-files.add-forbidden-env") {
      const changedFiles = readJson(join(runDir, "changed-files.json"));
      changedFiles.files.push({
        path: item.path || ".env",
        status: "modified",
        forbidden: false,
        contentCaptured: false,
        hashBefore: null,
        hashAfter: null,
        bytesBefore: 8,
        bytesAfter: 12
      });
      writeJson(join(runDir, "changed-files.json"), changedFiles);
    } else if (item.type === "verification.pass-after-failed-command") {
      const verification = readJson(join(runDir, "verification.json"));
      const evidenceId = verification.evidence?.[0]?.id || "E.cmd.verify.0001";
      verification.status = "failed";
      if (verification.commands?.[0]) {
        verification.commands[0].status = "failed";
        verification.commands[0].exitCode = 1;
      }
      if (verification.evidence?.[0]) {
        verification.evidence[0].status = "failed";
      }
      if (verification.proofObligations?.[0]) {
        verification.proofObligations[0].status = "failed";
        verification.proofObligations[0].evidence = [];
        verification.proofObligations[0].failedEvidence = [evidenceId];
      }
      if (verification.requirementCoverage?.[0]) {
        verification.requirementCoverage[0].status = "failed";
      }
      writeJson(join(runDir, "verification.json"), verification);
    } else if (item.type === "command-log.move-verify-before-edit") {
      const path = join(runDir, "command-log.jsonl");
      const rows = readJsonl(path).map((row) => {
        if (row.phase === "verify") {
          return {
            ...row,
            startedAt: item.startedAt || "2026-06-24T08:30:00.000Z",
            finishedAt: item.finishedAt || "2026-06-24T08:30:01.000Z"
          };
        }
        return row;
      });
      writeJsonl(path, rows);
    } else if (item.type === "noop") {
      continue;
    } else {
      throw new Error(`Unsupported corpus mutation type: ${item.type}`);
    }
  }
}

function compareExpectedOutcome({ corpusCase, policy, runDir }) {
  const expectedDecision = corpusCase.expected.decision;
  const expectedRules = corpusCase.expected.policyRules || [];
  const activeRules = policy.blockingRules.filter((rule) => !rule.overridden).map((rule) => rule.ruleId);
  const missingRules = expectedRules.filter((ruleId) => !activeRules.includes(ruleId));
  const passed = policy.decision === expectedDecision && missingRules.length === 0;
  return {
    id: corpusCase.id,
    category: corpusCase.category,
    title: corpusCase.title,
    label: corpusCase.label,
    privacyClassification: corpusCase.privacy.classification,
    expectedDecision,
    actualDecision: policy.decision,
    expectedRules,
    activeRules,
    missingRules,
    passed,
    runDir
  };
}

function configureCommandProof(runDir) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = "internal";
  spec.task.class = "internal";
  spec.requirements = [{
    id: "R1",
    text: "The internal helper behavior is covered by command proof.",
    source: "m7-corpus-fixture",
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
    source: "m7-corpus-fixture",
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
  const requirement = verification.requirementCoverage.find((item) => item.status === "passed");
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
  finalReport.residualRisk = ["Corpus fixture uses deterministic local artifacts."];
  finalReport.stillUnenforced = [];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function runIdForCase(corpusCase) {
  return `corpus-${safePathPart(corpusCase.id)}`;
}

function safePathPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderPromotedTaskPlaceholder({ policyDecision }) {
  return `# Promoted Task Placeholder

Source run ${policyDecision.runId} was promoted without copying the original task text.
Create a minimized synthetic task before marking this corpus case sanitized.
`;
}

function renderPromotedReadme({ corpusCase, policyDecision, verifierReport }) {
  return `# ${corpusCase.title}

This is a promoted failure-corpus intake skeleton.

- Source run: ${policyDecision.runId}
- Internal policy decision: ${policyDecision.decision}
- Privacy: ${corpusCase.privacy.classification}
- Sanitized: ${corpusCase.privacy.sanitized}

## Active Policy Rules

${(policyDecision.blockingRules || []).filter((rule) => !rule.overridden).map((rule) => `- ${rule.ruleId}`).join("\n") || "- none"}

## Verifier Findings

${(verifierReport.findings || []).map((finding) => `- ${finding.ruleId}`).join("\n") || "- none"}

## Next Step

Replace this skeleton with a minimized public fixture before committing it.
`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(path) {
  if (!existsSync(path) || statSync(path).size === 0) {
    return [];
  }
  return readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}
