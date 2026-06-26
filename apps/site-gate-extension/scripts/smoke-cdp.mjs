#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const browserCandidates = process.env.SITE_GATE_BROWSER_PATH
  ? [process.env.SITE_GATE_BROWSER_PATH]
  : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter((path) => existsSync(path));
const artifactsDir = resolve(process.cwd(), "tmp", "site-gate-smoke");

let state = createState();

function createState() {
  return {
    browser: null,
    cdp: null,
    workerCdp: null,
    userDataDir: null,
    servers: []
  };
}

async function runSmoke(browserPath) {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
  state.userDataDir = mkdtempSync(join(tmpdir(), "site-gate-chrome-"));
  const trace = [];

  const sites = await Promise.all([
    startSite("one"),
    startSite("two"),
    startSite("three"),
    startSite("four"),
    startSite("five"),
    startSite("six"),
    startSite("seven")
  ]);
  state.servers.push(...sites.map((site) => site.server));

  const debuggingPort = await getFreePort();
  state.browser = spawn(browserPath, [
    `--user-data-dir=${state.userDataDir}`,
    `--disable-extensions-except=${extensionRoot}`,
    `--load-extension=${extensionRoot}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debuggingPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--headless=new",
    "about:blank"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stderr = [];
  state.browser.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  state.browser.once("exit", (code) => {
    if (code !== null && code !== 0 && process.exitCode !== 1) {
      console.error(`Chrome exited with code ${code}: ${stderr.join("").slice(-1000)}`);
    }
  });

  const port = await waitForDebuggingPort(state.userDataDir, debuggingPort, stderr);
  const workerTarget = await waitForExtensionWorker(port);
  state.workerCdp = await CdpClient.connect(workerTarget.webSocketDebuggerUrl);
  await state.workerCdp.send("Runtime.enable");
  const manifestName = await evaluate(state.workerCdp, "chrome.runtime.getManifest().name");
  if (manifestName.value !== "Site Gate") {
    throw new Error(`Loaded extension worker is not Site Gate: ${manifestName.value}`);
  }

  const target = await getExistingPageTarget(port);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  state.cdp = cdp;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const first = `${sites[0].url}/first`;
  await navigate(cdp, first);
  const gateUrl = await waitForUrl(cdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(cdp);
  assertIncludes(gateUrl, encodeURIComponent(first), "gate URL should preserve target URL");
  await assertTextIncludes(cdp, "Do you want to open this site?");
  const firstGateLayout = await readGateLayout(cdp);
  assertGateRandomized(firstGateLayout);
  trace.push({ action: "gate-render", target: first, observedUrl: gateUrl });
  trace.push({ action: "randomized-gate-layout", layout: firstGateLayout });

  await evaluate(cdp, "document.querySelector('#minutes').value = '0'; document.querySelector('#custom-form').requestSubmit();");
  await assertTextIncludes(cdp, "Enter minutes greater than 0");
  assertIncludes(await currentUrl(cdp), "/gate.html", "invalid custom minutes should stay on gate");
  trace.push({ action: "invalid-custom-minutes", expected: "stay-on-gate", observedUrl: await currentUrl(cdp) });

  await evaluate(cdp, "document.querySelector('[data-minutes=\"0.1666666667\"]').click();");
  await waitForUrl(cdp, (url) => url === first);
  await assertTextIncludes(cdp, "Site one");
  trace.push({ action: "allow-ten-seconds", target: first, observedUrl: await currentUrl(cdp) });

  const sameOrigin = `${sites[0].url}/second`;
  await navigate(cdp, sameOrigin);
  await waitForUrl(cdp, (url) => url === sameOrigin);
  await assertTextIncludes(cdp, "Site one");
  trace.push({ action: "same-origin-reuse", target: sameOrigin, observedUrl: await currentUrl(cdp) });

  const oneMin = `${sites[1].url}/one`;
  await navigate(cdp, oneMin);
  await waitForUrl(cdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(cdp);
  await evaluate(cdp, "document.querySelector('[data-minutes=\"1\"]').click();");
  await waitForUrl(cdp, (url) => url === oneMin);
  await assertTextIncludes(cdp, "Site two");
  trace.push({ action: "allow-one-minute", target: oneMin, observedUrl: await currentUrl(cdp) });

  const fiveMin = `${sites[2].url}/five`;
  await navigate(cdp, fiveMin);
  await waitForUrl(cdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(cdp);
  await evaluate(cdp, "document.querySelector('[data-minutes=\"5\"]').click();");
  await waitForUrl(cdp, (url) => url === fiveMin);
  await assertTextIncludes(cdp, "Site three");
  trace.push({ action: "allow-five-minutes", target: fiveMin, observedUrl: await currentUrl(cdp) });

  const customPointOne = `${sites[3].url}/custom-point-one`;
  await navigate(cdp, customPointOne);
  await waitForUrl(cdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(cdp);
  await evaluate(cdp, "document.querySelector('#minutes').value = '0.1'; document.querySelector('#custom-form').requestSubmit();");
  await waitForUrl(cdp, (url) => url === customPointOne);
  await assertTextIncludes(cdp, "Site four");
  trace.push({ action: "allow-custom-decimal-minutes", minutes: 0.1, target: customPointOne, observedUrl: await currentUrl(cdp) });

  const customExpiry = `${sites[4].url}/custom-expiry`;
  await navigate(cdp, customExpiry);
  await waitForUrl(cdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(cdp);
  await evaluate(cdp, "document.querySelector('#minutes').value = '0.05'; document.querySelector('#custom-form').requestSubmit();");
  await waitForUrl(cdp, (url) => url === customExpiry);
  await assertTextIncludes(cdp, "Site five");
  trace.push({ action: "allow-custom-expiring-decimal-minutes", minutes: 0.05, target: customExpiry, observedUrl: await currentUrl(cdp) });

  await waitForTargetClosed(port, target.id);
  trace.push({ action: "expiry-closes-open-tab", target: customExpiry });
  state.cdp = null;

  const declineTarget = await openNewPageTarget(port);
  const declineCdp = await CdpClient.connect(declineTarget.webSocketDebuggerUrl);
  state.cdp = declineCdp;
  await declineCdp.send("Page.enable");
  await declineCdp.send("Runtime.enable");

  const decline = `${sites[5].url}/decline`;
  await navigate(declineCdp, decline);
  await waitForUrl(declineCdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(declineCdp);
  const screenshotPath = join(artifactsDir, "decline-gate.png");
  const screenshot = await declineCdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await evaluate(declineCdp, "document.querySelector('#decline').click();");
  await waitForTargetClosed(port, declineTarget.id);
  trace.push({ action: "decline-button-closes-tab", target: decline });
  state.cdp = null;

  const escapeTarget = await openNewPageTarget(port);
  const escapeCdp = await CdpClient.connect(escapeTarget.webSocketDebuggerUrl);
  state.cdp = escapeCdp;
  await escapeCdp.send("Page.enable");
  await escapeCdp.send("Runtime.enable");

  const escapeDecline = `${sites[6].url}/escape-decline`;
  await navigate(escapeCdp, escapeDecline);
  await waitForUrl(escapeCdp, (url) => url.startsWith("chrome-extension://") && url.includes("/gate.html"));
  await waitForGateReady(escapeCdp);
  await evaluate(escapeCdp, "setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 0); true;");
  await waitForTargetClosed(port, escapeTarget.id);
  trace.push({ action: "escape-closes-tab", target: escapeDecline });
  state.cdp = null;

  const tracePath = join(artifactsDir, "trace.json");
  const consoleLogPath = join(artifactsDir, "console.log");
  writeFileSync(tracePath, `${JSON.stringify({ browserPath, extensionRoot, steps: trace }, null, 2)}\n`);
  writeFileSync(consoleLogPath, [
    `browser=${browserPath}`,
    `extensionRoot=${extensionRoot}`,
    `firstGate=${gateUrl}`,
    `invalidCustomUrl=${trace.find((item) => item.action === "invalid-custom-minutes")?.observedUrl}`,
    `tenSecondUrl=${first}`,
    `sameOriginUrl=${sameOrigin}`,
    `oneMinuteUrl=${oneMin}`,
    `fiveMinuteUrl=${fiveMin}`,
    `customPointOneUrl=${customPointOne}`,
    `customExpiryUrl=${customExpiry}`,
    `expiryClosedTarget=${customExpiry}`,
    `declineClosedTarget=${decline}`,
    `escapeClosedTarget=${escapeDecline}`
  ].join("\n") + "\n");

  return {
    schemaVersion: 1,
    id: "site-gate-real-browser-smoke",
    surface: "chrome-extension",
    status: "passed",
    url: first,
    page: customExpiry,
    browserPath,
    extensionRoot,
    extensionLoaded: true,
    extensionContext: true,
    manifestPath: "manifest.json",
    screenshotPath: "decline-gate.png",
    tracePath: "trace.json",
    consoleLogPath: "console.log",
    assertions: [
      "first navigation was redirected to extension gate page before site content was shown",
      "gate card rendered inside the viewport at a randomized non-centered position",
      "gate action buttons rendered in a randomized order",
      "invalid custom minutes stayed on gate and displayed validation error",
      "10 sec opened the target",
      "same-origin navigation reused the active allowance",
      "1 min opened a separate target",
      "5 min opened a separate target",
      "custom 0.1 min opened a separate target",
      "custom 0.05 min opened a separate target and closed the open tab after expiry",
      "Actually no closed the tab instead of opening the target",
      "Escape closed the tab through the decline path"
    ]
  };
}

function startSite(label) {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Site ${label}</title><main><h1>Site ${label}</h1><p>${request.url}</p></main>`);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

async function waitForDebuggingPort(userDataDir, fallbackPort, stderr) {
  const file = join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = readFileSync(file, "utf8").trim().split(/\r?\n/);
      if (port) {
        return Number(port);
      }
    } catch {
      try {
        await listTargets(fallbackPort);
        return fallbackPort;
      } catch {
        await delay(100);
      }
    }
  }
  const stderrTail = stderr.join("").slice(-1000).trim();
  const detail = stderrTail ? ` Last browser stderr: ${stderrTail}` : "";
  throw new Error(`Timed out waiting for Chrome remote debugging endpoint.${detail}`);
}

