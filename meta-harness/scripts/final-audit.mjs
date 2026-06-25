#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(process.cwd());
const outputDir = join(repoRoot, "tmp/meta-harness-final-audit");

const requiredScripts = [
  "check",
  "meta",
  "meta:init",
  "meta:validate",
  "meta:codex-runner",
  "meta:verify-commands",
  "meta:verify-surfaces",
  "meta:verifier",
  "meta:policy",
  "meta:corpus",
  "meta:promote-failure",
  "meta:check",
  "meta:final-audit",
  "acceptance:test",
  "acceptance:verify",
  "web-ui:test-replay",
  "browser-extension:test-replay",
  "non-web:test-replay",
  "ab-harness:test",
  "site-gate:check",
  "voovo:test-repairs",
  "voovo:validate-cases"
];

const checkScriptFragments = [
  "npm run doctrine:validate",
  "npm run meta:check",
  "npm run acceptance:test",
  "npm run acceptance:verify",
  "npm run web-ui:test-replay",
  "npm run browser-extension:test-replay",
  "npm run non-web:test-replay",
  "npm run ab-harness:test",
  "npm run meta:final-audit",
  "npm run site-gate:check",
  "npm run voovo:test-repairs",
  "npm run voovo:validate-cases"
];

const requiredFiles = [
  "README.md",
  "bin/jarvis-harness.mjs",
  "meta-harness/lib/meta-cli.mjs",
  "meta-harness/README.md",
  "docs/meta-harness-new-session-usage.md",
  "docs/meta-harness-final-report-format.md",
  "docs/meta-harness-implementation-plan.md",
  "docs/meta-harness-implementation-plan-verification-report.md",
  "docs/goal-tool-calls.md",
  "evals/web-ui-replay/README.md",
  "evals/browser-extension-replay/README.md",
  "evals/non-web-replay/README.md",
  "evals/ab-harness/README.md",
  ".github/workflows/meta-harness-check.yml"
];

const docRequirements = [
  {
    path: "docs/meta-harness-new-session-usage.md",
    fragments: [
      "jarvis-harness doctor",
      "jarvis-harness run --repo",
      "jarvis-harness verify --run",
      "jarvis-harness report --run",
      "npm install -g .",
      "policy-decision.json",
      "final-report.json",
      "npm run check",
      "git diff --check",
      "200-500 total runs",
      "Rejected is repairable by default",
      "Blocked is the state that asks the user/operator for input"
    ]
  },
  {
    path: "docs/meta-harness-final-report-format.md",
    fragments: [
      "Findings:",
      "Decision:",
      "Blocking reason:",
      "Policy rules:",
      "Passed commands:",
      "Failed commands:",
      "Missing proof:",
      "Evidence:",
      "Residual risk:",
      "Next action:",
      "policy-decision.json",
      "verifier-report.json",
      "final-report.json",
      "For `rejected`, the default actor is the agent/harness repair loop",
      "For `blocked`, the next actor is the user/operator"
    ]
  },
  {
    path: "README.md",
    fragments: [
      "evals/ab-harness",
      "docs/meta-harness-new-session-usage.md",
      "docs/meta-harness-final-report-format.md",
      "npm install -g .",
      "jarvis-harness doctor",
      "jarvis-harness run --repo",
      "npm run meta:final-audit"
    ]
  },
  {
    path: "meta-harness/README.md",
    fragments: [
      "jarvis-harness run --repo",
      "jarvis-harness doctor",
      "npm install -g .",
      "A/B Evaluation Harness",
      "Final Report Format",
      "npm run meta:final-audit",
      "agent/harness repair action",
      "user/operator input needed",
      "blocked-notification.json",
      "meta run` exits `3`",
      "completion-notification.json"
    ]
  },
  {
    path: ".github/workflows/meta-harness-check.yml",
    fragments: [
      "npm run check",
      "git diff --check",
      "SITE_GATE_BROWSER_PATH"
    ]
  }
];

