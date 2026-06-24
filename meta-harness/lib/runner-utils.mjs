import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const maxCapturedFileBytes = 1024 * 1024;

export function snapshotRepo(repoPath, allowedFiles) {
  const root = resolve(repoPath);
  const files = new Map();
  walkSnapshot({ root, dir: root, files, allowedFiles });
  return files;
}

export function buildChangedFiles({ runId, createdAt, beforeSnapshot, afterSnapshot, note }) {
  const files = [];
  const paths = [...new Set([...beforeSnapshot.keys(), ...afterSnapshot.keys()])].sort();

  for (const path of paths) {
    const before = beforeSnapshot.get(path);
    const after = afterSnapshot.get(path);
    const status = changedStatus(before, after);
    if (!status) {
      continue;
    }
    const forbidden = Boolean(before?.forbidden || after?.forbidden);
    const contentCaptured = Boolean((before?.contentCaptured ?? true) && (after?.contentCaptured ?? true) && !forbidden);
    files.push({
      path,
      status,
      forbidden,
      contentCaptured,
      hashBefore: contentCaptured ? before?.hash || null : null,
      hashAfter: contentCaptured ? after?.hash || null : null,
      bytesBefore: before?.size ?? null,
      bytesAfter: after?.size ?? null
    });
  }

  return {
    schemaVersion: 1,
    kind: "meta-harness.changed-files",
    runId,
    createdAt,
    status: "captured",
    files,
    note: note || "Captured by M4 runner using a before/after filesystem snapshot."
  };
}

export function renderDiff({ changedFiles, beforeSnapshot, afterSnapshot }) {
  return changedFiles.files.map((file) => {
    const before = beforeSnapshot.get(file.path);
    const after = afterSnapshot.get(file.path);
    if (!file.contentCaptured) {
      return renderRedactedDiff(file);
    }
    return renderTextDiff({ file, before, after });
  }).join("");
}

export function isForbiddenPath(path, allowedFiles = {}) {
  const relPath = normalizeRelativePath(path);
  if (!relPath) {
    return true;
  }
  if (relPath === ".env" || relPath.startsWith(".env.")) {
    return true;
  }
  if (relPath === ".git" || relPath.startsWith(".git/")) {
    return true;
  }
  if (relPath === "node_modules" || relPath.startsWith("node_modules/") || relPath.includes("/node_modules/")) {
    return true;
  }
  if (relPath.endsWith(".pem") || relPath.endsWith(".key")) {
    return true;
  }
  if (/^(.+\/)?service-account.*\.json$/i.test(relPath)) {
    return true;
  }
  if (/^\.task-runs\/[^/]+\/transcript-secrets\//.test(relPath)) {
    return true;
  }
  const extraPatterns = Array.isArray(allowedFiles.forbiddenPatterns) ? allowedFiles.forbiddenPatterns : [];
  return extraPatterns.some((pattern) => pattern === relPath);
}

export function normalizeRelativePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function relativeArtifact(runDir, artifactPath) {
  return normalizeRelativePath(relative(runDir, artifactPath));
}

export function appendJsonl(path, entries) {
  if (!entries.length) {
    return;
  }
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { flag: "a" });
}

export function readJsonl(path) {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).map((line) => JSON.parse(line));
}

export function nextAppendDate(jsonlPath, now = new Date()) {
  const requested = now instanceof Date ? now.getTime() : Date.parse(now);
  const maxExisting = readJsonl(jsonlPath).reduce((max, row) => {
    const timestamp = row.timestamp || row.startedAt || row.finishedAt;
    const value = Date.parse(timestamp);
    return Number.isNaN(value) ? max : Math.max(max, value);
  }, Number.NEGATIVE_INFINITY);
  return new Date(Math.max(requested, maxExisting + 1));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function walkSnapshot({ root, dir, files, allowedFiles }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = normalizeRelativePath(relative(root, fullPath));
    if (!relPath) {
      continue;
    }
    if (entry.isDirectory()) {
      if (shouldSkipSnapshotDirectory(relPath)) {
        continue;
      }
      walkSnapshot({ root, dir: fullPath, files, allowedFiles });
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stats = statSync(fullPath);
    const forbidden = isForbiddenPath(relPath, allowedFiles);
    const contentResult = readCapturableFile(fullPath, { forbidden, size: stats.size });
    files.set(relPath, {
      path: relPath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      forbidden,
      contentCaptured: contentResult.contentCaptured,
      content: contentResult.content,
      hash: contentResult.hash
    });
  }
}

function shouldSkipSnapshotDirectory(relPath) {
  return relPath === ".git"
    || relPath.startsWith(".git/")
    || relPath === ".task-runs"
    || relPath.startsWith(".task-runs/")
    || relPath.includes("/.task-runs/")
    || relPath === "node_modules"
    || relPath.includes("/node_modules/");
}

function readCapturableFile(path, { forbidden, size }) {
  if (forbidden || size > maxCapturedFileBytes) {
    return { contentCaptured: false, content: null, hash: null };
  }
  const buffer = readFileSync(path);
  if (buffer.includes(0)) {
    return { contentCaptured: false, content: null, hash: null };
  }
  return {
    contentCaptured: true,
    content: buffer.toString("utf8"),
    hash: createHash("sha256").update(buffer).digest("hex")
  };
}

function changedStatus(before, after) {
  if (!before && after) {
    return "added";
  }
  if (before && !after) {
    return "deleted";
  }
  if (!before || !after) {
    return null;
  }
  if (before.contentCaptured && after.contentCaptured) {
    return before.hash === after.hash ? null : "modified";
  }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    return "modified";
  }
  return null;
}

function renderRedactedDiff(file) {
  return [
    `diff --git a/${file.path} b/${file.path}`,
    `--- ${file.status === "added" ? "/dev/null" : `a/${file.path}`}`,
    `+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
    "@@ redacted @@",
    `# ${file.status} file content not captured because the path is forbidden or not safely text-capturable.`,
    ""
  ].join("\n");
}

function renderTextDiff({ file, before, after }) {
  const beforeLines = splitLines(before?.content || "");
  const afterLines = splitLines(after?.content || "");
  return [
    `diff --git a/${file.path} b/${file.path}`,
    `--- ${file.status === "added" ? "/dev/null" : `a/${file.path}`}`,
    `+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
    `@@ -1,${Math.max(beforeLines.length, 1)} +1,${Math.max(afterLines.length, 1)} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

function splitLines(content) {
  if (!content) {
    return [];
  }
  return content.replace(/\n$/, "").split(/\n/);
}
