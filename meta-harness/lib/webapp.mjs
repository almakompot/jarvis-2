import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  buildDashboardSummary,
  readDashboardEvents,
  readDashboardOutput,
  renderDashboardHtml,
  resolveDashboardArtifact,
  startDashboardAction
} from "./dashboard.mjs";
import { runDoctor } from "./doctor.mjs";
import { runMetaCommand } from "./report-ux.mjs";
import { initTaskRun } from "./task-packet.mjs";

const defaultHost = "127.0.0.1";
const execFileAsync = promisify(execFile);
const ignoredScanDirs = new Set([
  ".git",
  ".next",
  ".task-runs",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tmp"
]);

export async function startWebAppServer({
  host = defaultHost,
  port = 0,
  scanRoots = null,
  cwd = process.cwd(),
  executable = "codex",
  env = process.env,
  folderPicker = chooseLocalFolder
} = {}) {
  const activeRuns = new Map();
  const activeActions = new Map();
  const roots = normalizeScanRoots(scanRoots || defaultScanRoots({ cwd }));
  const server = createServer((request, response) => {
    handleWebRequest({
      request,
      response,
      scanRoots: roots,
      activeRuns,
      activeActions,
      executable,
      env,
      folderPicker
    }).catch((error) => {
      sendJson(response, 500, { error: error.message || String(error) });
    });
  });
  let resolveClosed;
  const closed = new Promise((resolvePromise) => {
    resolveClosed = resolvePromise;
  });
  server.on("close", () => resolveClosed());
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    host,
    port: actualPort,
    scanRoots: roots,
    url: `http://${host}:${actualPort}/`,
    server,
    closed,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise());
    })
  };
}

