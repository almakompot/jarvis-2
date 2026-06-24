import {
  existsSync,
  readFileSync,
  statSync
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { requiredArtifacts, validateTaskRunDir } from "./task-packet.mjs";
import {
  appendJsonl,
  isForbiddenPath,
  normalizeRelativePath,
  readJson,
  writeJson
} from "./runner-utils.mjs";

const surfaceTypesByTaskClass = {
  "web-ui": ["browser-smoke", "screenshot", "trace"],
  "browser-extension": ["browser-extension-smoke", "browser-smoke"],
  cli: ["cli-smoke"],
  api: ["api-smoke", "request-response"],
  "data-pipeline": ["data-fixture", "generated-artifact", "manifest"]
};

export function runCompletedRunVerifier({ runDir, now = new Date() }) {
  const absoluteRunDir = resolve(runDir);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    throw new Error(`Run directory does not exist: ${absoluteRunDir}`);
  }
  const createdAt = now.toISOString();
  const findings = [];
  const validation = validateTaskRunDir(absoluteRunDir);
  const artifacts = readArtifacts(absoluteRunDir, findings);
  const runId = artifacts.runId || validation.runId || basename(absoluteRunDir);
  const state = createVerifierState({ runId, runDir: absoluteRunDir, createdAt, findings, artifacts });

  addStructuralFindings({ state, validation });
  verifyTraceability({ state });
  verifyEvidenceArtifacts({ state });
  verifyCommandExits({ state });
  verifyChangedFileBoundaries({ state });
  verifyRunnerStateFailures({ state });
  verifyEventOrdering({ state });
  verifySurfaceEvidence({ state });
  verifyFinalClaims({ state });
  verifyCaptureCompleteness({ state });

  const report = buildVerifierReport({ state });
  writeJson(join(absoluteRunDir, "verifier-report.json"), report);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), [verifierEvent({ state, report })]);

  return {
    runId,
    runDir: absoluteRunDir,
    status: report.status,
    decisionRecommendation: report.decisionRecommendation,
    report,
    findings: report.findings
  };
}

function createVerifierState({ runId, runDir, createdAt, findings, artifacts }) {
  return {
    runId,
    runDir,
    createdAt,
    findings,
    artifacts,
    findingIndex: 0
  };
}

function readArtifacts(runDir, findings) {
  const artifacts = {
    runId: null,
    json: {},
    jsonl: {},
    text: {},
    missing: []
  };

  for (const artifact of requiredArtifacts) {
    const path = join(runDir, artifact);
    if (artifact === "verifier-report.json") {
      continue;
    }
    if (!existsSync(path)) {
      artifacts.missing.push(artifact);
      continue;
    }
    if (artifact.endsWith(".json")) {
      const value = readJsonOrFinding({ path, artifact, findings });
      artifacts.json[artifact] = value;
      if (!artifacts.runId && value?.runId) {
        artifacts.runId = value.runId;
      }
    } else if (artifact.endsWith(".jsonl")) {
      artifacts.jsonl[artifact] = readJsonlOrFinding({ path, artifact, findings });
    } else {
      artifacts.text[artifact] = readTextOrFinding({ path, artifact, findings });
    }
  }

  return artifacts;
}

function readJsonOrFinding({ path, artifact, findings }) {
  try {
    return readJson(path);
  } catch (error) {
    findings.push(rawFinding({
      severity: "blocking",
      ruleId: "artifact.json.invalid",
      message: `${artifact} is not valid JSON: ${error.message}`,
      evidence: [artifact]
    }));
    return null;
  }
}

function readJsonlOrFinding({ path, artifact, findings }) {
  try {
    const text = readFileSync(path, "utf8");
    if (!text.trim()) {
      return [];
    }
    return text.trim().split(/\r?\n/).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        findings.push(rawFinding({
          severity: "blocking",
          ruleId: "artifact.jsonl.invalid",
          message: `${artifact} line ${index + 1} is not valid JSON: ${error.message}`,
          evidence: [artifact]
        }));
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    findings.push(rawFinding({
      severity: "blocking",
      ruleId: "artifact.read.failed",
      message: `${artifact} could not be read: ${error.message}`,
      evidence: [artifact]
    }));
    return [];
  }
}

