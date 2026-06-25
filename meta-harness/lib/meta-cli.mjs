import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { notifyBlockedRun, notifyCompletionRun } from "./block-notifier.mjs";
import { detectCodexCli, codexRunnerDefaultsFromEnv } from "./codex-runner.mjs";
import {
  cleanupRuns,
  createRerun,
  promoteFailureFromCli,
  renderRunReport,
  runMetaCommand,
  runVerifyPipeline,
  writeRunReport
} from "./report-ux.mjs";
import { initTaskRun } from "./task-packet.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(moduleDir, "../..");

export async function runMetaCli({
  argv = process.argv.slice(2),
  commandName = "meta",
  notificationPrefix = "npm run meta --",
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env
} = {}) {
  try {
    const { command, args } = parseTopLevel(argv);
    if (!command || command === "help" || args.help) {
      printHelp({ commandName, stdout });
      return 0;
    }

    if (command === "init") {
      const parsed = parseInitArgs(args.rest, commandName);
      const result = initTaskRun({
        repoPath: parsed.repo,
        task: parsed.task,
        runId: parsed.id,
        overwrite: parsed.overwrite
      });
      writeLine(stdout, `Created task run: ${result.runDir}`);
      writeLine(stdout, `Run id: ${result.runId}`);
      writeLine(stdout, `Next: ${formatCommand(notificationPrefix, "run", ["--run", result.runDir])}`);
      return 0;
    }

    if (command === "run") {
      const parsed = parseRunArgs(args.rest, commandName);
      if (!parsed.runDir) {
        const initialized = initTaskRun({
          repoPath: parsed.repo,
          task: parsed.task,
          runId: parsed.id,
          overwrite: parsed.overwrite
        });
        parsed.runDir = initialized.runDir;
        writeLine(stdout, `Created task run: ${initialized.runDir}`);
        writeLine(stdout, `Run id: ${initialized.runId}`);
      }
      const result = await runMetaCommand(parsed);
      writeLine(stdout, `Runner status: ${result.status}`);
      writeLine(stdout, `Run dir: ${result.runDir}`);
      if (result.status === "blocked") {
        emitBlockedNotification({
          runDir: result.runDir,
          phase: "run",
          reason: blockedRunReason(result),
          resumeCommand: formatCommand(notificationPrefix, "run", ["--run", result.runDir]),
          stderr,
          env
        });
      }
      return result.status === "implemented" ? 0 : result.status === "blocked" ? 3 : 2;
    }

    if (command === "verify") {
      const parsed = parseVerifyArgs(args.rest);
      const result = await runVerifyPipeline(parsed);
      writeLine(stdout, `Verification pipeline status: ${result.status}`);
      writeLine(stdout, `Run dir: ${result.runDir}`);
      for (const step of result.steps) {
        writeLine(stdout, `- ${step.name}: ${step.status} (${step.count})`);
      }
      if (result.status === "blocked") {
        emitBlockedNotification({
          runDir: result.runDir,
          phase: "verify",
          reason: blockedVerifyReason(result),
          resumeCommand: formatCommand(notificationPrefix, "verify", ["--run", result.runDir]),
          stderr,
          env
        });
      } else if (result.status === "accepted") {
        emitCompletionNotification({
          runDir: result.runDir,
          phase: "verify",
          reason: completionVerifyReason(result),
          nextCommand: formatCommand(notificationPrefix, "report", ["--run", result.runDir, "--format", "text"]),
          stderr,
          env
        });
      }
      return result.status === "accepted" ? 0 : result.status === "blocked" ? 3 : result.status === "rejected" ? 2 : 0;
    }

    if (command === "report") {
      const parsed = parseReportArgs(args.rest);
      if (parsed.output || parsed.format === "html") {
        const result = writeRunReport(parsed);
        writeLine(stdout, `Report written: ${result.outputPath}`);
      } else {
        stdout.write(renderRunReport(parsed));
      }
      return 0;
    }

    if (command === "rerun") {
      const parsed = parseRerunArgs(args.rest, commandName);
      const result = createRerun(parsed);
      writeLine(stdout, `Created child run: ${result.runDir}`);
      writeLine(stdout, `Run id: ${result.runId}`);
      writeLine(stdout, `Parent: ${result.parentRunId}`);
      return 0;
    }

    if (command === "promote-failure") {
      const parsed = parsePromoteArgs(args.rest, commandName);
      const result = promoteFailureFromCli(parsed);
      writeLine(stdout, `Promoted failure skeleton: ${result.caseDir}`);
      writeLine(stdout, "Privacy: private-staging; sanitize and minimize before committing.");
      return 0;
    }

    if (command === "cleanup") {
      const parsed = parseCleanupArgs(args.rest, commandName);
      const result = cleanupRuns(parsed);
      writeLine(stdout, `Run root: ${result.runRoot}`);
      writeLine(stdout, `Mode: ${result.dryRun ? "dry-run" : "delete"}`);
      writeLine(stdout, `Harness run folders: ${result.candidates.length}`);
      for (const candidate of result.candidates) {
        writeLine(stdout, `- ${candidate}`);
      }
      if (!result.dryRun) {
        writeLine(stdout, `Deleted: ${result.deleted.length}`);
      }
      return 0;
    }

    if (command === "doctor") {
      const parsed = parseDoctorArgs(args.rest);
      const result = runDoctor({ ...parsed, env });
      if (parsed.json) {
        writeLine(stdout, JSON.stringify(result, null, 2));
      } else {
        writeLine(stdout, renderDoctorReport(result));
      }
      return result.status === "passed" ? 0 : 2;
    }

    throw new Error(`Unknown ${commandName} command: ${command}`);
  } catch (error) {
    writeLine(stderr, error.message || String(error));
    return 1;
  }
}

