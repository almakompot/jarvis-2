import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { requiredArtifacts, validateTaskRunDir } from "./task-packet.mjs";
import {
  appendJsonl,
  isForbiddenPath,
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

const nonOverrideableRules = new Set([
  "POL-ARTIFACT-001",
  "POL-TRACE-001",
  "POL-VERIFY-001",
  "POL-VERIFY-002",
  "POL-UI-001",
  "POL-SURFACE-001",
  "POL-FILES-001",
  "POL-HONESTY-001",
  "POL-HONESTY-002",
  "POL-ORDER-001",
  "POL-CORPUS-001",
  "POL-BLOCKED-001"
]);

export function runPolicyEngine({ runDir, now = new Date(), corpusReplay = null, overrides = null, taskClassPolicy = null } = {}) {
  if (!runDir) {
    throw new Error("--run-dir is required");
  }
  const absoluteRunDir = resolve(runDir);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    throw new Error(`Run directory does not exist: ${absoluteRunDir}`);
  }

  const createdAt = now.toISOString();
  const validation = validateTaskRunDir(absoluteRunDir);
  const artifacts = readPolicyArtifacts(absoluteRunDir);
  const runId = artifacts.spec?.runId
    || artifacts.verification?.runId
    || artifacts.verifierReport?.runId
    || validation.runId
    || basename(absoluteRunDir);
  const resolvedCorpusReplay = corpusReplay || artifacts.corpusReplay;
  const resolvedOverrides = normalizeOverrides(overrides || artifacts.policyOverrides);
  const resolvedTaskClassPolicy = buildTaskClassPolicy({
    spec: artifacts.spec,
    proofPlan: artifacts.proofPlan,
    override: taskClassPolicy || artifacts.taskPolicy
  });

  const state = {
    runId,
    runDir: absoluteRunDir,
    createdAt,
    validation,
    artifacts,
    corpusReplay: resolvedCorpusReplay,
    overrides: resolvedOverrides,
    taskClassPolicy: resolvedTaskClassPolicy,
    rules: [],
    warnings: []
  };

  evaluateStructuralRules(state);
  evaluateVerificationRules(state);
  evaluateSurfaceRules(state);
  evaluateChangedFileRules(state);
  evaluateVerifierRules(state);
  evaluateCorpusRules(state);
  evaluateBlockedRules(state);
  applyOverrides(state);

  const decision = buildPolicyDecision(state);
  writeJson(join(absoluteRunDir, "policy-decision.json"), decision);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), [policyEvent({ state, decision })]);
  return {
    runId,
    runDir: absoluteRunDir,
    decision: decision.decision,
    policyDecision: decision,
    blockingRules: decision.blockingRules,
    warnings: decision.warnings,
    overrides: decision.overrides
  };
}

function readPolicyArtifacts(runDir) {
  return {
    spec: readOptionalJson(join(runDir, "spec.json")),
    proofPlan: readOptionalJson(join(runDir, "proof-plan.json")),
    verification: readOptionalJson(join(runDir, "verification.json")),
    verifierReport: readOptionalJson(join(runDir, "verifier-report.json")),
    changedFiles: readOptionalJson(join(runDir, "changed-files.json")),
    runnerState: readOptionalJson(join(runDir, "runner-state.json")),
    finalReport: readOptionalJson(join(runDir, "final-report.json")),
    corpusReplay: readOptionalJson(join(runDir, "corpus-replay.json")),
    policyOverrides: readOptionalJson(join(runDir, "policy-overrides.json")),
    taskPolicy: readOptionalJson(join(runDir, "task-policy.json"))
  };
}

function readOptionalJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function normalizeOverrides(value) {
  const raw = Array.isArray(value) ? value : Array.isArray(value?.overrides) ? value.overrides : [];
  return raw.map((override, index) => ({
    id: override.id || `override.${String(index + 1).padStart(4, "0")}`,
    ruleId: override.ruleId,
    user: override.user || override.actor || null,
    timestamp: override.timestamp || override.createdAt || null,
    reason: override.reason || "",
    remainingRisk: override.remainingRisk || override.risk || "",
    source: override.source || "policy-overrides.json"
  }));
}