function readTextOrFinding({ path, artifact, findings }) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    findings.push(rawFinding({
      severity: "blocking",
      ruleId: "artifact.read.failed",
      message: `${artifact} could not be read: ${error.message}`,
      evidence: [artifact]
    }));
    return "";
  }
}

function addStructuralFindings({ state, validation }) {
  for (const missing of state.artifacts.missing) {
    addFinding(state, {
      severity: "blocking",
      ruleId: "artifact.missing",
      message: `Missing required artifact: ${missing}.`,
      evidence: [missing]
    });
  }
  for (const error of validation.errors || []) {
    addFinding(state, {
      severity: structuralSeverity(error.id),
      ruleId: `schema.${error.id}`,
      message: error.message,
      evidence: error.artifact ? [error.artifact] : evidenceForStructuralError(error.id)
    });
  }
}

function structuralSeverity(id) {
  if (/missing|invalid|mismatch|fake-pass|unknown|failed|forbidden|passed-without|evidence-type-unaccepted/.test(id)) {
    return "blocking";
  }
  return "major";
}

function evidenceForStructuralError(id) {
  if (id.startsWith("verification.")) {
    return ["verification.json"];
  }
  if (id.startsWith("final-report.")) {
    return ["final-report.json"];
  }
  if (id.startsWith("proof-plan.")) {
    return ["proof-plan.json"];
  }
  if (id.startsWith("spec.")) {
    return ["spec.json"];
  }
  if (id.startsWith("changed-files.")) {
    return ["changed-files.json"];
  }
  return [];
}

function verifyTraceability({ state }) {
  const spec = json(state, "spec.json");
  const proofPlan = json(state, "proof-plan.json");
  const verification = json(state, "verification.json");
  if (!spec || !proofPlan || !verification) {
    return;
  }

  const requirementIds = new Set((spec.requirements || []).map((requirement) => requirement.id));
  const proofObligations = new Map((proofPlan.obligations || []).map((obligation) => [obligation.id, obligation]));
  for (const requirement of spec.requirements || []) {
    for (const proofId of requirement.proofObligationIds || []) {
      const obligation = proofObligations.get(proofId);
      if (!obligation) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.requirement.unknown-proof",
          message: `Requirement ${requirement.id} references unknown proof obligation ${proofId}.`,
          requirementIds: [requirement.id],
          proofObligationIds: [proofId],
          evidence: ["spec.json", "proof-plan.json"]
        });
      } else if (!(obligation.requirementIds || []).includes(requirement.id)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.proof.missing-backlink",
          message: `Proof obligation ${proofId} does not link back to requirement ${requirement.id}.`,
          requirementIds: [requirement.id],
          proofObligationIds: [proofId],
          evidence: ["spec.json", "proof-plan.json"]
        });
      }
    }
  }

  for (const obligation of proofPlan.obligations || []) {
    for (const requirementId of obligation.requirementIds || []) {
      if (!requirementIds.has(requirementId)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.proof.unknown-requirement",
          message: `Proof obligation ${obligation.id} references unknown requirement ${requirementId}.`,
          requirementIds: [requirementId],
          proofObligationIds: [obligation.id],
          evidence: ["proof-plan.json"]
        });
      }
    }
  }

  const evidenceById = evidenceMap(verification);
  for (const proof of verification.proofObligations || []) {
    const obligation = proofObligations.get(proof.id);
    if (!obligation) {
      continue;
    }
    const passedEvidence = proof.evidence || [];
    if (proof.status === "passed" && passedEvidence.length < obligation.minimumEvidence) {
      addFinding(state, {
        severity: "blocking",
        ruleId: "traceability.proof.insufficient-evidence",
        message: `Passed proof obligation ${proof.id} cites fewer than ${obligation.minimumEvidence} passing evidence item(s).`,
        proofObligationIds: [proof.id],
        evidence: ["verification.json"]
      });
    }
    for (const evidenceId of passedEvidence) {
      const evidenceItem = evidenceById.get(evidenceId);
      if (!evidenceItem) {
        continue;
      }
      if (!(obligation.acceptedEvidenceTypes || []).includes(evidenceItem.type)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.evidence.unaccepted-type",
          message: `Evidence ${evidenceId} has type ${evidenceItem.type}, which proof obligation ${proof.id} does not accept.`,
          proofObligationIds: [proof.id],
          evidence: [evidenceId, "proof-plan.json", "verification.json"]
        });
      }
    }
  }

  for (const evidenceItem of verification.evidence || []) {
    for (const proofId of evidenceItem.proofObligationIds || []) {
      if (!proofObligations.has(proofId)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.evidence.unknown-proof",
          message: `Evidence ${evidenceItem.id} references unknown proof obligation ${proofId}.`,
          proofObligationIds: [proofId],
          evidence: [evidenceItem.id, "verification.json"]
        });
      }
    }
    for (const requirementId of evidenceItem.requirementIds || []) {
      if (!requirementIds.has(requirementId)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "traceability.evidence.unknown-requirement",
          message: `Evidence ${evidenceItem.id} references unknown requirement ${requirementId}.`,
          requirementIds: [requirementId],
          evidence: [evidenceItem.id, "verification.json"]
        });
      }
    }
  }
}