async function waitForExtensionWorker(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await listTargets(port);
    const worker = targets.find((target) => target.type === "service_worker" && target.url.startsWith("chrome-extension://") && target.url.endsWith("/background.js"));
    if (worker) {
      return worker;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Site Gate extension service worker target.");
}

async function getExistingPageTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await listTargets(port);
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (page) {
      return page;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for a browser page target.");
}

async function openNewPageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`Failed to open new page target: ${response.status} ${await response.text()}`);
  }
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) {
    throw new Error("New page target did not expose a CDP websocket URL.");
  }
  return target;
}

async function waitForTargetClosed(port, targetId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await listTargets(port).catch(() => []);
    if (!targets.some((target) => target.id === targetId)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for target to close: ${targetId}`);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to list CDP targets: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
}

async function waitForUrl(cdp, predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const url = await currentUrl(cdp).catch(() => "");
    if (predicate(url)) {
      return url;
    }
    await delay(100);
  }
  const lastUrl = await currentUrl(cdp).catch(() => "(unavailable)");
  const lastText = await evaluate(cdp, "document.body ? document.body.innerText : ''").then((result) => result.value).catch(() => "(unavailable)");
  throw new Error(`Timed out waiting for URL. Last URL: ${lastUrl}. Page text: ${JSON.stringify(String(lastText).slice(0, 500))}`);
}

async function waitForGateReady(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await evaluate(cdp, "document.body?.dataset.ready === 'true'").catch(() => ({ value: false }));
    if (result.value === true) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the gate page to attach handlers.");
}

async function currentUrl(cdp) {
  const result = await evaluate(cdp, "location.href");
  return result.value;
}

async function assertTextIncludes(cdp, expected) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await evaluate(cdp, "document.body ? document.body.innerText : ''").catch(() => ({ value: "" }));
    if (String(result.value || "").includes(expected)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for page text: ${expected}`);
}

