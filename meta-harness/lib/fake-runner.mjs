import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendJsonl,
  buildChangedFiles,
  isForbiddenPath,
  normalizeRelativePath,
  readJson,
  relativeArtifact,
  renderDiff,
  snapshotRepo,
  writeJson
} from "./runner-utils.mjs";

export const fakeRunnerScenarios = [
  "success",
  "web-ui-success",
  "browser-extension-success",
  "data-pipeline-success",
  "failed-command",
  "edit-before-inspection",
  "forbidden-edit",
  "timeout",
  "interrupt",
  "final-overclaim"
];

function hasPositiveTimeout(value) {
  return Number.isFinite(value) && value > 0;
}

export function fakeCodexProcessPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/fake-codex.mjs");
}

export async function runFakeCodex({
  runDir,
  scenario = "success",
  now = new Date(),
  totalTimeoutMs = null,
  executable = process.execPath,
  scriptPath = fakeCodexProcessPath()
}) {
  if (!fakeRunnerScenarios.includes(scenario)) {
    throw new Error(`Unknown fake runner scenario: ${scenario}`);
  }

  const absoluteRunDir = resolve(runDir);
  const repoProfile = readJson(join(absoluteRunDir, "repo-profile.json"));
  const allowedFiles = readJson(join(absoluteRunDir, "allowed-files.json"));
  const verification = readJson(join(absoluteRunDir, "verification.json"));
  const runId = repoProfile.runId || basename(absoluteRunDir);
  const repoPath = repoProfile.targetPath || repoProfile.repoPath;
  const createdAt = now.toISOString();
  const evidenceRoot = join(absoluteRunDir, "evidence");
  const runnerEvidenceDir = join(evidenceRoot, "runner");
  const commandEvidenceDir = join(evidenceRoot, "commands");
  mkdirSync(runnerEvidenceDir, { recursive: true });
  mkdirSync(commandEvidenceDir, { recursive: true });

  const command = [
    executable,
    scriptPath,
    "--scenario",
    scenario,
    "--repo",
    repoPath,
    "--run-dir",
    absoluteRunDir
  ];

  writeJson(join(absoluteRunDir, "runner-config.json"), {
    schemaVersion: 1,
    kind: "meta-harness.runner-config",
    runId,
    createdAt,
    status: "captured",
    mode: "fake-codex",
    cwd: repoPath,
    command,
    sandbox: {
      mode: "fake-local-process",
      networkAccess: "disabled",
      filesystem: "target-repo-plus-run-artifacts"
    },
    timeouts: {
      idleMs: null,
      commandMs: null,
      totalMs: totalTimeoutMs ?? null
    },
    capture: {
      transcript: "jsonl-stdout",
      commandLog: "fake-event-stream",
      diff: "filesystem-snapshot",
      changedFiles: "filesystem-snapshot",
      terminalState: "child-process-close"
    },
    promptSources: [
      "task.md",
      "repo-profile.json",
      "spec.json",
      "proof-plan.json",
      "allowed-files.json",
      "docs/fresh-repo-feature-protocol.md",
      "AGENTS.md"
    ],
    scenario
  });

  const beforeSnapshot = snapshotRepo(repoPath, allowedFiles);
  const state = createCaptureState({ runId, runDir: absoluteRunDir, repoPath, scenario, createdAt, verification });
  const runnerStdoutPath = join(runnerEvidenceDir, "fake-codex.stdout.jsonl");
  const runnerStderrPath = join(runnerEvidenceDir, "fake-codex.stderr.txt");
  let stdoutBuffer = "";
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;

  state.events.push(runnerEvent({
    state,
    phase: "run",
    status: "started",
    message: `Fake Codex runner started scenario ${scenario}.`
  }));
  state.transcriptEntries.push({
    id: nextTranscriptId(state),
    type: "prompt",
    timestamp: nextTimestamp(state),
    source: "runner",
    content: buildPromptSummary({ runDir: absoluteRunDir })
  });

  const child = spawn(executable, command.slice(1), {
    cwd: repoPath,
    stdio: ["ignore", "pipe", "pipe"]
  });
  state.pid = child.pid ?? null;

  const timeout = hasPositiveTimeout(totalTimeoutMs)
    ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, totalTimeoutMs)
    : null;

  const terminal = await new Promise((resolvePromise) => {
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdoutChunks.push(text);
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        consumeFakeEventLine({ line, state, commandEvidenceDir, allowedFiles });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    child.on("close", (exitCode, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (stdoutBuffer.trim()) {
        consumeFakeEventLine({ line: stdoutBuffer, state, commandEvidenceDir, allowedFiles });
      }
      resolvePromise({ exitCode, signal });
    });
  });

  writeFileSync(runnerStdoutPath, stdoutChunks.join(""));
  writeFileSync(runnerStderrPath, stderrChunks.join(""));

  const afterSnapshot = snapshotRepo(repoPath, allowedFiles);
  const changedFiles = buildChangedFiles({
    runId,
    createdAt,
    beforeSnapshot,
    afterSnapshot
  });
  const diffPatch = renderDiff({ changedFiles, beforeSnapshot, afterSnapshot });
  writeJson(join(absoluteRunDir, "changed-files.json"), changedFiles);
  writeFileSync(join(absoluteRunDir, "diff.patch"), diffPatch);

  if (changedFiles.files.some((file) => file.forbidden)) {
    addFailure(state, "forbidden-edit", "Runner captured changes to a forbidden file path.");
  }

  const interrupted = state.interrupted || terminal.exitCode === 130 || terminal.signal === "SIGINT";
  const status = determineRunnerStatus({ state, timedOut, interrupted, exitCode: terminal.exitCode });
  state.events.push(runnerEvent({
    state,
    phase: "run",
    status,
    message: `Fake Codex runner ended with status ${status}.`
  }));

  appendJsonl(join(absoluteRunDir, "transcript.jsonl"), state.transcriptEntries);
  appendJsonl(join(absoluteRunDir, "command-log.jsonl"), state.commandEntries);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), state.events);

  const runnerState = {
    schemaVersion: 1,
    kind: "meta-harness.runner-state",
    runId,
    createdAt,
    updatedAt: nextTimestamp(state),
    status,
    mode: "fake-codex",
    cwd: repoPath,
    process: {
      pid: state.pid,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut,
      interrupted
    },
    terminalState: {
      cwd: repoPath,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      reason: terminalReason({ status, timedOut, interrupted, failures: state.failures }),
      stdoutPath: relativeArtifact(absoluteRunDir, runnerStdoutPath),
      stderrPath: relativeArtifact(absoluteRunDir, runnerStderrPath)
    },
    counters: {
      transcriptEntries: state.transcriptEntries.length,
      commandEntries: state.commandEntries.length,
      changedFiles: changedFiles.files.length,
      events: state.events.length
    },
    failures: state.failures,
    warnings: state.warnings,
    captureCompleteness: {
      transcript: state.parseFailed ? "partial" : "captured",
      commandLog: "captured",
      diff: "captured",
      changedFiles: "captured",
      terminalState: "captured"
    },
    scenario,
    note: status === "implemented"
      ? "Implementation attempt ended cleanly. Later verification and policy still decide acceptance."
      : "Implementation attempt did not reach an acceptable runner state."
  };

  writeJson(join(absoluteRunDir, "runner-state.json"), runnerState);

  return {
    runId,
    runDir: absoluteRunDir,
    status,
    runnerState,
    changedFiles,
    diffPatch,
    commandEntries: state.commandEntries,
    transcriptEntries: state.transcriptEntries
  };
}

