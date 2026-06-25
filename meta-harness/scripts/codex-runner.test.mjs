import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCodexRunnerPrompt, codexDefaultArgsFromEnv, detectCodexCli, runCodexCli } from "../lib/codex-runner.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";

test("real Codex wrapper builds prompt from the frozen task packet", (t) => {
  const { repo, runDir } = createRun("codex-prompt");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const prompt = buildCodexRunnerPrompt({ runDir, dryRun: true });

  assert.match(prompt, /Meta-Harness Codex Runner Prompt/);
  assert.match(prompt, /DRY RUN/);
  assert.match(prompt, /build a chrome extension that asks before opening every page/);
  assert.match(prompt, /Proof Plan/);
  assert.match(prompt, /Do not claim the task is accepted, verified, or done/);
});

test("real Codex wrapper detects supported CLI flags", (t) => {
  const fakeCli = createFakeCodexCli(t);
  const info = detectCodexCli({ executable: process.execPath, executableArgs: [fakeCli] });

  assert.equal(info.available, true);
  assert.equal(info.version, "codex-cli 999.0.0-test");
  assert.equal(info.supports.cd, true);
  assert.equal(info.supports.sandbox, true);
  assert.equal(info.supports.json, true);
  assert.equal(info.supports.outputLastMessage, true);
  assert.equal(info.supports.ephemeral, true);
});

test("real Codex wrapper builds model defaults from environment", () => {
  assert.deepEqual(codexDefaultArgsFromEnv({}), [
    "--ignore-user-config",
    "--model",
    "gpt-5.5",
    "-c",
    'model_reasoning_effort="high"'
  ]);
  assert.deepEqual(
    codexDefaultArgsFromEnv({
      META_HARNESS_CODEX_MODEL: "gpt-custom",
      META_HARNESS_CODEX_REASONING_EFFORT: "medium",
      META_HARNESS_CODEX_IGNORE_USER_CONFIG: "0"
    }),
    ["--model", "gpt-custom", "-c", 'model_reasoning_effort="medium"']
  );
});

test("real Codex wrapper injects env model defaults into runner command", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-env-defaults");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    env: {
      META_HARNESS_CODEX_MODEL: "gpt-env",
      META_HARNESS_CODEX_REASONING_EFFORT: "high"
    },
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "implemented");
  const runnerConfig = readJson(join(runDir, "runner-config.json"));
  assert.ok(runnerConfig.command.includes("--ignore-user-config"));
  assert.ok(runnerConfig.command.includes("--model"));
  assert.ok(runnerConfig.command.includes("gpt-env"));
  assert.ok(runnerConfig.command.includes('model_reasoning_effort="high"'));
});

test("explicit Codex args override env model defaults", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-explicit-model");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    env: {
      META_HARNESS_CODEX_MODEL: "gpt-env",
      META_HARNESS_CODEX_REASONING_EFFORT: "high"
    },
    extraArgs: ["--model", "gpt-explicit", "-c", 'model_reasoning_effort="medium"'],
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "implemented");
  const command = readJson(join(runDir, "runner-config.json")).command;
  assert.ok(command.includes("gpt-explicit"));
  assert.ok(command.includes('model_reasoning_effort="medium"'));
  assert.equal(command.includes("gpt-env"), false);
});

test("real Codex wrapper captures process output, transcript, diff, changed files, and runner state", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-capture");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli]
  });

  assert.equal(result.status, "implemented");
  assert.equal(result.runnerState.mode, "codex-cli");
  assert.equal(result.runnerState.failures.length, 0);
  assert.ok(result.commandEntries.some((entry) => entry.source === "codex-cli-event"));
  assert.ok(result.commandEntries.some((entry) => entry.source === "codex-cli-process"));
  assert.ok(result.transcriptEntries.some((entry) => entry.source === "runner" && entry.type === "prompt"));
  assert.ok(result.transcriptEntries.some((entry) => entry.source === "codex-cli"));
  assert.ok(result.changedFiles.files.some((file) => file.path === "src/real-codex-runner.js" && file.status === "added"));
  assert.match(readFileSync(join(runDir, "diff.patch"), "utf8"), /diff --git a\/src\/real-codex-runner\.js b\/src\/real-codex-runner\.js/);
  const runnerConfig = readJson(join(runDir, "runner-config.json"));
  assert.match(JSON.stringify(runnerConfig), /codex-cli 999\.0\.0-test/);
  assert.equal(runnerConfig.timeouts.totalMs, null);
  assert.equal(readJson(join(runDir, "final-report.json")).outcome, "pending");
  assertStructuralValidation(runDir);
});

