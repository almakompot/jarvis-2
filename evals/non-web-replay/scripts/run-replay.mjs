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
const defaultCasePath = join(repoRoot, "evals/non-web-replay/cases/hungarian-ocr-pipeline/case.json");
const defaultOutputDir = join(repoRoot, "tmp/non-web-replay/hungarian-ocr-pipeline");
const replayMarkerFile = ".non-web-replay-output";

export async function runNonWebReplay({
  casePath = defaultCasePath,
  outputDir = defaultOutputDir,
  keepOutput = false,
  json = false
} = {}) {
  const replayCase = readJson(resolve(casePath));
  const absoluteOutputDir = resolve(outputDir);
  prepareOutputDir({ outputDir: absoluteOutputDir, keepOutput });

  const acceptedRepo = join(absoluteOutputDir, "accepted-repo");
  const weakRepo = join(absoluteOutputDir, "weak-artifact-repo");
  writeFixtureRepo({ repoPath: acceptedRepo });
  writeFixtureRepo({ repoPath: weakRepo });

  const startedAt = new Date("2026-06-24T15:00:00.000Z");
  const accepted = await runAcceptedReplay({
    replayCase,
    repoPath: acceptedRepo,
    runId: replayCase.runId,
    startedAt
  });
  const weakArtifact = await runWeakArtifactReplay({
    replayCase,
    repoPath: weakRepo,
    runId: `${replayCase.runId}-weak-artifact`,
    startedAt: atMinute(startedAt, 20)
  });

  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.non-web-replay-summary",
    caseId: replayCase.id,
    outputDir: absoluteOutputDir,
    accepted,
    weakArtifact
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
  configureRun({ runDir: run.runDir, mode: "accepted" });
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
      message: "Repo profile captured package scripts, CLI entrypoint, fixtures, generated-artifact outputs, and local-only approval boundaries before verification."
    }
  });

  const runner = await runFakeCodex({
    runDir: run.runDir,
    scenario: "data-pipeline-success",
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
      message: "Final report maps data-pipeline requirements to CLI command, invalid-input, artifact-content, cost-boundary, and residual-risk evidence."
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

async function runWeakArtifactReplay({ replayCase, repoPath, runId, startedAt }) {
  const run = initTaskRun({
    repoPath,
    task: replayCase.task.raw,
    runId,
    now: atMinute(startedAt, 0),
    overwrite: true
  });
  configureRun({ runDir: run.runDir, mode: "weak-artifact" });
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
      message: "Repo profile captured the same pipeline surfaces, but this replay intentionally writes weak generated artifacts."
    }
  });

  const runner = await runFakeCodex({
    runDir: run.runDir,
    scenario: "data-pipeline-success",
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

  writeWeakOverclaimReport({ runDir: run.runDir, now: atMinute(startedAt, 5) });
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
      message: "Intentional weak-artifact false pass used to prove generated-file existence alone rejects."
    }
  });

  const verifier = runCompletedRunVerifier({ runDir: run.runDir, now: atMinute(startedAt, 7) });
  const policy = runPolicyEngine({ runDir: run.runDir, now: atMinute(startedAt, 8) });
  const textReport = writeRunReport({ runDir: run.runDir, format: "text" });
  const htmlReport = writeRunReport({ runDir: run.runDir, format: "html" });
  return summarizeRun({
    label: "weak-artifact",
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
      throw new Error(`Refusing to remove unmarked non-web replay output directory: ${outputDir}`);
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, replayMarkerFile), "non-web replay output\n");
}

function writeFixtureRepo({ repoPath }) {
  rmSync(repoPath, { recursive: true, force: true });
  const files = fixtureFiles();
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
    throw new Error(`Failed to initialize synthetic OCR fixture git repo: ${init.stderr || init.stdout}`);
  }
}

