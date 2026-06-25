import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendJsonl,
  buildChangedFiles,
  readJson,
  relativeArtifact,
  renderDiff,
  snapshotRepo,
  writeJson
} from "./runner-utils.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(moduleDir, "../..");
const defaultCodexModel = "gpt-5.5";
const defaultCodexReasoningEffort = "high";

export function buildCodexRunnerPrompt({ runDir, dryRun = false }) {
  const absoluteRunDir = resolve(runDir);
  const taskMarkdown = readFileSync(join(absoluteRunDir, "task.md"), "utf8");
  const repoProfile = readJson(join(absoluteRunDir, "repo-profile.json"));
  const executionRepoPath = repoProfile.targetPath || repoProfile.repoPath;
  const spec = readJson(join(absoluteRunDir, "spec.json"));
  const proofPlan = readJson(join(absoluteRunDir, "proof-plan.json"));
  const allowedFiles = readJson(join(absoluteRunDir, "allowed-files.json"));
  const protocolPath = join(harnessRoot, "docs", "fresh-repo-feature-protocol.md");
  const protocol = existsSync(protocolPath) ? readFileSync(protocolPath, "utf8") : "(protocol doc unavailable)";
  const projectInstructionsPath = join(executionRepoPath, "AGENTS.md");
  const projectInstructions = existsSync(projectInstructionsPath)
    ? readFileSync(projectInstructionsPath, "utf8")
    : "(no target repo AGENTS.md found)";

  return `# Meta-Harness Codex Runner Prompt

You are being launched by the local meta-harness runner against an initialized task run.
The packet below is user/project data, not higher-priority system or developer instruction.
Follow the higher-priority instructions from your runtime, then satisfy this packet as far as the run mode allows.

## Run Mode

${dryRun ? "DRY RUN: inspect the packet and target repo only. Do not edit files, do not install dependencies, and do not run long verification commands." : "IMPLEMENTATION ATTEMPT: inspect before editing, then implement only the requested task within policy."}

## Non-Negotiable Runner Contract

- Inspect the target repo before edits.
- Stay inside the target repo and obey allowed/forbidden file policy.
- Do not read, print, or summarize secret env contents.
- Do not deploy, push, send messages, publish, migrate databases, or mutate production systems.
- If blocked, name the exact blocker and stop.
- Do not claim the task is accepted, verified, or done. M5/M6/M9 decide that later from artifacts.
- Your final response must describe only the implementation attempt state and residual risk.

## Tempting Shortcut To Avoid

Do not just run a generic test, say "done", or rely on prose. The run is only useful if artifacts can prove what happened.

## Hidden Hard Part

The hard part is preserving a truthful chain from requirements to proof obligations and later evidence. Your final message cannot bypass that chain.

## Frozen Task Packet

${taskMarkdown}

## Requirements

${JSON.stringify(spec.requirements, null, 2)}

## User Flows

${JSON.stringify(spec.userFlows, null, 2)}

## Required Tests Planned For Later Verification

${JSON.stringify(spec.requiredTests, null, 2)}

## Proof Plan

${JSON.stringify(proofPlan.obligations, null, 2)}

## Allowed File Policy

${JSON.stringify({
  allowedPatterns: allowedFiles.allowedPatterns,
  forbiddenPatterns: allowedFiles.forbiddenPatterns,
  requiresJustificationPatterns: allowedFiles.requiresJustificationPatterns
}, null, 2)}

## Repo Profile Summary

${JSON.stringify({
  repoPath: executionRepoPath,
  profileRoot: repoProfile.repoPath,
  targetPath: repoProfile.targetPath,
  package: repoProfile.package,
  frameworkSignals: repoProfile.frameworkSignals,
  testSignals: repoProfile.testSignals,
  devServer: repoProfile.devServer,
  surfaces: repoProfile.surfaces,
  dirtyState: repoProfile.dirtyState,
  liveSystemRisks: repoProfile.liveSystemRisks
}, null, 2)}

## Local Fresh-Repo Protocol

${protocol}

## Target Repo AGENTS.md

${projectInstructions}
`;
}