function verifyEvidenceArtifacts({ state }) {
  const verification = json(state, "verification.json");
  if (!verification) {
    return;
  }
  for (const evidenceItem of verification.evidence || []) {
    if (evidenceItem.status !== "passed") {
      continue;
    }
    const paths = [
      evidenceItem.path,
      ...(Array.isArray(evidenceItem.artifacts)
        ? evidenceItem.artifacts
          .filter((artifact) => artifact?.exists !== false)
          .map((artifact) => artifact?.path)
        : [])
    ].filter(Boolean);
    for (const artifactPath of paths) {
      if (!artifactExists(state, artifactPath)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "evidence.artifact.missing",
          message: `Passed evidence ${evidenceItem.id} references missing artifact ${artifactPath}.`,
          requirementIds: evidenceItem.requirementIds,
          proofObligationIds: evidenceItem.proofObligationIds,
          evidence: [evidenceItem.id, artifactPath, "verification.json"]
        });
      }
    }
  }
}

function verifyCommandExits({ state }) {
  const verification = json(state, "verification.json");
  if (!verification) {
    return;
  }
  for (const command of verification.commands || []) {
    if (command.status === "passed" && command.exitCode !== 0) {
      addFinding(state, {
        severity: "blocking",
        ruleId: "command.exit.passed-nonzero",
        message: `Command ${command.id} is marked passed with exit code ${command.exitCode}.`,
        requirementIds: command.requirementIds,
        proofObligationIds: command.proofObligationIds,
        evidence: [command.id, "verification.json"]
      });
    }
    if (command.status === "failed" && command.exitCode === 0) {
      addFinding(state, {
        severity: "major",
        ruleId: "command.exit.failed-zero",
        message: `Command ${command.id} is marked failed with zero exit code.`,
        requirementIds: command.requirementIds,
        proofObligationIds: command.proofObligationIds,
        evidence: [command.id, "verification.json"]
      });
    }
    if (command.status === "timed-out" && command.timedOut !== true) {
      addFinding(state, {
        severity: "major",
        ruleId: "command.timeout.inconsistent",
        message: `Command ${command.id} is marked timed-out but timedOut is not true.`,
        requirementIds: command.requirementIds,
        proofObligationIds: command.proofObligationIds,
        evidence: [command.id, "verification.json"]
      });
    }
    for (const key of ["stdoutPath", "stderrPath"]) {
      if (command[key] && !artifactExists(state, command[key])) {
        addFinding(state, {
          severity: "major",
          ruleId: "command.log.missing-artifact",
          message: `Command ${command.id} references missing ${key}: ${command[key]}.`,
          evidence: [command.id, command[key]]
        });
      }
    }
  }

  for (const entry of jsonl(state, "command-log.jsonl")) {
    for (const key of ["stdoutPath", "stderrPath"]) {
      if (entry[key] && !artifactExists(state, entry[key])) {
        addFinding(state, {
          severity: "major",
          ruleId: "command-log.path.missing-artifact",
          message: `Command-log entry ${entry.id || "(missing id)"} references missing ${key}: ${entry[key]}.`,
          evidence: [entry.id || "command-log.jsonl", entry[key]]
        });
      }
    }
  }

  verifyHiddenFailedCommands({ state });
}