export function runFinalAudit({ now = new Date() } = {}) {
  const checks = [];
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts || {};
  addCheck(checks, {
    id: "package.bin.jarvis-harness",
    passed: packageJson.bin?.["jarvis-harness"] === "bin/jarvis-harness.mjs",
    message: "package.json defines jarvis-harness bin"
  });

  for (const script of requiredScripts) {
    addCheck(checks, {
      id: `script.${script}`,
      passed: typeof scripts[script] === "string" && scripts[script].length > 0,
      message: `package.json defines ${script}`
    });
  }

  for (const fragment of checkScriptFragments) {
    addCheck(checks, {
      id: `check-script.${safeId(fragment)}`,
      passed: String(scripts.check || "").includes(fragment),
      message: `npm run check includes ${fragment}`
    });
  }

  for (const file of requiredFiles) {
    addCheck(checks, {
      id: `file.${safeId(file)}`,
      passed: existsSync(join(repoRoot, file)),
      message: `${file} exists`
    });
  }

  for (const requirement of docRequirements) {
    const text = readText(requirement.path);
    for (const fragment of requirement.fragments) {
      addCheck(checks, {
        id: `doc.${safeId(requirement.path)}.${safeId(fragment)}`,
        passed: text.includes(fragment),
        message: `${requirement.path} mentions ${fragment}`
      });
    }
  }

  const help = spawnSync(process.execPath, ["meta-harness/scripts/meta.mjs", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  addCheck(checks, {
    id: "cli.help.exit",
    passed: help.status === 0,
    message: "meta CLI help exits successfully"
  });
  for (const fragment of [
    "meta init --repo",
    "meta run --repo",
    "meta run --run",
    "meta verify --run",
    "meta report --run",
    "meta rerun --from",
    "meta promote-failure",
    "meta cleanup --repo",
    "meta doctor"
  ]) {
    addCheck(checks, {
      id: `cli.help.${safeId(fragment)}`,
      passed: help.stdout.includes(fragment),
      message: `meta CLI help mentions ${fragment}`
    });
  }

  const jarvisHelp = spawnSync(process.execPath, ["bin/jarvis-harness.mjs", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  addCheck(checks, {
    id: "cli.jarvis-help.exit",
    passed: jarvisHelp.status === 0,
    message: "jarvis-harness CLI help exits successfully"
  });
  for (const fragment of [
    "jarvis-harness init --repo",
    "jarvis-harness run --repo",
    "jarvis-harness verify --run",
    "jarvis-harness report --run",
    "jarvis-harness doctor"
  ]) {
    addCheck(checks, {
      id: `cli.jarvis-help.${safeId(fragment)}`,
      passed: jarvisHelp.stdout.includes(fragment),
      message: `jarvis CLI help mentions ${fragment}`
    });
  }

  const goalText = readText("docs/goal-tool-calls.md");
  const goalHeadings = [...goalText.matchAll(/^## [0-9]+\. /gm)].length;
  addCheck(checks, {
    id: "goals.count",
    passed: goalHeadings === 18,
    message: "goal-tool-calls.md has exactly 18 numbered goals"
  });
  addCheck(checks, {
    id: "goals.final",
    passed: /^## 18\. Final Packaging, CI, Docs, And New-Session Usage/m.test(goalText),
    message: "goal 18 is the final packaging goal"
  });

  const failed = checks.filter((check) => check.status !== "passed");
  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.final-audit",
    generatedAt: now.toISOString(),
    status: failed.length === 0 ? "passed" : "failed",
    checkCount: checks.length,
    failedCount: failed.length,
    checks
  };
  mkdirSync(outputDir, { recursive: true });
  writeJson(join(outputDir, "summary.json"), summary);
  writeFileSync(join(outputDir, "report.md"), renderReport(summary));
  return summary;
}

function addCheck(checks, { id, passed, message }) {
  checks.push({
    id,
    status: passed ? "passed" : "failed",
    message
  });
}

function renderReport(summary) {
  const failed = summary.checks.filter((check) => check.status !== "passed");
  return `# Meta-Harness Final Audit

Status: ${summary.status}

Checks: ${summary.checkCount}

Failed: ${summary.failedCount}

## Failed Checks

${failed.map((check) => `- ${check.id}: ${check.message}`).join("\n") || "- none"}
`;
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const summary = runFinalAudit();
  console.log(`Meta-harness final audit ${summary.status}. Checks: ${summary.checkCount}.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);
  if (summary.status !== "passed") {
    for (const check of summary.checks.filter((item) => item.status !== "passed")) {
      console.error(`${check.id}: ${check.message}`);
    }
    process.exit(1);
  }
}
