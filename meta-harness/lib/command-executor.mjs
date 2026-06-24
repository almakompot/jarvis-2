import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  appendJsonl,
  nextAppendDate,
  readJson,
  relativeArtifact,
  writeJson
} from "./runner-utils.mjs";

const commandEvidenceTypes = new Set([
  "inspection-command",
  "test-command",
  "negative-test-command",
  "build-command",
  "lint-command",
  "typecheck-command",
  "command-output",
  "cli-smoke",
  "api-smoke",
  "browser-smoke",
  "browser-extension-smoke",
  "data-fixture"
]);

const approvalRequiredReasons = new Set([
  "unsafe-git-push",
  "unsafe-pr-create",
  "unsafe-release",
  "unsafe-deploy",
  "unsafe-live-mutation",
  "unsafe-publish",
  "unsafe-send",
  "unsafe-webhook-send",
  "unsafe-live-stripe",
  "unsafe-migration",
  "unsafe-production-seed",
  "unsafe-external-api-cost"
]);

export async function runCommandProofExecutor({
  runDir,
  now = new Date(),
  timeoutMs = 30000,
  env = {},
  onlyTestIds = null
}) {
  const absoluteRunDir = resolve(runDir);
  const repoProfile = readJson(join(absoluteRunDir, "repo-profile.json"));
  const spec = readJson(join(absoluteRunDir, "spec.json"));
  const proofPlan = readJson(join(absoluteRunDir, "proof-plan.json"));
  const existingVerification = readJson(join(absoluteRunDir, "verification.json"));
  const runId = spec.runId || proofPlan.runId || basename(absoluteRunDir);
  const repoPath = repoProfile.targetPath || repoProfile.repoPath;
  const createdAt = now.toISOString();
  const eventCreatedAt = nextAppendDate(join(absoluteRunDir, "events.jsonl"), now).toISOString();
  const state = {
    runId,
    runDir: absoluteRunDir,
    repoPath,
    createdAt,
    eventCreatedAt,
    timestampIndex: 0,
    commandIndex: nextCommandIndex(existingVerification),
    evidenceIndex: nextEvidenceIndex(existingVerification),
    eventIndex: Date.now(),
    timeoutMs,
    envKeys: Object.keys(env).sort()
  };
  const commandsDir = join(absoluteRunDir, "evidence", "commands");
  mkdirSync(commandsDir, { recursive: true });

  const selectedTests = selectCommandTests({ spec, onlyTestIds });
  const events = [
    verificationEvent({
      state,
      status: "started",
      message: `M5 command proof executor selected ${selectedTests.length} command candidate(s).`
    })
  ];
  const commandLogEntries = [];
  const commandResults = [];
  const evidenceEntries = [];

  for (const testCase of selectedTests) {
    const safety = classifyCommandSafety({ command: testCase.command, repoProfile });
    const mapping = mapTestToProofs({ testCase, proofPlan });
    if (!testCase.command) {
      const blocked = blockedCommandResult({
        state,
        testCase,
        mapping,
        reason: "missing-command",
        message: "Required proof command is missing from spec.requiredTests."
      });
      commandResults.push(blocked.commandResult);
      evidenceEntries.push(blocked.evidence);
      events.push(verificationEvent({
        state,
        status: "blocked",
        message: `Missing command for ${testCase.id}.`
      }));
      continue;
    }
    if (!safety.allowed) {
      const blocked = blockedCommandResult({
        state,
        testCase,
        mapping,
        reason: safety.reason,
        message: safety.message
      });
      commandResults.push(blocked.commandResult);
      evidenceEntries.push(blocked.evidence);
      events.push(verificationEvent({
        state,
        status: "blocked",
        message: `Unsafe command blocked for ${testCase.id}: ${safety.reason}.`
      }));
      continue;
    }

    const execution = await executeCommand({
      state,
      testCase,
      mapping,
      commandsDir,
      timeoutMs,
      env
    });
    commandLogEntries.push(execution.commandLogEntry);
    commandResults.push(execution.commandResult);
    evidenceEntries.push(execution.evidence);
    events.push(verificationEvent({
      state,
      status: execution.commandResult.status,
      message: `Command ${execution.commandLogEntry.id} ${execution.commandResult.status}: ${testCase.command}.`
    }));
  }

  const verification = buildVerification({
    previous: existingVerification,
    runId,
    createdAt,
    spec,
    proofPlan,
    commandResults,
    evidenceEntries
  });
  writeJson(join(absoluteRunDir, "verification.json"), verification);
  appendJsonl(join(absoluteRunDir, "command-log.jsonl"), commandLogEntries);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), [
    ...events,
    verificationEvent({
      state,
      status: verification.status,
      message: `M5 command proof executor finished with verification status ${verification.status}.`
    })
  ]);

  return {
    runId,
    runDir: absoluteRunDir,
    status: verification.status,
    verification,
    commandResults,
    evidenceEntries,
    commandLogEntries
  };
}

