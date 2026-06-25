import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

const defaultHost = "127.0.0.1";
const defaultOutputBytes = 48 * 1024;
const defaultJsonlLimit = 80;

export function buildDashboardSummary({ runDir, now = new Date() } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const spec = readJsonOptional(absoluteRunDir, "spec.json");
  const repoProfile = readJsonOptional(absoluteRunDir, "repo-profile.json");
  const proofPlan = readJsonOptional(absoluteRunDir, "proof-plan.json");
  const runnerConfig = readJsonOptional(absoluteRunDir, "runner-config.json");
  const runnerState = readJsonOptional(absoluteRunDir, "runner-state.json");
  const changedFiles = readJsonOptional(absoluteRunDir, "changed-files.json");
  const verification = readJsonOptional(absoluteRunDir, "verification.json");
  const verifierReport = readJsonOptional(absoluteRunDir, "verifier-report.json");
  const policyDecision = readJsonOptional(absoluteRunDir, "policy-decision.json");
  const finalReport = readJsonOptional(absoluteRunDir, "final-report.json");
  const events = readJsonlOptional(absoluteRunDir, "events.jsonl", { limit: defaultJsonlLimit });
  const transcript = readJsonlOptional(absoluteRunDir, "transcript.jsonl", { limit: defaultJsonlLimit });
  const commandLog = readJsonlOptional(absoluteRunDir, "command-log.jsonl", { limit: defaultJsonlLimit });
  const missingArtifacts = missingDashboardArtifacts(absoluteRunDir);
  const generatedAt = now.toISOString();
  const runId = spec?.runId || runnerState?.runId || repoProfile?.runId || basename(absoluteRunDir);
  const task = spec?.task || {};
  const repoPath = repoProfile?.targetPath || repoProfile?.repoPath || spec?.repo?.path || runnerState?.cwd || null;
  const git = repoProfile?.git || repoProfile?.dirtyState || {};
  const latestEvent = lastItem(events.items);
  const latestTranscript = lastItem(transcript.items);
  const latestCommand = lastItem(commandLog.items);
  const requirements = summarizeRequirements({ spec, verification });
  const proofObligations = summarizeProofObligations({ proofPlan, verification });
  const evidence = summarizeEvidence(verification);
  const changed = Array.isArray(changedFiles?.files) ? changedFiles.files : [];
  const status = summarizeStatus({
    now,
    runnerConfig,
    runnerState,
    verification,
    verifierReport,
    policyDecision,
    finalReport,
    latestEvent,
    latestCommand,
    spec
  });

  return {
    schemaVersion: 1,
    kind: "meta-harness.dashboard-summary",
    generatedAt,
    runDir: absoluteRunDir,
    runId,
    task: {
      title: task.title || task.summary || task.raw || "(unknown task)",
      summary: task.summary || null,
      raw: task.raw || null,
      class: spec?.taskClass || null
    },
    repo: {
      name: repoPath ? basename(repoPath) : "(unknown repo)",
      path: repoPath,
      profileRoot: repoProfile?.repoPath || null,
      branch: git.branch || null,
      head: git.head || null,
      dirty: Boolean(git.dirty)
    },
    commands: {
      resume: `jarvis-harness run --run ${shellToken(absoluteRunDir)}`,
      verify: `jarvis-harness verify --run ${shellToken(absoluteRunDir)}`,
      reportText: `jarvis-harness report --run ${shellToken(absoluteRunDir)} --format text`,
      reportHtml: `jarvis-harness report --run ${shellToken(absoluteRunDir)} --format html`
    },
    status,
    currentActivity: {
      phase: status.phase,
      latestEvent: compactEvent(latestEvent),
      latestCommand: compactCommand(latestCommand),
      latestTranscript: compactTranscript(latestTranscript),
      latestChangedFile: changed.at(-1) || null,
      latestArtifact: latestEvent?.artifact || latestCommand?.stdoutPath || latestCommand?.stderrPath || null
    },
    requirements,
    proofObligations,
    changedFiles: {
      status: changedFiles?.status || "pending",
      count: changed.length,
      files: changed.slice(-120)
    },
    commandLog: {
      count: commandLog.total,
      parseErrors: commandLog.parseErrors,
      commands: commandLog.items.map(compactCommand)
    },
    timeline: {
      count: events.total,
      parseErrors: events.parseErrors,
      events: events.items.map(compactEvent)
    },
    transcript: {
      count: transcript.total,
      parseErrors: transcript.parseErrors,
      entries: transcript.items.map(compactTranscript)
    },
    evidence,
    missingArtifacts,
    artifacts: standardArtifacts(absoluteRunDir)
  };
}

