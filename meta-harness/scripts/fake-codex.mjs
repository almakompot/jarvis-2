#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const repoPath = resolve(args.repo);

try {
  await runScenario(args.scenario);
} catch (error) {
  emit({
    type: "final_message",
    claimStatus: "failed",
    content: `Fake Codex process failed: ${error.message || String(error)}`
  });
  process.exitCode = 1;
}

async function runScenario(scenario) {
  if (scenario === "success") {
    emit({ type: "assistant_message", content: "I am inspecting the repository before editing." });
    emit({
      type: "command",
      phase: "inspect",
      command: "ls package.json src",
      exitCode: 0,
      stdout: "package.json\nsrc\n"
    });
    emit({ type: "inspection", message: "Package and source tree inspected before edits." });
    writeRepoFile("src/site-gate.js", "export function shouldGate(url) {\n  return Boolean(url);\n}\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "command",
      phase: "verify",
      command: "npm test -- --runInBand",
      exitCode: 0,
      stdout: "ok 1 - gate behavior\n",
      proofObligationIds: ["P2"]
    });
    emit({
      type: "final_message",
      claimStatus: "attempt-complete",
      content: "Implementation attempt finished; verification and policy still need to accept it."
    });
    return;
  }

  if (scenario === "failed-command") {
    emit({ type: "assistant_message", content: "I inspected first, then implemented a change." });
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile("src/site-gate.js", "export const broken = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "command",
      phase: "verify",
      command: "npm test -- --runInBand",
      exitCode: 1,
      stdout: "not ok 1 - gate behavior\n",
      stderr: "Expected confirmation prompt to render.\n",
      proofObligationIds: ["P2", "P4"]
    });
    emit({ type: "final_message", claimStatus: "failed", content: "Verification failed." });
    return;
  }

  if (scenario === "edit-before-inspection") {
    writeRepoFile("src/site-gate.js", "export const editedTooSoon = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection happened after an edit." });
    emit({ type: "final_message", claimStatus: "attempt-complete", content: "Attempt finished." });
    return;
  }

  if (scenario === "forbidden-edit") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile(".env", "TOKEN=fake-runner-secret\n");
    emit({ type: "edit", path: ".env", action: "write" });
    emit({ type: "final_message", claimStatus: "attempt-complete", content: "Attempt finished after forbidden edit." });
    return;
  }

  if (scenario === "timeout") {
    emit({ type: "assistant_message", content: "Starting a long-running fake Codex operation." });
    await new Promise(() => {
      setInterval(() => {}, 1000);
    });
    return;
  }

  if (scenario === "interrupt") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    emit({ type: "interrupt", message: "User interrupted the fake run." });
    process.exit(130);
  }

  if (scenario === "final-overclaim") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile("src/site-gate.js", "export const unverified = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "final_message",
      claimStatus: "passed",
      content: "Done. All requirements are fully verified and accepted."
    });
    return;
  }

  throw new Error(`Unknown fake scenario: ${scenario}`);
}

function writeRepoFile(path, content) {
  const absolutePath = join(repoPath, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function emit(item) {
  process.stdout.write(`${JSON.stringify(item)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    scenario: "success",
    repo: null,
    runDir: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--scenario") {
      parsed.scenario = argv[++index];
    } else if (item === "--repo") {
      parsed.repo = argv[++index];
    } else if (item === "--run-dir") {
      parsed.runDir = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  if (!parsed.repo) {
    throw new Error("--repo is required.");
  }
  if (!parsed.runDir) {
    throw new Error("--run-dir is required.");
  }

  return parsed;
}