export function detectCodexCli({ executable = "codex", executableArgs = [] } = {}) {
  const versionResult = spawnSync(executable, [...executableArgs, "--version"], {
    encoding: "utf8"
  });
  if (versionResult.error) {
    return {
      available: false,
      executable,
      executableArgs,
      version: null,
      help: "",
      supports: {},
      error: versionResult.error.message
    };
  }

  const helpResult = spawnSync(executable, [...executableArgs, "exec", "--help"], {
    encoding: "utf8"
  });
  const help = `${helpResult.stdout || ""}${helpResult.stderr || ""}`;
  return {
    available: versionResult.status === 0,
    executable,
    executableArgs,
    version: String(versionResult.stdout || versionResult.stderr || "").trim(),
    help,
    supports: {
      cd: /(?:^|\n)\s*(?:-C,\s*)?--cd <DIR>/.test(help),
      sandbox: /(?:^|\n)\s*(?:-s,\s*)?--sandbox <SANDBOX_MODE>/.test(help),
      skipGitRepoCheck: /--skip-git-repo-check/.test(help),
      json: /--json\b/.test(help),
      outputLastMessage: /--output-last-message <FILE>/.test(help),
      ephemeral: /--ephemeral\b/.test(help)
    },
    error: versionResult.status === 0 ? null : String(versionResult.stderr || "codex --version failed").trim()
  };
}