function verifyHiddenFailedCommands({ state }) {
  const verification = json(state, "verification.json");
  const finalReport = json(state, "final-report.json");
  if (!verification || finalReport?.outcome !== "passed") {
    return;
  }
  const passedEvidenceByProof = new Map();
  for (const evidence of verification.evidence || []) {
    if (evidence.status !== "passed") {
      continue;
    }
    for (const proofId of evidence.proofObligationIds || []) {
      if (!passedEvidenceByProof.has(proofId)) {
        passedEvidenceByProof.set(proofId, []);
      }
      passedEvidenceByProof.get(proofId).push(evidence);
    }
  }
  for (const command of verification.commands || []) {
    if (!["failed", "timed-out"].includes(command.status) || (command.proofObligationIds || []).length === 0) {
      continue;
    }
    const uncovered = (command.proofObligationIds || []).filter((proofId) => (passedEvidenceByProof.get(proofId) || []).length === 0);
    if (uncovered.length > 0) {
      addFinding(state, {
        severity: "blocking",
        ruleId: "command.failure.uncovered",
        message: `Failed command ${command.id} is not covered by later passing proof for ${uncovered.join(", ")}.`,
        requirementIds: command.requirementIds,
        proofObligationIds: uncovered,
        evidence: [command.id, "verification.json"]
      });
    }
  }
}

function verifyChangedFileBoundaries({ state }) {
  const changedFiles = json(state, "changed-files.json");
  const allowedFiles = json(state, "allowed-files.json") || {};
  const diffText = text(state, "diff.patch") || "";
  if (!changedFiles) {
    return;
  }
  for (const file of changedFiles.files || []) {
    const path = normalizeRelativePath(file.path);
    if (file.forbidden || isForbiddenPath(path, allowedFiles)) {
      addFinding(state, {
        severity: "blocking",
        ruleId: "changed-files.forbidden-path",
        message: `Changed file ${path} violates forbidden path policy.`,
        evidence: ["changed-files.json", path]
      });
    }
    if (matchesAny(path, allowedFiles.requiresJustificationPatterns || []) && !file.justification) {
      addFinding(state, {
        severity: "major",
        ruleId: "changed-files.justification-missing",
        message: `Changed file ${path} requires justification but none is recorded.`,
        evidence: ["changed-files.json", path]
      });
    }
  }

  const diffPaths = parseDiffPaths(diffText);
  const changedPaths = new Set((changedFiles.files || []).map((file) => normalizeRelativePath(file.path)));
  for (const diffPath of diffPaths) {
    if (!changedPaths.has(diffPath)) {
      addFinding(state, {
        severity: "major",
        ruleId: "diff.changed-files.mismatch",
        message: `diff.patch mentions ${diffPath}, but changed-files.json does not list it.`,
        evidence: ["diff.patch", "changed-files.json", diffPath]
      });
    }
  }
}