function buildTaskClassPolicy({ spec, proofPlan, override }) {
  const taskClass = override?.taskClass || spec?.taskClass || proofPlan?.taskClass || "unknown";
  const defaultRequired = surfaceTypesByTaskClass[taskClass] || [];
  const requiredSurfaceEvidenceTypes = Array.isArray(override?.requiredSurfaceEvidenceTypes)
    ? override.requiredSurfaceEvidenceTypes
    : defaultRequired;
  return {
    taskClass,
    requiredSurfaceEvidenceTypes,
    source: override ? "task-policy.json" : "default-task-class-policy"
  };
}

function evaluateStructuralRules(state) {
  for (const error of state.validation.errors || []) {
    if (error.id === "artifact.missing") {
      addRule(state, {
        ruleId: "POL-ARTIFACT-001",
        decision: "reject",
        severity: "blocking",
        source: "validateTaskRunDir",
        message: error.message,
        evidence: [error.artifact || "run-folder"]
      });
      continue;
    }
    if (isTraceabilityError(error.id)) {
      addRule(state, {
        ruleId: "POL-TRACE-001",
        decision: "reject",
        severity: "blocking",
        source: "validateTaskRunDir",
        message: error.message,
        evidence: evidenceForValidationError(error)
      });
      continue;
    }
    if (error.id === "final-report.residual-risk") {
      addRule(state, {
        ruleId: "POL-RISK-001",
        decision: "reject",
        severity: "major",
        source: "validateTaskRunDir",
        message: "Passed or terminal reports must name residual risk unless explicitly overridden.",
        evidence: ["final-report.json"]
      });
      continue;
    }
    if (error.id === "final-report.passed-without-verification") {
      addRule(state, {
        ruleId: "POL-HONESTY-002",
        decision: "reject",
        severity: "blocking",
        source: "validateTaskRunDir",
        message: error.message,
        evidence: ["final-report.json", "verification.json"]
      });
      continue;
    }
    if (error.id === "verification.unknown-evidence" || error.id === "verification.failed-evidence-cited") {
      addRule(state, {
        ruleId: "POL-HONESTY-001",
        decision: "reject",
        severity: "blocking",
        source: "validateTaskRunDir",
        message: error.message,
        evidence: ["verification.json"]
      });
    }
  }
}

function isTraceabilityError(id) {
  return [
    "spec.requirement.unmapped",
    "spec.requirement.unknown-proof",
    "spec.proof-obligation.not-in-plan",
    "spec.proof-obligation.requirements",
    "proof-plan.obligation.requirements",
    "proof-plan.unknown-requirement",
    "verification.coverage.missing",
    "verification.unknown-proof",
    "verification.proof-no-evidence"
  ].includes(id);
}

function evidenceForValidationError(error) {
  if (error.id.startsWith("spec.")) {
    return ["spec.json", "proof-plan.json"];
  }
  if (error.id.startsWith("proof-plan.")) {
    return ["proof-plan.json"];
  }
  if (error.id.startsWith("verification.")) {
    return ["verification.json"];
  }
  return [];
}