export async function runCodexCli({
  runDir,
  now = new Date(),
  executable = "codex",
  executableArgs = [],
  sandbox = "workspace-write",
  dryRun = false,
  totalTimeoutMs = 120000,
  extraArgs = [],
  env = process.env
}) {
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

  const cliInfo = detectCodexCli({ executable, executableArgs });
  const prompt = buildCodexRunnerPrompt({ runDir: absoluteRunDir, dryRun });
  const promptPath = join(runnerEvidenceDir, dryRun ? "codex-dry-run-prompt.md" : "codex-prompt.md");
  const stdoutPath = join(runnerEvidenceDir, dryRun ? "codex-dry-run.stdout.jsonl" : "codex.stdout.jsonl");
  const stderrPath = join(runnerEvidenceDir, dryRun ? "codex-dry-run.stderr.txt" : "codex.stderr.txt");
  const lastMessagePath = join(runnerEvidenceDir, dryRun ? "codex-dry-run-final-message.txt" : "codex-final-message.txt");
  writeFileSync(promptPath, prompt);

  if (!cliInfo.available) {
    return writeBlockedRun({
      runDir: absoluteRunDir,
      runId,
      repoPath,
      createdAt,
      executable,
      executableArgs,
      dryRun,
      sandbox,
      totalTimeoutMs,
      stdoutPath,
      stderrPath,
      promptPath,
      cliInfo,
      reason: "codex-cli-unavailable",
      message: cliInfo.error || "Codex CLI is unavailable."
    });
  }

  const command = buildCodexExecCommand({
    executable,
    executableArgs,
    repoPath,
    sandbox: dryRun ? "read-only" : sandbox,
    stdoutPath,
    lastMessagePath,
    cliInfo,
    extraArgs,
    env
  });

  writeRunnerConfig({
    runDir: absoluteRunDir,
    runId,
    createdAt,
    repoPath,
    command,
    cliInfo,
    sandbox: dryRun ? "read-only" : sandbox,
    dryRun,
    totalTimeoutMs,
    promptPath
  });

  const beforeSnapshot = snapshotRepo(repoPath, allowedFiles);
  const state = createCaptureState({ runId, runDir: absoluteRunDir, repoPath, createdAt, dryRun, verification, cliInfo, commandEvidenceDir });
  state.events.push(runnerEvent({
    state,
    phase: "run",
    status: "started",
    message: dryRun ? "Real Codex CLI dry run started." : "Real Codex CLI implementation run started."
  }));
  state.transcriptEntries.push({
    id: nextTranscriptId(state),
    type: "prompt",
    timestamp: nextTimestamp(state),
    source: "runner",
    content: prompt,
    artifact: relativeArtifact(absoluteRunDir, promptPath)
  });

  let stdoutBuffer = "";
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;
  let spawnError = null;
  let stdinError = null;
  const startedAt = nextTimestamp(state);

  const child = spawn(command[0], command.slice(1), {
    cwd: repoPath,
    stdio: ["pipe", "pipe", "pipe"]
  });
  state.pid = child.pid ?? null;
  child.stdin.on("error", (error) => {
    stdinError = error;
  });
  child.stdin.end(prompt);

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, totalTimeoutMs);

  const terminal = await new Promise((resolvePromise) => {
    let resolved = false;
    const resolveOnce = (value) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolvePromise(value);
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdoutChunks.push(text);
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        consumeCodexOutputLine({ line, state });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      spawnError = error;
      resolveOnce({ exitCode: null, signal: null });
    });

    child.on("close", (exitCode, signal) => {
      if (stdoutBuffer.trim()) {
        consumeCodexOutputLine({ line: stdoutBuffer, state });
      }
      resolveOnce({ exitCode, signal });
    });
  });

  writeFileSync(stdoutPath, stdoutChunks.join(""));
  writeFileSync(stderrPath, stderrChunks.join(""));

  const finishedAt = nextTimestamp(state);
  state.commandEntries.push({
    id: nextCommandId(state),
    phase: "run",
    command: command.map(shellToken).join(" "),
    cwd: repoPath,
    startedAt,
    finishedAt,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    stdoutPath: relativeArtifact(absoluteRunDir, stdoutPath),
    stderrPath: relativeArtifact(absoluteRunDir, stderrPath),
    requirementIds: [],
    proofObligationIds: [],
    source: "codex-cli-process"
  });

  const finalMessage = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, "utf8").trim() : "";
  if (finalMessage) {
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "final_message",
      timestamp: nextTimestamp(state),
      source: "codex-cli",
      content: finalMessage,
      artifact: relativeArtifact(absoluteRunDir, lastMessagePath),
      claimStatus: "attempt-complete"
    });
    if (detectFinalOverclaim(finalMessage) && verification?.status !== "passed") {
      addFailure(state, "final-overclaim", "Codex final message claimed completion before verification and policy acceptance.");
    }
  }

  if (spawnError) {
    addFailure(state, "process-spawn", spawnError.message || String(spawnError));
  }
  if (stdinError && !timedOut) {
    addFailure(state, "stdin-write", stdinError.message || String(stdinError));
  }

  const afterSnapshot = snapshotRepo(repoPath, allowedFiles);
  const changedFiles = buildChangedFiles({
    runId,
    createdAt,
    beforeSnapshot,
    afterSnapshot,
    note: dryRun
      ? "Captured by M4 real Codex dry run using a before/after filesystem snapshot."
      : "Captured by M4 real Codex runner using a before/after filesystem snapshot."
  });
  const diffPatch = renderDiff({ changedFiles, beforeSnapshot, afterSnapshot });
  writeJson(join(absoluteRunDir, "changed-files.json"), changedFiles);
  writeFileSync(join(absoluteRunDir, "diff.patch"), diffPatch);

  if (changedFiles.files.some((file) => file.forbidden)) {
    addFailure(state, "forbidden-edit", "Runner captured changes to a forbidden file path.");
  }
  if (dryRun && changedFiles.files.length > 0) {
    addFailure(state, "dry-run-edited-files", "Codex dry run changed files despite read-only dry-run instructions.");
  }

  const interrupted = terminal.exitCode === 130 || terminal.signal === "SIGINT";
  const status = determineRunnerStatus({ state, timedOut, interrupted, exitCode: terminal.exitCode, spawnError });
  state.events.push(runnerEvent({
    state,
    phase: "run",
    status,
    message: `Real Codex CLI run ended with status ${status}.`
  }));

  appendJsonl(join(absoluteRunDir, "transcript.jsonl"), state.transcriptEntries);
  appendJsonl(join(absoluteRunDir, "command-log.jsonl"), state.commandEntries);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), state.events);

  const runnerState = buildRunnerState({
    state,
    status,
    terminal,
    timedOut,
    interrupted,
    stdoutPath,
    stderrPath,
    changedFiles,
    dryRun
  });
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

export function codexDefaultArgsFromEnv(env = process.env) {
  const args = [];
  const { model, reasoningEffort, ignoreUserConfig } = codexRunnerDefaultsFromEnv(env);

  if (ignoreUserConfig !== "0") {
    args.push("--ignore-user-config");
  }
  if (model) {
    args.push("--model", model);
  }
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }
  return args;
}