function fixtureFiles() {
  return {
    "package.json": `${JSON.stringify({
      name: "synthetic-hungarian-ocr-pipeline",
      version: "0.0.0",
      private: true,
      type: "module",
      bin: {
        "hu-ocr-smoke": "./bin/hu-ocr-smoke.mjs"
      },
      scripts: {
        test: "node scripts/test-pipeline.mjs",
        "smoke:ocr": "node bin/hu-ocr-smoke.mjs --fixture fixtures/good-old-doc.txt --bad-fixture fixtures/missing-text-layer.txt --out tmp/ocr-smoke",
        "smoke:weak": "node bin/hu-ocr-smoke.mjs --fixture fixtures/good-old-doc.txt --bad-fixture fixtures/missing-text-layer.txt --out tmp/ocr-smoke --weak",
        "assert:negative": "node scripts/assert-negative.mjs"
      }
    }, null, 2)}\n`,
    "AGENTS.md": [
      "# Synthetic Hungarian OCR Fixture",
      "",
      "Use local fixture scripts only. Do not call paid OCR APIs, deploy, publish, send messages, or read env files.",
      "The requested user surface is the local data-pipeline CLI and its generated manifest/artifacts."
    ].join("\n") + "\n",
    "docs/approval-boundary.md": [
      "# Approval Boundary",
      "",
      "This fixture is local-only. It must not call external OCR APIs, spend money, mutate live data, deploy, publish, or require human approval for the smoke run.",
      "",
      "The generated manifest records `cost.externalApiCalls = 0` and `approval.required = false` as proof."
    ].join("\n") + "\n",
    "fixtures/good-old-doc.txt": [
      "DOCUMENT_ID=hu-old-doc-001",
      "TEXT_LAYER=true",
      "Arvizturo tukorfurogep is preserved as searchable text layer evidence.",
      "The old Hungarian document fixture contains enough plain text for local OCR smoke validation."
    ].join("\n") + "\n",
    "fixtures/missing-text-layer.txt": [
      "DOCUMENT_ID=hu-old-doc-002",
      "TEXT_LAYER=false",
      ""
    ].join("\n"),
    "src/ocr-quality.mjs": ocrQualitySource(),
    "bin/hu-ocr-smoke.mjs": ocrSmokeCliSource(),
    "scripts/test-pipeline.mjs": testPipelineSource(),
    "scripts/assert-negative.mjs": assertNegativeSource()
  };
}

function ocrQualitySource() {
  return [
    "export function parseFixture(text) {",
    "  const lines = String(text).split(/\\r?\\n/);",
    "  const meta = {};",
    "  const body = [];",
    "  for (const line of lines) {",
    "    const match = /^([A-Z_]+)=(.*)$/.exec(line);",
    "    if (match) {",
    "      meta[match[1]] = match[2];",
    "    } else if (line.trim()) {",
    "      body.push(line.trim());",
    "    }",
    "  }",
    "  return {",
    "    documentId: meta.DOCUMENT_ID || 'unknown-doc',",
    "    textLayer: meta.TEXT_LAYER === 'true',",
    "    body: body.join(' ')",
    "  };",
    "}",
    "",
    "export function tokenize(text) {",
    "  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter(Boolean);",
    "}",
    "",
    "export function validateSearchableText(parsed) {",
    "  const tokens = tokenize(parsed.body);",
    "  return {",
    "    searchable: parsed.textLayer && parsed.body.length >= 40 && tokens.length >= 8,",
    "    characters: parsed.textLayer ? parsed.body.length : 0,",
    "    tokenCount: parsed.textLayer ? tokens.length : 0,",
    "    tokens",
    "  };",
    "}",
    "",
    "export function buildSearchIndex(parsed) {",
    "  const quality = validateSearchableText(parsed);",
    "  return {",
    "    documentId: parsed.documentId,",
    "    searchable: quality.searchable,",
    "    tokens: quality.tokens.slice(0, 12),",
    "    searchableText: parsed.body",
    "  };",
    "}"
  ].join("\n") + "\n";
}