export function readDashboardEvents({ runDir, limit = defaultJsonlLimit } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  return readJsonlOptional(absoluteRunDir, "events.jsonl", { limit });
}

export function readDashboardOutput({ runDir, maxBytes = defaultOutputBytes } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const stdoutPath = join(absoluteRunDir, "evidence", "runner", "codex.stdout.jsonl");
  const stderrPath = join(absoluteRunDir, "evidence", "runner", "codex.stderr.txt");
  const fakeStdoutPath = join(absoluteRunDir, "evidence", "runner", "fake-codex.stdout.jsonl");
  const fakeStderrPath = join(absoluteRunDir, "evidence", "runner", "fake-codex.stderr.txt");
  const stdoutSource = existsSync(stdoutPath) ? stdoutPath : fakeStdoutPath;
  const stderrSource = existsSync(stderrPath) ? stderrPath : fakeStderrPath;
  const events = readJsonlOptional(absoluteRunDir, "events.jsonl", { limit: 5000 }).items;
  const stdout = readTail(stdoutSource, maxBytes);
  const stderr = readTail(stderrSource, maxBytes);
  return {
    schemaVersion: 1,
    kind: "meta-harness.dashboard-output",
    stdoutPath: relativeArtifactPath(absoluteRunDir, stdoutSource),
    stderrPath: relativeArtifactPath(absoluteRunDir, stderrSource),
    stdout: {
      ...stdout,
      displayText: timestampedOutputText({
        text: stdout.text,
        fallbackTimestamp: stdout.modifiedAt,
        events: stdoutCaptureEvents({ events, sourcePath: stdoutSource })
      })
    },
    stderr: {
      ...stderr,
      displayText: timestampedOutputText({
        text: stderr.text,
        fallbackTimestamp: stderr.modifiedAt,
        events: []
      })
    }
  };
}

export function resolveDashboardArtifact({ runDir, artifactPath } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const requested = String(artifactPath || "").replace(/^\/+/, "");
  if (!requested || requested.includes("\0")) {
    throw new Error("Artifact path is required.");
  }
  const fullPath = resolve(absoluteRunDir, requested);
  const relPath = normalizeRelPath(relative(absoluteRunDir, fullPath));
  if (!relPath || relPath.startsWith("../") || relPath === ".." || isAbsolute(relPath)) {
    throw new Error("Artifact path escapes the run directory.");
  }
  if (isBlockedArtifactPath(relPath)) {
    throw new Error(`Artifact path is blocked: ${relPath}`);
  }
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    throw new Error(`Artifact not found: ${relPath}`);
  }
  return {
    path: fullPath,
    relPath,
    contentType: contentTypeFor(fullPath),
    size: statSync(fullPath).size
  };
}