function createCaptureState({ runId, runDir, repoPath, scenario, createdAt, verification }) {
  return {
    runId,
    runDir,
    repoPath,
    scenario,
    createdAt,
    timestampIndex: 0,
    transcriptIndex: 0,
    commandIndex: 0,
    eventIndex: 0,
    pid: null,
    inspected: false,
    interrupted: false,
    parseFailed: false,
    verificationPassed: verification?.status === "passed",
    transcriptEntries: [],
    commandEntries: [],
    events: [],
    failures: [],
    warnings: []
  };
}

function consumeFakeEventLine({ line, state, commandEvidenceDir, allowedFiles }) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let item;
  try {
    item = JSON.parse(trimmed);
  } catch (readError) {
    state.parseFailed = true;
    state.warnings.push({
      id: "invalid-fake-jsonl",
      message: `Fake runner emitted invalid JSONL: ${readError.message}`
    });
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "raw-output",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      content: trimmed
    });
    return;
  }

  if (item.type === "assistant_message") {
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "assistant_message",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      content: String(item.content || "")
    });
    return;
  }

  if (item.type === "inspection") {
    state.inspected = true;
    state.events.push(runnerEvent({
      state,
      phase: "inspect",
      status: "passed",
      message: item.message || "Fake runner reported repository inspection."
    }));
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "tool_result",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      phase: "inspect",
      content: item.message || "inspection complete"
    });
    return;
  }

  if (item.type === "command") {
    if (item.phase === "inspect") {
      state.inspected = true;
    }
    const commandId = nextCommandId(state);
    const stdoutPath = join(commandEvidenceDir, `${commandId}.stdout.txt`);
    const stderrPath = join(commandEvidenceDir, `${commandId}.stderr.txt`);
    writeFileSync(stdoutPath, String(item.stdout || ""));
    writeFileSync(stderrPath, String(item.stderr || ""));
    const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : 0;
    const phase = item.phase || "run";
    const status = exitCode === 0 ? "passed" : "failed";
    const timestamp = nextTimestamp(state);
    state.commandEntries.push({
      id: commandId,
      phase,
      command: String(item.command || ""),
      cwd: state.repoPath,
      startedAt: timestamp,
      finishedAt: timestamp,
      exitCode,
      stdoutPath: relativeArtifact(state.runDir, stdoutPath),
      stderrPath: relativeArtifact(state.runDir, stderrPath),
      requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds : [],
      proofObligationIds: Array.isArray(item.proofObligationIds) ? item.proofObligationIds : [],
      source: "fake-codex"
    });
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "tool_call",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      tool: "shell",
      command: String(item.command || ""),
      exitCode
    });
    state.events.push(runnerEvent({
      state,
      phase,
      status,
      message: `Captured command ${commandId}: ${item.command || "(missing command)"}`
    }));
    if (exitCode !== 0) {
      addFailure(state, "failed-command", `Command ${commandId} exited ${exitCode}.`);
    }
    return;
  }

  if (item.type === "edit") {
    const path = normalizeRelativePath(item.path || "");
    if (!state.inspected) {
      addFailure(state, "edit-before-inspection", `File edit ${path || "(missing path)"} happened before inspection evidence.`);
    }
    if (path && isForbiddenPath(path, allowedFiles)) {
      addFailure(state, "forbidden-edit", `File edit ${path} matched a forbidden path policy.`);
    }
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "file_edit",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      path,
      action: item.action || "write"
    });
    state.events.push(runnerEvent({
      state,
      phase: "edit",
      status: "captured",
      message: `Captured fake file edit ${path || "(missing path)"}.`
    }));
    return;
  }

  if (item.type === "interrupt") {
    state.interrupted = true;
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "interrupt",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      content: item.message || "Fake runner interrupted."
    });
    state.events.push(runnerEvent({
      state,
      phase: "run",
      status: "interrupted",
      message: item.message || "Fake runner emitted an interrupt event."
    }));
    return;
  }

  if (item.type === "final_message") {
    const content = String(item.content || "");
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "final_message",
      timestamp: nextTimestamp(state),
      source: "fake-codex",
      content,
      claimStatus: item.claimStatus || "attempt-complete"
    });
    state.events.push(runnerEvent({
      state,
      phase: "final",
      status: "captured",
      message: "Captured fake final message."
    }));
    if (item.claimStatus === "passed" && !state.verificationPassed) {
      addFailure(state, "final-overclaim", "Final message claimed a passed task before verification passed.");
    }
    return;
  }

  state.warnings.push({
    id: "unknown-fake-event",
    message: `Ignored unknown fake event type: ${item.type || "(missing type)"}`
  });
}