function ocrSmokeCliSource() {
  return [
    "#!/usr/bin/env node",
    "",
    "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { buildSearchIndex, parseFixture, validateSearchableText } from '../src/ocr-quality.mjs';",
    "",
    "const args = parseArgs(process.argv.slice(2));",
    "const outDir = args.out || 'tmp/ocr-smoke';",
    "mkdirSync(outDir, { recursive: true });",
    "mkdirSync(join(outDir, 'bad'), { recursive: true });",
    "",
    "const good = parseFixture(readFileSync(args.fixture, 'utf8'));",
    "const bad = parseFixture(readFileSync(args.badFixture, 'utf8'));",
    "const goodQuality = validateSearchableText(good);",
    "const badQuality = validateSearchableText(bad);",
    "const weak = args.weak === true;",
    "",
    "const searchableText = weak ? 'placeholder output without OCR text layer evidence\\n' : `Searchable text layer for ${good.documentId}: ${good.body}\\n`;",
    "const searchIndex = weak ? { documentId: good.documentId, searchable: false, tokens: [], searchableText: '' } : buildSearchIndex(good);",
    "const manifest = {",
    "  schemaVersion: 1,",
    "  status: 'passed',",
    "  fixture: args.fixture,",
    "  output: {",
    "    searchableTextPath: 'searchable.txt',",
    "    searchIndexPath: 'search-index.json'",
    "  },",
    "  textLayer: {",
    "    searchable: weak ? false : goodQuality.searchable,",
    "    characters: weak ? 0 : goodQuality.characters,",
    "    tokenCount: weak ? 0 : goodQuality.tokenCount",
    "  },",
    "  invalidFixture: {",
    "    status: badQuality.searchable ? 'passed' : 'rejected',",
    "    reason: badQuality.searchable ? null : 'missing-text-layer',",
    "    manifestPath: 'bad/manifest.json'",
    "  },",
    "  cost: {",
    "    mode: 'local-fixture',",
    "    externalApiCalls: 0,",
    "    externalApiCostUsd: 0",
    "  },",
    "  approval: {",
    "    required: false,",
    "    reason: 'local fixture pipeline only'",
    "  }",
    "};",
    "const badManifest = {",
    "  schemaVersion: 1,",
    "  status: manifest.invalidFixture.status,",
    "  reason: manifest.invalidFixture.reason,",
    "  fixture: args.badFixture,",
    "  textLayer: { searchable: badQuality.searchable, characters: badQuality.characters },",
    "  cost: { externalApiCalls: 0 },",
    "  approval: { required: false }",
    "};",
    "",
    "writeFileSync(join(outDir, 'searchable.txt'), searchableText);",
    "writeFileSync(join(outDir, 'search-index.json'), `${JSON.stringify(searchIndex, null, 2)}\\n`);",
    "writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\\n`);",
    "writeFileSync(join(outDir, 'bad', 'manifest.json'), `${JSON.stringify(badManifest, null, 2)}\\n`);",
    "",
    "console.log(weak ? 'ok - weak placeholder artifacts written' : 'ok - generated searchable text layer and search index');",
    "console.log(`invalid-fixture=${badManifest.status}:${badManifest.reason}`);",
    "console.log('external-api-calls=0');",
    "",
    "function parseArgs(argv) {",
    "  const parsed = {};",
    "  for (let index = 0; index < argv.length; index += 1) {",
    "    const item = argv[index];",
    "    if (item === '--fixture') parsed.fixture = argv[++index];",
    "    else if (item === '--bad-fixture') parsed.badFixture = argv[++index];",
    "    else if (item === '--out') parsed.out = argv[++index];",
    "    else if (item === '--weak') parsed.weak = true;",
    "    else throw new Error(`Unknown argument: ${item}`);",
    "  }",
    "  if (!parsed.fixture || !parsed.badFixture) {",
    "    throw new Error('--fixture and --bad-fixture are required');",
    "  }",
    "  return parsed;",
    "}"
  ].join("\n") + "\n";
}

function testPipelineSource() {
  return [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import { buildSearchIndex, parseFixture, validateSearchableText } from '../src/ocr-quality.mjs';",
    "",
    "const good = parseFixture(readFileSync('fixtures/good-old-doc.txt', 'utf8'));",
    "const bad = parseFixture(readFileSync('fixtures/missing-text-layer.txt', 'utf8'));",
    "const goodQuality = validateSearchableText(good);",
    "const badQuality = validateSearchableText(bad);",
    "const index = buildSearchIndex(good);",
    "",
    "assert.equal(good.documentId, 'hu-old-doc-001');",
    "assert.equal(goodQuality.searchable, true);",
    "assert.ok(goodQuality.characters >= 40);",
    "assert.ok(index.tokens.includes('arvizturo'));",
    "assert.equal(badQuality.searchable, false);",
    "assert.equal(badQuality.characters, 0);",
    "console.log('ok - OCR quality helpers preserve searchable text and token evidence');"
  ].join("\n") + "\n";
}

