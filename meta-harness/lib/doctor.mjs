import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { detectCodexCli, codexRunnerDefaultsFromEnv } from "./codex-runner.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(moduleDir, "../..");

export function runDoctor({ executable = "codex", env = process.env } = {}) {
  const checks = [];
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  addCheck(checks, {
    id: "node.version",
    status: nodeMajor >= 20 ? "passed" : "failed",
    message: `Node ${nodeVersion}`,
    detail: "Requires Node >=20."
  });
  for (const file of [
    "package.json",
    "meta-harness/lib/meta-cli.mjs",
    "meta-harness/lib/codex-runner.mjs",
    "docs/fresh-repo-feature-protocol.md"
  ]) {
    addCheck(checks, {
      id: `file.${file}`,
      status: existsSync(join(harnessRoot, file)) ? "passed" : "failed",
      message: file,
      detail: "Required packaged harness file."
    });
  }

  const codex = detectCodexCli({ executable });
  addCheck(checks, {
    id: "codex.version",
    status: codex.available ? "passed" : "failed",
    message: codex.available ? codex.version : codex.error,
    detail: `${executable} --version`
  });

  const defaults = codexRunnerDefaultsFromEnv(env);
  const packageJson = readPackageJson();
  const failed = checks.filter((check) => check.status !== "passed");
  return {
    schemaVersion: 1,
    kind: "jarvis.doctor",
    status: failed.length === 0 ? "passed" : "failed",
    package: {
      name: packageJson.name || null,
      version: packageJson.version || null,
      private: Boolean(packageJson.private),
      root: harnessRoot
    },
    defaults,
    checks
  };
}

export function renderDoctorReport(result) {
  const lines = [
    `Jarvis doctor: ${result.status}`,
    `Package: ${result.package.name}@${result.package.version}${result.package.private ? " (private)" : ""}`,
    `Root: ${result.package.root}`,
    "Defaults:",
    `- META_HARNESS_CODEX_MODEL=${result.defaults.model}`,
    `- META_HARNESS_CODEX_REASONING_EFFORT=${result.defaults.reasoningEffort}`,
    `- META_HARNESS_CODEX_IGNORE_USER_CONFIG=${result.defaults.ignoreUserConfig}`,
    "Checks:",
    ...result.checks.map((check) => `- ${check.status} ${check.id}: ${check.message}`)
  ];
  return lines.join("\n");
}

function addCheck(checks, { id, status, message, detail }) {
  checks.push({ id, status, message: message || "", detail: detail || "" });
}

function readPackageJson() {
  const path = join(harnessRoot, "package.json");
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8"));
}
