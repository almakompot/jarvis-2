import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { runCodexCli } from "./codex-runner.mjs";
import { runCommandProofExecutor } from "./command-executor.mjs";
import { promoteFailureRun } from "./corpus-manager.mjs";
import { runPolicyEngine } from "./policy-engine.mjs";
import { runSurfaceProofExecutor } from "./surface-executor.mjs";
import { initTaskRun } from "./task-packet.mjs";
import { appendJsonl, readJson, writeJson } from "./runner-utils.mjs";
import { runCompletedRunVerifier } from "./verifier.mjs";

const reportJsonArtifacts = [
  "spec.json",
  "proof-plan.json",
  "verification.json",
  "verifier-report.json",
  "policy-decision.json",
  "final-report.json"
];

export function renderRunReport({ runDir, format = "text" } = {}) {
  const state = loadReportState(runDir);
  if (format === "text") {
    return renderTextReport(state);
  }
  if (format === "html") {
    return renderHtmlReport(state);
  }
  throw new Error("--format must be text or html");
}

export function writeRunReport({ runDir, format = "text", outputPath = null } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const report = renderRunReport({ runDir: absoluteRunDir, format });
  const target = outputPath
    ? resolve(outputPath)
    : format === "html"
      ? join(absoluteRunDir, "html-report", "index.html")
      : join(absoluteRunDir, "report.txt");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, report);
  return { report, outputPath: target };
}

export async function runMetaCommand({ runDir, executable = "codex", sandbox = "workspace-write", codexArgs = [], dryRun = false, fake = false, scenario = "success", timeoutMs = 120000 } = {}) {
  if (fake) {
    return runFakeMetaCommand({ runDir, scenario, timeoutMs });
  }
  return runCodexCli({
    runDir,
    executable,
    sandbox,
    extraArgs: codexArgs,
    dryRun,
    totalTimeoutMs: timeoutMs
  });
}

export async function runVerifyPipeline({
  runDir,
  commandTimeoutMs = 30000,
  surfaceTimeoutMs = 30000,
  skipCommands = false,
  skipSurfaces = false,
  skipVerifier = false,
  skipPolicy = false
} = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const steps = [];

  if (!skipCommands) {
    const command = await runCommandProofExecutor({ runDir: absoluteRunDir, timeoutMs: commandTimeoutMs });
    steps.push({ name: "commands", status: command.status, count: command.commandResults.length });
  }
  if (!skipSurfaces) {
    const surface = await runSurfaceProofExecutor({ runDir: absoluteRunDir, timeoutMs: surfaceTimeoutMs });
    steps.push({ name: "surfaces", status: surface.status, count: surface.surfaceResults.length });
  }
  if (!skipVerifier) {
    const verifier = runCompletedRunVerifier({ runDir: absoluteRunDir });
    steps.push({ name: "verifier", status: verifier.status, count: verifier.findings.length });
  }
  let policy = null;
  if (!skipPolicy) {
    policy = runPolicyEngine({ runDir: absoluteRunDir });
    steps.push({ name: "policy", status: policy.decision, count: policy.blockingRules.filter((rule) => !rule.overridden).length });
  }

  return {
    runDir: absoluteRunDir,
    status: policy?.decision || steps.at(-1)?.status || "not-run",
    steps,
    policy
  };
}