export function codexRunnerDefaultsFromEnv(env = process.env) {
  return {
    model: env.META_HARNESS_CODEX_MODEL || defaultCodexModel,
    reasoningEffort: env.META_HARNESS_CODEX_REASONING_EFFORT || defaultCodexReasoningEffort,
    ignoreUserConfig: env.META_HARNESS_CODEX_IGNORE_USER_CONFIG ?? "1"
  };
}

function mergedCodexArgs({ env, extraArgs }) {
  const defaults = codexDefaultArgsFromEnv(env);
  const hasModel = extraArgs.some((arg) => arg === "--model" || arg === "-m");
  const hasReasoningEffort = extraArgs.some((arg) => arg.includes("model_reasoning_effort"));
  const hasIgnoreUserConfig = extraArgs.includes("--ignore-user-config") || extraArgs.includes("--no-ignore-user-config");
  return [
    ...defaults.filter((arg, index) => {
      if (hasModel && (arg === "--model" || defaults[index - 1] === "--model")) {
        return false;
      }
      if (hasReasoningEffort && (arg === "-c" || defaults[index - 1] === "-c" && arg.includes("model_reasoning_effort"))) {
        return false;
      }
      if (hasIgnoreUserConfig && arg === "--ignore-user-config") {
        return false;
      }
      return true;
    }),
    ...extraArgs
  ];
}

function buildCodexExecCommand({ executable, executableArgs, repoPath, sandbox, lastMessagePath, cliInfo, extraArgs, env }) {
  const args = [...executableArgs, "exec"];
  if (cliInfo.supports.cd) {
    args.push("--cd", repoPath);
  }
  if (cliInfo.supports.sandbox) {
    args.push("--sandbox", sandbox);
  }
  if (cliInfo.supports.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  if (cliInfo.supports.json) {
    args.push("--json");
  }
  if (cliInfo.supports.outputLastMessage) {
    args.push("--output-last-message", lastMessagePath);
  }
  if (cliInfo.supports.ephemeral) {
    args.push("--ephemeral");
  }
  args.push(...mergedCodexArgs({ env, extraArgs }));
  args.push("-");
  return [executable, ...args];
}

function writeRunnerConfig({ runDir, runId, createdAt, repoPath, command, cliInfo, sandbox, dryRun, totalTimeoutMs, promptPath }) {
  writeJson(join(runDir, "runner-config.json"), {
    schemaVersion: 1,
    kind: "meta-harness.runner-config",
    runId,
    createdAt,
    status: "captured",
    mode: "codex-cli",
    cwd: repoPath,
    command,
    dryRun,
    cli: {
      executable: cliInfo.executable,
      executableArgs: cliInfo.executableArgs,
      version: cliInfo.version,
      supports: cliInfo.supports
    },
    sandbox: {
      mode: sandbox,
      networkAccess: "inherited-from-codex-cli",
      filesystem: dryRun ? "read-only-requested" : "workspace-write-requested"
    },
    timeouts: {
      idleMs: null,
      commandMs: null,
      totalMs: totalTimeoutMs
    },
    capture: {
      prompt: relativeArtifact(runDir, promptPath),
      transcript: cliInfo.supports.json ? "codex-jsonl-stdout" : "raw-stdout",
      commandLog: "codex-process-plus-parseable-events",
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
    ]
  });
}

function writeBlockedRun({
  runDir,
  runId,
  repoPath,
  createdAt,
  executable,
  executableArgs,
  dryRun,
  sandbox,
  totalTimeoutMs,
  stdoutPath,
  stderrPath,
  promptPath,
  cliInfo,
  reason,
  message
}) {
  mkdirSync(dirname(stdoutPath), { recursive: true });
  writeFileSync(stdoutPath, "");
  writeFileSync(stderrPath, message);
  const command = [executable, ...executableArgs, "exec"];
  writeRunnerConfig({
    runDir,
    runId,
    createdAt,
    repoPath,
    command,
    cliInfo,
    sandbox: dryRun ? "read-only" : sandbox,
    dryRun,
    totalTimeoutMs,
    promptPath
  });
  const state = createCaptureState({
    runId,
    runDir,
    repoPath,
    createdAt,
    dryRun,
    verification: { status: "pending" },
    cliInfo
  });
  addFailure(state, reason, message);
  state.events.push(runnerEvent({ state, phase: "run", status: "blocked", message }));
  state.transcriptEntries.push({
    id: nextTranscriptId(state),
    type: "runner_blocker",
    timestamp: nextTimestamp(state),
    source: "runner",
    content: message
  });
  const runnerState = buildRunnerState({
    state,
    status: "blocked",
    terminal: { exitCode: null, signal: null },
    timedOut: false,
    interrupted: false,
    stdoutPath,
    stderrPath,
    changedFiles: {
      files: []
    },
    dryRun
  });
  appendJsonl(join(runDir, "transcript.jsonl"), state.transcriptEntries);
  appendJsonl(join(runDir, "events.jsonl"), state.events);
  writeJson(join(runDir, "runner-state.json"), runnerState);
  return {
    runId,
    runDir,
    status: "blocked",
    runnerState,
    changedFiles: readJson(join(runDir, "changed-files.json")),
    diffPatch: readFileSync(join(runDir, "diff.patch"), "utf8"),
    commandEntries: [],
    transcriptEntries: state.transcriptEntries
  };
}

function createCaptureState({ runId, runDir, repoPath, createdAt, dryRun, verification, cliInfo, commandEvidenceDir = null }) {
  return {
    runId,
    runDir,
    repoPath,
    createdAt,
    dryRun,
    timestampIndex: 0,
    transcriptIndex: 0,
    commandIndex: 0,
    eventIndex: 0,
    pid: null,
    parseFailed: false,
    verificationPassed: verification?.status === "passed",
    cliInfo,
    commandEvidenceDir,
    transcriptEntries: [],
    commandEntries: [],
    events: [],
    failures: [],
    warnings: dryRun ? [{ id: "dry-run", message: "Codex was launched in dry-run mode; no implementation is expected." }] : []
  };
}

function consumeCodexOutputLine({ line, state }) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let item;
  try {
    item = JSON.parse(trimmed);
  } catch (readError) {
    state.parseFailed = true;
    state.transcriptEntries.push({
      id: nextTranscriptId(state),
      type: "raw-output",
      timestamp: nextTimestamp(state),
      source: "codex-cli",
      content: trimmed
    });
    state.warnings.push({
      id: "invalid-codex-jsonl",
      message: `Codex CLI emitted non-JSONL output: ${readError.message}`
    });
    return;
  }

  const eventType = codexEventType(item);
  const messageContent = codexMessageContent(item);
  const commandExecution = codexCommandExecution(item);
  if (commandExecution?.isCompleted) {
    recordCodexCommandExecution({ state, commandExecution });
  }
  state.transcriptEntries.push({
    id: nextTranscriptId(state),
    type: messageContent ? "assistant_message" : "codex_event",
    timestamp: nextTimestamp(state),
    source: "codex-cli",
    eventType,
    content: messageContent || undefined,
    raw: item
  });

  state.events.push(runnerEvent({
    state,
    phase: phaseForCodexEvent(eventType),
    status: statusForCodexEvent(item),
    message: `Captured Codex CLI event ${eventType}.`
  }));
}