function buildPromptSummary({ runDir }) {
  const spec = readJson(join(runDir, "spec.json"));
  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  return [
    `Task: ${spec.task?.title || spec.task?.raw || "(missing task)"}`,
    `Requirements: ${(spec.requirements || []).map((item) => item.id).join(", ")}`,
    `Proof obligations: ${(proofPlan.obligations || []).map((item) => item.id).join(", ")}`,
    "Final completion requires runner evidence, verification, independent review, and policy acceptance."
  ].join("\n");
}

function determineRunnerStatus({ state, timedOut, interrupted, exitCode }) {
  if (interrupted) {
    return "interrupted";
  }
  if (timedOut) {
    addFailure(state, "timeout", "Fake runner exceeded the explicitly configured total timeout.");
    return "blocked";
  }
  if (state.failures.length > 0) {
    return "rejected";
  }
  if (exitCode !== 0) {
    addFailure(state, "process-exit", `Fake runner process exited ${exitCode}.`);
    return "rejected";
  }
  return "implemented";
}

function terminalReason({ status, timedOut, interrupted, failures }) {
  if (interrupted) {
    return "interrupted";
  }
  if (timedOut) {
    return "timeout";
  }
  if (failures.length > 0) {
    return failures[0].id;
  }
  return status;
}

function addFailure(state, id, message) {
  if (!state.failures.some((failure) => failure.id === id && failure.message === message)) {
    state.failures.push({ id, message });
  }
}

function runnerEvent({ state, phase, status, message }) {
  state.eventIndex += 1;
  return {
    id: `event.runner.${String(state.eventIndex).padStart(4, "0")}`,
    type: "runner-event",
    phase,
    status,
    timestamp: nextTimestamp(state),
    scenario: state.scenario,
    message
  };
}

function nextCommandId(state) {
  state.commandIndex += 1;
  return `cmd.${String(state.commandIndex).padStart(4, "0")}`;
}

function nextTranscriptId(state) {
  state.transcriptIndex += 1;
  return `transcript.${String(state.transcriptIndex).padStart(4, "0")}`;
}

function nextTimestamp(state) {
  const base = Date.parse(state.createdAt);
  const value = new Date(base + state.timestampIndex).toISOString();
  state.timestampIndex += 1;
  return value;
}
