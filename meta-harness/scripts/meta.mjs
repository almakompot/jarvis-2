#!/usr/bin/env node

import process from "node:process";

import { notifyBlockedRun, notifyCompletionRun } from "../lib/block-notifier.mjs";
import {
  cleanupRuns,
  createRerun,
  promoteFailureFromCli,
  renderRunReport,
  runMetaCommand,
  runVerifyPipeline,
  writeRunReport
} from "../lib/report-ux.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";

try {
  const { command, args } = parseTopLevel(process.argv.slice(2));
  if (!command || command === "help" || args.help) {
    printHelp();
    process.exit(0);
  }

  if (command === "init") {
    const parsed = parseInitArgs(args.rest);
    const result = initTaskRun({
      repoPath: parsed.repo,
      task: parsed.task,
      runId: parsed.id,
      overwrite: parsed.overwrite
    });
    console.log(`Created task run: ${result.runDir}`);
    console.log(`Run id: ${result.runId}`);
    console.log(`Next: meta run --run ${result.runDir}`);
  } else if (command === "run") {
    const parsed = parseRunArgs(args.rest);
    if (!parsed.runDir) {
      const initialized = initTaskRun({
        repoPath: parsed.repo,
        task: parsed.task,
        runId: parsed.id,
        overwrite: parsed.overwrite
      });
      parsed.runDir = initialized.runDir;
      console.log(`Created task run: ${initialized.runDir}`);
      console.log(`Run id: ${initialized.runId}`);
    }
    const result = await runMetaCommand(parsed);
    console.log(`Runner status: ${result.status}`);
    console.log(`Run dir: ${result.runDir}`);
    if (result.status === "blocked") {
      emitBlockedNotification({
        runDir: result.runDir,
        phase: "run",
        reason: blockedRunReason(result),
        resumeCommand: `npm run meta -- run --run ${result.runDir}`
      });
    }
    process.exit(result.status === "implemented" ? 0 : result.status === "blocked" ? 3 : 2);
  } else if (command === "verify") {
    const parsed = parseVerifyArgs(args.rest);
    const result = await runVerifyPipeline(parsed);
    console.log(`Verification pipeline status: ${result.status}`);
    console.log(`Run dir: ${result.runDir}`);
    for (const step of result.steps) {
      console.log(`- ${step.name}: ${step.status} (${step.count})`);
    }
    if (result.status === "blocked") {
      emitBlockedNotification({
        runDir: result.runDir,
        phase: "verify",
        reason: blockedVerifyReason(result),
        resumeCommand: `npm run meta -- verify --run ${result.runDir}`
      });
    } else if (result.status === "accepted") {
      emitCompletionNotification({
        runDir: result.runDir,
        phase: "verify",
        reason: completionVerifyReason(result),
        nextCommand: `npm run meta -- report --run ${result.runDir} --format text`
      });
    }
    process.exit(result.status === "accepted" ? 0 : result.status === "blocked" ? 3 : result.status === "rejected" ? 2 : 0);
  } else if (command === "report") {
    const parsed = parseReportArgs(args.rest);
    if (parsed.output) {
      const result = writeRunReport(parsed);
      console.log(`Report written: ${result.outputPath}`);
    } else if (parsed.format === "html") {
      const result = writeRunReport(parsed);
      console.log(`Report written: ${result.outputPath}`);
    } else {
      process.stdout.write(renderRunReport(parsed));
    }
  } else if (command === "rerun") {
    const parsed = parseRerunArgs(args.rest);
    const result = createRerun(parsed);
    console.log(`Created child run: ${result.runDir}`);
    console.log(`Run id: ${result.runId}`);
    console.log(`Parent: ${result.parentRunId}`);
  } else if (command === "promote-failure") {
    const parsed = parsePromoteArgs(args.rest);
    const result = promoteFailureFromCli(parsed);
    console.log(`Promoted failure skeleton: ${result.caseDir}`);
    console.log("Privacy: private-staging; sanitize and minimize before committing.");
  } else if (command === "cleanup") {
    const parsed = parseCleanupArgs(args.rest);
    const result = cleanupRuns(parsed);
    console.log(`Run root: ${result.runRoot}`);
    console.log(`Mode: ${result.dryRun ? "dry-run" : "delete"}`);
    console.log(`Harness run folders: ${result.candidates.length}`);
    for (const candidate of result.candidates) {
      console.log(`- ${candidate}`);
    }
    if (!result.dryRun) {
      console.log(`Deleted: ${result.deleted.length}`);
    }
  } else {
    throw new Error(`Unknown meta command: ${command}`);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseTopLevel(argv) {
  const command = argv[0] || null;
  return {
    command,
    args: {
      help: argv.includes("--help") || argv.includes("-h"),
      rest: argv.slice(1)
    }
  };
}

function emitBlockedNotification({ runDir, phase, reason, resumeCommand }) {
  const notification = notifyBlockedRun({ runDir, phase, reason, resumeCommand });
  if (notification.status === "sent") {
    console.error(`Blocked notification sent: ${notification.artifact}`);
  } else {
    console.error(`Blocked notification ${notification.status}: ${notification.skipReason || notification.failure || "unknown"}`);
  }
}

function emitCompletionNotification({ runDir, phase, reason, nextCommand }) {
  const notification = notifyCompletionRun({ runDir, phase, reason, nextCommand });
  if (notification.status === "sent") {
    console.error(`Completion notification sent: ${notification.artifact}`);
  } else {
    console.error(`Completion notification ${notification.status}: ${notification.skipReason || notification.failure || "unknown"}`);
  }
}

function blockedRunReason(result) {
  return result.runnerState?.failures?.[0]?.message
    || result.runnerState?.terminalState?.reason
    || "Runner stopped with a blocked status.";
}

function blockedVerifyReason(result) {
  return result.policy?.decisionReason
    || result.steps.find((step) => step.status === "blocked")?.name
    || "Verification stopped with a blocked status.";
}

function completionVerifyReason(result) {
  return result.policy?.decisionReason
    || "Policy accepted. Required proof passed and residual risk is recorded.";
}

function parseInitArgs(argv) {
  const args = { repo: null, task: null, id: null, overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--repo") {
      args.repo = argv[++index];
    } else if (item === "--task") {
      args.task = argv[++index];
    } else if (item === "--id") {
      args.id = argv[++index];
    } else if (item === "--overwrite") {
      args.overwrite = true;
    } else {
      throw new Error(`Unknown init argument: ${item}`);
    }
  }
  if (!args.repo || !args.task) {
    throw new Error("meta init requires --repo and --task");
  }
  return args;
}

function parseRunArgs(argv) {
  const args = {
    runDir: null,
    repo: null,
    task: null,
    id: null,
    overwrite: false,
    executable: "codex",
    sandbox: "workspace-write",
    codexArgs: [],
    dryRun: false,
    fake: false,
    scenario: "success",
    timeoutMs: 120000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run" || item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--repo") {
      args.repo = argv[++index];
    } else if (item === "--task") {
      args.task = argv[++index];
    } else if (item === "--id") {
      args.id = argv[++index];
    } else if (item === "--overwrite") {
      args.overwrite = true;
    } else if (item === "--executable") {
      args.executable = argv[++index];
    } else if (item === "--sandbox") {
      args.sandbox = argv[++index];
    } else if (item === "--codex-arg" || item === "--codex-extra-arg") {
      args.codexArgs.push(argv[++index]);
    } else if (item === "--dry-run") {
      args.dryRun = true;
    } else if (item === "--fake") {
      args.fake = true;
    } else if (item === "--scenario") {
      args.scenario = argv[++index];
    } else if (item === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index]);
    } else {
      throw new Error(`Unknown run argument: ${item}`);
    }
  }
  if (!args.runDir && (!args.repo || !args.task)) {
    throw new Error("meta run requires either --run or both --repo and --task");
  }
  return args;
}