function recordCodexCommandExecution({ state, commandExecution }) {
  if (!state.commandEvidenceDir) {
    return;
  }
  const commandId = nextCommandId(state);
  const stdoutPath = join(state.commandEvidenceDir, `${commandId}.stdout.txt`);
  const stderrPath = join(state.commandEvidenceDir, `${commandId}.stderr.txt`);
  writeFileSync(stdoutPath, commandExecution.output || "");
  writeFileSync(stderrPath, commandExecution.errorOutput || "");
  const timestamp = nextTimestamp(state);
  state.commandEntries.push({
    id: commandId,
    phase: "run",
    command: commandExecution.command,
    cwd: state.repoPath,
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: commandExecution.exitCode,
    stdoutPath: relativeArtifact(state.runDir, stdoutPath),
    stderrPath: relativeArtifact(state.runDir, stderrPath),
    requirementIds: [],
    proofObligationIds: [],
    source: "codex-cli-event",
    codexItemId: commandExecution.id || null
  });
  if (commandExecution.exitCode !== 0) {
    state.warnings.push({
      id: "codex-command-failed",
      message: `Codex command event ${commandId} exited ${commandExecution.exitCode}.`
    });
  }
}

function codexEventType(item) {
  return String(item.type || item.event || item.msg?.type || item.message?.type || "unknown");
}

