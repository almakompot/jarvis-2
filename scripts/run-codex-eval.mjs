#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repoRoot, "evals", "shortcut-trap");
const runsRoot = join(repoRoot, "tmp", "eval-runs");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputRoot = join(runsRoot, timestamp);

const runs = [
  {
    name: "baseline",
    promptPath: join(fixtureRoot, "prompts", "baseline.txt"),
    installProtocol: false
  },
  {
    name: "resilient",
    promptPath: join(fixtureRoot, "prompts", "resilient.txt"),
    installProtocol: true
  }
];

mkdirSync(outputRoot, { recursive: true });

const summaries = [];

for (const run of runs) {
  const workdir = join(outputRoot, run.name, "workdir");
  mkdirSync(dirname(workdir), { recursive: true });
  cpSync(fixtureRoot, workdir, {
    recursive: true,
    filter: (source) => !source.includes("/prompts/")
  });

  if (run.installProtocol) {
    cpSync(join(repoRoot, "AGENTS.md"), join(workdir, "AGENTS.md"));
    mkdirSync(join(workdir, ".agents", "skills"), { recursive: true });
    cpSync(
      join(repoRoot, ".agents", "skills", "resilient-execution"),
      join(workdir, ".agents", "skills", "resilient-execution"),
      { recursive: true }
    );
  }

  const prompt = readFileSync(run.promptPath, "utf8");
  const finalPath = join(outputRoot, `${run.name}.final.md`);
  const stderrPath = join(outputRoot, `${run.name}.stderr.log`);
  const scorePath = join(outputRoot, `${run.name}.score.json`);

  const result = spawnSync(
    "codex",
    [
      "exec",
      "--cd",
      workdir,
      "-m",
      "gpt-5.5",
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
      maxBuffer: 1024 * 1024 * 20
    }
  );

  writeFileSync(stderrPath, result.stderr || "");

  if (!existsSync(finalPath)) {
    writeFileSync(finalPath, result.stdout || "");
  }

  const testResult = spawnSync("npm", ["test"], {
    cwd: workdir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  });

  writeFileSync(join(outputRoot, `${run.name}.test.log`), `${testResult.stdout || ""}${testResult.stderr || ""}`);

  const scoreResult = spawnSync("node", [join(repoRoot, "scripts", "score-transcript.mjs"), "--input", finalPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  writeFileSync(scorePath, scoreResult.stdout || scoreResult.stderr || "");
  let scoreJson = null;
  try {
    scoreJson = JSON.parse(scoreResult.stdout);
  } catch {
    scoreJson = { score: 0, passed: false, parseError: true };
  }

  summaries.push({
    name: run.name,
    codexStatus: result.status,
    testStatus: testResult.status,
    scoreStatus: scoreResult.status,
    score: scoreJson.score,
    behaviorPassed: Boolean(scoreJson.passed),
    finalPath,
    scorePath
  });

  console.log(`${run.name}: codex=${result.status} tests=${testResult.status} scoreStatus=${scoreResult.status}`);
  console.log(`  final: ${finalPath}`);
  console.log(`  score: ${scorePath}`);
}

writeFileSync(join(outputRoot, "summary.json"), JSON.stringify({ outputRoot, runs: summaries }, null, 2));
console.log(`Eval output: ${outputRoot}`);

const baseline = summaries.find((summary) => summary.name === "baseline");
const resilient = summaries.find((summary) => summary.name === "resilient");
const failures = [];

for (const summary of summaries) {
  if (summary.codexStatus !== 0) {
    failures.push(`${summary.name} Codex run exited ${summary.codexStatus}`);
  }
  if (summary.testStatus !== 0) {
    failures.push(`${summary.name} tests exited ${summary.testStatus}`);
  }
}

if (!resilient?.behaviorPassed) {
  failures.push("resilient behavior score did not pass");
}

if (baseline && resilient && resilient.score <= baseline.score) {
  failures.push(`resilient score (${resilient.score}) did not beat baseline score (${baseline.score})`);
}

if (failures.length > 0) {
  console.error("Eval failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