export function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Jarvis Harness Run</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #111827;
      --muted: #4b5563;
      --line: #cbd5e1;
      --soft: #f8fafc;
      --panel: #ffffff;
      --pass: #0f766e;
      --fail: #b42318;
      --warn: #9a3412;
      --pending: #475569;
      --blue: #1d4ed8;
      --dashboard-min-width: 1500px;
      --dashboard-width: max(100vw, var(--dashboard-min-width));
      --space-1: max(4px, 0.2vw);
      --space-2: max(8px, 0.4vw);
      --space-3: max(12px, 0.6vw);
      --top-row-min: max(255px, 17vw);
      --mid-row-min: max(210px, 14vw);
    }
    * { box-sizing: border-box; }
    html,
    body {
      min-width: var(--dashboard-min-width);
      margin: 0;
      overflow-x: auto;
      background: #e5e7eb;
      color: var(--ink);
      font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    .dashboard {
      width: 100%;
      min-width: var(--dashboard-min-width);
      margin: 0;
      padding: var(--space-2);
    }
    .frame {
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .header {
      padding: var(--space-2) var(--space-3);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 12vw);
      gap: var(--space-2);
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0 0 var(--space-1);
      font-size: 18px;
      letter-spacing: 0;
    }
    .meta, .commands, .risk {
      color: var(--muted);
      white-space: normal;
      overflow: visible;
      word-break: break-word;
    }
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
    .status.accepted, .pass { color: var(--pass); }
    .status.rejected, .fail { color: var(--fail); }
    .status.blocked, .warn { color: var(--warn); }
    .status.pending, .pending { color: var(--pending); }
    .command-strip {
      padding: var(--space-1) var(--space-3);
      border-bottom: 1px solid var(--line);
      white-space: normal;
      overflow: visible;
      word-break: break-word;
    }
    .grid-top {
      display: grid;
      grid-template-columns: minmax(0, 31fr) minmax(0, 33fr) minmax(0, 36fr);
      border-bottom: 1px solid var(--line);
    }
    .grid-mid {
      display: grid;
      grid-template-columns: minmax(0, 74fr) minmax(0, 26fr);
      border-bottom: 1px solid var(--line);
    }
    .grid-low {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 1px solid var(--line);
    }
    section {
      min-height: var(--mid-row-min);
      padding: var(--space-2) var(--space-3);
      border-right: 1px solid var(--line);
      min-width: 0;
      overflow: visible;
    }
    .grid-top section { min-height: var(--top-row-min); }
    section:last-child { border-right: 0; }
    h2 {
      margin: 0 0 var(--space-1);
      font-size: 13px;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: visible;
    }
    #output {
      display: block;
      width: 100%;
      max-width: 100%;
      max-height: calc(var(--top-row-min) - 48px);
      overflow: auto;
      white-space: pre;
      word-break: normal;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: calc(var(--space-1) * 0.6) var(--space-1);
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      word-break: break-word;
    }
    th { text-align: left; color: var(--muted); font-weight: 700; }
    .decision {
      padding: var(--space-2) var(--space-3) var(--space-3);
      min-height: max(120px, 8vw);
    }
    .kv {
      display: grid;
      grid-template-columns: minmax(170px, 12vw) minmax(0, 1fr);
      gap: var(--space-1) var(--space-3);
    }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main class="dashboard">
    <div class="frame">
      <div class="header">
        <div>
          <h1>JARVIS HARNESS RUN</h1>
          <div id="task" class="meta">Loading task...</div>
          <div id="repo" class="meta"></div>
          <div id="run-dir" class="meta"></div>
        </div>
        <div>
          <span id="overall-status" class="status pending">loading</span>
          <div id="elapsed" class="meta"></div>
          <div id="timeout" class="meta"></div>
        </div>
      </div>
      <div id="commands" class="command-strip">Loading commands...</div>
      <div class="grid-top">
        <section>
          <h2>Run Timeline</h2>
          <table><tbody id="timeline"></tbody></table>
        </section>
        <section>
          <h2>Current Activity</h2>
          <div id="activity" class="kv"></div>
        </section>
        <section>
          <h2>Live Output</h2>
          <pre id="output">Loading output...</pre>
        </section>
      </div>
      <div class="grid-mid">
        <section>
          <h2>Requirements / Proof</h2>
          <table>
            <thead><tr><th style="width:85px">ID</th><th>Requirement</th><th style="width:110px">Status</th><th style="width:190px">Evidence</th></tr></thead>
            <tbody id="requirements"></tbody>
          </table>
        </section>
        <section>
          <h2>Files / Diff</h2>
          <table><tbody id="files"></tbody></table>
        </section>
      </div>
      <div class="grid-low">
        <section>
          <h2>Commands</h2>
          <table>
            <thead><tr><th style="width:110px">ID</th><th>Command</th><th style="width:90px">Status</th><th style="width:90px">Exit</th></tr></thead>
            <tbody id="command-log"></tbody>
          </table>
        </section>
        <section>
          <h2>Evidence</h2>
          <table><tbody id="evidence"></tbody></table>
        </section>
      </div>
      <div class="decision">
        <h2>Decision / Trust State</h2>
        <div id="decision" class="kv"></div>
      </div>
    </div>
  </main>
  <script>
    const refreshMs = 1500;
    const statusEl = document.getElementById("overall-status");
    const text = (value) => value == null || value === "" ? "none" : String(value);
    const cls = (status) => ["accepted", "passed", "implemented"].includes(status) ? "pass"
      : ["rejected", "failed"].includes(status) ? "fail"
      : ["blocked", "interrupted"].includes(status) ? "warn"
      : "pending";
    function setText(id, value) { document.getElementById(id).textContent = text(value); }
    function rows(id, values, render, empty = "none") {
      const body = document.getElementById(id);
      body.replaceChildren();
      if (!values || values.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 4;
        td.textContent = empty;
        tr.append(td);
        body.append(tr);
        return;
      }
      for (const value of values) body.append(render(value));
    }
    function tr(cells) {
      const row = document.createElement("tr");
      for (const cell of cells) {
        const td = document.createElement("td");
        if (cell && cell.nodeType) td.append(cell);
        else td.textContent = text(cell);
        row.append(td);
      }
      return row;
    }
    function artifactLink(path) {
      if (!path) return "none";
      const a = document.createElement("a");
      a.href = "/api/artifact?path=" + encodeURIComponent(path);
      a.textContent = path;
      a.target = "_blank";
      return a;
    }
    function kv(id, values) {
      const box = document.getElementById(id);
      box.replaceChildren();
      for (const [key, value] of values) {
        const k = document.createElement("div");
        k.textContent = key;
        k.className = "meta";
        const v = document.createElement("div");
        if (value && value.nodeType) v.append(value);
        else v.textContent = text(value);
        box.append(k, v);
      }
    }
    async function refresh() {
      const [summaryRes, outputRes] = await Promise.all([fetch("/api/summary"), fetch("/api/output")]);
      const summary = await summaryRes.json();
      const output = await outputRes.json();
      const s = summary.status || {};
      statusEl.textContent = s.overall || "pending";
      statusEl.className = "status " + (s.overall || "pending");
      setText("elapsed", "elapsed " + text(s.elapsedText));
      setText("timeout", "wall-clock limit " + (s.wallClockLimitMs == null ? "none" : s.wallClockLimitMs + "ms"));
      setText("task", "Task: " + text(summary.task && summary.task.title));
      setText("repo", "Repo: " + text(summary.repo && summary.repo.name) + "  Branch: " + text(summary.repo && summary.repo.branch) + "  Run: " + text(summary.runId));
      setText("run-dir", "Run dir: " + text(summary.runDir));
      setText("commands", "Resume: " + summary.commands.resume + "    Verify: " + summary.commands.verify + "    Report: " + summary.commands.reportText);
      rows("timeline", (summary.timeline.events || []).slice(-12), (event) => tr([event.timestamp || "", event.phase || "", event.status || "", event.message || event.type || ""]));
      kv("activity", [
        ["Phase", s.phase],
        ["Latest event", summary.currentActivity.latestEvent && summary.currentActivity.latestEvent.message],
        ["Latest command", summary.currentActivity.latestCommand && summary.currentActivity.latestCommand.command],
        ["Latest transcript", summary.currentActivity.latestTranscript && summary.currentActivity.latestTranscript.content],
        ["Latest changed file", summary.currentActivity.latestChangedFile && summary.currentActivity.latestChangedFile.path],
        ["Latest artifact", artifactLink(summary.currentActivity.latestArtifact)]
      ]);
      const stdoutText = output.stdout && (output.stdout.displayText || output.stdout.text);
      const stderrText = output.stderr && (output.stderr.displayText || output.stderr.text);
      document.getElementById("output").textContent = [stdoutText, stderrText ? "\\nstderr:\\n" + stderrText : ""].filter(Boolean).join("\\n") || "no runner output yet";
      rows("requirements", summary.requirements, (req) => tr([req.id, req.text, req.status, (req.evidence || []).join(", ")]));
      rows("files", summary.changedFiles.files, (file) => tr([file.status, file.forbidden ? "forbidden" : "", file.path, artifactLink("diff.patch")]));
      rows("command-log", summary.commandLog.commands, (cmd) => tr([cmd.id, cmd.command, cmd.status, cmd.exitCode == null ? cmd.signal : cmd.exitCode]));
      rows("evidence", summary.evidence.items, (item) => tr([item.id, item.type, item.status, artifactLink(item.artifactPath)]));
      kv("decision", [
        ["Runner status", s.runner],
        ["Verification status", s.verification],
        ["Verifier status", s.verifier],
        ["Policy decision", s.policy],
        ["Blocking reason", s.blockingReason],
        ["Reject reason", s.rejectReason],
        ["Current risk", s.currentRisk],
        ["Next expected transition", s.nextTransition]
      ]);
    }
    refresh().catch((error) => { document.body.textContent = error.message || String(error); });
    setInterval(() => refresh().catch(() => {}), refreshMs);
  </script>