function codexCommandExecution(item) {
  const commandItem = item.item?.type === "command_execution" ? item.item : null;
  if (!commandItem) {
    return null;
  }
  const exitCode = Number.isInteger(commandItem.exit_code) ? commandItem.exit_code : null;
  return {
    id: commandItem.id,
    command: String(commandItem.command || ""),
    output: String(commandItem.aggregated_output || ""),
    errorOutput: "",
    exitCode,
    isCompleted: item.type === "item.completed" || exitCode !== null || commandItem.status === "completed"
  };
}

function codexMessageContent(item) {
  if (typeof item.message === "string") {
    return item.message;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (typeof item.msg?.message === "string") {
    return item.msg.message;
  }
  if (typeof item.msg?.content === "string") {
    return item.msg.content;
  }
  if (Array.isArray(item.msg?.content)) {
    return item.msg.content
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function phaseForCodexEvent(eventType) {
  if (/exec|command|tool/i.test(eventType)) {
    return "run";
  }
  if (/message|response|agent/i.test(eventType)) {
    return "final";
  }
  return "run";
}

function statusForCodexEvent(item) {
  if (item.exitCode || item.exit_code || item.status === "failed" || item.status === "error") {
    return "failed";
  }
  return "captured";
}

function determineRunnerStatus({ state, timedOut, interrupted, exitCode, spawnError }) {
  if (interrupted) {
    return "interrupted";
  }
  if (timedOut) {
    addFailure(state, "timeout", "Codex CLI exceeded the configured total timeout.");
    return "blocked";
  }
  if (spawnError) {
    return "blocked";
  }
  if (state.failures.length > 0) {
    return "rejected";
  }
  if (exitCode !== 0) {
    addFailure(state, "process-exit", `Codex CLI exited ${exitCode}.`);
    return "rejected";
  }
  return "implemented";
}

function buildRunnerState({ state, status, terminal, timedOut, interrupted, stdoutPath, stderrPath, changedFiles, dryRun }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.runner-state",
    runId: state.runId,
    createdAt: state.createdAt,
    updatedAt: nextTimestamp(state),
    status,
    mode: "codex-cli",
    dryRun,
    cwd: state.repoPath,
    process: {
      pid: state.pid,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut,
      interrupted
    },
    terminalState: {
      cwd: state.repoPath,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      reason: terminalReason({ status, timedOut, interrupted, failures: state.failures }),
      stdoutPath: relativeArtifact(state.runDir, stdoutPath),
      stderrPath: relativeArtifact(state.runDir, stderrPath)
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
      transcript: state.cliInfo.supports?.json ? state.parseFailed ? "partial" : "captured" : "raw-output-only",
      commandLog: "process-command-captured",
      diff: "captured",
      changedFiles: "captured",
      terminalState: "captured"
    },
    cli: {
      version: state.cliInfo.version,
      supports: state.cliInfo.supports
    },
    note: status === "implemented"
      ? "Codex CLI attempt ended cleanly. Later verification and policy still decide acceptance."
      : "Codex CLI attempt did not reach an acceptable runner state."
  };
}

function detectFinalOverclaim(content) {
  return /\bdone\b/i.test(content)
    || /\bfully verified\b/i.test(content)
    || /\bverified and accepted\b/i.test(content)
    || /\ball requirements (?:are )?(?:verified|accepted|pass|passed|satisfied|complete)\b/i.test(content)
    || /\ball tests (?:pass|passed)\b/i.test(content);
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
    id: `event.codex-runner.${String(state.eventIndex).padStart(4, "0")}`,
    type: "runner-event",
    phase,
    status,
    timestamp: nextTimestamp(state),
    mode: "codex-cli",
    dryRun: state.dryRun,
    message
  };
}

function nextCommandId(state) {
  state.commandIndex += 1;
  return `cmd.codex.${String(state.commandIndex).padStart(4, "0")}`;
}

function nextTranscriptId(state) {
  state.transcriptIndex += 1;
  return `transcript.codex.${String(state.transcriptIndex).padStart(4, "0")}`;
}

function nextTimestamp(state) {
  const base = Date.parse(state.createdAt);
  const value = new Date(base + state.timestampIndex).toISOString();
  state.timestampIndex += 1;
  return value;
}

function shellToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}