function evaluateVerificationRules(state) {
  const verification = state.artifacts.verification;
  if (!verification) {
    if (!missingArtifactNames(state).includes("verification.json")) {
      addRule(state, {
        ruleId: "POL-VERIFY-001",
        decision: "reject",
        severity: "blocking",
        source: "policy-engine",
        message: "verification.json could not be read, so required proof did not run.",
        evidence: ["verification.json"]
      });
    }
    return;
  }
  if (verification.status === "pending") {
    addRule(state, {
      ruleId: "POL-VERIFY-001",
      decision: "reject",
      severity: "blocking",
      source: "verification.json",
      message: "Required verification has not run.",
      evidence: ["verification.json"]
    });
  } else if (verification.status === "failed") {
    addRule(state, {
      ruleId: "POL-VERIFY-002",
      decision: "reject",
      severity: "blocking",
      source: "verification.json",
      message: "Required verification failed.",
      evidence: ["verification.json"]
    });
  } else if (verification.status === "blocked") {
    addRule(state, {
      ruleId: "POL-BLOCKED-001",
      decision: "block",
      severity: "blocking",
      source: "verification.json",
      message: "Verification is blocked by an unresolved condition.",
      evidence: ["verification.json"]
    });
  }
}

function evaluateSurfaceRules(state) {
  const requiredTypes = state.taskClassPolicy.requiredSurfaceEvidenceTypes || [];
  if (requiredTypes.length === 0) {
    return;
  }
  const verification = state.artifacts.verification;
  const passedTypes = new Set((verification?.evidence || [])
    .filter((evidence) => evidence.status === "passed" && evidence.surfaceResultId)
    .map((evidence) => evidence.type));
  if (requiredTypes.some((type) => passedTypes.has(type))) {
    return;
  }
  const isUi = ["web-ui", "browser-extension"].includes(state.taskClassPolicy.taskClass);
  addRule(state, {
    ruleId: isUi ? "POL-UI-001" : "POL-SURFACE-001",
    decision: "reject",
    severity: "blocking",
    source: "task-class-policy",
    message: `${state.taskClassPolicy.taskClass} tasks require passing runnable-surface evidence (${requiredTypes.join(", ")}).`,
    evidence: ["verification.json", "proof-plan.json"],
    taskClass: state.taskClassPolicy.taskClass
  });
}

function evaluateChangedFileRules(state) {
  const changedFiles = state.artifacts.changedFiles;
  if (!changedFiles) {
    return;
  }
  for (const file of changedFiles.files || []) {
    if (file.forbidden || isForbiddenPath(file.path)) {
      addRule(state, {
        ruleId: "POL-FILES-001",
        decision: "reject",
        severity: "blocking",
        source: "changed-files.json",
        message: `Forbidden file changed: ${file.path}.`,
        evidence: ["changed-files.json", file.path]
      });
    }
  }
}

function evaluateVerifierRules(state) {
  const verifierReport = state.artifacts.verifierReport;
  if (!verifierReport) {
    return;
  }
  if (verifierReport.status === "pending") {
    addRule(state, {
      ruleId: "POL-VERIFY-001",
      decision: "reject",
      severity: "blocking",
      source: "verifier-report.json",
      message: "Independent verifier has not run.",
      evidence: ["verifier-report.json"]
    });
  } else if (verifierReport.status === "blocked") {
    addRule(state, {
      ruleId: "POL-BLOCKED-001",
      decision: "block",
      severity: "blocking",
      source: "verifier-report.json",
      message: "Independent verifier is blocked.",
      evidence: ["verifier-report.json"]
    });
  }
  for (const finding of verifierReport.findings || []) {
    if (!["blocking", "major"].includes(finding.severity)) {
      if (finding.severity === "minor") {
        state.warnings.push(warningFromFinding(finding));
      }
      continue;
    }
    addRule(state, ruleFromVerifierFinding(finding));
  }
}

function ruleFromVerifierFinding(finding) {
  const mapped = mapVerifierRule(finding);
  return {
    ruleId: mapped.ruleId,
    decision: mapped.decision,
    severity: finding.severity === "major" ? "major" : "blocking",
    source: "verifier-report.json",
    findingId: finding.id || null,
    requirementIds: finding.requirementIds || [],
    proofObligationIds: finding.proofObligationIds || [],
    taskClass: finding.taskClass || null,
    message: finding.message,
    evidence: finding.evidence || []
  };
}