async function readGateLayout(cdp) {
  const result = await evaluate(cdp, `(() => {
    const shell = document.querySelector(".shell");
    const rect = shell.getBoundingClientRect();
    return {
      positioned: shell.dataset.positioned === "true",
      shuffled: document.querySelector(".actions")?.dataset.shuffled === "true",
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      actionOrder: Array.from(document.querySelectorAll(".actions button")).map((button) => button.textContent.trim())
    };
  })()`);
  return result.value;
}

function assertGateRandomized(layout) {
  if (!layout.positioned) {
    throw new Error("Gate shell did not mark itself as randomly positioned.");
  }
  if (!layout.shuffled) {
    throw new Error("Gate action buttons did not mark themselves as shuffled.");
  }

  const slop = 1;
  if (layout.left < -slop || layout.top < -slop || layout.right > layout.viewportWidth + slop || layout.bottom > layout.viewportHeight + slop) {
    throw new Error(`Gate shell escaped viewport bounds: ${JSON.stringify(layout)}`);
  }

  const expectedButtons = ["10 sec", "1 min", "5 min", "Actually no"].sort().join("|");
  const actualButtons = [...layout.actionOrder].sort().join("|");
  if (actualButtons !== expectedButtons) {
    throw new Error(`Gate action buttons changed unexpectedly: ${layout.actionOrder.join(" | ")}`);
  }

  const staticOrder = ["Actually no", "10 sec", "1 min", "5 min"].join("|");
  if (layout.actionOrder.join("|") === staticOrder) {
    throw new Error("Gate action buttons stayed in static HTML order.");
  }

  const hasHorizontalRoom = layout.viewportWidth - layout.width > 96;
  const hasVerticalRoom = layout.viewportHeight - layout.height > 96;
  const centerLeft = Math.max(0, (layout.viewportWidth - layout.width) / 2);
  const centerTop = Math.max(0, (layout.viewportHeight - layout.height) / 2);
  if (hasHorizontalRoom && hasVerticalRoom && Math.abs(layout.left - centerLeft) < 40 && Math.abs(layout.top - centerTop) < 40) {
    throw new Error(`Gate shell stayed near the old centered position: ${JSON.stringify(layout)}`);
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text || "exception"}`);
  }
  return response.result;
}

function assertIncludes(value, expected, message) {
  if (!String(value).includes(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}.`);
  }
}