export function runDoctor({ executable = "codex", env = process.env } = {}) {
  const checks = [];
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  addCheck(checks, {
    id: "node.version",
    status: nodeMajor >= 20 ? "passed" : "failed",
    message: `Node ${nodeVersion}`,
    detail: "Requires Node >=20."
  });
  for (const file of [
    "package.json",
    "meta-harness/lib/meta-cli.mjs",
    "meta-harness/lib/codex-runner.mjs",
    "docs/fresh-repo-feature-protocol.md"
  ]) {
    addCheck(checks, {
      id: `file.${file}`,
      status: existsSync(join(harnessRoot, file)) ? "passed" : "failed",
      message: file,
      detail: "Required packaged harness file."
    });
  }

  const codex = detectCodexCli({ executable });
  addCheck(checks, {
    id: "codex.version",
    status: codex.available ? "passed" : "failed",
    message: codex.available ? codex.version : codex.error,
    detail: `${executable} --version`
  });

  const defaults = codexRunnerDefaultsFromEnv(env);
  const packageJson = readPackageJson();
  const failed = checks.filter((check) => check.status !== "passed");
  return {
    schemaVersion: 1,
    kind: "jarvis.doctor",
    status: failed.length === 0 ? "passed" : "failed",
    package: {
      name: packageJson.name || null,
      version: packageJson.version || null,
      private: Boolean(packageJson.private),
      root: harnessRoot
    },
    defaults,
    checks
  };
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

function emitBlockedNotification({ runDir, phase, reason, resumeCommand, stderr, env }) {
  const notification = notifyBlockedRun({ runDir, phase, reason, resumeCommand, env });
  if (notification.status === "sent") {
    writeLine(stderr, `Blocked notification sent: ${notification.artifact}`);
  } else {
    writeLine(stderr, `Blocked notification ${notification.status}: ${notification.skipReason || notification.failure || "unknown"}`);
  }
}

function emitCompletionNotification({ runDir, phase, reason, nextCommand, stderr, env }) {
  const notification = notifyCompletionRun({ runDir, phase, reason, nextCommand, env });
  if (notification.status === "sent") {
    writeLine(stderr, `Completion notification sent: ${notification.artifact}`);
  } else {
    writeLine(stderr, `Completion notification ${notification.status}: ${notification.skipReason || notification.failure || "unknown"}`);
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

function parseInitArgs(argv, commandName) {
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
    throw new Error(`${commandName} init requires --repo and --task`);
  }
  return args;
}

function parseRunArgs(argv, commandName) {
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
    throw new Error(`${commandName} run requires either --run or both --repo and --task`);
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

function parseRerunArgs(argv, commandName) {
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
    throw new Error(`${commandName} rerun requires --from`);
  }
  return args;
}

function parsePromoteArgs(argv, commandName) {
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
    throw new Error(`${commandName} promote-failure requires --category and --case-id`);
  }
  return args;
}

function parseCleanupArgs(argv, commandName) {
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
    throw new Error(`${commandName} cleanup requires --repo`);
  }
  return args;
}

function parseDoctorArgs(argv) {
  const args = { executable: "codex", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--executable") {
      args.executable = argv[++index];
    } else if (item === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown doctor argument: ${item}`);
    }
  }
  return args;
}

function requireRun(runDir) {
  if (!runDir) {
    throw new Error("--run is required");
  }
}

function printHelp({ commandName, stdout }) {
  writeLine(stdout, `Usage:
  ${commandName} init --repo /path/to/repo --task "build X" [--id run-id]
  ${commandName} run --repo /path/to/repo --task "build X" [--id run-id] [--dry-run] [--codex-arg arg]
  ${commandName} run --run /path/to/.task-runs/<id> [--dry-run]
  ${commandName} verify --run /path/to/.task-runs/<id>
  ${commandName} report --run /path/to/.task-runs/<id> [--format text|html] [--output path]
  ${commandName} rerun --from /path/to/.task-runs/<id> [--id child-id]
  ${commandName} promote-failure --run /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset
  ${commandName} cleanup --repo /path/to/repo [--dry-run|--delete]
  ${commandName} doctor [--executable codex] [--json]

The CLI is a thin M8 product surface over the run-folder artifacts. JSON artifacts remain authoritative.`);
}

function renderDoctorReport(result) {
  const lines = [
    `Jarvis doctor: ${result.status}`,
    `Package: ${result.package.name}@${result.package.version}${result.package.private ? " (private)" : ""}`,
    `Root: ${result.package.root}`,
    "Defaults:",
    `- META_HARNESS_CODEX_MODEL=${result.defaults.model}`,
    `- META_HARNESS_CODEX_REASONING_EFFORT=${result.defaults.reasoningEffort}`,
    `- META_HARNESS_CODEX_IGNORE_USER_CONFIG=${result.defaults.ignoreUserConfig}`,
    "Checks:",
    ...result.checks.map((check) => `- ${check.status} ${check.id}: ${check.message}`)
  ];
  return lines.join("\n");
}

function addCheck(checks, { id, status, message, detail }) {
  checks.push({ id, status, message: message || "", detail: detail || "" });
}

function readPackageJson() {
  const path = join(harnessRoot, "package.json");
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function formatCommand(prefix, command, args = []) {
  return [prefix, command, ...args.map(shellToken)].join(" ");
}

function shellToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function writeLine(stream, text = "") {
  stream.write(`${text}\n`);
}