function mapVerifierRule(finding) {
  const ruleId = finding.ruleId;
  if (ruleId === "surface.required-evidence.missing") {
    const isUi = ["web-ui", "browser-extension"].includes(finding.taskClass);
    return { ruleId: isUi ? "POL-UI-001" : "POL-SURFACE-001", decision: "reject" };
  }
  if (ruleId === "changed-files.forbidden-path") {
    return { ruleId: "POL-FILES-001", decision: "reject" };
  }
  if (ruleId === "final-report.claim.unknown-evidence" || ruleId === "evidence.artifact.missing") {
    return { ruleId: "POL-HONESTY-001", decision: "reject" };
  }
  if (ruleId === "command.exit.passed-nonzero"
    || ruleId === "command.failure.uncovered"
    || ruleId === "final-report.outcome.exceeds-verification"
    || ruleId === "final-report.claim.nonpassing-evidence") {
    return { ruleId: "POL-HONESTY-002", decision: "reject" };
  }
  if (ruleId === "event.edit-before-inspection" || ruleId === "event.verification-before-final-edit") {
    return { ruleId: "POL-ORDER-001", decision: "reject" };
  }
  if (ruleId.startsWith("traceability.") || ruleId.startsWith("schema.spec.") || ruleId.startsWith("schema.proof-plan.")) {
    return { ruleId: "POL-TRACE-001", decision: "reject" };
  }
  if (ruleId === "final-report.residual-risk.missing" || ruleId === "schema.final-report.residual-risk") {
    return { ruleId: "POL-RISK-001", decision: "reject" };
  }
  return { ruleId: "POL-VERIFIER-001", decision: "reject" };
}

function warningFromFinding(finding) {
  return {
    id: finding.id || `warning.${finding.ruleId}`,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: "verifier-report.json",
    message: finding.message,
    evidence: finding.evidence || []
  };
}

function evaluateCorpusRules(state) {
  const corpus = state.corpusReplay;
  if (!corpus) {
    return;
  }
  const status = corpus.status || (corpus.passed === false ? "failed" : corpus.passed === true ? "passed" : "unknown");
  if (["failed", "regressed", "rejected"].includes(status)) {
    addRule(state, {
      ruleId: "POL-CORPUS-001",
      decision: "reject",
      severity: "blocking",
      source: "corpus-replay.json",
      message: corpus.message || "A known corpus regression failed under current harness behavior.",
      evidence: ["corpus-replay.json", ...(corpus.caseIds || corpus.regressions || [])]
    });
  } else if (status === "blocked") {
    addRule(state, {
      ruleId: "POL-BLOCKED-001",
      decision: "block",
      severity: "blocking",
      source: "corpus-replay.json",
      message: corpus.message || "Corpus replay is blocked.",
      evidence: ["corpus-replay.json"]
    });
  }
}

function evaluateBlockedRules(state) {
  const runnerState = state.artifacts.runnerState;
  if (runnerState?.status === "blocked" || runnerState?.status === "interrupted") {
    addRule(state, {
      ruleId: "POL-BLOCKED-001",
      decision: "block",
      severity: "blocking",
      source: "runner-state.json",
      message: `Runner state is ${runnerState.status}.`,
      evidence: ["runner-state.json"]
    });
  }
}

function applyOverrides(state) {
  for (const override of state.overrides) {
    const valid = override.ruleId && override.user && override.timestamp && override.reason && override.remainingRisk;
    if (!valid) {
      state.warnings.push({
        id: `override.invalid.${override.id}`,
        ruleId: "POL-OVERRIDE-INVALID",
        severity: "major",
        source: override.source,
        message: `Override ${override.id} is missing ruleId, user, timestamp, reason, or remainingRisk.`,
        evidence: ["policy-overrides.json"]
      });
      continue;
    }
    for (const rule of state.rules.filter((rule) => rule.ruleId === override.ruleId)) {
      if (nonOverrideableRules.has(rule.ruleId)) {
        state.warnings.push({
          id: `override.denied.${override.id}`,
          ruleId: "POL-OVERRIDE-DENIED",
          severity: "major",
          source: override.source,
          message: `Override ${override.id} cannot override non-overrideable rule ${rule.ruleId}.`,
          evidence: ["policy-overrides.json", rule.ruleId]
        });
        continue;
      }
      rule.overridden = true;
      rule.overrideIds.push(override.id);
    }
  }
}