</body>
</html>`;
}

export async function startDashboardServer({ runDir, host = defaultHost, port = 0 } = {}) {
  const absoluteRunDir = resolveRunDir(runDir);
  const server = createServer((request, response) => {
    handleDashboardRequest({ request, response, runDir: absoluteRunDir });
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
    runDir: absoluteRunDir,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}/`,
    server,
    closed,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise());
    })
  };
}

export function openDashboardUrl({ url, platform = process.platform, runner = spawnSync } = {}) {
  if (!url) {
    throw new Error("Dashboard URL is required.");
  }
  const command = openCommandForPlatform({ url, platform });
  if (!command) {
    return {
      status: "skipped",
      reason: `Unsupported platform: ${platform}`,
      url
    };
  }
  const result = runner(command.executable, command.args, {
    stdio: "ignore",
    detached: true
  });
  if (result?.error) {
    return {
      status: "failed",
      reason: result.error.message,
      url,
      command
    };
  }
  if (typeof result?.status === "number" && result.status !== 0) {
    return {
      status: "failed",
      reason: `${command.executable} exited ${result.status}`,
      url,
      command
    };
  }
  return {
    status: "opened",
    url,
    command
  };
}

function handleDashboardRequest({ request, response, runDir }) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  try {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (url.pathname === "/") {
      sendText(response, 200, renderDashboardHtml(), "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, { "x-content-type-options": "nosniff" });
      response.end();
      return;
    }
    if (url.pathname === "/api/summary") {
      sendJson(response, 200, buildDashboardSummary({ runDir }));
      return;
    }
    if (url.pathname === "/api/events") {
      sendJson(response, 200, readDashboardEvents({ runDir }));
      return;
    }
    if (url.pathname === "/api/output") {
      sendJson(response, 200, readDashboardOutput({ runDir }));
      return;
    }
    if (url.pathname === "/api/artifact") {
      const artifact = resolveDashboardArtifact({ runDir, artifactPath: url.searchParams.get("path") });
      response.writeHead(200, {
        "content-type": artifact.contentType,
        "content-length": artifact.size,
        "x-content-type-options": "nosniff"
      });
      createReadStream(artifact.path).pipe(response);
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message || String(error) });
  }
}