export function createRerun({ fromRunDir, runId = null, now = new Date() } = {}) {
  const absoluteFromRunDir = resolveRunDir(fromRunDir);
  const spec = readJson(join(absoluteFromRunDir, "spec.json"));
  const repoPath = spec.repo?.path;
  if (!repoPath) {
    throw new Error("Cannot rerun: spec.json does not contain repo.path");
  }
  const parentRunId = spec.runId || basename(absoluteFromRunDir);
  const childRunId = runId || `${parentRunId}-rerun-${compactTimestamp(now)}`;
  const result = initTaskRun({
    repoPath,
    task: spec.task?.raw || spec.task?.summary || "Rerun task from parent run",
    runId: childRunId,
    now
  });
  const parent = {
    schemaVersion: 1,
    kind: "meta-harness.parent-run",
    runId: childRunId,
    parentRunId,
    parentRunDir: absoluteFromRunDir,
    createdAt: now.toISOString(),
    reason: "Created by M8 rerun command."
  };
  writeJson(join(result.runDir, "parent-run.json"), parent);
  appendJsonl(join(result.runDir, "events.jsonl"), [{
    id: `event.rerun.${Date.parse(now.toISOString())}`,
    type: "rerun-created",
    phase: "init",
    status: "passed",
    timestamp: now.toISOString(),
    artifact: "parent-run.json",
    message: `Child run created from ${parentRunId}.`
  }]);
  return {
    runId: childRunId,
    runDir: result.runDir,
    parentRunId,
    parentRunDir: absoluteFromRunDir
  };
}

export function cleanupRuns({ repoPath, dryRun = true } = {}) {
  if (!repoPath) {
    throw new Error("--repo is required");
  }
  const repo = resolve(repoPath);
  const runRoot = join(repo, ".task-runs");
  if (!existsSync(runRoot)) {
    return { repoPath: repo, runRoot, dryRun, candidates: [], deleted: [] };
  }
  assertInsideRepoRunRoot({ repo, runRoot });
  const candidates = readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runRoot, entry.name))
    .filter((candidate) => isHarnessRunDir(candidate))
    .sort();
  const deleted = [];
  if (!dryRun) {
    for (const candidate of candidates) {
      assertInsideRepoRunRoot({ repo, runRoot: dirname(candidate) });
      rmSync(candidate, { recursive: true, force: true });
      deleted.push(candidate);
    }
  }
  return { repoPath: repo, runRoot, dryRun, candidates, deleted };
}

export function promoteFailureFromCli(args) {
  return promoteFailureRun(args);
}

