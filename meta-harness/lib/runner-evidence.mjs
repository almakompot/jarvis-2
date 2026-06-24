import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  appendJsonl,
  nextAppendDate,
  readJson,
  writeJson
} from "./runner-utils.mjs";

const commandEvidenceTypes = new Set([
  "inspection-command",
  "test-command",
  "build-command",
  "lint-command",
  "typecheck-command"
]);

const surfaceEvidenceTypes = new Set([
  "browser-smoke",
  "browser-extension-smoke",
  "api-smoke",
  "request-response",
  "cli-smoke",
  "data-fixture",
  "generated-artifact",
  "manifest",
  "screenshot",
  "trace",
  "manual-smoke-artifact"
]);

const capturedCommandSources = new Set(["codex-cli-event", "orchestrator-command"]);

export function harvestRunnerEvidence({ runDir, now = new Date() } = {}) {
  const absoluteRunDir = resolve(runDir);
  const spec = readJson(join(absoluteRunDir, "spec.json"));
  const proofPlan = readJson(join(absoluteRunDir, "proof-plan.json"));
  const previous = readJson(join(absoluteRunDir, "verification.json"));
  const existingFinalReport = readOptionalJson(join(absoluteRunDir, "final-report.json"));
  const runnerState = readOptionalJson(join(absoluteRunDir, "runner-state.json"));
  if (previous.status === "passed" && existingFinalReport?.outcome === "passed") {
    return noOpResult({ runDir: absoluteRunDir, runId: previous.runId || basename(absoluteRunDir), status: "passed", verification: previous });
  }
  if (runnerState?.status && runnerState.status !== "implemented") {
    return noOpResult({ runDir: absoluteRunDir, runId: previous.runId || basename(absoluteRunDir), status: previous.status || "pending", verification: previous });
  }
  const finalMessage = readFinalMessage(absoluteRunDir);
  const commandLog = readJsonl(join(absoluteRunDir, "command-log.jsonl"));
  const runId = spec.runId || proofPlan.runId || basename(absoluteRunDir);
  const createdAt = now.toISOString();
  const eventCreatedAt = nextAppendDate(join(absoluteRunDir, "events.jsonl"), now).toISOString();
  const base = stripGeneratedMissingProof(previous);
  const state = {
    runDir: absoluteRunDir,
    runId,
    createdAt,
    evidenceIndex: nextHarvestEvidenceIndex(base),
    commandIndex: nextHarvestCommandIndex(base),
    surfaceIndex: nextHarvestSurfaceIndex(base)
  };

  const commands = [];
  const surfaceResults = [];
  const evidence = [];

  for (const obligation of proofPlan.obligations || []) {
    const accepted = new Set(obligation.acceptedEvidenceTypes || []);
    if (hasAccepted(accepted, ["repo-profile", "inspection-command", "file-read"])) {
      const entry = findInspectionCommand(commandLog);
      if (entry) {
        const harvested = commandEvidence({ state, entry, obligation, type: "inspection-command", testId: "runner-inspection" });
        commands.push(harvested.command);
        evidence.push(harvested.evidence);
      }
      continue;
    }
    if (hasAcceptedSet(accepted, commandEvidenceTypes)) {
      const entry = findAutomatedCheck(commandLog);
      if (entry) {
        const harvested = commandEvidence({ state, entry, obligation, type: evidenceTypeForCommandObligation(accepted), testId: "runner-automated-check" });
        commands.push(harvested.command);
        evidence.push(harvested.evidence);
      }
      continue;
    }
    if (accepted.has("negative-test-command")) {
      const entry = findNegativeCommand({ commandLog, runDir: absoluteRunDir });
      if (entry) {
        evidence.push(nonCommandEvidence({ state, entry, obligation, type: "negative-test-command", note: "Runner captured an expected failing or invalid-input path." }));
        continue;
      }
    }
    if (hasAcceptedSet(accepted, surfaceEvidenceTypes)) {
      const surface = findSurfaceEvidence({ commandLog, accepted, taskClass: spec.taskClass, runDir: absoluteRunDir });
      if (surface) {
        const harvested = surfaceEvidence({ state, entry: surface.entry, obligation, type: surface.type });
        surfaceResults.push(harvested.surfaceResult);
        evidence.push(harvested.evidence);
      }
      continue;
    }
    if (accepted.has("final-report") && finalMessage.ok) {
      evidence.push(finalReportEvidence({ state, obligation, finalMessage }));
    }
  }

  if (commands.length === 0 && surfaceResults.length === 0 && evidence.length === 0) {
    return noOpResult({ runDir: absoluteRunDir, runId, status: previous.status || "pending", verification: previous });
  }

  const verification = buildVerification({
    previous: base,
    runId,
    createdAt,
    spec,
    proofPlan,
    commands,
    surfaceResults,
    evidence
  });
  writeJson(join(absoluteRunDir, "verification.json"), verification);

  if (verification.status === "passed") {
    writeJson(join(absoluteRunDir, "final-report.json"), buildFinalReport({ runId, createdAt, spec, proofPlan, verification, finalMessage }));
  }

  appendJsonl(join(absoluteRunDir, "events.jsonl"), [{
    id: `event.runner-evidence.${Date.parse(eventCreatedAt)}`,
    type: "verification-event",
    phase: "verify",
    status: verification.status,
    timestamp: eventCreatedAt,
    artifact: "verification.json",
    message: `Runner evidence harvester added ${evidence.length} evidence item(s).`
  }]);

  return {
    runId,
    runDir: absoluteRunDir,
    status: verification.status,
    evidenceEntries: evidence,
    commandResults: commands,
    surfaceResults,
    verification
  };
}

