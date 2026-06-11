#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { caseRelative, ensureCleanDir, ensureExists, loadCase, parseArgs, repoRoot, requiredArg, runCommand, writeCommandLog, writeJson } from "./lib.mjs";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const { caseDir, manifest } = loadCase(requiredArg(args, "case"));
if (manifest.goal?.humanReviewed !== true && args["allow-unreviewed-goal"] !== true) {
  throw new Error("Refusing to run agents: goal.humanReviewed is false. Review goal.md for leakage or pass --allow-unreviewed-goal.");
}
const variants = args.variant ? [args.variant] : ["baseline", "resilient"];
const model = args.model || "gpt-5.5";
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const runRoot = resolve(process.cwd(), args["run-root"] || join(repoRoot, "tmp", "voovo-pr-replay"));
const runDir = join(runRoot, manifest.caseId, timestamp);
mkdirSync(runDir, { recursive: true });
const runSummaries = [];

for (const variant of variants) {
  const variantDir = join(runDir, variant);
  const workdir = join(variantDir, "workdir");
  prepareWorkspace(manifest, caseDir, workdir);

  if (variant === "resilient") {
    installResilientSkill(workdir);
  }

  const prompt = buildPrompt(variant, readFileSync(caseRelative(caseDir, manifest.goal.path), "utf8"));
  const promptPath = join(variantDir, "prompt.md");
  const finalPath = join(variantDir, "final.md");
  mkdirSync(variantDir, { recursive: true });
  writeFileSync(promptPath, prompt);

  const codex = spawnSync(
    "codex",
    [
      "exec",
      "--cd",
      workdir,
      "-m",
      model,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--output-last-message",
      finalPath,
      prompt
    ],
    {
      cwd: workdir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 50
    }
  );

  writeFileSync(join(variantDir, "codex.stderr.log"), codex.stderr || "");
  writeFileSync(join(variantDir, "codex.stdout.log"), codex.stdout || "");

  const diff = runCommand("git diff --binary", workdir);
  writeCommandLog(join(variantDir, "git-diff.log"), diff);
  writeFileSync(join(variantDir, "implementation.patch"), diff.stdout);

  const changed = runCommand("git diff --name-status", workdir);
  writeCommandLog(join(variantDir, "changed-files.log"), changed);
  writeFileSync(join(variantDir, "changed-files.txt"), changed.stdout);

  writeJson(join(variantDir, "run-summary.json"), {
    variant,
    model,
    workdir,
    codexStatus: codex.status,
    finalPath,
    promptPath,
    implementationPatchPath: join(variantDir, "implementation.patch")
  });
  runSummaries.push({
    variant,
    codexStatus: codex.status,
    workdir,
    finalPath
  });

  console.log(`${variant}: codex=${codex.status} workdir=${workdir}`);
}

const checks = spawnSync("node", [join(repoRoot, "evals", "voovo-pr-replay", "scripts", "run-checks.mjs"), "--case", caseDir, "--run-dir", runDir], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 20
});
writeFileSync(join(runDir, "run-checks.stdout.log"), checks.stdout || "");
writeFileSync(join(runDir, "run-checks.stderr.log"), checks.stderr || "");
process.stdout.write(checks.stdout || "");
process.stderr.write(checks.stderr || "");

writeJson(join(runDir, "summary.json"), {
  caseId: manifest.caseId,
  runDir,
  variants,
  runs: runSummaries,
  checksStatus: checks.status
});

console.log(`Run output: ${runDir}`);
const codexFailures = runSummaries.filter((summary) => summary.codexStatus !== 0);
if (codexFailures.length > 0) {
  console.error("Codex run failures:");
  for (const failure of codexFailures) {
    console.error(`- ${failure.variant}: ${failure.codexStatus}`);
  }
  process.exit(1);
}
if (checks.status !== 0) {
  process.exit(checks.status || 1);
}

function prepareWorkspace(manifest, caseDir, workdir) {
  if (manifest.workspace.kind === "copy-fixture") {
    ensureCleanDir(workdir);
    const fixturePath = resolve(caseDir, manifest.workspace.fixturePath);
    ensureExists(fixturePath, "fixturePath");
    cpSync(fixturePath, workdir, {
      recursive: true,
      filter: (source) => !source.includes("/node_modules/") && !source.includes("/.git/")
    });
    const init = runCommand("git init && git add -A && git -c user.name='Jarvis Replay' -c user.email='jarvis-replay@example.invalid' commit -m 'fixture base'", workdir);
    if (init.status !== 0) {
      writeCommandLog(join(dirname(workdir), "fixture-git-init.log"), init);
      throw new Error(`fixture git init failed for ${manifest.caseId}`);
    }
    return;
  }

  if (manifest.workspace.kind === "git-worktree") {
    rmSync(workdir, { recursive: true, force: true });
    mkdirSync(dirname(workdir), { recursive: true });
    ensureExists(manifest.workspace.sourceRepo, "workspace.sourceRepo");
    const add = runCommand(`git worktree add --detach ${shellQuote(workdir)} ${shellQuote(manifest.workspace.baseRef)}`, manifest.workspace.sourceRepo);
    if (add.status !== 0) {
      writeCommandLog(join(dirname(workdir), "worktree-add.log"), add);
      throw new Error(`git worktree add failed for ${manifest.caseId}`);
    }
    return;
  }

  throw new Error(`Unsupported workspace kind: ${manifest.workspace.kind}`);
}

function installResilientSkill(workdir) {
  const skillSource = join(repoRoot, ".agents", "skills", "resilient-execution");
  const skillTarget = join(workdir, ".agents", "skills", "resilient-execution");
  mkdirSync(dirname(skillTarget), { recursive: true });
  cpSync(skillSource, skillTarget, { recursive: true });
}

function buildPrompt(variant, goal) {
  if (variant === "baseline") {
    return goal;
  }
  return [
    "Use $resilient-execution at Level 3.",
    "",
    "You are reimplementing a real merged PR from an outcome-only brief. Do not ask for or search for the merged implementation.",
    "",
    "Before editing, name the tempting shortcut, hidden hard part, and proof of success. Final answer must repeat those plus exact verification and remaining risk.",
    "",
    goal
  ].join("\n");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