function openCommandForPlatform({ url, platform }) {
  if (platform === "darwin") {
    return { executable: "open", args: [url] };
  }
  if (platform === "win32") {
    return { executable: "cmd", args: ["/c", "start", "", url] };
  }
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return { executable: "xdg-open", args: [url] };
  }
  return null;
}

function summarizeStatus({ now, runnerConfig, runnerState, verification, verifierReport, policyDecision, finalReport, latestEvent, latestCommand, spec }) {
  const runner = runnerState?.status || "pending";
  const verificationStatus = verification?.status || "pending";
  const verifier = verifierReport?.recommendation || verifierReport?.status || "pending";
  const policy = policyDecision?.decision || "not-run";
  const overall = policy !== "not-run" && policy !== "pending"
    ? policy
    : runner === "implemented" && verificationStatus === "pending"
      ? "implemented"
      : runner;
  const startedAt = runnerState?.createdAt || spec?.createdAt || finalReport?.createdAt || latestEvent?.timestamp || now.toISOString();
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(startedAt || now.toISOString()));
  const latestCommandStatus = latestCommand ? commandStatus(latestCommand) : null;
  return {
    overall,
    runner,
    verification: verificationStatus,
    verifier,
    policy,
    phase: latestEvent?.phase || latestCommand?.phase || runnerState?.terminalState?.reason || "pending",
    elapsedMs,
    elapsedText: formatDuration(elapsedMs),
    wallClockLimitMs: runnerConfig?.timeouts?.totalMs ?? null,
    blockingReason: policyDecision?.decision === "blocked"
      ? policyDecision.decisionReason
      : runner === "blocked"
        ? runnerState?.terminalState?.reason || "runner blocked"
        : null,
    rejectReason: policyDecision?.decision === "rejected"
      ? policyDecision.decisionReason
      : runner === "rejected"
        ? runnerState?.terminalState?.reason || "runner rejected"
        : null,
    currentRisk: finalReport?.residualRisk?.[0] || policyDecision?.residualRisk?.[0] || missingRisk({ verificationStatus, policy, latestCommandStatus }),
    nextTransition: nextTransition({ runner, verificationStatus, policy })
  };
}

