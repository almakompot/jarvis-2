#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(".");
const smokeRoot = join(root, "tmp", "meta-harness-smoke");
const repoDir = join(smokeRoot, "repo");
const runId = "smoke-site-gate-task";
const runDir = join(repoDir, ".task-runs", runId);

rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(repoDir, { recursive: true });
writeFileSync(join(repoDir, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`);
writeFileSync(join(repoDir, "README.md"), "# Smoke Repo\n");

run("node", [
  "meta-harness/scripts/init-run.mjs",
  "--repo",
  repoDir,
  "--task",
  "build a chrome extension that asks before opening each site",
  "--id",
  runId
]);
run("node", ["meta-harness/scripts/validate-run.mjs", "--run-dir", runDir]);

writeFileSync(
  join(smokeRoot, "summary.json"),
  `${JSON.stringify({ status: "passed", runDir, requiredArtifacts: 14, requiredDirectories: 2 }, null, 2)}\n`
);
console.log(`Meta-harness smoke passed. Evidence: ${join(smokeRoot, "summary.json")}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}