export function loadReportState(runDir) {
  const absoluteRunDir = resolveRunDir(runDir);
  const json = {};
  const missing = [];
  for (const artifact of reportJsonArtifacts) {
    const path = join(absoluteRunDir, artifact);
    if (!existsSync(path)) {
      missing.push(artifact);
      continue;
    }
    json[artifact] = readJson(path);
  }
  for (const artifact of ["command-log.jsonl", "diff.patch", "changed-files.json"]) {
    const path = join(absoluteRunDir, artifact);
    if (!existsSync(path)) {
      missing.push(artifact);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required report artifact(s): ${missing.join(", ")}`);
  }
  return {
    runDir: absoluteRunDir,
    runId: json["policy-decision.json"].runId || json["spec.json"].runId || basename(absoluteRunDir),
    spec: json["spec.json"],
    proofPlan: json["proof-plan.json"],
    verification: json["verification.json"],
    verifierReport: json["verifier-report.json"],
    policyDecision: json["policy-decision.json"],
    finalReport: json["final-report.json"],
    commandLog: readJsonl(join(absoluteRunDir, "command-log.jsonl")),
    changedFiles: readJson(join(absoluteRunDir, "changed-files.json")),
    diffPatch: readFileSync(join(absoluteRunDir, "diff.patch"), "utf8")
  };
}

function renderTextReport(state) {
  const activeRules = activePolicyRules(state);
  const findings = reportFindings(state);
  const commandGroups = commandGroupsFromVerification(state);
  const missingProof = missingProofItems(state);
  const evidence = evidenceItems(state);
  const residualRisk = residualRiskItems(state);
  const nextActions = nextActionsFor({ state, activeRules, missingProof });
  return [
    "Findings:",
    ...bulletLines(findings.map(formatFinding), "none"),
    `Decision: ${state.policyDecision.decision}`,
    `Blocking reason: ${state.policyDecision.decision === "accepted" ? "none" : state.policyDecision.decisionReason || "see findings"}`,
    `Run: ${state.runId}`,
    `Task: ${state.spec.task?.title || state.spec.task?.summary || state.spec.task?.raw || "(unknown)"}`,
    "Policy rules:",
    ...bulletLines(activeRules.map((rule) => `${rule.ruleId}: ${rule.message}`), "none active"),
    "Passed commands:",
    ...bulletLines(commandGroups.passed.map(formatCommand), "none"),
    "Failed commands:",
    ...bulletLines(commandGroups.failed.map(formatCommand), "none"),
    "Missing proof:",
    ...bulletLines(missingProof.map(formatMissingProof), "none"),
    "Evidence:",
    ...bulletLines(evidence.map((item) => formatEvidence({ state, item })), "none"),
    "Residual risk:",
    ...bulletLines(residualRisk, "none recorded"),
    "Next action:",
    ...bulletLines(nextActions, "none"),
    ""
  ].join("\n");
}

function renderHtmlReport(state) {
  const textReport = renderTextReport(state);
  const evidence = evidenceItems(state);
  const evidenceLinks = evidence.map((item) => {
    const href = htmlEscape(relativePathFromRun(state.runDir, primaryEvidencePath(item) || "verification.json"));
    return `<li><a href="../${href}">${htmlEscape(item.id)}</a> ${htmlEscape(item.type || "evidence")} ${htmlEscape(item.status || "unknown")}</li>`;
  }).join("\n") || "<li>none</li>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Meta Harness Report ${htmlEscape(state.runId)}</title>
  <style>
    body { font: 14px/1.5 system-ui, sans-serif; margin: 32px; color: #17202a; }
    pre { background: #f6f8fa; padding: 16px; overflow: auto; }
    a { color: #0b57d0; }
  </style>
</head>
<body>
  <h1>Meta Harness Report: ${htmlEscape(state.runId)}</h1>
  <p><strong>Decision:</strong> ${htmlEscape(state.policyDecision.decision)}</p>
  <h2>Evidence Links</h2>
  <ul>
${evidenceLinks}
  </ul>
  <h2>Text Report</h2>
  <pre>${htmlEscape(textReport)}</pre>
</body>
</html>
`;
}

function activePolicyRules(state) {
  return (state.policyDecision.blockingRules || []).filter((rule) => !rule.overridden);
}

function reportFindings(state) {
  const activeRules = activePolicyRules(state).map((rule) => ({
    severity: rule.severity || "blocking",
    ruleId: rule.ruleId,
    message: rule.message,
    evidence: rule.evidence || []
  }));
  if (activeRules.length > 0) {
    return activeRules;
  }
  return (state.verifierReport.findings || [])
    .filter((finding) => ["blocking", "major"].includes(finding.severity))
    .map((finding) => ({
      severity: finding.severity,
      ruleId: finding.ruleId,
      message: finding.message,
      evidence: finding.evidence || []
    }));
}

function formatFinding(finding) {
  const evidence = finding.evidence?.length ? ` Evidence: ${finding.evidence.join(", ")}` : "";
  return `[${finding.severity}] ${finding.ruleId}: ${finding.message}${evidence}`;
}

function commandGroupsFromVerification(state) {
  const commands = state.verification.commands || [];
  return {
    passed: commands.filter((command) => command.status === "passed"),
    failed: commands.filter((command) => ["failed", "timed-out", "blocked"].includes(command.status))
  };
}

function formatCommand(command) {
  const exit = command.exitCode === undefined || command.exitCode === null ? "exit unknown" : `exit ${command.exitCode}`;
  const stdout = command.stdoutPath ? ` stdout ${command.stdoutPath}` : "";
  return `${command.id} ${command.command || "(command unavailable)"} (${command.status}, ${exit})${stdout}`;
}

function missingProofItems(state) {
  const proofs = state.verification.proofObligations || [];
  const byId = new Map((state.proofPlan.obligations || []).map((proof) => [proof.id, proof]));
  return proofs
    .filter((proof) => proof.status !== "passed")
    .map((proof) => ({
      id: proof.id,
      status: proof.status || "unknown",
      statement: byId.get(proof.id)?.statement || "proof obligation",
      acceptedEvidenceTypes: byId.get(proof.id)?.acceptedEvidenceTypes || []
    }));
}

function formatMissingProof(proof) {
  const types = proof.acceptedEvidenceTypes.length ? ` (${proof.acceptedEvidenceTypes.join(", ")})` : "";
  return `${proof.id} ${proof.status}: ${proof.statement}${types}`;
}

function evidenceItems(state) {
  return state.verification.evidence || [];
}

function formatEvidence({ state, item }) {
  const path = primaryEvidencePath(item);
  const relativePath = path ? relativePathFromRun(state.runDir, path) : null;
  const artifacts = Array.isArray(item.artifacts)
    ? item.artifacts.map((artifact) => artifact?.path).filter(Boolean)
    : [];
  const more = artifacts.length ? ` artifacts ${artifacts.map((artifact) => relativePathFromRun(state.runDir, artifact)).join(", ")}` : "";
  return `${item.id} ${item.type || "evidence"} ${item.status || "unknown"}${relativePath ? ` -> ${relativePath}` : ""}${more}`;
}

function primaryEvidencePath(item) {
  return item.path || item.stdoutPath || item.stderrPath || item.artifacts?.find((artifact) => artifact?.path)?.path || null;
}

function residualRiskItems(state) {
  return Array.isArray(state.finalReport.residualRisk) ? state.finalReport.residualRisk : [];
}

function nextActionsFor({ state, activeRules, missingProof }) {
  if (state.policyDecision.decision === "accepted") {
    return ["Archive the run artifacts and keep residual risk visible in handoff notes."];
  }
  if (state.policyDecision.decision === "blocked") {
    return ["User/operator: resolve the blocking condition, then run `meta verify --run <run-dir>` again."];
  }
  if (missingProof.length > 0) {
    return ["Agent/harness repair: add the missing proof evidence, then run `meta verify --run <run-dir>` again."];
  }
  if (activeRules.some((rule) => rule.ruleId === "POL-HONESTY-001" || rule.ruleId === "POL-HONESTY-002")) {
    return ["Agent/harness repair: fix the evidence/final-report mismatch, rerun verifier and policy, then rerender the report."];
  }
  return ["Agent/harness repair: fix the listed policy findings, then rerun `meta verify --run <run-dir>`."];
}

function bulletLines(items, emptyText) {
  const values = items.filter(Boolean);
  if (values.length === 0) {
    return [`- ${emptyText}`];
  }
  return values.map((item) => `- ${item}`);
}

function relativePathFromRun(runDir, path) {
  if (!path) {
    return "";
  }
  if (existsSync(path)) {
    return relative(runDir, path).replace(/\\/g, "/");
  }
  return String(path).replace(/\\/g, "/");
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveRunDir(runDir) {
  if (!runDir) {
    throw new Error("--run is required");
  }
  const absoluteRunDir = resolve(runDir);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    throw new Error(`Run directory does not exist: ${absoluteRunDir}`);
  }
  return absoluteRunDir;
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8");
  if (!text.trim()) {
    return [];
  }
  return text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

function compactTimestamp(now) {
  return now.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

async function runFakeMetaCommand({ runDir, scenario, timeoutMs }) {
  const { runFakeCodex } = await import("./fake-runner.mjs");
  return runFakeCodex({ runDir, scenario, totalTimeoutMs: timeoutMs });
}

function isHarnessRunDir(candidate) {
  try {
    const specPath = join(candidate, "spec.json");
    if (!existsSync(specPath)) {
      return false;
    }
    const spec = readJson(specPath);
    return spec?.kind === "meta-harness.task-spec" && spec.runId === basename(candidate);
  } catch {
    return false;
  }
}

function assertInsideRepoRunRoot({ repo, runRoot }) {
  const expected = join(resolve(repo), ".task-runs");
  const actual = resolve(runRoot);
  if (actual !== expected) {
    throw new Error(`Cleanup is restricted to the repo-local .task-runs directory: ${expected}`);
  }
}