export function classifyCommandSafety({ command, repoProfile = {} }) {
  if (!command || typeof command !== "string") {
    return {
      allowed: false,
      reason: "missing-command",
      message: "Command is missing."
    };
  }
  const normalized = command.trim();
  if (!normalized) {
    return {
      allowed: false,
      reason: "missing-command",
      message: "Command is empty."
    };
  }
  const unsafe = unsafeReason(normalized);
  if (unsafe) {
    return unsafe;
  }
  const scriptName = packageScriptName(normalized);
  if (scriptName) {
    const scripts = repoProfile.package?.scripts || {};
    const rawScript = scripts[scriptName];
    if (typeof rawScript === "string") {
      const rawUnsafe = unsafeReason(rawScript);
      if (rawUnsafe) {
        return {
          allowed: false,
          reason: rawUnsafe.reason,
          message: `Package script ${scriptName} is unsafe: ${rawUnsafe.message}`,
          approvalRequired: rawUnsafe.approvalRequired
        };
      }
    }
  }
  return { allowed: true, reason: "local-command", message: "Command is allowed for local proof execution." };
}

function unsafeReason(command) {
  const checks = [
    { id: "unsafe-git-push", pattern: /\bgit\s+push\b/i, message: "git push requires explicit approval." },
    { id: "unsafe-pr-create", pattern: /\bgh\s+pr\s+create\b/i, message: "PR creation requires explicit approval." },
    { id: "unsafe-release", pattern: /\bgh\s+release\s+create\b/i, message: "Release creation requires explicit approval." },
    { id: "unsafe-deploy", pattern: /\b(?:firebase|netlify|wrangler|fly)\s+deploy\b|\bcloudflare\s+(?:pages\s+)?deploy\b|\brailway\s+up\b|\bgcloud\s+run\s+deploy\b|\bsupabase\s+functions\s+deploy\b|\bvercel\b(?=[^;&|\n]*(?:\bdeploy\b|--prod\b))/i, message: "Deployment commands are not allowed as proof commands." },
    { id: "unsafe-live-mutation", pattern: /\b(?:kubectl\s+(?:apply|delete|patch|scale|rollout)|terraform\s+(?:apply|destroy)|docker\s+push|aws\s+cloudformation\s+deploy|serverless\s+deploy)\b/i, message: "Live infrastructure mutation commands require explicit approval." },
    { id: "unsafe-publish", pattern: /\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bchrome-webstore-upload\s+upload\b/i, message: "Package publish commands are not allowed as proof commands." },
    { id: "unsafe-webhook-send", pattern: /\b(?:curl|wget|http)\b[^\n]*(?:hooks\.slack\.com|discord\.com\/api\/webhooks|api\.telegram\.org\/bot)/i, message: "Webhook sending commands require explicit approval." },
    { id: "unsafe-send", pattern: /\b(?:send(?:email)?|mail|slack|post-to-slack|resend|twilio|nodemailer)\b/i, message: "Message sending commands require explicit approval." },
    { id: "unsafe-live-stripe", pattern: /\bstripe\b.*\blive\b|\blive\b.*\bstripe\b/i, message: "Live payment commands are not allowed as proof commands." },
    { id: "unsafe-migration", pattern: /\b(?:migrate|migration|db\s+push|supabase\s+db\s+push|prisma\s+(?:migrate\s+deploy|db\s+push)|drizzle-kit\s+(?:push|migrate)|knex\s+migrate)\b/i, message: "Migration commands require explicit approval." },
    { id: "unsafe-production-seed", pattern: /\b(?:seed:prod|prod:seed|production\s+seed)\b/i, message: "Production seed commands require explicit approval." },
    { id: "unsafe-external-api-cost", pattern: /(^|[;&|]\s*)(?:(?:npx|bunx)\s+|pnpm\s+dlx\s+|npm\s+exec\s+)?(?:openai|anthropic|replicate|elevenlabs|deepgram|assemblyai)\b|\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|REPLICATE_API_TOKEN|ELEVENLABS_API_KEY|DEEPGRAM_API_KEY|ASSEMBLYAI_API_KEY)\s*=|\baws\s+(?:bedrock|textract|rekognition|comprehend|sagemaker)\b|\bgcloud\s+(?:ai|ml|vision)\b|\bazure\s+(?:ai|cognitiveservices)\b/i, message: "Cost-bearing external API commands require explicit approval." },
    { id: "unsafe-env-read", pattern: /\b(?:cat|grep|rg|sed|awk|head|tail|less|more)\b[^;&|]*\.env(?:\s|$|[.*])|\b(?:node|python|ruby|perl)\b[^;&|]*(?:readFileSync|open|File\.read)[^;&|]*\.env(?:\s|$|[.*])/i, message: "Commands must not read secret env files." },
    { id: "unsafe-env-dump", pattern: /(^|[;&|]\s*)(?:env|printenv)(\s|$)/i, message: "Environment dumps are not allowed as proof commands." },
    { id: "unsafe-root-delete", pattern: /\brm\s+-rf\s+\/(?:\s|$)/i, message: "Destructive root deletion is never allowed." }
  ];
  const match = checks.find((check) => check.pattern.test(command));
  if (!match) {
    return null;
  }
  return {
    allowed: false,
    reason: match.id,
    message: match.message,
    approvalRequired: approvalRequiredForReason(match.id)
  };
}

