import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDashboardSummary,
  openDashboardUrl,
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
  assert.equal(summary.status.overall, "working");
  assert.equal(summary.status.operatorStatus, "working");
  assert.equal(summary.status.wallClockLimitMs, null);
  assert.ok(summary.requirements.length > 0);
  assert.ok(summary.proofObligations.length > 0);
  assert.equal(summary.missingArtifacts.length, 0);
  assert.match(summary.commands.resume, /jarvis-harness run --run/);
  assert.match(summary.commands.verify, /jarvis-harness verify --run/);
  assert.match(summary.commands.reportText, /jarvis-harness report --run .* --format text/);
  assert.match(summary.commands.reportHtml, /jarvis-harness report --run .* --format html/);
  assert.deepEqual(summary.actions.map((action) => action.id), ["resume", "verify", "reportText", "reportHtml"]);
  assert.deepEqual(summary.actions.map((action) => action.status), ["idle", "idle", "idle", "idle"]);
});

test("dashboard summary maps internal policy decisions to operator lifecycle states", (t) => {
  const { repo, runDir } = createRun("dashboard-decisions");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const policyPath = join(runDir, "policy-decision.json");
  const policy = readJson(policyPath);

  writeJson(policyPath, { ...policy, decision: "accepted", decisionReason: "accepted for fixture" });
  const accepted = buildDashboardSummary({ runDir });
  assert.equal(accepted.status.overall, "finished");
  assert.equal(accepted.status.internalOverall, "accepted");

  writeJson(policyPath, { ...policy, decision: "rejected", decisionReason: "fixture reject" });
  const rejected = buildDashboardSummary({ runDir });
  assert.equal(rejected.status.overall, "repairing");
  assert.equal(rejected.status.internalOverall, "rejected");
  assert.equal(rejected.status.rejectReason, "fixture reject");
  assert.equal(rejected.status.repairReason, "fixture reject");

  writeJson(policyPath, { ...policy, decision: "blocked", decisionReason: "fixture block" });
  const blocked = buildDashboardSummary({ runDir });
  assert.equal(blocked.status.overall, "blocked");
  assert.equal(blocked.status.blockingReason, "fixture block");
});

test("dashboard summary labels terminal runner state as stopped, not running", (t) => {
  const { repo, runDir } = createRun("dashboard-terminal-runner");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const runnerPath = join(runDir, "runner-state.json");
  const runnerState = readJson(runnerPath);
  writeJson(runnerPath, {
    ...runnerState,
    createdAt: "2026-06-25T10:00:00.000Z",
    updatedAt: "2026-06-25T10:05:00.000Z",
    status: "rejected",
    terminalState: {
      ...runnerState.terminalState,
      reason: "final-overclaim"
    }
  });

  const summary = buildDashboardSummary({ runDir, now: new Date("2026-06-25T10:20:00.000Z") });

  assert.equal(summary.status.overall, "repairing");
  assert.equal(summary.status.isTerminal, true);
  assert.equal(summary.status.phase, "stopped: final-overclaim");
  assert.equal(summary.status.elapsedText, "5m 0s");
  assert.equal(summary.status.runtimeText, "5m 0s");
  assert.equal(summary.status.stoppedAgoText, "15m 0s");
  assert.equal(summary.status.nextTransition, "repair implementation/proof -> rerun verification");
});

test("dashboard output reader uses bounded tails", (t) => {
  const { repo, runDir } = createRun("dashboard-output-tail");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(runDir, "evidence", "runner"), { recursive: true });
  writeFileSync(join(runDir, "evidence", "runner", "codex.stdout.jsonl"), `${"x".repeat(100)}tail`);

  const output = readDashboardOutput({ runDir, maxBytes: 12 });

  assert.equal(output.stdout.truncated, true);
  assert.equal(output.stdout.text, "xxxxxxxxtail");
  assert.match(output.stdout.displayText, /^\[[^\]]+\] xxxxxxxxtail$/);
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
  assert.match(html, /--dashboard-width: max\(100vw, var\(--dashboard-min-width\)\)/);
  assert.match(html, /min-width: var\(--dashboard-min-width\)/);
  assert.match(html, /width: 100%/);
  assert.match(html, /white-space: pre;/);
  assert.match(html, /overflow: auto;/);
  assert.match(html, /action-button/);
  assert.match(html, /apiBase \+ "\/action"/);
  assert.doesNotMatch(html, /2400px/);
  assert.doesNotMatch(html, /@media/);

  const summary = await (await fetch(new URL("/api/summary", server.url))).json();
  assert.equal(summary.runId, "dashboard-server");
  assert.equal(summary.status.runner, "implemented");
  assert.ok(summary.changedFiles.files.some((file) => file.path === "src/site-gate.js"));
  assert.ok(summary.actions.some((action) => action.label === "Run verification"));
  assert.ok(summary.actions.some((action) => action.label === "HTML report"));

  const output = await (await fetch(new URL("/api/output", server.url))).json();
  assert.match(output.stdout.text, /assistant_message|inspection|command/);
  assert.match(output.stdout.displayText, /\[[^\]]+\] \{"type":/);

  const favicon = await fetch(new URL("/favicon.ico", server.url));
  assert.equal(favicon.status, 204);

  const artifact = await fetch(new URL("/api/artifact?path=task.md", server.url));
  assert.equal(artifact.status, 200);
  assert.match(await artifact.text(), /dashboard artifact task/);

  const traversal = await fetch(new URL("/api/artifact?path=..%2Fpackage.json", server.url));
  assert.equal(traversal.status, 400);
  assert.match(await traversal.text(), /escapes the run directory/);

  const verify = await fetch(new URL("/api/action", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "verify" })
  });
  assert.equal(verify.status, 202);
  const verifyPayload = await verify.json();
  assert.equal(verifyPayload.status, "running");

  const verified = await pollDashboardAction(server.url, "verify");
  assert.equal(verified.status, "completed");
  assert.match(verified.message, /verification/);

  const report = await fetch(new URL("/api/action", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reportHtml" })
  });
  assert.equal(report.status, 200);
  const reportPayload = await report.json();
  assert.equal(reportPayload.status, "completed");
  assert.equal(reportPayload.artifactPath, "html-report/index.html");

  const reportArtifact = await fetch(new URL("/api/artifact?path=html-report%2Findex.html", server.url));
  assert.equal(reportArtifact.status, 200);
  assert.match(await reportArtifact.text(), /Findings/);
});