function parseVerifyArgs(argv) {
  const args = {
    runDir: null,
    commandTimeoutMs: 30000,
    surfaceTimeoutMs: 30000,
    skipCommands: false,
    skipSurfaces: false,
    skipVerifier: false,
    skipPolicy: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run" || item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--command-timeout-ms") {
      args.commandTimeoutMs = Number(argv[++index]);
    } else if (item === "--surface-timeout-ms") {
      args.surfaceTimeoutMs = Number(argv[++index]);
    } else if (item === "--skip-commands") {
      args.skipCommands = true;
    } else if (item === "--skip-surfaces") {
      args.skipSurfaces = true;
    } else if (item === "--skip-verifier") {
      args.skipVerifier = true;
    } else if (item === "--skip-policy") {
      args.skipPolicy = true;
    } else {
      throw new Error(`Unknown verify argument: ${item}`);
    }
  }
  requireRun(args.runDir);
  return args;
}

function parseReportArgs(argv) {
  const args = { runDir: null, format: "text", outputPath: null, output: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run" || item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--format") {
      args.format = argv[++index];
    } else if (item === "--output") {
      args.outputPath = argv[++index];
      args.output = true;
    } else {
      throw new Error(`Unknown report argument: ${item}`);
    }
  }
  requireRun(args.runDir);
  return args;
}

