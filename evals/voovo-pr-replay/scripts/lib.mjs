import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const replayRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = dirname(dirname(replayRoot));

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function requiredArg(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function resolveCasePath(casePath) {
  return isAbsolute(casePath) ? casePath : resolve(process.cwd(), casePath);
}

export function loadCase(casePath) {
  const caseDir = resolveCasePath(casePath);
  const manifestPath = join(caseDir, "case.json");
  const manifest = readJson(manifestPath);
  return { caseDir, manifestPath, manifest };
}

export function caseRelative(caseDir, relativePath) {
  return resolve(caseDir, relativePath);
}

export function runCommand(command, cwd, options = {}) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 50,
    env: {
      ...process.env,
      ...(options.env || {})
    }
  });
  return {
    command,
    cwd,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

export function writeCommandLog(path, result) {
  const body = [
    `$ ${result.command}`,
    `cwd: ${result.cwd}`,
    `status: ${result.status}`,
    "",
    "## stdout",
    result.stdout,
    "## stderr",
    result.stderr
  ].join("\n");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export function ensureCleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

export function ensureExists(path, label = path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