test("real Codex wrapper executes in targetPath when the target is nested under a Git root", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "meta-harness-codex-nested-parent-")));
  const repo = join(parent, "target-app");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(parent, "README.md"), "# Parent Git Root\n");
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`);
  execFileSync("git", ["init"], { cwd: parent, stdio: "ignore" });

  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a chrome extension that asks before opening every page",
    runId: "codex-nested-target"
  }).runDir;

  const profile = readJson(join(runDir, "repo-profile.json"));
  assert.equal(profile.repoPath, parent);
  assert.equal(profile.targetPath, repo);

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "implemented");
  assert.equal(result.runnerState.cwd, repo);
  assert.ok(result.changedFiles.files.some((file) => file.path === "src/real-codex-runner.js"));
  assertStructuralValidation(runDir);
});

test("real Codex dry run captures artifacts without implementation edits or final-report bypass", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-dry-run");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    dryRun: true,
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "implemented");
  assert.equal(result.runnerState.dryRun, true);
  assert.equal(result.changedFiles.files.length, 0);
  assert.equal(readFileSync(join(runDir, "diff.patch"), "utf8"), "");
  assert.equal(readJson(join(runDir, "final-report.json")).outcome, "pending");
  assert.ok(result.runnerState.warnings.some((warning) => warning.id === "dry-run"));
  assertStructuralValidation(runDir);
});

test("real Codex wrapper blocks unavailable CLI before claiming a run", async (t) => {
  const { repo, runDir } = createRun("codex-unavailable");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: "/definitely/not/a/codex",
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assertFailure(result.runnerState, "codex-cli-unavailable");
  assert.equal(readJson(join(runDir, "final-report.json")).outcome, "pending");
  assertStructuralValidation(runDir);
});

test("real Codex wrapper blocks timed-out Codex process", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-timeout");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    extraArgs: ["--fake-scenario", "timeout"],
    totalTimeoutMs: 50
  });

  assert.equal(result.status, "blocked");
  assertFailure(result.runnerState, "timeout");
  assert.equal(result.runnerState.process.timedOut, true);
  assert.equal(result.runnerState.terminalState.reason, "timeout");
  assertStructuralValidation(runDir);
});

test("real Codex wrapper rejects final overclaim from Codex output", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-overclaim");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    extraArgs: ["--fake-scenario", "overclaim"],
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "rejected");
  assertFailure(result.runnerState, "final-overclaim");
  assert.equal(readJson(join(runDir, "final-report.json")).outcome, "pending");
  assertStructuralValidation(runDir);
});

test("real Codex wrapper does not reject explicit not-fully-verified final output", async (t) => {
  const fakeCli = createFakeCodexCli(t);
  const { repo, runDir } = createRun("codex-not-fully-verified");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const result = await runCodexCli({
    runDir,
    executable: process.execPath,
    executableArgs: [fakeCli],
    extraArgs: ["--fake-scenario", "not-fully-verified"],
    totalTimeoutMs: 1000
  });

  assert.equal(result.status, "implemented");
  assert.equal(result.runnerState.failures.length, 0);
  assert.ok(result.runnerState.warnings.length === 0);
  assertStructuralValidation(runDir);
});

function createRun(runId) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-codex-runner-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Codex Runner Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a chrome extension that asks before opening every page",
    runId
  }).runDir;
  return { repo, runDir };
}

function createFakeCodexCli(t) {
  const dir = mkdtempSync(join(tmpdir(), "meta-harness-fake-codex-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "fake-codex-cli.mjs");
  writeFileSync(path, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 999.0.0-test");
  process.exit(0);
}
if (args[0] === "exec" && args.includes("--help")) {
  console.log(\`Usage: codex exec [OPTIONS] [PROMPT]
  -C, --cd <DIR>
  -s, --sandbox <SANDBOX_MODE>
      --skip-git-repo-check
      --json
  -o, --output-last-message <FILE>
      --ephemeral\`);
  process.exit(0);
}
if (args[0] !== "exec") {
  console.error("unknown fake codex command");
  process.exit(1);
}

const repoPath = valueAfter("--cd");
const lastMessagePath = valueAfter("--output-last-message");
const scenario = valueAfter("--fake-scenario") || "implementation";
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", async () => {
  if (scenario === "timeout") {
    emit({ type: "agent_message", message: "Starting long fake Codex run." });
    await new Promise(() => setInterval(() => {}, 1000));
    return;
  }

  if (prompt.includes("DRY RUN")) {
    writeLast("Dry run captured task packet; no implementation changes.");
    emit({ type: "item.completed", item: { id: "fake_cmd_1", type: "command_execution", command: "ls package.json", aggregated_output: "package.json\\n", exit_code: 0, status: "completed" } });
    emit({ type: "agent_message", message: "Dry-run packet inspection complete." });
    return;
  }

  if (scenario === "overclaim") {
    writeLast("Done. All requirements are verified and accepted.");
    emit({ type: "agent_message", message: "Done. All requirements are verified and accepted." });
    return;
  }

  if (scenario === "not-fully-verified") {
    const target = join(repoPath, "src", "real-codex-runner.js");
    emit({ type: "item.completed", item: { id: "fake_cmd_1", type: "command_execution", command: "ls package.json", aggregated_output: "package.json\\n", exit_code: 0, status: "completed" } });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "export const realCodexRunner = true;\\n");
    writeLast("Implemented, but not fully verified.");
    emit({ type: "agent_message", message: "Implemented, but not fully verified." });
    return;
  }

  const target = join(repoPath, "src", "real-codex-runner.js");
  emit({ type: "item.completed", item: { id: "fake_cmd_1", type: "command_execution", command: "ls package.json", aggregated_output: "package.json\\n", exit_code: 0, status: "completed" } });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "export const realCodexRunner = true;\\n");
  writeLast("Implementation attempt changed src/real-codex-runner.js; verification still pending.");
  emit({ type: "agent_message", message: "Implemented a fake runner change." });
});

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function writeLast(content) {
  if (lastMessagePath) {
    mkdirSync(dirname(lastMessagePath), { recursive: true });
    writeFileSync(lastMessagePath, content);
  }
}

function emit(item) {
  process.stdout.write(JSON.stringify(item) + "\\n");
}
`);
  return path;
}

function assertFailure(runnerState, id) {
  assert.ok(runnerState.failures.some((failure) => failure.id === id), `Missing failure ${id}`);
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