function verifyRunnerStateFailures({ state }) {
  const runnerState = json(state, "runner-state.json");
  if (!runnerState || !Array.isArray(runnerState.failures)) {
    return;
  }
  for (const failure of runnerState.failures) {
    const failureId = String(failure.id || "unknown-runner-failure");
    if (failureId === "edit-before-inspection") {
      addFinding(state, {
        severity: "blocking",
        ruleId: "event.edit-before-inspection",
        message: failure.message || "Runner captured an edit before inspection evidence.",
        evidence: ["runner-state.json", "events.jsonl", "transcript.jsonl"]
      });
      continue;
    }
    addFinding(state, {
      severity: "blocking",
      ruleId: `runner.failure.${failureId}`,
      message: failure.message || `Runner recorded failure ${failureId}.`,
      evidence: ["runner-state.json"]
    });
  }
}

function verifyEventOrdering({ state }) {
  const events = jsonl(state, "events.jsonl");
  const commandLog = jsonl(state, "command-log.jsonl");
  const transcript = jsonl(state, "transcript.jsonl");
  assertMonotonicTimestamps({ state, rows: events, artifact: "events.jsonl", severity: "blocking" });
  assertMonotonicTimestamps({ state, rows: commandLog, artifact: "command-log.jsonl", severity: "major" });
  assertMonotonicTimestamps({ state, rows: transcript, artifact: "transcript.jsonl", severity: "major" });

  const firstEdit = firstByTimestamp([
    ...events.filter((event) => event.phase === "edit").map((event) => ({ ...event, artifact: "events.jsonl" })),
    ...transcript.filter((entry) => entry.type === "file_edit").map((entry) => ({ ...entry, artifact: "transcript.jsonl" }))
  ]);
  const inspection = firstByTimestamp([
    ...events.filter((event) => event.phase === "inspect" && event.status === "passed").map((event) => ({ ...event, artifact: "events.jsonl" })),
    ...commandLog.filter((entry) => entry.phase === "inspect" && entry.exitCode === 0).map((entry) => ({ ...entry, artifact: "command-log.jsonl" }))
  ]);
  if (firstEdit && (!inspection || Date.parse(inspection.timestamp || inspection.startedAt) > Date.parse(firstEdit.timestamp || firstEdit.startedAt))) {
    addFinding(state, {
      severity: "blocking",
      ruleId: "event.edit-before-inspection",
      message: "First edit happened before passing inspection evidence.",
      evidence: [firstEdit.artifact, inspection?.artifact || "events.jsonl"]
    });
  }

  const lastEdit = lastByTimestamp([
    ...events.filter((event) => event.phase === "edit").map((event) => ({ ...event, artifact: "events.jsonl" })),
    ...transcript.filter((entry) => entry.type === "file_edit").map((entry) => ({ ...entry, artifact: "transcript.jsonl" }))
  ]);
  const verificationStart = firstByTimestamp([
    ...events.filter((event) => event.phase === "verify").map((event) => ({ ...event, artifact: "events.jsonl" })),
    ...commandLog.filter((entry) => entry.phase === "verify").map((entry) => ({ ...entry, artifact: "command-log.jsonl", timestamp: entry.startedAt }))
  ]);
  const verification = json(state, "verification.json");
  if (verification?.status === "passed" && lastEdit && verificationStart && Date.parse(verificationStart.timestamp || verificationStart.startedAt) < Date.parse(lastEdit.timestamp || lastEdit.startedAt)) {
    addFinding(state, {
      severity: "blocking",
      ruleId: "event.verification-before-final-edit",
      message: "Verification proof ran before the final captured edit.",
      evidence: [verificationStart.artifact, lastEdit.artifact]
    });
  }
}

