#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const repoPath = resolve(args.repo);

try {
  await runScenario(args.scenario);
} catch (error) {
  emit({
    type: "final_message",
    claimStatus: "failed",
    content: `Fake Codex process failed: ${error.message || String(error)}`
  });
  process.exitCode = 1;
}

async function runScenario(scenario) {
  if (scenario === "success") {
    emit({ type: "assistant_message", content: "I am inspecting the repository before editing." });
    emit({
      type: "command",
      phase: "inspect",
      command: "ls package.json src",
      exitCode: 0,
      stdout: "package.json\nsrc\n"
    });
    emit({ type: "inspection", message: "Package and source tree inspected before edits." });
    writeRepoFile("src/site-gate.js", "export function shouldGate(url) {\n  return Boolean(url);\n}\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "command",
      phase: "verify",
      command: "npm test -- --runInBand",
      exitCode: 0,
      stdout: "ok 1 - gate behavior\n",
      proofObligationIds: ["P2"]
    });
    emit({
      type: "final_message",
      claimStatus: "attempt-complete",
      content: "Implementation attempt finished; verification and policy still need to accept it."
    });
    return;
  }

  if (scenario === "web-ui-success") {
    emit({ type: "assistant_message", content: "I am inspecting the routed browse UI and local scripts before editing." });
    emit({
      type: "command",
      phase: "inspect",
      command: "find package.json app src scripts -type f | sort",
      exitCode: 0,
      stdout: [
        "app/(browse)/browse/page.tsx",
        "package.json",
        "scripts/assertions.mjs",
        "scripts/build-browse.mjs",
        "scripts/dev-clean.mjs",
        "scripts/e2e-browse-to-purchase.mjs",
        "scripts/smoke-browse.mjs",
        "scripts/test-browse.mjs",
        "src/browse-catalog.mjs"
      ].join("\n") + "\n"
    });
    emit({ type: "inspection", message: "Browse route, catalog module, and proof scripts inspected before edits." });
    writeRepoFile("src/browse-catalog.mjs", `const offerings = [
  { id: "algorithms", title: "Algorithms Sprint", checkoutPath: "/checkout/algorithms" },
  { id: "biology", title: "Biology Exam Pack", checkoutPath: "/checkout/biology" },
  { id: "calculus", title: "Calculus Crash Course", checkoutPath: "/checkout/calculus" }
];

export function allOfferings() {
  return offerings.map((offering) => ({ ...offering }));
}

export function searchCatalog(query = "") {
  const normalizedQuery = String(query).trim().toLowerCase();
  const items = normalizedQuery
    ? offerings.filter((offering) => offering.title.toLowerCase().includes(normalizedQuery))
    : offerings;

  if (items.length === 0) {
    return {
      status: "empty",
      query,
      items: [],
      visibleOfferings: [],
      emptyState: {
        title: "No offerings found",
        body: \`No browse offerings match "\${query}". Reset filters to see all offerings.\`,
        resetLabel: "Reset filters"
      }
    };
  }

  return {
    status: "ready",
    query,
    items: items.map((offering) => ({ ...offering })),
    visibleOfferings: items.map((offering) => offering.title),
    emptyState: null
  };
}

export function resetBrowse() {
  return {
    status: "ready",
    query: "",
    items: allOfferings(),
    visibleOfferings: offerings.map((offering) => offering.title),
    emptyState: null
  };
}
`);
    emit({ type: "edit", path: "src/browse-catalog.mjs", action: "write" });
    emit({
      type: "command",
      phase: "verify",
      command: "npm run test -- --runInBand",
      exitCode: 0,
      stdout: "ok 1 - browse no-results empty state and reset\n",
      proofObligationIds: ["P2"]
    });
    emit({
      type: "final_message",
      claimStatus: "attempt-complete",
      content: "Implementation attempt finished; verification and policy still need to accept it."
    });
    return;
  }

  if (scenario === "browser-extension-success") {
    emit({ type: "assistant_message", content: "I am inspecting the browser-extension manifest, service worker, pages, and smoke scripts before claiming implementation." });
    emit({
      type: "command",
      phase: "inspect",
      command: "find manifest.json background.js gate.html gate.js blocked.html blocked.js scripts -type f | sort",
      exitCode: 0,
      stdout: [
        "background.js",
        "blocked.html",
        "blocked.js",
        "gate.html",
        "gate.js",
        "manifest.json",
        "scripts/assert-negative-scenario.mjs",
        "scripts/smoke-cdp.mjs",
        "scripts/validate-extension.mjs"
      ].join("\n") + "\n"
    });
    emit({ type: "inspection", message: "Manifest V3, background service worker, gate/blocked pages, and smoke scripts inspected before verification." });
    emit({
      type: "command",
      phase: "verify",
      command: "npm run test",
      exitCode: 0,
      stdout: "Site Gate extension manifest and source checks passed.\n",
      proofObligationIds: ["P2"]
    });
    emit({
      type: "final_message",
      claimStatus: "attempt-complete",
      content: "Browser-extension implementation attempt finished; smoke proof, verifier, and policy still need to accept it."
    });
    return;
  }

  if (scenario === "data-pipeline-success") {
    emit({ type: "assistant_message", content: "I am inspecting the data-pipeline CLI, fixtures, generated-artifact scripts, and approval boundary before claiming implementation." });
    emit({
      type: "command",
      phase: "inspect",
      command: "find package.json bin src scripts fixtures docs -type f | sort",
      exitCode: 0,
      stdout: [
        "bin/hu-ocr-smoke.mjs",
        "docs/approval-boundary.md",
        "fixtures/good-old-doc.txt",
        "fixtures/missing-text-layer.txt",
        "package.json",
        "scripts/assert-negative.mjs",
        "scripts/test-pipeline.mjs",
        "src/ocr-quality.mjs"
      ].join("\n") + "\n"
    });
    emit({ type: "inspection", message: "OCR pipeline CLI, fixtures, tests, and local-only cost/approval boundary inspected before verification." });
    emit({
      type: "command",
      phase: "verify",
      command: "npm run test",
      exitCode: 0,
      stdout: "ok - OCR quality helpers preserve searchable text and token evidence\n",
      proofObligationIds: ["P2"]
    });
    emit({
      type: "final_message",
      claimStatus: "attempt-complete",
      content: "Data-pipeline implementation attempt finished; pipeline smoke, artifact proof, verifier, and policy still need to accept it."
    });
    return;
  }

  if (scenario === "failed-command") {
    emit({ type: "assistant_message", content: "I inspected first, then implemented a change." });
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile("src/site-gate.js", "export const broken = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "command",
      phase: "verify",
      command: "npm test -- --runInBand",
      exitCode: 1,
      stdout: "not ok 1 - gate behavior\n",
      stderr: "Expected confirmation prompt to render.\n",
      proofObligationIds: ["P2", "P4"]
    });
    emit({ type: "final_message", claimStatus: "failed", content: "Verification failed." });
    return;
  }

  if (scenario === "edit-before-inspection") {
    writeRepoFile("src/site-gate.js", "export const editedTooSoon = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection happened after an edit." });
    emit({ type: "final_message", claimStatus: "attempt-complete", content: "Attempt finished." });
    return;
  }

  if (scenario === "forbidden-edit") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile(".env", "TOKEN=fake-runner-secret\n");
    emit({ type: "edit", path: ".env", action: "write" });
    emit({ type: "final_message", claimStatus: "attempt-complete", content: "Attempt finished after forbidden edit." });
    return;
  }

  if (scenario === "timeout") {
    emit({ type: "assistant_message", content: "Starting a long-running fake Codex operation." });
    await new Promise(() => {
      setInterval(() => {}, 1000);
    });
    return;
  }

  if (scenario === "interrupt") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    emit({ type: "interrupt", message: "User interrupted the fake run." });
    process.exit(130);
  }

  if (scenario === "final-overclaim") {
    emit({ type: "command", phase: "inspect", command: "ls package.json", exitCode: 0, stdout: "package.json\n" });
    emit({ type: "inspection", message: "Inspection complete." });
    writeRepoFile("src/site-gate.js", "export const unverified = true;\n");
    emit({ type: "edit", path: "src/site-gate.js", action: "write" });
    emit({
      type: "final_message",
      claimStatus: "passed",
      content: "Done. All requirements are fully verified and accepted."
    });
    return;
  }

  throw new Error(`Unknown fake scenario: ${scenario}`);
}

function writeRepoFile(path, content) {
  const absolutePath = join(repoPath, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function emit(item) {
  process.stdout.write(`${JSON.stringify(item)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    scenario: "success",
    repo: null,
    runDir: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--scenario") {
      parsed.scenario = argv[++index];
    } else if (item === "--repo") {
      parsed.repo = argv[++index];
    } else if (item === "--run-dir") {
      parsed.runDir = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  if (!parsed.repo) {
    throw new Error("--repo is required.");
  }
  if (!parsed.runDir) {
    throw new Error("--run-dir is required.");
  }

  return parsed;
}