function addRule(state, rule) {
  const normalized = {
    ruleId: rule.ruleId,
    decision: rule.decision || "reject",
    severity: rule.severity || "blocking",
    source: rule.source || "policy-engine",
    findingId: rule.findingId || null,
    requirementIds: rule.requirementIds || [],
    proofObligationIds: rule.proofObligationIds || [],
    taskClass: rule.taskClass || null,
    message: rule.message,
    evidence: rule.evidence || [],
    overrideable: !nonOverrideableRules.has(rule.ruleId),
    overridden: false,
    overrideIds: []
  };
  if (!state.rules.some((existing) => sameRule(existing, normalized))) {
    state.rules.push(normalized);
  }
}

function sameRule(left, right) {
  return left.ruleId === right.ruleId
    && left.message === right.message
    && JSON.stringify(left.evidence) === JSON.stringify(right.evidence);
}

function buildPolicyDecision(state) {
  const rules = state.rules.map((rule, index) => ({
    id: `PD${index + 1}`,
    ...rule
  }));
  const activeRules = rules.filter((rule) => !rule.overridden);
  const activeRejects = activeRules.filter((rule) => rule.decision === "reject");
  const activeBlocks = activeRules.filter((rule) => rule.decision === "block");
  const decision = activeRejects.length > 0 ? "rejected" : activeBlocks.length > 0 ? "blocked" : "accepted";
  return {
    schemaVersion: 1,
    kind: "meta-harness.policy-decision",
    runId: state.runId,
    createdAt: state.createdAt,
    decidedAt: state.createdAt,
    decision,
    decisionReason: decisionReason({ decision, activeRejects, activeBlocks }),
    blockingRules: rules,
    warnings: state.warnings,
    overrides: state.overrides,
    taskClassPolicy: state.taskClassPolicy,
    inputs: {
      requiredArtifacts,
      structuralValidationPassed: state.validation.passed,
      verificationStatus: state.artifacts.verification?.status || "missing",
      verifierStatus: state.artifacts.verifierReport?.status || "missing",
      corpusReplayStatus: state.corpusReplay?.status || (state.corpusReplay?.passed === false ? "failed" : state.corpusReplay?.passed === true ? "passed" : "not-run")
    },
    summary: {
      activeRejectRules: activeRejects.length,
      activeBlockRules: activeBlocks.length,
      overriddenRules: rules.filter((rule) => rule.overridden).length,
      warnings: state.warnings.length
    },
    policyEngine: {
      name: "m9-deterministic-policy-engine",
      version: 1,
      deterministic: true
    }
  };
}

function decisionReason({ decision, activeRejects, activeBlocks }) {
  if (decision === "rejected") {
    return activeRejects[0]?.message || "At least one rejection rule fired.";
  }
  if (decision === "blocked") {
    return activeBlocks[0]?.message || "At least one blocking condition prevents a decision.";
  }
  return "No active reject or block policy rules fired.";
}

function missingArtifactNames(state) {
  return (state.validation.errors || [])
    .filter((error) => error.id === "artifact.missing")
    .map((error) => error.artifact)
    .filter(Boolean);
}

function policyEvent({ state, decision }) {
  return {
    id: `event.policy.${Date.parse(state.createdAt)}`,
    type: "policy-event",
    phase: "policy",
    status: decision.decision,
    timestamp: state.createdAt,
    artifact: "policy-decision.json",
    message: `M9 policy engine decided ${decision.decision} with ${decision.summary.activeRejectRules} reject rule(s) and ${decision.summary.activeBlockRules} block rule(s).`
  };
}
