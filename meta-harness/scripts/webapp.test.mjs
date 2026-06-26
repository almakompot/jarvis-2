import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFolderPickerCommand,
  encodeRunToken,
  listHarnessRuns,
  renderWebAppHtml,
  startWebAppServer
} from "../lib/webapp.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";

test("web app lists discovered runs and serves dashboard detail routes", async (t) => {
  const repo = createRepo("webapp-list");
  const runDir = initTaskRun({
    repoPath: repo,
    task: "web app listed task with command proof",
    runId: "webapp-listed-run"
  }).runDir;
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const listed = listHarnessRuns({ scanRoots: [repo] });
  assert.equal(listed.runs.length, 1);
  assert.equal(listed.runs[0].runId, "webapp-listed-run");
  assert.equal(listed.runs[0].detailUrl, `/runs/${encodeRunToken(runDir)}`);

  const server = await startWebAppServer({ scanRoots: [repo], port: 0, executable: writeFakeCodex(repo) });
  t.after(async () => {
    await server.close();
  });

  const html = await (await fetch(server.url)).text();
  assert.match(html, /JARVIS HARNESS/);
  assert.match(html, /Start Run/);
  assert.match(html, /Runs/);
  assert.match(html, /Choose folder/);
  assert.match(html, /\/api\/folder-picker/);
  assert.doesNotMatch(html, /@media/);

  const doctor = await (await fetch(new URL("/api/doctor", server.url))).json();
  assert.equal(doctor.status, "passed");

  const runs = await (await fetch(new URL("/api/runs", server.url))).json();
  assert.equal(runs.runs.length, 1);
  const run = runs.runs[0];
  assert.equal(run.runId, "webapp-listed-run");
  assert.equal(run.status.operatorStatus, "working");

  const detail = await (await fetch(new URL(run.detailUrl, server.url))).text();
  assert.match(detail, /JARVIS HARNESS RUN/);
  assert.match(detail, new RegExp(`/api/run/${escapeRegExp(run.token)}`));
  assert.match(detail, /Runs/);

  const summary = await (await fetch(new URL(`/api/run/${run.token}/summary`, server.url))).json();
  assert.equal(summary.runId, "webapp-listed-run");

  const artifact = await fetch(new URL(`/api/run/${run.token}/artifact?path=task.md`, server.url));
  assert.equal(artifact.status, 200);
  assert.match(await artifact.text(), /web app listed task/);

  const traversal = await fetch(new URL(`/api/run/${run.token}/artifact?path=..%2Fpackage.json`, server.url));
  assert.equal(traversal.status, 400);
  assert.match(await traversal.text(), /escapes the run directory/);

  const badToken = encodeRunToken(repo);
  const badSummary = await fetch(new URL(`/api/run/${badToken}/summary`, server.url));
  assert.equal(badSummary.status, 400);
  assert.match(await badSummary.text(), /harness run directory/);
});

test("web app exposes a local folder picker endpoint for repo path selection", async (t) => {
  const repo = createRepo("webapp-picker");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const server = await startWebAppServer({
    scanRoots: [repo],
    port: 0,
    executable: writeFakeCodex(repo),
    folderPicker: async ({ prompt }) => ({
      schemaVersion: 1,
      kind: "meta-harness.folder-picker",
      status: "selected",
      path: repo,
      prompt
    })
  });
  t.after(async () => {
    await server.close();
  });

  const selected = await fetch(new URL("/api/folder-picker", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "repo" })
  });
  assert.equal(selected.status, 200);
  const payload = await selected.json();
  assert.equal(payload.status, "selected");
  assert.equal(payload.path, repo);
  assert.equal(payload.prompt, "Choose harness repo folder");
});

test("folder picker command uses native OS folder selection surfaces", () => {
  const mac = buildFolderPickerCommand({ platform: "darwin", prompt: "Pick \"repo\"" });
  assert.equal(mac.file, "osascript");
  assert.match(mac.args.join(" "), /choose folder/);

  const windows = buildFolderPickerCommand({ platform: "win32", prompt: "Pick repo" });
  assert.equal(windows.file, "powershell.exe");
  assert.match(windows.args.join(" "), /FolderBrowserDialog/);

  const linux = buildFolderPickerCommand({ platform: "linux", prompt: "Pick repo" });
  assert.equal(linux.file, "zenity");
  assert.deepEqual(linux.args.slice(0, 3), ["--file-selection", "--directory", "--title"]);
});

test("web app starts a run through the normal run folder and redirects to detail", async (t) => {
  const repo = createRepo("webapp-start");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const server = await startWebAppServer({ scanRoots: [repo], port: 0, executable: writeFakeCodex(repo) });
  t.after(async () => {
    await server.close();
  });

  const started = await fetch(new URL("/api/runs", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoPath: repo,
      task: "start from the web app and capture fake runner proof",
      runId: "webapp-started-run",
      fake: true,
      scenario: "success"
    })
  });
  assert.equal(started.status, 202);
  const payload = await started.json();
  assert.equal(payload.runId, "webapp-started-run");
  assert.equal(payload.detailUrl, `/runs/${payload.token}`);

  const summary = await pollSummary(server.url, payload.token);
  assert.equal(summary.runId, "webapp-started-run");
  assert.equal(summary.status.runner, "implemented");
  assert.equal(summary.status.operatorStatus, "working");
});

test("web app can initialize without starting the runner", async (t) => {
  const repo = createRepo("webapp-init");
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const server = await startWebAppServer({ scanRoots: [repo], port: 0, executable: writeFakeCodex(repo) });
  t.after(async () => {
    await server.close();
  });

  const initialized = await fetch(new URL("/api/runs", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoPath: repo,
      task: "initialize from web app only",
      runId: "webapp-init-only",
      mode: "init"
    })
  });

  assert.equal(initialized.status, 202);
  const payload = await initialized.json();
  const summary = await (await fetch(new URL(`/api/run/${payload.token}/summary`, server.url))).json();
  assert.equal(summary.status.runner, "pending");
  assert.equal(summary.commands.resume, `jarvis-harness run --run ${payload.runDir}`);

  const report = await fetch(new URL(`/api/run/${payload.token}/action`, server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reportText" })
  });
  assert.equal(report.status, 200);
  const reportPayload = await report.json();
  assert.equal(reportPayload.status, "completed");
  assert.equal(reportPayload.artifactPath, "report.txt");
});

test("web app HTML is minimal desktop-only local harness UI", () => {
  const html = renderWebAppHtml();
  assert.match(html, /<meta name="viewport" content="width=device-width">/);
  assert.match(html, /--min-width: 1280px/);
  assert.match(html, /\/api\/runs/);
  assert.match(html, /\/api\/doctor/);
  assert.match(html, /\/api\/folder-picker/);
  assert.doesNotMatch(html, /@media/);
});

function createRepo(name) {
  const repo = mkdtempSync(join(tmpdir(), `${name}-`));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: { test: "node scripts/pass.mjs" }, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "scripts", "pass.mjs"), "console.log('webapp proof');\n");
  writeFileSync(join(repo, "README.md"), "# Webapp Fixture\n");
  return repo;
}

function writeFakeCodex(repo) {
  const path = join(repo, "fake-codex");
  writeFileSync(path, "#!/usr/bin/env node\nconsole.log('codex-cli 999.0.0-webapp-test');\n");
  chmodSync(path, 0o755);
  return path;
}

async function pollSummary(baseUrl, token) {
  let last = null;
  for (let index = 0; index < 30; index += 1) {
    last = await (await fetch(new URL(`/api/run/${token}/summary`, baseUrl))).json();
    if (last.status?.runner === "implemented") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