function verifySurfaceEvidence({ state }) {
  const spec = json(state, "spec.json");
  const proofPlan = json(state, "proof-plan.json");
  const verification = json(state, "verification.json");
  if (!spec || !proofPlan || !verification) {
    return;
  }
  const requiredTypes = surfaceTypesByTaskClass[spec.taskClass] || [];
  if (requiredTypes.length === 0) {
    return;
  }
  const acceptsRequiredSurface = (proofPlan.obligations || []).some((obligation) =>
    (obligation.acceptedEvidenceTypes || []).some((type) => requiredTypes.includes(type))
  );
  if (!acceptsRequiredSurface) {
    return;
  }
  const passedTypes = new Set((verification.evidence || [])
    .filter((evidence) => evidence.status === "passed" && evidence.surfaceResultId)
    .map((evidence) => evidence.type));
  if (!requiredTypes.some((type) => passedTypes.has(type))) {
    addFinding(state, {
      severity: "blocking",
      ruleId: "surface.required-evidence.missing",
      message: `${spec.taskClass} tasks require passing runnable-surface evidence (${requiredTypes.join(", ")}).`,
      evidence: ["proof-plan.json", "verification.json"]
    });
  }
}

function verifyFinalClaims({ state }) {
  const finalReport = json(state, "final-report.json");
  const verification = json(state, "verification.json");
  const proofPlan = json(state, "proof-plan.json");
  if (!finalReport || !verification) {
    return;
  }
  const evidenceById = evidenceMap(verification);

  if (finalReport.outcome === "passed" && verification.status !== "passed") {
    addFinding(state, {
      severity: "blocking",
      ruleId: "final-report.outcome.exceeds-verification",
      message: `final-report.json claims passed while verification status is ${verification.status}.`,
      evidence: ["final-report.json", "verification.json"]
    });
  }

  for (const [claimId, claim] of Object.entries(finalReport.claims || {})) {
    validateClaimEvidence({ state, evidenceById, owner: `claim ${claimId}`, status: claim.status, evidenceIds: claim.evidence || [], requirementIds: claim.requirementIds || [] });
  }
  for (const [proofId, proofResult] of Object.entries(finalReport.proofObligations || {})) {
    validateClaimEvidence({ state, evidenceById, owner: `proof result ${proofId}`, status: proofResult.status, evidenceIds: proofResult.evidence || [], proofObligationIds: [proofId] });
    const obligation = (proofPlan?.obligations || []).find((item) => item.id === proofId);
    for (const evidenceId of proofResult.evidence || []) {
      const evidenceItem = evidenceById.get(evidenceId);
      if (evidenceItem && obligation && !(obligation.acceptedEvidenceTypes || []).includes(evidenceItem.type)) {
        addFinding(state, {
          severity: "blocking",
          ruleId: "final-report.evidence.unaccepted-type",
          message: `Final report proof ${proofId} cites evidence ${evidenceId} with unaccepted type ${evidenceItem.type}.`,
          proofObligationIds: [proofId],
          evidence: ["final-report.json", evidenceId, "proof-plan.json"]
        });
      }
    }
  }
  for (const result of finalReport.requirementResults || []) {
    validateClaimEvidence({ state, evidenceById, owner: `requirement result ${result.requirementId}`, status: result.status, evidenceIds: result.evidence || [], requirementIds: [result.requirementId] });
  }

  if (finalReport.outcome === "passed" && (!Array.isArray(finalReport.residualRisk) || finalReport.residualRisk.length === 0)) {
    addFinding(state, {
      severity: "major",
      ruleId: "final-report.residual-risk.missing",
      message: "Passed final report must include residual risk.",
      evidence: ["final-report.json"]
    });
  }
}

function validateClaimEvidence({ state, evidenceById, owner, status, evidenceIds, requirementIds = [], proofObligationIds = [] }) {
  if (status === "passed" && evidenceIds.length === 0) {
    addFinding(state, {
      severity: "blocking",
      ruleId: "final-report.claim.evidence-missing",
      message: `Final report ${owner} is passed but cites no evidence.`,
      requirementIds,
      proofObligationIds,
      evidence: ["final-report.json"]
    });
  }
  for (const evidenceId of evidenceIds) {
    const evidenceItem = evidenceById.get(evidenceId);
    if (!evidenceItem) {
      addFinding(state, {
        severity: "blocking",
        ruleId: "final-report.claim.unknown-evidence",
        message: `Final report ${owner} cites unknown evidence ${evidenceId}.`,
        requirementIds,
        proofObligationIds,
        evidence: ["final-report.json", evidenceId]
      });
    } else if (status === "passed" && evidenceItem.status !== "passed") {
      addFinding(state, {
        severity: "blocking",
        ruleId: "final-report.claim.nonpassing-evidence",
        message: `Final report ${owner} cites non-passing evidence ${evidenceId}.`,
        requirementIds,
        proofObligationIds,
        evidence: ["final-report.json", evidenceId]
      });
    }
  }
}