test("dashboard opener launches the platform default browser command", () => {
  const calls = [];
  const runner = (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 0 };
  };

  const opened = openDashboardUrl({
    url: "http://127.0.0.1:4817/",
    platform: "darwin",
    runner
  });

  assert.equal(opened.status, "opened");
  assert.equal(calls[0].executable, "open");
  assert.deepEqual(calls[0].args, ["http://127.0.0.1:4817/"]);
  assert.equal(calls[0].options.detached, true);
});

test("dashboard opener supports Linux and Windows command shapes", () => {
  const calls = [];
  const runner = (executable, args) => {
    calls.push({ executable, args });
    return { status: 0 };
  };

  assert.equal(openDashboardUrl({ url: "http://127.0.0.1:1/", platform: "linux", runner }).status, "opened");
  assert.equal(openDashboardUrl({ url: "http://127.0.0.1:2/", platform: "win32", runner }).status, "opened");
  assert.equal(calls[0].executable, "xdg-open");
  assert.equal(calls[1].executable, "cmd");
  assert.deepEqual(calls[1].args, ["/c", "start", "", "http://127.0.0.1:2/"]);
});

test("dashboard opener reports unsupported platforms without throwing", () => {
  const result = openDashboardUrl({
    url: "http://127.0.0.1:4817/",
    platform: "plan9",
    runner: () => {
      throw new Error("should not run");
    }
  });

  assert.equal(result.status, "skipped");
  assert.match(result.reason, /Unsupported platform/);
});

test("dashboard HTML is desktop-only and file-backed", () => {
  const html = renderDashboardHtml();

  assert.match(html, /<meta name="viewport" content="width=device-width">/);
  assert.match(html, /--dashboard-min-width: 1500px/);
  assert.match(html, /--dashboard-width: max\(100vw, var\(--dashboard-min-width\)\)/);
  assert.match(html, /min-width: var\(--dashboard-min-width\)/);
  assert.match(html, /width: 100%/);
  assert.match(html, /grid-template-columns: minmax\(0, 31fr\) minmax\(0, 33fr\) minmax\(0, 36fr\)/);
  assert.match(html, /white-space: normal/);
  assert.match(html, /#output \{/);
  assert.match(html, /white-space: pre;/);
  assert.match(html, /overflow: auto;/);
  assert.match(html, /displayText/);
  assert.match(html, /action-button/);
  assert.match(html, /postAction\(action\.id, button\)/);
  assert.match(html, /apiBase \+ "\/action"/);
  assert.match(html, /<tbody id="actions"><\/tbody>/);
  assert.doesNotMatch(html, /text-overflow: ellipsis/);
  assert.doesNotMatch(html, /grid-template-columns: calc\(var\(--dashboard-width\)/);
  assert.doesNotMatch(html, /2400px/);
  assert.match(html, /const apiBase = "\/api"/);
  assert.match(html, /apiBase \+ "\/summary"/);
  assert.match(html, /apiBase \+ "\/artifact\?path="/);

  const embedded = renderDashboardHtml({ apiBase: "/api/run/token", homeHref: "/" });
  assert.match(embedded, /const apiBase = "\/api\/run\/token"/);
  assert.match(embedded, /<a href="\/">Runs<\/a>/);
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

async function pollDashboardAction(baseUrl, actionId) {
  let last = null;
  for (let index = 0; index < 30; index += 1) {
    last = await (await fetch(new URL("/api/summary", baseUrl))).json();
    const action = last.actions.find((item) => item.id === actionId);
    if (action && action.status !== "running") {
      return action;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last.actions.find((item) => item.id === actionId);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