function assertNegativeSource() {
  return [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "",
    "const manifest = JSON.parse(readFileSync('tmp/ocr-smoke/manifest.json', 'utf8'));",
    "const bad = JSON.parse(readFileSync('tmp/ocr-smoke/bad/manifest.json', 'utf8'));",
    "",
    "assert.equal(manifest.invalidFixture.status, 'rejected');",
    "assert.equal(manifest.invalidFixture.reason, 'missing-text-layer');",
    "assert.equal(bad.status, 'rejected');",
    "assert.equal(bad.reason, 'missing-text-layer');",
    "assert.equal(manifest.cost.externalApiCalls, 0);",
    "assert.equal(manifest.approval.required, false);",
    "assert.equal(bad.cost.externalApiCalls, 0);",
    "assert.equal(bad.approval.required, false);",
    "console.log('ok - missing text-layer fixture rejected without external OCR cost or approval');"
  ].join("\n") + "\n";
}

function configureRun({ runDir, mode }) {
  const specPath = join(runDir, "spec.json");
  const proofPlanPath = join(runDir, "proof-plan.json");
  const spec = readJson(specPath);
  const proofPlan = readJson(proofPlanPath);
  const smokeCommand = mode === "weak-artifact" ? "npm run smoke:weak" : "npm run smoke:ocr";

  spec.taskClass = "data-pipeline";
  spec.task.class = "data-pipeline";
  spec.task.title = "Hungarian OCR searchable text-layer smoke";
  spec.requirements = [
    {
      id: "R1",
      text: "Inspect the local OCR pipeline package scripts, CLI entrypoint, fixtures, and approval boundary before implementation claims.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P1"]
    },
    {
      id: "R2",
      text: "The real local pipeline CLI runs on the Hungarian old-doc fixture and generates searchable text, search index, and manifest artifacts.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P2", "P4"]
    },
    {
      id: "R3",
      text: "A missing-text-layer invalid fixture is rejected explicitly with status and reason evidence.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P2", "P3", "P4"]
    },
    {
      id: "R4",
      text: "Generated artifacts are validated for searchable content and manifest values, not just file existence.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P4"]
    },
    {
      id: "R5",
      text: "The smoke records that no external OCR API cost, live data mutation, or human approval is used.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P2", "P4"]
    },
    {
      id: "R6",
      text: "Final report maps requirements to CLI, negative-input, artifact-content, and residual-risk evidence.",
      source: "goal-15:data-pipeline",
      proofObligationIds: ["P5"]
    }
  ];
  spec.proofObligations = [
    { id: "P1", requirementIds: ["R1"] },
    { id: "P2", requirementIds: ["R2", "R3", "R5"] },
    { id: "P3", requirementIds: ["R3"] },
    { id: "P4", requirementIds: ["R2", "R3", "R4", "R5"] },
    { id: "P5", requirementIds: ["R6"] }
  ];
  spec.requiredTests = [
    {
      id: "T1",
      type: "repo-native-check",
      command: "npm run test",
      description: "Validate OCR quality helper behavior on searchable and missing text-layer fixtures.",
      requirementIds: ["R2", "R3"]
    },
    {
      id: "T2",
      type: "repo-native-check",
      command: smokeCommand,
      description: "Invoke the actual local OCR pipeline CLI to generate manifest, searchable text, search index, and invalid-fixture artifacts.",
      requirementIds: ["R2", "R3", "R5"]
    },
    {
      id: "T3",
      type: "negative-or-edge-path",
      command: "npm run assert:negative",
      description: "Assert the missing-text-layer fixture is rejected and the run records zero external OCR calls and no approval requirement.",
      requirementIds: ["R3", "R5"]
    }
  ];
  spec.userFlows = [{
    id: "F1",
    name: "Run OCR fixture pipeline and verify generated evidence",
    steps: [
      "Run the local OCR pipeline CLI against fixtures/good-old-doc.txt.",
      "Generate searchable text, search-index, and manifest artifacts under tmp/ocr-smoke.",
      "Run the missing-text-layer fixture and write a rejected invalid-fixture manifest.",
      "Validate manifest values and generated artifact contents."
    ],
    negativePath: "Run a missing-text-layer fixture and verify rejected status, reason, zero external calls, and no approval requirement.",
    expectedOutcome: "The local data-pipeline proof validates actual generated content and rejects placeholder artifacts."
  }];
  spec.nonRequirements = [
    "No real OCR API is called.",
    "No production data, deployment, publish, send, or live mutation is performed.",
    "No PDF rendering fidelity beyond searchable text-layer evidence is claimed."
  ];
  spec.risks = [
    {
      id: "risk.local-fixture-only",
      text: "The replay proves local fixture behavior, not OCR quality across all historical documents.",
      mitigation: "Record fixture scope and require residual risk in final report."
    },
    {
      id: "risk.cost-boundary",
      text: "OCR/data tasks can accidentally call paid APIs.",
      mitigation: "Fixture scripts record zero external calls and approval.required=false; command guard blocks deploy/publish/send/live actions."
    }
  ];
  spec.manualSmoke = {
    id: "manual.data-pipeline.review",
    instructions: "Inspect tmp/ocr-smoke/manifest.json, searchable.txt, search-index.json, and bad/manifest.json if automated proof is disputed."
  };
  spec.repoSignals = {
    ...(spec.repoSignals || {}),
    inferredTaskCues: ["data-pipeline"],
    availableScripts: ["test", "smoke:ocr", "smoke:weak", "assert:negative"],
    targetSurfaces: ["data-pipeline-cli", "generated-artifacts", "manifest-status-output"],
    expectedOutputs: ["searchable text artifact", "search index JSON", "manifest JSON", "invalid fixture manifest"],
    edgePaths: ["missing text-layer fixture rejection"]
  };

  proofPlan.taskClass = "data-pipeline";
  proofPlan.obligations = [
    {
      id: "P1",
      statement: "Repository inspection happened before implementation edits.",
      requirementIds: ["R1"],
      acceptedEvidenceTypes: ["repo-profile", "inspection-command", "file-read"],
      minimumEvidence: 1,
      status: "pending"
    },
    {
      id: "P2",
      statement: "Local pipeline tests and smoke commands invoke the real CLI/pipeline after inspection.",
      requirementIds: ["R2", "R3", "R5"],
      acceptedEvidenceTypes: ["test-command", "build-command", "lint-command", "typecheck-command"],
      minimumEvidence: 1,
      status: "pending"
    },
    {
      id: "P3",
      statement: "The missing-text-layer invalid fixture is exercised and rejected.",
      requirementIds: ["R3"],
      acceptedEvidenceTypes: ["negative-test-command", "data-fixture", "manual-smoke-artifact"],
      minimumEvidence: 1,
      status: "pending"
    },
    {
      id: "P4",
      statement: "The data-pipeline runnable surface is exercised and generated artifacts are content-validated.",
      requirementIds: ["R2", "R3", "R4", "R5"],
      acceptedEvidenceTypes: ["data-fixture", "generated-artifact", "manifest"],
      minimumEvidence: 1,
      status: "pending"
    },
    {
      id: "P5",
      statement: "Final report maps every requirement to evidence and residual risk.",
      requirementIds: ["R6"],
      acceptedEvidenceTypes: ["final-report"],
      minimumEvidence: 1,
      status: "pending"
    }
  ];
  proofPlan.requirementCoverage = spec.requirements.map((requirement) => ({
    requirementId: requirement.id,
    proofObligationIds: requirement.proofObligationIds
  }));
  proofPlan.surfaceProofs = [{
    id: "surface-hungarian-ocr-data-fixture",
    handler: "data",
    evidenceType: "data-fixture",
    proofObligationIds: ["P3", "P4"],
    requirementIds: ["R2", "R3", "R4", "R5"],
    expectedArtifacts: [
      "tmp/ocr-smoke/searchable.txt",
      "tmp/ocr-smoke/search-index.json",
      "tmp/ocr-smoke/bad/manifest.json"
    ],
    manifestPath: "tmp/ocr-smoke/manifest.json",
    requiredManifestFields: [
      "status",
      "textLayer.searchable",
      "textLayer.characters",
      "invalidFixture.status",
      "invalidFixture.reason",
      "cost.externalApiCalls",
      "approval.required"
    ],
    manifestAssertions: [
      { path: "status", equals: "passed" },
      { path: "textLayer.searchable", equals: true },
      { path: "textLayer.characters", min: 40 },
      { path: "invalidFixture.status", equals: "rejected" },
      { path: "invalidFixture.reason", equals: "missing-text-layer" },
      { path: "cost.externalApiCalls", equals: 0 },
      { path: "cost.externalApiCostUsd", equals: 0 },
      { path: "approval.required", equals: false }
    ],
    artifactAssertions: [
      { path: "tmp/ocr-smoke/searchable.txt", includes: ["Searchable text layer", "Arvizturo tukorfurogep"] },
      { path: "tmp/ocr-smoke/search-index.json", jsonPath: "documentId", equals: "hu-old-doc-001" },
      { path: "tmp/ocr-smoke/search-index.json", jsonPath: "searchable", equals: true },
      { path: "tmp/ocr-smoke/search-index.json", jsonPath: "tokens.0", equals: "arvizturo" },
      { path: "tmp/ocr-smoke/bad/manifest.json", jsonPath: "status", equals: "rejected" },
      { path: "tmp/ocr-smoke/bad/manifest.json", jsonPath: "reason", equals: "missing-text-layer" }
    ],
    description: "Validate the local OCR pipeline artifacts beyond existence, including searchable text, search index, invalid fixture status, and cost/approval boundaries."
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
    const status = failed.length > 0
      ? "failed"
      : blocked.length > 0
        ? "blocked"
        : passed.length >= obligation.minimumEvidence
          ? "passed"
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
  verification.scope = "non-web-replay-full-pipeline";
  verification.updatedAt = now.toISOString();
  verification.summary = {
    ...(verification.summary || {}),
    replayBridgeEvidence: (verification.evidence || []).filter((item) => item.id.startsWith("E.repo-profile.") || item.id.startsWith("E.final-report.")).length,
    note: "Non-web replay recomputed after bridge evidence for repo inspection and final report."
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
  const artifactEvidence = evidenceForProofs(["P3", "P4"]);
  writeJson(join(runDir, "final-report.json"), {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId: spec.runId,
    createdAt: now.toISOString(),
    outcome: "passed",
    summary: "Hungarian OCR data-pipeline replay passed with real local CLI execution, invalid-input rejection, generated-artifact content validation, and zero external OCR cost evidence.",
    claims: {
      cliPipelineRun: passedClaim(["R2", "R3", "R5"], ["P2"], evidenceForProofs(["P2"]), "The local pipeline CLI and helper checks ran through npm scripts."),
      invalidFixtureRejected: passedClaim(["R3"], ["P3"], evidenceForProofs(["P3"]), "The missing-text-layer fixture was rejected with status and reason evidence."),
      generatedArtifactsValidated: passedClaim(["R2", "R4"], ["P4"], artifactEvidence, "Searchable text, search index JSON, manifest values, and invalid-fixture manifest were validated beyond existence."),
      costApprovalBoundary: passedClaim(["R5"], ["P4"], artifactEvidence, "Manifest evidence records zero external OCR calls, zero external cost, and no approval requirement."),
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
      "Replay uses a small public synthetic fixture rather than a broad historical OCR corpus.",
      "The artifact proof validates searchable text-layer evidence, not full PDF rendering fidelity."
    ],
    stillUnenforced: [
      "Future hardening should add reusable data-pipeline adapters for richer PDF and OCR quality metrics."
    ]
  });
}

function writeWeakOverclaimReport({ runDir, now }) {
  const spec = readJson(join(runDir, "spec.json"));
  const verification = readJson(join(runDir, "verification.json"));
  const passedEvidence = (verification.evidence || []).filter((evidence) => evidence.status === "passed").map((evidence) => evidence.id);
  writeJson(join(runDir, "final-report.json"), {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId: spec.runId,
    createdAt: now.toISOString(),
    outcome: "passed",
    summary: "Intentional false pass: generated files exist, but searchable text-layer content assertions failed.",
    claims: {
      weakArtifactClaim: {
        status: "passed",
        requirementIds: ["R2", "R4"],
        proofObligationIds: ["P2", "P4"],
        evidence: passedEvidence,
        summary: "This intentionally overclaims data-pipeline correctness from file existence and command success."
      }
    },
    proofObligations: Object.fromEntries((verification.proofObligations || []).map((proof) => [
      proof.id,
      { status: proof.status, evidence: proof.evidence || [] }
    ])),
    requirementResults: verification.requirementCoverage || [],
    residualRisk: [
      "This run intentionally lacks valid searchable text-layer content and must be rejected."
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
    activePolicyRules: [...new Set(policy.blockingRules.filter((rule) => !rule.overridden).map((rule) => rule.ruleId))],
    validationPassed: validation.passed,
    validationErrors: validation.errors.map((error) => error.id),
    evidenceTypes: [...new Set((verification.evidence || []).map((item) => item.type))].sort(),
    passedEvidenceTypes: [...new Set((verification.evidence || []).filter((item) => item.status === "passed").map((item) => item.type))].sort(),
    passedSurfaceEvidenceTypes: [...new Set((verification.evidence || []).filter((item) => item.status === "passed" && item.surfaceResultId).map((item) => item.type))].sort(),
    failedSurfaceReasons: [...new Set((verification.surfaceResults || []).filter((item) => item.status === "failed").map((item) => item.reason).filter(Boolean))].sort(),
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
  const weakExpected = replayCase.expected.weakArtifact;
  const weakArtifact = summary.weakArtifact;
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
  for (const type of acceptedExpected.requiredSurfaceEvidenceTypes || []) {
    if (!accepted.passedSurfaceEvidenceTypes.includes(type)) {
      failures.push(`accepted run missing passing surface evidence type ${type}`);
    }
  }
  if (weakArtifact.verificationStatus !== weakExpected.verificationStatus) {
    failures.push(`weak-artifact verification status ${weakArtifact.verificationStatus} != ${weakExpected.verificationStatus}`);
  }
  if (weakArtifact.policyDecision !== weakExpected.policyDecision) {
    failures.push(`weak-artifact policy decision ${weakArtifact.policyDecision} != ${weakExpected.policyDecision}`);
  }
  for (const ruleId of weakExpected.requiredPolicyRules || []) {
    if (!weakArtifact.activePolicyRules.includes(ruleId)) {
      failures.push(`weak-artifact run missing policy rule ${ruleId}`);
    }
  }
  if (!weakArtifact.failedSurfaceReasons.includes(weakExpected.requiredSurfaceReason)) {
    failures.push(`weak-artifact run missing surface failure reason ${weakExpected.requiredSurfaceReason}`);
  }
  if (weakArtifact.passedSurfaceEvidenceTypes.includes("data-fixture")) {
    failures.push("weak-artifact run unexpectedly produced passing surface data-fixture evidence");
  }
  if (failures.length > 0) {
    throw new Error(`Non-web replay failed acceptance:\n- ${failures.join("\n- ")}`);
  }
}

function printSummary(summary) {
  process.stdout.write([
    `case: ${summary.caseId}`,
    `accepted run: ${summary.accepted.runId}`,
    `accepted policy: ${summary.accepted.policyDecision}`,
    `accepted report: ${summary.accepted.reports.text}`,
    `weak-artifact run: ${summary.weakArtifact.runId}`,
    `weak-artifact policy: ${summary.weakArtifact.policyDecision}`,
    `weak-artifact rules: ${summary.weakArtifact.activePolicyRules.join(", ")}`,
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
    const summary = await runNonWebReplay(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