function approvalRequiredForReason(reason) {
  return approvalRequiredReasons.has(reason);
}

function packageScriptName(command) {
  const withoutEnvPrefix = command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, "");
  const npmMatch = /\b(?:npm|pnpm|bun)(?:\s+run)?\s+([A-Za-z0-9:_-]+)/.exec(withoutEnvPrefix);
  if (npmMatch) {
    return npmMatch[1];
  }
  const yarnMatch = /\byarn\s+([A-Za-z0-9:_-]+)/.exec(withoutEnvPrefix);
  return yarnMatch?.[1] || null;
}

function selectCommandTests({ spec, onlyTestIds }) {
  const selected = Array.isArray(spec.requiredTests) ? spec.requiredTests : [];
  const allowedIds = onlyTestIds ? new Set(onlyTestIds) : null;
  return selected
    .filter((testCase) => !allowedIds || allowedIds.has(testCase.id))
    .map((testCase, index) => ({
      id: testCase.id || `T${index + 1}`,
      type: testCase.type || "repo-native-check",
      command: testCase.command || null,
      description: testCase.description || "",
      requirementIds: Array.isArray(testCase.requirementIds) ? testCase.requirementIds : []
    }));
}

function mapTestToProofs({ testCase, proofPlan }) {
  const evidenceType = evidenceTypeForTest({ testCase, taskClass: proofPlan.taskClass });
  const requirementIds = new Set(testCase.requirementIds || []);
  const proofObligationIds = (proofPlan.obligations || [])
    .filter((obligation) => intersects(requirementIds, obligation.requirementIds || []))
    .filter((obligation) => (obligation.acceptedEvidenceTypes || []).includes(evidenceType))
    .map((obligation) => obligation.id);
  return {
    evidenceType,
    proofObligationIds
  };
}

function evidenceTypeForTest({ testCase, taskClass }) {
  if (testCase.type === "build") {
    return "build-command";
  }
  if (testCase.type === "lint") {
    return "lint-command";
  }
  if (testCase.type === "typecheck") {
    return "typecheck-command";
  }
  if (testCase.type === "negative-or-edge-path") {
    return "negative-test-command";
  }
  if (testCase.type === "browser-e2e") {
    return taskClass === "browser-extension" ? "browser-extension-smoke" : "browser-smoke";
  }
  if (testCase.type === "user-smoke") {
    if (taskClass === "browser-extension") {
      return "browser-extension-smoke";
    }
    if (taskClass === "web-ui") {
      return "browser-smoke";
    }
    if (taskClass === "cli") {
      return "cli-smoke";
    }
    if (taskClass === "api") {
      return "api-smoke";
    }
    if (taskClass === "data-pipeline") {
      return "data-fixture";
    }
    return "command-output";
  }
  return "test-command";
}

function intersects(left, right) {
  return [...left].some((item) => right.includes(item));
}