function noOpResult({ runDir, runId, status, verification }) {
  return {
    runId,
    runDir,
    status,
    evidenceEntries: [],
    commandResults: [],
    surfaceResults: [],
    verification
  };
}

function readOptionalJson(path) {
  try {
    return existsSync(path) ? readJson(path) : null;
  } catch {
    return null;
  }
}

function stripGeneratedMissingProof(verification) {
  return {
    ...verification,
    commands: (verification.commands || []).filter((command) => !(command.id || "").startsWith("cmd.verify.") || command.reason !== "missing-command"),
    surfaceResults: (verification.surfaceResults || []).filter((surface) => !(surface.id || "").startsWith("surface.verify.") || surface.reason !== "missing-surface-proof"),
    evidence: (verification.evidence || []).filter((evidence) => {
      const id = evidence.id || "";
      return !((id.startsWith("E.cmd.verify.") && evidence.reason === "missing-command")
        || (id.startsWith("E.surface.verify.") && evidence.reason === "missing-surface-proof")
        || evidence.source === "runner-evidence-harvester");
    })
  };
}

function readFinalMessage(runDir) {
  const path = join(runDir, "evidence", "runner", "codex-final-message.txt");
  if (!existsSync(path)) {
    return { ok: false, path: null, text: "", parsed: null, residualRisks: [] };
  }
  const text = readFileSync(path, "utf8");
  const parsed = parseMaybeJson(text);
  const residualRisks = extractResidualRisks({ text, parsed });
  const hasMapping = Boolean(parsed?.evidence_by_requirement || parsed?.requirements_to_evidence || parsed?.evidence)
    || /evidence(?:\s+map|_by_requirement|_to_evidence)|R\d+\s*\/?\s*P?\d*/i.test(text);
  return {
    ok: hasMapping && residualRisks.length > 0,
    path: "evidence/runner/codex-final-message.txt",
    text,
    parsed,
    residualRisks
  };
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractResidualRisks({ text, parsed }) {
  const structured = [
    ...(Array.isArray(parsed?.remaining_risks) ? parsed.remaining_risks : []),
    ...(Array.isArray(parsed?.not_tested) ? parsed.not_tested.map((item) => `Not tested: ${item}`) : [])
  ].filter(Boolean);
  if (structured.length > 0) {
    return structured;
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const riskStart = lines.findIndex((line) => /residual risk|remaining risk|not tested/i.test(line));
  if (riskStart < 0) {
    return [];
  }
  return lines.slice(riskStart + 1)
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .slice(0, 8);
}

function readJsonl(path) {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).map((line) => JSON.parse(line));
}

function findInspectionCommand(commandLog) {
  return commandLog.find((entry) =>
    isCapturedCommand(entry)
    && entry.exitCode === 0
    && /(\bgit status\b|\brg --files\b|\bsed -n\b|\bfind\b.*AGENTS\.md|\bpwd\b|\bls\b)/i.test(entry.command || "")
    && artifactPath(entry)
  ) || null;
}

function findAutomatedCheck(commandLog) {
  const candidates = commandLog.filter((entry) =>
    isCapturedCommand(entry)
    && entry.exitCode === 0
    && /(unittest|pytest|node --test|npm (?:run )?test|compileall|py_compile|git diff --check|typecheck|lint)/i.test(entry.command || "")
    && artifactPath(entry)
  );
  return candidates.sort((left, right) => scoreAutomatedCheck(right) - scoreAutomatedCheck(left))[0] || null;
}

function scoreAutomatedCheck(entry) {
  const command = entry.command || "";
  if (/unittest(?![^']*tests\.)|pytest(?![^']*tests\/)/i.test(command)) {
    return 50;
  }
  if (/unittest|pytest|node --test|npm (?:run )?test/i.test(command)) {
    return 40;
  }
  if (/compileall|py_compile|typecheck|lint/i.test(command)) {
    return 20;
  }
  if (/git diff --check/i.test(command)) {
    return 10;
  }
  return 0;
}

function findNegativeCommand({ commandLog, runDir }) {
  return commandLog.find((entry) =>
    isCapturedCommand(entry)
    && entry.exitCode !== 0
    && /(invalid|bad|broken|negative|malformed|missing|uncertain|operations_invalid|bad-parliament|hu_parliament_malformed|scope bad|audio_source|target_not_found)/i.test(entry.command || "")
    && artifactPath(entry)
  ) || commandLog.find((entry) =>
    isCapturedCommand(entry)
    && entry.exitCode !== 0
    && artifactPath(entry)
    && /(statement_tracker|validate|check|ingest|import|review|store|parliament)/i.test(entry.command || "")
    && artifactShowsExpectedFailure({ runDir, entry })
  ) || null;
}

function artifactShowsExpectedFailure({ runDir, entry }) {
  const text = [entry.stdoutPath, entry.stderrPath]
    .filter(Boolean)
    .map((path) => readArtifactText(runDir, path))
    .join("\n");
  return /"processing_status"\s*:\s*"failed"|"status"\s*:\s*"failed"|validation failed|rejected/i.test(text)
    && /"errors"\s*:|"error_count"\s*:|no usable|malformed|missing|invalid|bad input|target_not_found/i.test(text);
}

function readArtifactText(runDir, path) {
  const fullPath = join(runDir, path);
  if (!existsSync(fullPath)) {
    return "";
  }
  return readFileSync(fullPath, "utf8").slice(0, 20000);
}

function findSurfaceEvidence({ commandLog, accepted, taskClass, runDir }) {
  const passed = commandLog.filter((entry) => isCapturedCommand(entry) && entry.exitCode === 0 && artifactPath(entry));
  if (taskClass === "data-pipeline" && hasAccepted(accepted, ["data-fixture", "generated-artifact", "manifest"])) {
    const entry = passed.find((item) => /statement_tracker\b(?![^']*--help).*(?:ingest-source|validate|check|search|review|parliament-import|parliament-check|store-check|store-export)/i.test(item.command || ""));
    return entry ? { entry, type: firstAccepted(accepted, ["data-fixture", "manifest", "generated-artifact"]) } : null;
  }
  if (taskClass === "cli" && accepted.has("cli-smoke")) {
    const entry = passed.find((item) => /statement_tracker\b(?![^']*--help)/i.test(item.command || ""));
    return entry ? { entry, type: "cli-smoke" } : null;
  }
  if (taskClass === "api" && hasAccepted(accepted, ["api-smoke", "request-response"])) {
    const httpEntry = passed.find((item) => /\b(curl|http)\b.*(localhost|127\.0\.0\.1)|request-response|api-smoke/i.test(item.command || ""));
    if (httpEntry) {
      return { entry: httpEntry, type: firstAccepted(accepted, ["api-smoke", "request-response"]) };
    }
    const dbEntry = passed.find((item) => localBackendRequestResponse({ entry: item, runDir }));
    return dbEntry ? { entry: dbEntry, type: firstAccepted(accepted, ["request-response", "api-smoke"]) } : null;
  }
  if (hasAccepted(accepted, ["browser-smoke", "screenshot", "trace"])) {
    const entry = passed.find((item) => /(playwright|browser|chromium|chrome|edge).*(screenshot|trace|goto|locator|click|page\.)/i.test(item.command || ""))
      || passed.find((item) => browserSmokeArtifact({ entry: item, runDir }));
    return entry ? { entry, type: firstAccepted(accepted, ["browser-smoke", "screenshot", "trace"]) } : null;
  }
  return null;
}

function isCapturedCommand(entry) {
  return capturedCommandSources.has(entry.source);
}

function localBackendRequestResponse({ entry, runDir }) {
  const command = entry.command || "";
  if (!/(store-load|psql|postgres|pgvector)/i.test(command)) {
    return false;
  }
  const text = readArtifactText(runDir, entry.stdoutPath || "");
  return /"status"\s*:\s*"passed"|sources=\d+|statements=\d+|embeddings=\d+/i.test(text);
}

function browserSmokeArtifact({ entry, runDir }) {
  const command = entry.command || "";
  if (!/(browser|playwright|chromium|chrome|edge)/i.test(command)) {
    return false;
  }
  const text = readArtifactText(runDir, entry.stdoutPath || "");
  return /"status"\s*:\s*"passed"/i.test(text)
    && /"screenshot"\s*:|browser-smoke|canvas|pageErrors|consoleErrors/i.test(text)
    && !/"pageErrors"\s*:\s*\[[^\]]+\]/i.test(text);
}

function commandEvidence({ state, entry, obligation, type, testId }) {
  const commandId = nextCommandId(state);
  const evidenceId = nextEvidenceId(state);
  const command = {
    id: commandId,
    testId,
    type: "runner-captured-command",
    evidenceType: type,
    command: entry.command,
    cwd: entry.cwd,
    status: "passed",
    startedAt: entry.startedAt || state.createdAt,
    finishedAt: entry.finishedAt || entry.startedAt || state.createdAt,
    durationMs: entry.durationMs || 0,
    exitCode: entry.exitCode,
    signal: entry.signal || null,
    timedOut: Boolean(entry.timedOut),
    stdoutPath: entry.stdoutPath || null,
    stderrPath: entry.stderrPath || null,
    requirementIds: obligation.requirementIds || [],
    proofObligationIds: [obligation.id],
    evidenceIds: [evidenceId],
    source: "runner-evidence-harvester",
    sourceCommandId: entry.id
  };
  return {
    command,
    evidence: baseEvidence({ state, entry, obligation, type, evidenceId, extra: { commandId, testId, sourceCommandId: entry.id } })
  };
}

function nonCommandEvidence({ state, entry, obligation, type, note }) {
  return baseEvidence({
    state,
    entry,
    obligation,
    type,
    evidenceId: nextEvidenceId(state),
    extra: {
      sourceCommandId: entry.id,
      expectedFailure: true,
      note
    }
  });
}

function surfaceEvidence({ state, entry, obligation, type }) {
  const surfaceResultId = nextSurfaceId(state);
  const evidenceId = nextEvidenceId(state);
  const surfaceResult = {
    id: surfaceResultId,
    handler: handlerForSurfaceType(type),
    evidenceType: type,
    status: "passed",
    reason: null,
    message: `Runner captured ${type} evidence from ${entry.id}.`,
    startedAt: entry.startedAt || state.createdAt,
    finishedAt: entry.finishedAt || entry.startedAt || state.createdAt,
    proofObligationIds: [obligation.id],
    requirementIds: obligation.requirementIds || [],
    evidenceIds: [evidenceId],
    path: artifactPath(entry),
    sourceCommandId: entry.id,
    source: "runner-evidence-harvester"
  };
  return {
    surfaceResult,
    evidence: baseEvidence({ state, entry, obligation, type, evidenceId, extra: { surfaceResultId, sourceCommandId: entry.id } })
  };
}

function finalReportEvidence({ state, obligation, finalMessage }) {
  return {
    id: nextEvidenceId(state),
    type: "final-report",
    status: "passed",
    path: finalMessage.path,
    requirementIds: obligation.requirementIds || [],
    proofObligationIds: [obligation.id],
    source: "runner-evidence-harvester",
    note: "Structured runner final message maps requirements to evidence and residual risk."
  };
}

function baseEvidence({ state, entry, obligation, type, evidenceId, extra = {} }) {
  const path = artifactPath(entry);
  return {
    id: evidenceId,
    type,
    status: "passed",
    path,
    stdoutPath: entry.stdoutPath || null,
    stderrPath: entry.stderrPath || null,
    artifacts: [entry.stdoutPath, entry.stderrPath].filter(Boolean),
    exitCode: entry.exitCode,
    timedOut: Boolean(entry.timedOut),
    requirementIds: obligation.requirementIds || [],
    proofObligationIds: [obligation.id],
    source: "runner-evidence-harvester",
    ...extra
  };
}

function artifactPath(entry) {
  return entry.stdoutPath || entry.stderrPath || null;
}

function buildVerification({ previous, runId, createdAt, spec, proofPlan, commands, surfaceResults, evidence }) {
  const allCommands = [...(previous.commands || []), ...commands];
  const allSurfaceResults = [...(previous.surfaceResults || []), ...surfaceResults];
  const allEvidence = [...(previous.evidence || []), ...evidence];
  const evidenceByProof = new Map();
  for (const item of allEvidence) {
    for (const proofId of item.proofObligationIds || []) {
      if (!evidenceByProof.has(proofId)) {
        evidenceByProof.set(proofId, []);
      }
      evidenceByProof.get(proofId).push(item);
    }
  }
  const proofObligations = (proofPlan.obligations || []).map((obligation) => {
    const items = evidenceByProof.get(obligation.id) || [];
    const passed = items.filter((item) => item.status === "passed");
    const failed = items.filter((item) => item.status === "failed" || item.status === "timed-out");
    const blocked = items.filter((item) => item.status === "blocked");
    return {
      id: obligation.id,
      status: passed.length >= obligation.minimumEvidence ? "passed" : failed.length > 0 ? "failed" : blocked.length > 0 ? "blocked" : "pending",
      evidence: passed.map((item) => item.id),
      failedEvidence: failed.map((item) => item.id),
      blockedEvidence: blocked.map((item) => item.id)
    };
  });
  const proofStatusById = new Map(proofObligations.map((proof) => [proof.id, proof.status]));
  const requirementCoverage = (spec.requirements || []).map((requirement) => {
    const statuses = (requirement.proofObligationIds || []).map((proofId) => proofStatusById.get(proofId)).filter(Boolean);
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
  const statuses = proofObligations.map((proof) => proof.status);
  const status = statuses.every((item) => item === "passed")
    ? "passed"
    : statuses.includes("failed")
      ? "failed"
      : statuses.includes("blocked")
        ? "blocked"
        : "pending";
  return {
    ...previous,
    schemaVersion: 1,
    kind: "meta-harness.verification",
    runId,
    updatedAt: createdAt,
    status,
    scope: "runner-evidence-harvester",
    commands: allCommands,
    surfaceResults: allSurfaceResults,
    evidence: allEvidence,
    requirementCoverage,
    proofObligations,
    summary: {
      ...(previous.summary || {}),
      harvestedRunnerEvidence: evidence.length,
      harvestedRunnerCommands: commands.length,
      harvestedRunnerSurfaces: surfaceResults.length
    }
  };
}

function buildFinalReport({ runId, createdAt, spec, proofPlan, verification, finalMessage }) {
  const evidenceForRequirements = (requirementIds) => [...new Set((verification.evidence || [])
    .filter((evidence) => intersects(requirementIds, evidence.requirementIds || []))
    .filter((evidence) => evidence.status === "passed")
    .map((evidence) => evidence.id))];
  const proofResultById = new Map((verification.proofObligations || []).map((proof) => [proof.id, proof]));
  const requirementResults = (spec.requirements || []).map((requirement) => ({
    requirementId: requirement.id,
    status: "passed",
    evidence: evidenceForRequirements([requirement.id])
  }));
  const claims = {
    repoInspection: { status: "passed", requirementIds: ["R1"], evidence: evidenceForRequirements(["R1"]) },
    implementation: { status: "passed", requirementIds: ["R2"], evidence: evidenceForRequirements(["R2"]) },
    negativeOrEdgePath: { status: "passed", requirementIds: ["R3"], evidence: evidenceForRequirements(["R3"]) },
    automatedVerification: { status: "passed", requirementIds: ["R4"], evidence: evidenceForRequirements(["R4"]) },
    userSmoke: { status: "passed", requirementIds: ["R5"], evidence: evidenceForRequirements(["R5"]) },
    requirementMapping: { status: "passed", requirementIds: ["R6"], evidence: evidenceForRequirements(["R6"]) }
  };
  return {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId,
    createdAt,
    outcome: "passed",
    claims,
    proofObligations: Object.fromEntries((proofPlan.obligations || []).map((obligation) => {
      const proof = proofResultById.get(obligation.id);
      return [obligation.id, { status: "passed", evidence: proof?.evidence || [] }];
    })),
    requirementResults,
    residualRisk: finalMessage.residualRisks.length > 0 ? finalMessage.residualRisks : ["Runner evidence was harvested from local command artifacts; no external publish/deploy proof was attempted."],
    stillUnenforced: [],
    summary: {
      source: "runner-evidence-harvester",
      runnerFinalMessage: finalMessage.path
    }
  };
}

function hasAccepted(accepted, types) {
  return types.some((type) => accepted.has(type));
}

function hasAcceptedSet(accepted, types) {
  return [...types].some((type) => accepted.has(type));
}

function firstAccepted(accepted, types) {
  return types.find((type) => accepted.has(type)) || types[0];
}

function evidenceTypeForCommandObligation(accepted) {
  return firstAccepted(accepted, ["test-command", "build-command", "lint-command", "typecheck-command"]);
}

function handlerForSurfaceType(type) {
  if (type === "api-smoke" || type === "request-response") {
    return "api";
  }
  if (type === "cli-smoke") {
    return "cli";
  }
  if (["data-fixture", "generated-artifact", "manifest"].includes(type)) {
    return "data";
  }
  if (["browser-smoke", "browser-extension-smoke"].includes(type)) {
    return "browser";
  }
  if (["screenshot", "trace"].includes(type)) {
    return "visual";
  }
  return "manual";
}

function intersects(left, right) {
  return left.some((item) => right.includes(item));
}

function nextCommandId(state) {
  const id = `cmd.runner.${String(state.commandIndex).padStart(4, "0")}`;
  state.commandIndex += 1;
  return id;
}

function nextSurfaceId(state) {
  const id = `surface.runner.${String(state.surfaceIndex).padStart(4, "0")}`;
  state.surfaceIndex += 1;
  return id;
}

function nextEvidenceId(state) {
  const id = `E.runner.${String(state.evidenceIndex).padStart(4, "0")}`;
  state.evidenceIndex += 1;
  return id;
}

function nextHarvestCommandIndex(verification) {
  return maxIndex([...(verification.commands || []).map((item) => item.id)], /^cmd\.runner\.(\d+)$/) + 1;
}

function nextHarvestSurfaceIndex(verification) {
  return maxIndex([...(verification.surfaceResults || []).map((item) => item.id)], /^surface\.runner\.(\d+)$/) + 1;
}

function nextHarvestEvidenceIndex(verification) {
  return maxIndex([...(verification.evidence || []).map((item) => item.id)], /^E\.runner\.(\d+)$/) + 1;
}

function maxIndex(values, pattern) {
  return values.reduce((max, value) => {
    const match = pattern.exec(value || "");
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}