function verifyCaptureCompleteness({ state }) {
  const runnerState = json(state, "runner-state.json");
  if (!runnerState) {
    return;
  }
  for (const [capture, status] of Object.entries(runnerState.captureCompleteness || {})) {
    if (status === "partial") {
      addFinding(state, {
        severity: "minor",
        ruleId: "capture.partial",
        message: `Runner capture for ${capture} is partial.`,
        evidence: ["runner-state.json"]
      });
    }
  }
  if (runnerState.status === "pending" && json(state, "verification.json")?.status === "passed") {
    addFinding(state, {
      severity: "major",
      ruleId: "runner-state.pending-with-verification",
      message: "Verification is passed while runner-state.json still says pending.",
      evidence: ["runner-state.json", "verification.json"]
    });
  }
}

function buildVerifierReport({ state }) {
  const findings = state.findings.map((finding, index) => ({
    id: `V${index + 1}`,
    ...finding
  }));
  const blockingCount = findings.filter((finding) => finding.severity === "blocking").length;
  const majorCount = findings.filter((finding) => finding.severity === "major").length;
  const status = blockingCount > 0 || majorCount > 0 ? "failed" : "passed";
  return {
    schemaVersion: 1,
    kind: "meta-harness.verifier-report",
    runId: state.runId,
    createdAt: state.createdAt,
    status,
    decisionRecommendation: status === "passed" ? "accept" : "reject",
    findings,
    coverage: buildCoverage({ state }),
    summary: {
      blocking: blockingCount,
      major: majorCount,
      minor: findings.filter((finding) => finding.severity === "minor").length,
      info: findings.filter((finding) => finding.severity === "info").length
    },
    verifier: {
      name: "m6-completed-run-verifier",
      version: 1,
      deterministic: true
    }
  };
}

function buildCoverage({ state }) {
  const verification = json(state, "verification.json");
  const spec = json(state, "spec.json");
  const requirementsWithPassingProof = (verification?.requirementCoverage || [])
    .filter((item) => item.status === "passed")
    .map((item) => item.requirementId);
  const requirementsMissingProof = (spec?.requirements || [])
    .filter((requirement) => !requirementsWithPassingProof.includes(requirement.id))
    .map((requirement) => requirement.id);
  return {
    requirementsWithPassingProof,
    requirementsMissingProof,
    proofObligationsPassed: (verification?.proofObligations || []).filter((item) => item.status === "passed").map((item) => item.id),
    proofObligationsFailed: (verification?.proofObligations || []).filter((item) => item.status === "failed").map((item) => item.id),
    proofObligationsBlocked: (verification?.proofObligations || []).filter((item) => item.status === "blocked").map((item) => item.id),
    evidenceIds: (verification?.evidence || []).map((item) => item.id)
  };
}

function verifierEvent({ state, report }) {
  return {
    id: `event.verifier.${Date.parse(state.createdAt)}`,
    type: "verifier-event",
    phase: "review",
    status: report.status,
    timestamp: state.createdAt,
    artifact: "verifier-report.json",
    message: `M6 verifier wrote ${report.findings.length} finding(s) with recommendation ${report.decisionRecommendation}.`
  };
}

function addFinding(state, finding) {
  const normalized = rawFinding(finding);
  if (!state.findings.some((item) => sameFinding(item, normalized))) {
    state.findings.push(normalized);
  }
}