async function executeCommand({ state, testCase, mapping, commandsDir, timeoutMs, env }) {
  const commandId = nextCommandId(state);
  const evidenceId = nextEvidenceId(state);
  const stdoutPath = join(commandsDir, `${commandId}.stdout.txt`);
  const stderrPath = join(commandsDir, `${commandId}.stderr.txt`);
  const startedAt = nextTimestamp(state);
  const startedHr = process.hrtime.bigint();
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;

  const child = spawn("/bin/sh", ["-lc", testCase.command], {
    cwd: state.repoPath,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  const terminal = await new Promise((resolvePromise) => {
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => resolvePromise({ exitCode: null, signal: null, error }));
    child.on("close", (exitCode, signal) => resolvePromise({ exitCode, signal, error: null }));
  });
  clearTimeout(timeout);

  const finishedAt = nextTimestamp(state);
  const durationMs = Number((process.hrtime.bigint() - startedHr) / 1000000n);
  writeFileSync(stdoutPath, Buffer.concat(stdoutChunks));
  writeFileSync(stderrPath, terminal.error ? String(terminal.error.message || terminal.error) : Buffer.concat(stderrChunks));

  const status = timedOut ? "timed-out" : terminal.error ? "blocked" : terminal.exitCode === 0 ? "passed" : "failed";
  const commandLogEntry = {
    schemaVersion: 1,
    id: commandId,
    runId: state.runId,
    phase: "verify",
    command: testCase.command,
    cwd: state.repoPath,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    timedOut,
    stdoutPath: relativeArtifact(state.runDir, stdoutPath),
    stderrPath: relativeArtifact(state.runDir, stderrPath),
    requirementIds: testCase.requirementIds,
    proofObligationIds: mapping.proofObligationIds,
    source: "m5-command-executor",
    env: {
      inherited: true,
      overrideKeys: state.envKeys
    }
  };
  const commandResult = {
    id: commandId,
    testId: testCase.id,
    type: testCase.type,
    evidenceType: mapping.evidenceType,
    command: testCase.command,
    cwd: state.repoPath,
    status,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    timedOut,
    stdoutPath: commandLogEntry.stdoutPath,
    stderrPath: commandLogEntry.stderrPath,
    requirementIds: testCase.requirementIds,
    proofObligationIds: mapping.proofObligationIds,
    evidenceIds: [evidenceId]
  };
  const evidence = {
    id: evidenceId,
    type: mapping.evidenceType,
    status,
    commandId,
    testId: testCase.id,
    path: commandLogEntry.stdoutPath,
    stdoutPath: commandLogEntry.stdoutPath,
    stderrPath: commandLogEntry.stderrPath,
    exitCode: terminal.exitCode,
    timedOut,
    requirementIds: testCase.requirementIds,
    proofObligationIds: mapping.proofObligationIds
  };
  return { commandLogEntry, commandResult, evidence };
}

function blockedCommandResult({ state, testCase, mapping, reason, message }) {
  const commandId = nextCommandId(state);
  const evidenceId = nextEvidenceId(state);
  const timestamp = nextTimestamp(state);
  const commandResult = {
    id: commandId,
    testId: testCase.id,
    type: testCase.type,
    evidenceType: mapping.evidenceType,
    command: testCase.command,
    cwd: state.repoPath,
    status: "blocked",
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    reason,
    message,
    approvalRequired: approvalRequiredForReason(reason),
    requirementIds: testCase.requirementIds,
    proofObligationIds: mapping.proofObligationIds,
    evidenceIds: [evidenceId]
  };
  const evidence = {
    id: evidenceId,
    type: mapping.evidenceType,
    status: "blocked",
    commandId,
    testId: testCase.id,
    path: null,
    exitCode: null,
    timedOut: false,
    reason,
    message,
    approvalRequired: approvalRequiredForReason(reason),
    requirementIds: testCase.requirementIds,
    proofObligationIds: mapping.proofObligationIds
  };
  return { commandResult, evidence };
}

function buildVerification({ previous, runId, createdAt, spec, proofPlan, commandResults, evidenceEntries }) {
  const previousCommands = Array.isArray(previous.commands) ? previous.commands : [];
  const previousEvidence = Array.isArray(previous.evidence) ? previous.evidence : [];
  const commands = [...previousCommands, ...commandResults];
  const evidence = [...previousEvidence, ...evidenceEntries];
  const evidenceByProof = new Map();
  for (const evidenceItem of evidence) {
    for (const proofId of evidenceItem.proofObligationIds || []) {
      if (!evidenceByProof.has(proofId)) {
        evidenceByProof.set(proofId, []);
      }
      evidenceByProof.get(proofId).push(evidenceItem);
    }
  }

  const proofObligations = proofPlan.obligations.map((obligation) => {
    const items = evidenceByProof.get(obligation.id) || [];
    const passed = items.filter((item) => item.status === "passed");
    const failed = items.filter((item) => item.status === "failed" || item.status === "timed-out");
    const blocked = items.filter((item) => item.status === "blocked");
    let status = "pending";
    if (passed.length >= obligation.minimumEvidence) {
      status = "passed";
    } else if (blocked.length > 0) {
      status = "blocked";
    } else if (failed.length > 0) {
      status = "failed";
    }
    return {
      id: obligation.id,
      status,
      evidence: passed.map((item) => item.id),
      failedEvidence: failed.map((item) => item.id),
      blockedEvidence: blocked.map((item) => item.id)
    };
  });

  const proofStatusById = new Map(proofObligations.map((proof) => [proof.id, proof.status]));
  const requirementCoverage = spec.requirements.map((requirement) => {
    const proofIds = requirement.proofObligationIds || [];
    const statuses = proofIds.map((proofId) => proofStatusById.get(proofId)).filter(Boolean);
    let status = "pending";
    if (statuses.length > 0 && statuses.every((item) => item === "passed")) {
      status = "passed";
    } else if (statuses.includes("failed")) {
      status = "failed";
    } else if (statuses.includes("blocked")) {
      status = "blocked";
    }
    return {
      requirementId: requirement.id,
      status,
      proofObligationIds: proofIds
    };
  });

  const currentStatuses = commandResults.map((command) => command.status);
  const status = statusForRun({ currentStatuses, proofObligations, commandResults });
  return {
    schemaVersion: 1,
    kind: "meta-harness.verification",
    runId,
    createdAt: previous.createdAt || createdAt,
    updatedAt: createdAt,
    status,
    scope: "m5-command-proof-executor",
    commands,
    evidence,
    requirementCoverage,
    proofObligations,
    summary: {
      executedCommands: commandResults.filter((command) => ["passed", "failed", "timed-out"].includes(command.status)).length,
      passedCommands: commandResults.filter((command) => command.status === "passed").length,
      failedCommands: commandResults.filter((command) => command.status === "failed").length,
      timedOutCommands: commandResults.filter((command) => command.status === "timed-out").length,
      blockedCommands: commandResults.filter((command) => command.status === "blocked").length,
      note: "M5 command executor records command proof only. Non-command proof remains pending for later executors."
    }
  };
}

function statusForRun({ currentStatuses, proofObligations, commandResults }) {
  if (commandResults.length === 0) {
    return "blocked";
  }
  if (currentStatuses.includes("blocked")) {
    return "blocked";
  }
  if (currentStatuses.includes("failed") || currentStatuses.includes("timed-out")) {
    return "failed";
  }
  if (proofObligations.some((proof) => proof.status === "failed")) {
    return "failed";
  }
  if (proofObligations.some((proof) => proof.status === "blocked")) {
    return "blocked";
  }
  if (proofObligations.some((proof) => proof.status === "pending")) {
    return "pending";
  }
  return currentStatuses.every((status) => status === "passed") ? "passed" : "pending";
}

function nextCommandIndex(verification) {
  return maxIndex((verification.commands || []).map((command) => command.id), /^cmd\.verify\.(\d+)$/) + 1;
}

function nextEvidenceIndex(verification) {
  return maxIndex((verification.evidence || []).map((evidence) => evidence.id), /^E\.cmd\.verify\.(\d+)$/) + 1;
}

function maxIndex(ids, pattern) {
  let max = 0;
  for (const id of ids) {
    const match = pattern.exec(String(id || ""));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

function nextCommandId(state) {
  const id = `cmd.verify.${String(state.commandIndex).padStart(4, "0")}`;
  state.commandIndex += 1;
  return id;
}

function nextEvidenceId(state) {
  const id = `E.cmd.verify.${String(state.evidenceIndex).padStart(4, "0")}`;
  state.evidenceIndex += 1;
  return id;
}

function verificationEvent({ state, status, message }) {
  state.eventIndex += 1;
  return {
    id: `event.verification.${state.eventIndex}`,
    type: "verification-event",
    phase: "verify",
    status,
    timestamp: nextTimestamp(state),
    message
  };
}

function nextTimestamp(state) {
  const base = Date.parse(state.eventCreatedAt || state.createdAt);
  const value = new Date(base + state.timestampIndex).toISOString();
  state.timestampIndex += 1;
  return value;
}