function parseRerunArgs(argv) {
  const args = { fromRunDir: null, runId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--from") {
      args.fromRunDir = argv[++index];
    } else if (item === "--id") {
      args.runId = argv[++index];
    } else {
      throw new Error(`Unknown rerun argument: ${item}`);
    }
  }
  if (!args.fromRunDir) {
    throw new Error("meta rerun requires --from");
  }
  return args;
}

function parsePromoteArgs(argv) {
  const args = {
    runDir: null,
    category: null,
    caseId: null,
    title: null,
    corpusRoot: "corpus/meta-harness"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--run" || item === "--run-dir") {
      args.runDir = argv[++index];
    } else if (item === "--category") {
      args.category = argv[++index];
    } else if (item === "--case-id") {
      args.caseId = argv[++index];
    } else if (item === "--title") {
      args.title = argv[++index];
    } else if (item === "--corpus-root") {
      args.corpusRoot = argv[++index];
    } else {
      throw new Error(`Unknown promote-failure argument: ${item}`);
    }
  }
  requireRun(args.runDir);
  if (!args.category || !args.caseId) {
    throw new Error("meta promote-failure requires --category and --case-id");
  }
  return args;
}

function parseCleanupArgs(argv) {
  const args = { repoPath: null, dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--repo") {
      args.repoPath = argv[++index];
    } else if (item === "--dry-run") {
      args.dryRun = true;
    } else if (item === "--delete") {
      args.dryRun = false;
    } else {
      throw new Error(`Unknown cleanup argument: ${item}`);
    }
  }
  if (!args.repoPath) {
    throw new Error("meta cleanup requires --repo");
  }
  return args;
}

function requireRun(runDir) {
  if (!runDir) {
    throw new Error("--run is required");
  }
}

function printHelp() {
  console.log(`Usage:
  meta init --repo /path/to/repo --task "build X" [--id run-id]
  meta run --repo /path/to/repo --task "build X" [--id run-id] [--dry-run] [--codex-arg arg]
  meta run --run /path/to/.task-runs/<id> [--dry-run]
  meta verify --run /path/to/.task-runs/<id>
  meta report --run /path/to/.task-runs/<id> [--format text|html] [--output path]
  meta rerun --from /path/to/.task-runs/<id> [--id child-id]
  meta promote-failure --run /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset
  meta cleanup --repo /path/to/repo [--dry-run|--delete]

The CLI is a thin M8 product surface over the run-folder artifacts. JSON artifacts remain authoritative.`);
}