function rawFinding({ severity, ruleId, message, evidence = [], requirementIds = [], proofObligationIds = [] }) {
  return {
    severity,
    ruleId,
    requirementIds,
    proofObligationIds,
    message,
    evidence
  };
}

function sameFinding(left, right) {
  return left.ruleId === right.ruleId
    && left.message === right.message
    && JSON.stringify(left.evidence || []) === JSON.stringify(right.evidence || []);
}

function json(state, artifact) {
  return state.artifacts.json[artifact] || null;
}

function jsonl(state, artifact) {
  return state.artifacts.jsonl[artifact] || [];
}

function text(state, artifact) {
  return state.artifacts.text[artifact] || "";
}

function evidenceMap(verification) {
  return new Map((verification?.evidence || []).map((evidence) => [evidence.id, evidence]));
}

function artifactExists(state, artifactPath) {
  const resolved = resolveArtifactPath(state, artifactPath);
  return Boolean(resolved && existsSync(resolved) && statSync(resolved).isFile());
}

function resolveArtifactPath(state, artifactPath) {
  if (!artifactPath || typeof artifactPath !== "string") {
    return null;
  }
  if (artifactPath.startsWith("target:")) {
    const repoPath = json(state, "repo-profile.json")?.targetPath || json(state, "repo-profile.json")?.repoPath;
    return repoPath ? resolve(repoPath, artifactPath.slice("target:".length)) : null;
  }
  const absolute = isAbsolute(artifactPath) ? artifactPath : resolve(state.runDir, artifactPath);
  const relPath = relative(state.runDir, absolute);
  if (relPath.startsWith("..") || isAbsolute(relPath)) {
    return null;
  }
  return absolute;
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => patternMatches(path, pattern));
}

function patternMatches(path, pattern) {
  const normalized = normalizeRelativePath(pattern);
  if (normalized === path) {
    return true;
  }
  if (normalized.endsWith("/**")) {
    return path.startsWith(normalized.slice(0, -3));
  }
  const singleStarPattern = normalized.replace(/\*\*/g, "*");
  if (singleStarPattern.endsWith("/*")) {
    return path.startsWith(singleStarPattern.slice(0, -1));
  }
  if (singleStarPattern.includes("*")) {
    const escaped = singleStarPattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}$`).test(path);
  }
  return false;
}

function parseDiffPaths(diffText) {
  const paths = [];
  for (const line of diffText.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) {
      paths.push(normalizeRelativePath(match[2]));
    }
  }
  return [...new Set(paths)];
}

function assertMonotonicTimestamps({ state, rows, artifact, severity }) {
  let previous = null;
  for (const row of rows) {
    const timestamp = row.timestamp || row.startedAt || row.finishedAt;
    const value = Date.parse(timestamp);
    if (!timestamp || Number.isNaN(value)) {
      addFinding(state, {
        severity,
        ruleId: "event.timestamp.invalid",
        message: `${artifact} has an invalid or missing timestamp.`,
        evidence: [artifact, row.id || "(missing id)"]
      });
      continue;
    }
    if (previous !== null && value < previous) {
      addFinding(state, {
        severity,
        ruleId: "event.timestamp.nonmonotonic",
        message: `${artifact} timestamps are not monotonic.`,
        evidence: [artifact, row.id || "(missing id)"]
      });
      return;
    }
    previous = value;
  }
}

function firstByTimestamp(rows) {
  return rows
    .filter((row) => row.timestamp || row.startedAt)
    .sort((left, right) => Date.parse(left.timestamp || left.startedAt) - Date.parse(right.timestamp || right.startedAt))[0] || null;
}

function lastByTimestamp(rows) {
  return rows
    .filter((row) => row.timestamp || row.startedAt)
    .sort((left, right) => Date.parse(right.timestamp || right.startedAt) - Date.parse(left.timestamp || left.startedAt))[0] || null;
}