function summarizeRequirements({ spec, verification }) {
  const coverage = new Map((verification?.requirementCoverage || []).map((item) => [item.requirementId, item]));
  return (spec?.requirements || []).map((requirement) => {
    const item = coverage.get(requirement.id) || {};
    return {
      id: requirement.id,
      text: requirement.text || requirement.title || "",
      status: item.status || "pending",
      proofObligationIds: requirement.proofObligationIds || requirement.proofObligations || [],
      evidence: item.evidence || item.evidenceIds || []
    };
  });
}

function summarizeProofObligations({ proofPlan, verification }) {
  const statusByProof = new Map((verification?.proofObligations || []).map((item) => [item.id || item.proofObligationId, item]));
  return (proofPlan?.obligations || []).map((obligation) => {
    const item = statusByProof.get(obligation.id) || {};
    return {
      id: obligation.id,
      title: obligation.title || obligation.description || obligation.text || "",
      status: item.status || "pending",
      requirementIds: obligation.requirementIds || [],
      acceptedEvidenceTypes: obligation.acceptedEvidenceTypes || [],
      evidence: item.evidence || item.evidenceIds || []
    };
  });
}

function summarizeEvidence(verification) {
  const items = (verification?.evidence || []).map((item) => ({
    id: item.id,
    type: item.type,
    status: item.status,
    artifactPath: primaryArtifactPath(item),
    proofObligationIds: item.proofObligationIds || []
  }));
  return { count: items.length, items };
}

function primaryArtifactPath(item) {
  if (item.artifactPath) {
    return item.artifactPath;
  }
  if (Array.isArray(item.artifacts) && item.artifacts.length > 0) {
    return item.artifacts[0];
  }
  if (Array.isArray(item.artifactPaths) && item.artifactPaths.length > 0) {
    return item.artifactPaths[0];
  }
  return null;
}

function compactEvent(event) {
  if (!event) {
    return null;
  }
  return {
    id: event.id || null,
    type: event.type || null,
    phase: event.phase || null,
    status: event.status || null,
    timestamp: event.timestamp || null,
    message: event.message || null,
    artifact: event.artifact || null
  };
}

function compactCommand(command) {
  if (!command) {
    return null;
  }
  return {
    id: command.id || null,
    phase: command.phase || null,
    command: command.command || null,
    cwd: command.cwd || null,
    status: command.status || commandStatus(command),
    exitCode: command.exitCode ?? null,
    signal: command.signal || null,
    startedAt: command.startedAt || null,
    finishedAt: command.finishedAt || null,
    stdoutPath: command.stdoutPath || null,
    stderrPath: command.stderrPath || null
  };
}

function compactTranscript(entry) {
  if (!entry) {
    return null;
  }
  const content = entry.content || entry.message || entry.command || "";
  return {
    id: entry.id || null,
    type: entry.type || null,
    phase: entry.phase || null,
    timestamp: entry.timestamp || null,
    source: entry.source || null,
    content: truncateText(content, 220),
    artifact: entry.artifact || null
  };
}

function commandStatus(command) {
  if (command.status) {
    return command.status;
  }
  if (command.exitCode === 0) {
    return "passed";
  }
  if (command.exitCode != null || command.signal) {
    return "failed";
  }
  return "running";
}

function missingRisk({ verificationStatus, policy, latestCommandStatus }) {
  if (policy === "accepted") {
    return "none recorded";
  }
  if (verificationStatus === "pending") {
    return "verification proof pending";
  }
  if (latestCommandStatus === "failed") {
    return "latest command failed";
  }
  return "policy acceptance pending";
}

function nextTransition({ runner, verificationStatus, policy }) {
  if (policy === "accepted") {
    return "none";
  }
  if (policy === "blocked") {
    return "resolve blocker -> resume run or verification";
  }
  if (policy === "rejected") {
    return "repair implementation/proof -> rerun verification";
  }
  if (runner === "pending") {
    return "run implementation";
  }
  if (runner === "implemented" && verificationStatus === "pending") {
    return "verify command proof -> surface proof -> verifier -> policy";
  }
  if (verificationStatus !== "passed") {
    return "complete verification proof";
  }
  return "run verifier and policy";
}