async function cleanup() {
  if (state.cdp) {
    state.cdp.close();
  }
  if (state.workerCdp) {
    state.workerCdp.close();
  }
  if (state.browser && !state.browser.killed) {
    state.browser.kill("SIGTERM");
    const exited = await waitForProcessExit(state.browser, 1500);
    if (!exited) {
      state.browser.kill("SIGKILL");
      await waitForProcessExit(state.browser, 1500);
    }
  }
  for (const server of state.servers) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  if (state.userDataDir) {
    await removeWithRetry(state.userDataDir);
  }
}

function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise(true);
      return;
    }
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    child.once("exit", onExit);
  });
}

async function removeWithRetry(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await delay(200);
    }
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

class CdpClient {
  static async connect(wsUrl) {
    const parsed = new URL(wsUrl);
    const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
    const client = new CdpClient(socket);
    await client.handshake(parsed);
    return client;
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.handshakeBuffer = Buffer.alloc(0);
    this.handshakeDone = false;
  }

  handshake(parsed) {
    return new Promise((resolvePromise, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const request = [
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n");

      const onData = (chunk) => {
        this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
        const headerEnd = this.handshakeBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = this.handshakeBuffer.slice(0, headerEnd).toString("utf8");
        if (!header.includes("101")) {
          reject(new Error(`WebSocket handshake failed: ${header}`));
          return;
        }
        this.socket.off("data", onData);
        this.handshakeDone = true;
        const rest = this.handshakeBuffer.slice(headerEnd + 4);
        this.socket.on("data", (data) => this.handleData(data));
        if (rest.length > 0) {
          this.handleData(rest);
        }
        resolvePromise();
      };

      this.socket.once("error", reject);
      this.socket.on("data", onData);
      this.socket.write(request);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.socket.write(encodeFrame(payload));
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 10000);
    });
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 2) {
      const parsed = decodeFrame(this.buffer);
      if (!parsed) {
        return;
      }
      this.buffer = this.buffer.slice(parsed.bytes);
      if (parsed.opcode === 8) {
        this.close();
        return;
      }
      if (parsed.opcode !== 1) {
        continue;
      }
      const message = JSON.parse(parsed.payload.toString("utf8"));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
        } else {
          pending.resolve(message.result || {});
        }
      }
    }
  }

  close() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("CDP socket closed."));
    }
    this.pending.clear();
    this.socket.end();
  }
}

function encodeFrame(payload) {
  const body = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x81, 0x80 | body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  const masked = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) {
    masked[index] = body[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) {
      return null;
    }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) {
      return null;
    }
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) {
    return null;
  }
  let payload = buffer.slice(offset + maskLength, offset + maskLength + length);
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  }
  return {
    opcode,
    payload,
    bytes: offset + maskLength + length
  };
}

if (browserCandidates.length === 0) {
  console.error("No Chromium browser found. Set SITE_GATE_BROWSER_PATH to a Chrome or Edge executable.");
  process.exitCode = 1;
} else {
  let lastError = null;
  for (const browserPath of browserCandidates) {
    state = createState();
    try {
      const result = await runSmoke(browserPath);
      writeFileSync(join(artifactsDir, "scenario.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`Site Gate smoke passed. Browser: ${browserPath}`);
      console.log(`Evidence: ${join(artifactsDir, "scenario.json")}`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = error.message || String(error);
      const outcome = message.includes("Site Gate extension service worker target") ? "unavailable" : "failed";
      console.error(`Site Gate smoke ${outcome} with ${browserPath}: ${message}`);
    } finally {
      await cleanup();
    }
  }

  if (lastError) {
    console.error(lastError.stack || lastError.message || String(lastError));
    process.exitCode = 1;
  }
}