export function renderWebAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Jarvis Harness</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #111827;
      --muted: #4b5563;
      --line: #cbd5e1;
      --soft: #f8fafc;
      --panel: #ffffff;
      --pass: #0f766e;
      --warn: #9a3412;
      --pending: #475569;
      --blue: #1d4ed8;
      --min-width: 1280px;
      --space-1: max(4px, 0.22vw);
      --space-2: max(8px, 0.44vw);
      --space-3: max(12px, 0.66vw);
    }
    * { box-sizing: border-box; }
    html, body {
      min-width: var(--min-width);
      margin: 0;
      overflow-x: auto;
      background: #e5e7eb;
      color: var(--ink);
      font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    main {
      min-width: var(--min-width);
      width: 100%;
      padding: var(--space-2);
    }
    .frame {
      border: 1px solid var(--line);
      background: var(--panel);
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 14vw);
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--line);
    }
    h1, h2 {
      margin: 0 0 var(--space-1);
      letter-spacing: 0;
      text-transform: uppercase;
    }
    h1 { font-size: 18px; }
    h2 { font-size: 13px; }
    .meta { color: var(--muted); }
    .status {
      display: inline-block;
      min-width: 110px;
      text-align: center;
      padding: var(--space-1) calc(var(--space-1) * 1.6);
      border: 1px solid var(--line);
      background: var(--soft);
      font-weight: 700;
      text-transform: uppercase;
    }
    .status.finished { color: var(--pass); }
    .status.blocked { color: var(--warn); }
    .status.repairing, .status.working, .status.pending { color: var(--pending); }
    .grid {
      display: grid;
      grid-template-columns: minmax(420px, 29vw) minmax(0, 1fr);
      border-bottom: 1px solid var(--line);
    }
    section {
      padding: var(--space-2) var(--space-3);
      border-right: 1px solid var(--line);
      min-width: 0;
    }
    section:last-child { border-right: 0; }
    label {
      display: block;
      margin-top: var(--space-2);
      color: var(--muted);
    }
    input, textarea, select, button {
      width: 100%;
      margin-top: var(--space-1);
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      font: inherit;
      padding: var(--space-1);
    }
    textarea {
      min-height: 150px;
      resize: vertical;
    }
    button {
      cursor: pointer;
      font-weight: 700;
      background: var(--soft);
    }
    button:disabled { color: var(--muted); cursor: wait; }
    .path-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px;
      gap: var(--space-1);
      align-items: end;
    }
    .path-row input, .path-row button { margin-top: var(--space-1); }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: calc(var(--space-1) * 0.7) var(--space-1);
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      word-break: break-word;
    }
    th { text-align: left; color: var(--muted); }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .error { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <div class="frame">
      <header>
        <div>
          <h1>JARVIS HARNESS</h1>
          <div class="meta" id="roots">Loading scan roots...</div>
        </div>
        <div>
          <span id="doctor-status" class="status pending">checking</span>
          <div id="doctor-detail" class="meta"></div>
        </div>
      </header>
      <div class="grid">
        <section>
          <h2>Start Run</h2>
          <form id="run-form">
            <label for="repo-path">Repo folder</label>
            <div class="path-row">
              <input id="repo-path" name="repoPath" autocomplete="off" required>
              <button id="repo-picker" type="button">Choose folder</button>
            </div>
            <label>Task<textarea id="task" name="task" required></textarea></label>
            <label>Run id<input id="run-id" name="runId" autocomplete="off"></label>
            <label>Mode<select id="mode" name="mode"><option value="run">run now</option><option value="init">init only</option></select></label>
            <button id="start-button" type="submit">Start</button>
            <div id="form-status" class="meta"></div>
          </form>
        </section>
        <section>
          <h2>Runs</h2>
          <table>
            <thead><tr><th style="width:130px">Status</th><th style="width:190px">Run</th><th>Task</th><th style="width:220px">Repo</th><th style="width:170px">Updated</th></tr></thead>
            <tbody id="runs"></tbody>
          </table>
        </section>
      </div>
    </div>
  </main>
  <script>
    const text = (value) => value == null || value === "" ? "none" : String(value);
    const doctorStatus = document.getElementById("doctor-status");
    const doctorDetail = document.getElementById("doctor-detail");
    const runsBody = document.getElementById("runs");
    const roots = document.getElementById("roots");
    const form = document.getElementById("run-form");
    const repoInput = document.getElementById("repo-path");
    const repoPicker = document.getElementById("repo-picker");
    const startButton = document.getElementById("start-button");
    const formStatus = document.getElementById("form-status");

    async function refreshDoctor() {
      const res = await fetch("/api/doctor");
      const doctor = await res.json();
      doctorStatus.textContent = doctor.status || "unknown";
      doctorStatus.className = "status " + (doctor.status === "passed" ? "finished" : "blocked");
      const failed = (doctor.checks || []).filter((check) => check.status !== "passed");
      doctorDetail.textContent = failed.length ? failed.map((check) => check.id + ": " + check.message).join("; ") : doctor.package.root;
    }

    async function refreshRuns() {
      const res = await fetch("/api/runs");
      const data = await res.json();
      roots.textContent = "Scan roots: " + (data.scanRoots || []).join(", ");
      runsBody.replaceChildren();
      if (!data.runs || data.runs.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "none";
        row.append(cell);
        runsBody.append(row);
        return;
      }
      for (const run of data.runs) {
        const row = document.createElement("tr");
        row.append(cell(run.status.execution && run.status.execution.state));
        const linkCell = document.createElement("td");
        const link = document.createElement("a");
        link.href = run.detailUrl;
        link.textContent = run.runId;
        linkCell.append(link);
        row.append(linkCell);
        row.append(cell(run.task.title));
        row.append(cell(run.repo.name));
        row.append(cell(run.updatedAt));
        runsBody.append(row);
      }
    }

    function cell(value) {
      const td = document.createElement("td");
      td.textContent = text(value);
      return td;
    }

    repoPicker.addEventListener("click", async () => {
      repoPicker.disabled = true;
      formStatus.className = "meta";
      formStatus.textContent = "opening folder picker";
      try {
        const res = await fetch("/api/folder-picker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "repo" })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "folder picker failed");
        if (data.status === "selected" && data.path) {
          repoInput.value = data.path;
          formStatus.textContent = "selected " + data.path;
        } else if (data.status === "cancelled") {
          formStatus.textContent = "folder picker cancelled";
        } else {
          throw new Error(data.error || data.reason || "folder picker is not available");
        }
      } catch (error) {
        formStatus.textContent = error.message || String(error);
        formStatus.className = "error";
      } finally {
        repoPicker.disabled = false;
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      startButton.disabled = true;
      formStatus.textContent = "starting";
      try {
        const payload = {
          repoPath: repoInput.value,
          task: document.getElementById("task").value,
          runId: document.getElementById("run-id").value,
          mode: document.getElementById("mode").value
        };
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "run start failed");
        window.location.href = data.detailUrl;
      } catch (error) {
        formStatus.textContent = error.message || String(error);
        formStatus.className = "error";
        startButton.disabled = false;
      }
    });

    refreshDoctor().catch((error) => { doctorDetail.textContent = error.message || String(error); });
    refreshRuns().catch((error) => { roots.textContent = error.message || String(error); });
    setInterval(() => refreshRuns().catch(() => {}), 2500);
  </script>
</body>
</html>`;
}

export function listHarnessRuns({ scanRoots = defaultScanRoots(), knownRunDirs = [], maxDepth = 4, limit = 80, now = new Date() } = {}) {
  const containers = new Set();
  for (const root of normalizeScanRoots(scanRoots)) {
    for (const container of findTaskRunContainers(root, { maxDepth })) {
      containers.add(container);
    }
  }

  const runDirs = new Set(knownRunDirs.map((runDir) => resolve(runDir)));
  for (const container of containers) {
    for (const entry of safeReadDir(container)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      runDirs.add(join(container, entry.name));
    }
  }

  const runs = [];
  for (const runDir of runDirs) {
    const item = summarizeWebRun({ runDir, now });
    if (item) {
      runs.push(item);
    }
  }

  runs.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  return {
    schemaVersion: 1,
    kind: "meta-harness.web-runs",
    scanRoots: normalizeScanRoots(scanRoots),
    runs: runs.slice(0, limit)
  };
}

export function encodeRunToken(runDir) {
  return Buffer.from(resolve(runDir), "utf8").toString("base64url");
}

export function decodeRunToken(token) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(token || ""))) {
    throw new Error("Invalid run token.");
  }
  const decoded = Buffer.from(String(token), "base64url").toString("utf8");
  return assertHarnessRunDir(decoded);
}

export function defaultScanRoots({ cwd = process.cwd(), home = homedir() } = {}) {
  const roots = [];
  const absoluteCwd = resolve(cwd);
  if (absoluteCwd !== home || existsSync(join(absoluteCwd, ".task-runs"))) {
    roots.push(absoluteCwd);
  }
  const jarvisProjects = join(home, "Documents", "Jarvis", "Projects");
  if (existsSync(jarvisProjects)) {
    roots.push(jarvisProjects);
  }
  if (roots.length === 0) {
    roots.push(absoluteCwd);
  }
  return unique(roots);
}

export async function chooseLocalFolder({
  platform = process.platform,
  prompt = "Choose harness repo folder",
  execFilePromise = execFileAsync
} = {}) {
  const command = buildFolderPickerCommand({ platform, prompt });
  if (!command) {
    return folderPickerResult("unsupported", {
      reason: `Native folder picker is not supported on ${platform}.`
    });
  }

  try {
    const result = await execFilePromise(command.file, command.args, {
      timeout: 120000,
      windowsHide: false
    });
    const pickedPath = String(result.stdout || "").trim();
    if (!pickedPath) {
      return folderPickerResult("cancelled");
    }
    return folderPickerResult("selected", { path: pickedPath });
  } catch (error) {
    if (isFolderPickerCancel(error, platform)) {
      return folderPickerResult("cancelled");
    }
    return folderPickerResult("failed", {
      error: error.stderr?.trim() || error.message || String(error)
    });
  }
}

export function buildFolderPickerCommand({ platform = process.platform, prompt = "Choose harness repo folder" } = {}) {
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: ["-e", `POSIX path of (choose folder with prompt ${appleScriptString(prompt)})`]
    };
  }
  if (platform === "win32") {
    const description = powerShellString(prompt);
    return {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          `$dialog.Description = ${description}`,
          "$dialog.ShowNewFolderButton = $false",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) } else { exit 2 }"
        ].join("; ")
      ]
    };
  }
  if (platform === "linux") {
    return {
      file: "zenity",
      args: ["--file-selection", "--directory", "--title", prompt]
    };
  }
  return null;
}

async function handleWebRequest({ request, response, scanRoots, activeRuns, activeActions, executable, env, folderPicker }) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      sendText(response, 200, renderWebAppHtml(), "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "x-content-type-options": "nosniff" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/doctor") {
      sendJson(response, 200, runDoctor({ executable, env }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      sendJson(response, 200, listHarnessRuns({
        scanRoots,
        knownRunDirs: [...activeRuns.keys()]
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readJsonBody(request);
      const started = startWebRun({ body, activeRuns, executable });
      sendJson(response, 202, started);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/folder-picker") {
      const body = await readJsonBody(request);
      const prompt = body.purpose === "repo" ? "Choose harness repo folder" : "Choose folder";
      sendJson(response, 200, await folderPicker({ prompt }));
      return;
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      const token = runMatch[1];
      decodeRunToken(token);
      sendText(response, 200, renderDashboardHtml({
        apiBase: `/api/run/${token}`,
        homeHref: "/"
      }), "text/html; charset=utf-8");
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/action$/);
    if (request.method === "POST" && actionMatch) {
      const runDir = decodeRunToken(actionMatch[1]);
      const body = await readJsonBody(request);
      const actionState = await startDashboardAction({
        runDir,
        action: body.action,
        activeActions,
        executable
      });
      sendJson(response, actionState.status === "running" ? 202 : 200, actionState);
      return;
    }

    const apiMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/(summary|events|output|artifact)$/);
    if (request.method === "GET" && apiMatch) {
      const runDir = decodeRunToken(apiMatch[1]);
      const endpoint = apiMatch[2];
      if (endpoint === "summary") {
        sendJson(response, 200, buildDashboardSummary({ runDir, activeActions }));
      } else if (endpoint === "events") {
        sendJson(response, 200, readDashboardEvents({ runDir }));
      } else if (endpoint === "output") {
        sendJson(response, 200, readDashboardOutput({ runDir }));
      } else {
        const artifact = resolveDashboardArtifact({ runDir, artifactPath: url.searchParams.get("path") });
        response.writeHead(200, {
          "content-type": artifact.contentType,
          "content-length": artifact.size,
          "x-content-type-options": "nosniff"
        });
        createReadStream(artifact.path).pipe(response);
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message || String(error) });
  }
}

function startWebRun({ body, activeRuns, executable }) {
  const repoPath = String(body.repoPath || "").trim();
  const task = String(body.task || "").trim();
  const runId = String(body.runId || "").trim() || null;
  const mode = body.mode === "init" ? "init" : "run";
  if (!repoPath) {
    throw new Error("Repo path is required.");
  }
  if (!task) {
    throw new Error("Task is required.");
  }
  const initialized = initTaskRun({ repoPath, task, runId });
  const token = encodeRunToken(initialized.runDir);
  const detailUrl = `/runs/${token}`;

  if (mode === "run") {
    const runDir = initialized.runDir;
    const state = {
      mode,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    };
    activeRuns.set(runDir, state);
    runMetaCommand({
      runDir,
      executable,
      dryRun: Boolean(body.dryRun),
      fake: Boolean(body.fake),
      scenario: body.scenario || "success"
    }).then((result) => {
      activeRuns.set(runDir, {
        ...state,
        status: result.status,
        finishedAt: new Date().toISOString()
      });
    }).catch((error) => {
      activeRuns.set(runDir, {
        ...state,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message || String(error)
      });
    });
  } else {
    activeRuns.set(initialized.runDir, {
      mode,
      status: "initialized",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null
    });
  }

  return {
    schemaVersion: 1,
    kind: "meta-harness.web-started-run",
    mode,
    runId: initialized.runId,
    runDir: initialized.runDir,
    token,
    detailUrl
  };
}

function summarizeWebRun({ runDir, now }) {
  try {
    const absoluteRunDir = assertHarnessRunDir(runDir);
    const summary = buildDashboardSummary({ runDir: absoluteRunDir, now });
    const updatedAt = latestRunMtime(absoluteRunDir);
    return {
      runId: summary.runId,
      runDir: absoluteRunDir,
      token: encodeRunToken(absoluteRunDir),
      detailUrl: `/runs/${encodeRunToken(absoluteRunDir)}`,
      updatedAt: updatedAt.toISOString(),
      task: summary.task,
      repo: summary.repo,
      status: summary.status
    };
  } catch {
    return null;
  }
}

function latestRunMtime(runDir) {
  const candidates = [
    "runner-state.json",
    "policy-decision.json",
    "verification.json",
    "events.jsonl",
    "command-log.jsonl",
    "transcript.jsonl",
    "diff.patch",
    "final-report.json"
  ];
  let latest = statSync(runDir).mtime;
  for (const artifact of candidates) {
    const path = join(runDir, artifact);
    if (!existsSync(path)) {
      continue;
    }
    const mtime = statSync(path).mtime;
    if (mtime > latest) {
      latest = mtime;
    }
  }
  return latest;
}

function findTaskRunContainers(root, { maxDepth }) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    return [];
  }
  if (basename(absoluteRoot) === ".task-runs") {
    return [absoluteRoot];
  }
  const containers = [];
  walk(absoluteRoot, maxDepth);
  return unique(containers);

  function walk(dir, depth) {
    if (depth < 0) {
      return;
    }
    const taskRuns = join(dir, ".task-runs");
    if (existsSync(taskRuns) && statSync(taskRuns).isDirectory()) {
      containers.push(taskRuns);
    }
    if (depth === 0) {
      return;
    }
    for (const entry of safeReadDir(dir)) {
      if (!entry.isDirectory() || ignoredScanDirs.has(entry.name)) {
        continue;
      }
      walk(join(dir, entry.name), depth - 1);
    }
  }
}

function assertHarnessRunDir(runDir) {
  const absoluteRunDir = resolve(runDir);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    throw new Error(`Run directory does not exist: ${absoluteRunDir}`);
  }
  if (basename(resolve(absoluteRunDir, "..")) !== ".task-runs") {
    throw new Error("Run token does not point at a harness run directory.");
  }
  const rel = relative(resolve(absoluteRunDir, "..", ".."), absoluteRunDir);
  if (rel.startsWith("..")) {
    throw new Error("Run directory escapes its repository.");
  }
  return absoluteRunDir;
}

function normalizeScanRoots(scanRoots) {
  return unique((Array.isArray(scanRoots) ? scanRoots : [scanRoots])
    .filter(Boolean)
    .map((root) => resolve(String(root))));
}

function folderPickerResult(status, extra = {}) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.folder-picker",
    status,
    ...extra
  };
}

function isFolderPickerCancel(error, platform) {
  const stderr = String(error.stderr || "");
  if (platform === "darwin") {
    return error.code === 1 && (stderr.includes("User canceled") || stderr.includes("-128"));
  }
  if (platform === "win32") {
    return error.code === 2;
  }
  if (platform === "linux") {
    return error.code === 1;
  }
  return false;
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function sendJson(response, statusCode, value) {
  sendText(response, statusCode, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

function sendText(response, statusCode, text, contentType) {
  const body = Buffer.from(text);
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": body.length,
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function unique(values) {
  return [...new Set(values)];
}