function standardArtifacts(runDir) {
  return [
    "task.md",
    "spec.json",
    "repo-profile.json",
    "proof-plan.json",
    "runner-config.json",
    "runner-state.json",
    "command-log.jsonl",
    "transcript.jsonl",
    "changed-files.json",
    "diff.patch",
    "verification.json",
    "verifier-report.json",
    "policy-decision.json",
    "final-report.json"
  ].map((artifact) => ({
    path: artifact,
    exists: existsSync(join(runDir, artifact))
  }));
}

function missingDashboardArtifacts(runDir) {
  return standardArtifacts(runDir)
    .filter((artifact) => !artifact.exists)
    .map((artifact) => artifact.path);
}

function readJsonOptional(runDir, artifact) {
  const path = join(runDir, artifact);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readJsonlOptional(runDir, artifact, { limit = defaultJsonlLimit } = {}) {
  const path = join(runDir, artifact);
  if (!existsSync(path)) {
    return { artifact, total: 0, parseErrors: 0, items: [] };
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return { artifact, total: 0, parseErrors: 0, items: [] };
  }
  const parsed = [];
  let parseErrors = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parseErrors += 1;
    }
  }
  return {
    artifact,
    total: parsed.length,
    parseErrors,
    items: parsed.slice(-limit)
  };
}

function readTail(path, maxBytes) {
  if (!existsSync(path)) {
    return { text: "", truncated: false, bytes: 0, modifiedAt: null };
  }
  const stats = statSync(path);
  const buffer = readFileSync(path);
  const truncated = buffer.length > maxBytes;
  const slice = truncated ? buffer.subarray(buffer.length - maxBytes) : buffer;
  return {
    text: slice.toString("utf8"),
    truncated,
    bytes: buffer.length,
    modifiedAt: stats.mtime.toISOString()
  };
}

function timestampedOutputText({ text, fallbackTimestamp = null, events = [] } = {}) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized) {
    return "";
  }
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const eventTimestamps = events.map((event) => event.timestamp).filter(Boolean);
  const offset = Math.max(0, eventTimestamps.length - lines.length);
  return lines.map((line, index) => {
    const timestamp = eventTimestamps[offset + index] || fallbackTimestamp || "timestamp-unavailable";
    return `[${timestamp}] ${line}`;
  }).join("\n");
}

function stdoutCaptureEvents({ events, sourcePath }) {
  const source = basename(String(sourcePath || ""));
  if (source.startsWith("fake-codex")) {
    return events.filter((event) =>
      event?.type === "runner-event"
      && event.timestamp
      && /^Captured fake /.test(event.message || "")
    );
  }
  return events.filter((event) =>
    event?.type === "runner-event"
    && event.timestamp
    && /^Captured Codex CLI event /.test(event.message || "")
  );
}

function resolveRunDir(runDir) {
  if (!runDir) {
    throw new Error("--run is required");
  }
  const absoluteRunDir = resolve(runDir);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    throw new Error(`Run directory does not exist: ${absoluteRunDir}`);
  }
  return absoluteRunDir;
}

function relativeArtifactPath(runDir, artifactPath) {
  return normalizeRelPath(relative(runDir, artifactPath));
}

function normalizeRelPath(path) {
  return String(path || "").replace(/\\/g, "/");
}

function isBlockedArtifactPath(path) {
  const relPath = normalizeRelPath(path);
  return relPath === ".env"
    || relPath.startsWith(".env.")
    || relPath.includes("/.env")
    || relPath === ".git"
    || relPath.startsWith(".git/")
    || relPath.includes("/.git/")
    || relPath.includes("transcript-secrets/")
    || relPath.endsWith(".pem")
    || relPath.endsWith(".key")
    || /(^|\/)service-account.*\.json$/i.test(relPath);
}

function contentTypeFor(path) {
  const ext = extname(path).toLowerCase();
  if ([".html", ".htm"].includes(ext)) {
    return "text/html; charset=utf-8";
  }
  if ([".json", ".jsonl", ".map"].includes(ext)) {
    return "application/json; charset=utf-8";
  }
  if ([".txt", ".md", ".patch", ".log"].includes(ext)) {
    return "text/plain; charset=utf-8";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
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

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function lastItem(values) {
  return values.length > 0 ? values[values.length - 1] : null;
}

function shellToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}
