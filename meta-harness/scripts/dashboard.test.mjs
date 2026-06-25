import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDashboardSummary,
  readDashboardOutput,
  renderDashboardHtml,
  resolveDashboardArtifact,
  startDashboardServer
} from "../lib/dashboard.mjs";
import { runFakeCodex } from "../lib/fake-runner.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";

test("dashboard summary renders an initialized pending run with missing-file tolerance", (t) => {
  const { repo, runDir } = createRun("dashboard-pending");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const summary = buildDashboardSummary({ runDir, now: new Date("2026-06-25T12:00:00.000Z") });

  assert.equal(summary.kind, "meta-harness.dashboard-summary");
  assert.equal(summary.runId, "dashboard-pending");
  assert.equal(summary.status.overall, "pending");
  assert.equal(summary.status.wallClockLimitMs, null);
  assert.ok(summary.requirements.length > 0);
  assert.ok(summary.proofObligations.length > 0);
  assert.equal(summary.missingArtifacts.length, 0);
  assert.match(summary.commands.verify, /jarvis-harness verify --run/);
});

test("dashboard summary reflects accepted, rejected, and blocked policy states", (t) => {
  const { repo, runDir } = createRun("dashboard-decisions");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const policyPath = join(runDir, "policy-decision.json");
  const policy = readJson(policyPath);

  writeJson(policyPath, { ...policy, decision: "accepted", decisionReason: "accepted for fixture" });
  assert.equal(buildDashboardSummary({ runDir }).status.overall, "accepted");

  writeJson(policyPath, { ...policy, decision: "rejected", decisionReason: "fixture reject" });
  const rejected = buildDashboardSummary({ runDir });
  assert.equal(rejected.status.overall, "rejected");
  assert.equal(rejected.status.rejectReason, "fixture reject");

  writeJson(policyPath, { ...policy, decision: "blocked", decisionReason: "fixture block" });
  const blocked = buildDashboardSummary({ runDir });
  assert.equal(blocked.status.overall, "blocked");
  assert.equal(blocked.status.blockingReason, "fixture block");
});

test("dashboard output reader uses bounded tails", (t) => {
  const { repo, runDir } = createRun("dashboard-output-tail");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(runDir, "evidence", "runner"), { recursive: true });
  writeFileSync(join(runDir, "evidence", "runner", "codex.stdout.jsonl"), `${"x".repeat(100)}tail`);

  const output = readDashboardOutput({ runDir, maxBytes: 12 });

  assert.equal(output.stdout.truncated, true);
  assert.equal(output.stdout.text, "xxxxxxxxtail");
});

test("dashboard artifact reader is scoped to run dir and blocks secret-like paths", (t) => {
  const { repo, runDir } = createRun("dashboard-artifacts");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const task = resolveDashboardArtifact({ runDir, artifactPath: "task.md" });
  assert.equal(task.relPath, "task.md");
  assert.match(readFileSync(task.path, "utf8"), /dashboard artifact task/);

  assert.throws(
    () => resolveDashboardArtifact({ runDir, artifactPath: "../package.json" }),
    /escapes the run directory/
  );
  assert.throws(
    () => resolveDashboardArtifact({ runDir, artifactPath: ".env" }),
    /blocked/
  );
});

test("dashboard server serves HTML, JSON endpoints, artifact files, and traversal errors", async (t) => {
  const { repo, runDir } = createRun("dashboard-server");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  await runFakeCodex({ runDir, scenario: "success" });

  const server = await startDashboardServer({ runDir, port: 0 });
  t.after(async () => {
    await server.close();
  });

  const html = await (await fetch(server.url)).text();
  assert.match(html, /JARVIS HARNESS RUN/);
  assert.match(html, /min-width: 1500px/);
  assert.doesNotMatch(html, /@media/);

  const summary = await (await fetch(new URL("/api/summary", server.url))).json();
  assert.equal(summary.runId, "dashboard-server");
  assert.equal(summary.status.runner, "implemented");
  assert.ok(summary.changedFiles.files.some((file) => file.path === "src/site-gate.js"));

  const output = await (await fetch(new URL("/api/output", server.url))).json();
  assert.match(output.stdout.text, /assistant_message|inspection|command/);

  const artifact = await fetch(new URL("/api/artifact?path=task.md", server.url));
  assert.equal(artifact.status, 200);
  assert.match(await artifact.text(), /dashboard artifact task/);

  const traversal = await fetch(new URL("/api/artifact?path=..%2Fpackage.json", server.url));
  assert.equal(traversal.status, 400);
  assert.match(await traversal.text(), /escapes the run directory/);
});

test("dashboard HTML is desktop-only and file-backed", () => {
  const html = renderDashboardHtml();

  assert.match(html, /<meta name="viewport" content="width=1500">/);
  assert.match(html, /width: 1500px/);
  assert.match(html, /\/api\/summary/);
  assert.match(html, /\/api\/artifact\?path=/);
});

function createRun(runId) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-dashboard-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('dashboard proof');\n");
  writeFileSync(join(repo, "README.md"), "# Dashboard Fixture\n");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "dashboard artifact task with local command proof",
    runId
  }).runDir;
  return { repo, runDir };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
