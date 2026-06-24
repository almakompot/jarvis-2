#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const defaultTaskSetPath = join(repoRoot, "evals/ab-harness/fixtures/dry-run-task-set.json");
const defaultVariantsPath = join(repoRoot, "evals/ab-harness/fixtures/dry-run-variants.json");
const defaultOutputDir = join(repoRoot, "tmp/ab-harness/dry-run");
const markerFile = ".ab-harness-output";

const scoringRubric = [
  {
    id: "traceability",
    label: "Traceability",
    points: 20,
    capabilities: ["task-packet", "repo-profile"]
  },
  {
    id: "proof-execution",
    label: "Proof execution",
    points: 20,
    capabilities: ["command-proof", "user-surface"]
  },
  {
    id: "negative-and-edge",
    label: "Negative and edge coverage",
    points: 15,
    capabilities: ["negative-path"]
  },
  {
    id: "artifact-grounding",
    label: "Artifact grounding",
    points: 20,
    capabilities: ["artifact-content-validation", "independent-verifier", "policy-decision"]
  },
  {
    id: "decision-honesty",
    label: "Decision honesty",
    points: 20,
    decisionHonesty: true
  },
  {
    id: "safety-boundary",
    label: "Safety boundary",
    points: 5,
    capabilities: ["safety-boundary"]
  }
];

export function runAbHarnessSuite({
  taskSetPath = defaultTaskSetPath,
  variantsPath = defaultVariantsPath,
  outputDir = defaultOutputDir,
  repeats = null,
  keepOutput = false,
  json = false,
  now = new Date("2026-06-24T16:00:00.000Z")
} = {}) {
  const taskSet = validateTaskSet(readJson(resolve(taskSetPath)));
  const variants = validateVariants(readJson(resolve(variantsPath)));
  const repeatCount = repeats === null ? taskSet.repeats : Number(repeats);
  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error("repeats must be a positive integer.");
  }

  const absoluteOutputDir = resolve(outputDir);
  prepareOutputDir({ outputDir: absoluteOutputDir, keepOutput });
  const runs = [];
  for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
    for (const task of taskSet.tasks) {
      for (const variant of variants.variants) {
        runs.push(evaluateRun({ task, variant, repeat, outputDir: absoluteOutputDir }));
      }
    }
  }

  const summary = {
    schemaVersion: 1,
    kind: "meta-harness.ab-eval-summary",
    mode: "dry-run",
    generatedAt: now.toISOString(),
    taskSet: {
      id: taskSet.id,
      title: taskSet.title,
      taskCount: taskSet.tasks.length,
      repeats: repeatCount,
      validationScale: taskSet.validationScale
    },
    variants: variants.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      kind: variant.kind,
      capabilities: variant.capabilities,
      artifactPolicy: variant.artifactPolicy,
      decisionPolicy: variant.decisionPolicy
    })),
    scoringRubric,
    runs,
    aggregate: aggregateRuns({ runs, variants: variants.variants }),
    reportPath: join(absoluteOutputDir, "report.md")
  };
  writeJson(join(absoluteOutputDir, "summary.json"), summary);
  writeFileSync(summary.reportPath, renderReport(summary));
  if (!json) {
    printSummary(summary);
  }
  return summary;
}

function validateTaskSet(taskSet) {
  requireObject(taskSet, "task set");
  requireEqual(taskSet.schemaVersion, 1, "taskSet.schemaVersion");
  requireEqual(taskSet.kind, "meta-harness.ab-task-set", "taskSet.kind");
  requireString(taskSet.id, "taskSet.id");
  requireString(taskSet.title, "taskSet.title");
  if (!Number.isInteger(taskSet.repeats) || taskSet.repeats < 1) {
    throw new Error("taskSet.repeats must be a positive integer.");
  }
  requireObject(taskSet.validationScale, "taskSet.validationScale");
  if (taskSet.validationScale.recommendedRunsMin !== 200 || taskSet.validationScale.recommendedRunsMax !== 500) {
    throw new Error("taskSet.validationScale must record 200-500 recommended validation runs.");
  }
  requireArray(taskSet.tasks, "taskSet.tasks");
  for (const task of taskSet.tasks) {
    requireString(task.id, "task.id");
    requireString(task.title, `task ${task.id}.title`);
    requireString(task.taskClass, `task ${task.id}.taskClass`);
    requireString(task.prompt, `task ${task.id}.prompt`);
    if (!["accepted", "rejected", "blocked"].includes(task.expectedDecision)) {
      throw new Error(`task ${task.id}.expectedDecision must be accepted, rejected, or blocked.`);
    }
    requireObject(task.failureTrap, `task ${task.id}.failureTrap`);
    requireString(task.failureTrap.category, `task ${task.id}.failureTrap.category`);
    requireArray(task.requiredCapabilities, `task ${task.id}.requiredCapabilities`);
    requireArray(task.artifactExpectations, `task ${task.id}.artifactExpectations`);
  }
  return taskSet;
}

function validateVariants(variants) {
  requireObject(variants, "variants");
  requireEqual(variants.schemaVersion, 1, "variants.schemaVersion");
  requireEqual(variants.kind, "meta-harness.ab-variants", "variants.kind");
  requireString(variants.id, "variants.id");
  requireArray(variants.variants, "variants.variants");
  for (const variant of variants.variants) {
    requireString(variant.id, "variant.id");
    requireString(variant.label, `variant ${variant.id}.label`);
    requireString(variant.kind, `variant ${variant.id}.kind`);
    requireString(variant.runnerCommand, `variant ${variant.id}.runnerCommand`);
    requireArray(variant.capabilities, `variant ${variant.id}.capabilities`);
    requireArray(variant.artifactPolicy, `variant ${variant.id}.artifactPolicy`);
    if (!["accepts-final-claim", "policy-gated"].includes(variant.decisionPolicy)) {
      throw new Error(`variant ${variant.id}.decisionPolicy must be accepts-final-claim or policy-gated.`);
    }
  }
  return variants;
}

function evaluateRun({ task, variant, repeat, outputDir }) {
  const runId = `${task.id}__${variant.id}__r${repeat}`;
  const runDir = join(outputDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const capabilitySet = new Set(variant.capabilities);
  const requiredCapabilities = task.requiredCapabilities || [];
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
  const actualDecision = decideRun({ task, variant, missingCapabilities });
  const classifications = classifyRun({ task, actualDecision, missingCapabilities });
  const score = scoreRun({ task, variant, actualDecision, missingCapabilities });
  const artifacts = writeRunArtifacts({
    task,
    variant,
    repeat,
    runId,
    runDir,
    actualDecision,
    missingCapabilities,
    classifications,
    score
  });
  return {
    runId,
    taskId: task.id,
    taskClass: task.taskClass,
    variantId: variant.id,
    repeat,
    expectedDecision: task.expectedDecision,
    actualDecision,
    score: score.total,
    scoreBreakdown: score.breakdown,
    missingCapabilities,
    classifications,
    artifactDir: runDir,
    artifacts
  };
}

function decideRun({ task, variant, missingCapabilities }) {
  if (variant.decisionPolicy === "policy-gated") {
    if (task.expectedDecision === "rejected") {
      return missingCapabilities.length === 0 ? "rejected" : "accepted";
    }
    return missingCapabilities.length === 0 ? task.expectedDecision : "rejected";
  }
  if (task.expectedDecision === "blocked") {
    return "accepted";
  }
  return "accepted";
}

function classifyRun({ task, actualDecision, missingCapabilities }) {
  const classifications = [];
  if (task.expectedDecision === "rejected" && actualDecision === "accepted") {
    classifications.push("false_accept");
  }
  if (task.expectedDecision === "accepted" && actualDecision === "rejected") {
    classifications.push("false_reject");
  }
  if (actualDecision === "blocked") {
    classifications.push("blocked");
  }
  const mapping = [
    ["user-surface", "missed_surface_proof"],
    ["negative-path", "missing_negative_path"],
    ["artifact-content-validation", "weak_artifact_validation"],
    ["safety-boundary", "unsafe_live_action_unblocked"],
    ["policy-decision", "no_policy_gate"],
    ["independent-verifier", "no_independent_verifier"]
  ];
  for (const [capability, classification] of mapping) {
    if (missingCapabilities.includes(capability)) {
      classifications.push(classification);
    }
  }
  if (missingCapabilities.includes("task-packet") || missingCapabilities.includes("repo-profile")) {
    classifications.push("traceability_gap");
  }
  return [...new Set(classifications)];
}

function scoreRun({ task, variant, actualDecision }) {
  const variantCapabilities = new Set(variant.capabilities);
  const required = new Set(task.requiredCapabilities);
  const breakdown = scoringRubric.map((rule) => {
    if (rule.decisionHonesty) {
      const passed = actualDecision === task.expectedDecision;
      return {
        id: rule.id,
        label: rule.label,
        points: passed ? rule.points : 0,
        maxPoints: rule.points,
        passed,
        missingCapabilities: []
      };
    }
    const relevant = rule.capabilities.filter((capability) => required.has(capability));
    if (relevant.length === 0) {
      return {
        id: rule.id,
        label: rule.label,
        points: rule.points,
        maxPoints: rule.points,
        passed: true,
        notApplicable: true,
        missingCapabilities: []
      };
    }
    const present = relevant.filter((capability) => variantCapabilities.has(capability));
    const points = Math.round((present.length / relevant.length) * rule.points);
    return {
      id: rule.id,
      label: rule.label,
      points,
      maxPoints: rule.points,
      passed: points === rule.points,
      missingCapabilities: relevant.filter((capability) => !variantCapabilities.has(capability))
    };
  });
  return {
    total: breakdown.reduce((sum, item) => sum + item.points, 0),
    breakdown
  };
}

function writeRunArtifacts({
  task,
  variant,
  repeat,
  runId,
  runDir,
  actualDecision,
  missingCapabilities,
  classifications,
  score
}) {
  const artifactIndex = [
    "run.json",
    "task.md",
    "variant.json",
    "verification.json",
    "policy-decision.json",
    "final-report.json",
    "artifact-index.json"
  ];
  writeJson(join(runDir, "run.json"), {
    schemaVersion: 1,
    kind: "meta-harness.ab-run",
    runId,
    taskId: task.id,
    taskClass: task.taskClass,
    variantId: variant.id,
    repeat,
    expectedDecision: task.expectedDecision,
    actualDecision,
    missingCapabilities,
    classifications,
    score: score.total,
    dryRun: true
  });
  writeFileSync(join(runDir, "task.md"), `${task.prompt}\n`);
  writeJson(join(runDir, "variant.json"), variant);
  writeJson(join(runDir, "verification.json"), {
    schemaVersion: 1,
    kind: "meta-harness.ab-dry-verification",
    runId,
    status: actualDecision === "accepted" ? "passed" : "failed",
    missingCapabilities,
    artifactExpectations: task.artifactExpectations,
    note: "Dry-run stub. Real campaigns replace this with meta-harness verification.json."
  });
  writeJson(join(runDir, "policy-decision.json"), {
    schemaVersion: 1,
    kind: "meta-harness.ab-dry-policy-decision",
    runId,
    decision: actualDecision,
    classifications,
    note: "Dry-run stub. Real campaigns replace this with meta-harness policy-decision.json."
  });
  writeJson(join(runDir, "final-report.json"), {
    schemaVersion: 1,
    kind: "meta-harness.ab-dry-final-report",
    runId,
    outcome: actualDecision === "accepted" ? "passed" : actualDecision,
    score: score.total,
    residualRisk: ["Dry-run scoring uses declared variant capabilities, not a live Codex process."]
  });
  writeJson(join(runDir, "artifact-index.json"), {
    schemaVersion: 1,
    kind: "meta-harness.ab-artifact-index",
    runId,
    collectionMode: "dry-run-stub",
    expectedRealArtifacts: task.artifactExpectations,
    collectedArtifacts: artifactIndex,
    variantArtifactPolicy: variant.artifactPolicy
  });
  return artifactIndex.map((artifact) => join(runDir, artifact));
}

function aggregateRuns({ runs, variants }) {
  const byVariant = {};
  for (const variant of variants) {
    const variantRuns = runs.filter((run) => run.variantId === variant.id);
    const exactMatches = variantRuns.filter((run) => run.actualDecision === run.expectedDecision);
    byVariant[variant.id] = {
      runCount: variantRuns.length,
      averageScore: average(variantRuns.map((run) => run.score)),
      exactDecisionMatches: exactMatches.length,
      exactDecisionRate: ratio(exactMatches.length, variantRuns.length),
      falseAccepts: variantRuns.filter((run) => run.classifications.includes("false_accept")).length,
      falseRejects: variantRuns.filter((run) => run.classifications.includes("false_reject")).length,
      classifications: countClassifications(variantRuns)
    };
  }
  return {
    runCount: runs.length,
    averageScore: average(runs.map((run) => run.score)),
    byVariant,
    classifications: countClassifications(runs)
  };
}

function countClassifications(runs) {
  const counts = {};
  for (const run of runs) {
    for (const classification of run.classifications) {
      counts[classification] = (counts[classification] || 0) + 1;
    }
  }
  return counts;
}

function renderReport(summary) {
  const variantRows = Object.entries(summary.aggregate.byVariant)
    .map(([variantId, item]) => `| ${variantId} | ${item.runCount} | ${item.averageScore} | ${item.exactDecisionRate} | ${item.falseAccepts} | ${item.falseRejects} |`)
    .join("\n");
  const classificationRows = Object.entries(summary.aggregate.classifications)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classification, count]) => `| ${classification} | ${count} |`)
    .join("\n") || "| none | 0 |";
  return `# A/B Harness Dry-Run Report

Task set: ${summary.taskSet.id}

Mode: ${summary.mode}

Total dry-run records: ${summary.aggregate.runCount}

Validation campaign scale: ${summary.taskSet.validationScale.recommendedRunsMin}-${summary.taskSet.validationScale.recommendedRunsMax} runs are for confidence measurement, not implementation steps.

## Variant Summary

| Variant | Runs | Average Score | Exact Decision Rate | False Accepts | False Rejects |
| --- | ---: | ---: | ---: | ---: | ---: |
${variantRows}

## Failure Classification

| Classification | Count |
| --- | ---: |
${classificationRows}

## Scoring Rubric

${summary.scoringRubric.map((rule) => `- ${rule.id}: ${rule.points} points`).join("\n")}

## Artifact Collection

Every dry-run record writes a per-run directory with run metadata, task prompt, variant config, dry verification, dry policy decision, final report, and artifact index. Real campaigns should replace dry stubs with actual task packets, transcripts, command logs, diffs, evidence, verifier reports, policy decisions, final reports, browser traces, screenshots, and generated artifacts.
`;
}

function prepareOutputDir({ outputDir, keepOutput }) {
  if (existsSync(outputDir) && !keepOutput) {
    const marker = join(outputDir, markerFile);
    const isEmpty = readdirSync(outputDir).length === 0;
    if (!existsSync(marker) && !isEmpty) {
      throw new Error(`Refusing to remove unmarked A/B harness output directory: ${outputDir}`);
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, markerFile), "A/B harness output\n");
}

function printSummary(summary) {
  console.log(`A/B harness dry run: ${summary.aggregate.runCount} records`);
  for (const [variantId, item] of Object.entries(summary.aggregate.byVariant)) {
    console.log(`${variantId}: score ${item.averageScore}, exact decision rate ${item.exactDecisionRate}, false accepts ${item.falseAccepts}`);
  }
  console.log(`Summary: ${join(dirname(summary.reportPath), "summary.json")}`);
  console.log(`Report: ${summary.reportPath}`);
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function ratio(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
}

function requireString(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}.`);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task-set") {
      options.taskSetPath = argv[++index];
    } else if (arg === "--variants") {
      options.variantsPath = argv[++index];
    } else if (arg === "--output-dir") {
      options.outputDir = argv[++index];
    } else if (arg === "--repeats") {
      options.repeats = Number(argv[++index]);
    } else if (arg === "--keep-output") {
      options.keepOutput = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node evals/ab-harness/scripts/run-suite.mjs [options]

Options:
  --task-set <path>    Task set JSON file
  --variants <path>    Variant JSON file
  --output-dir <path>  Output directory
  --repeats <n>        Override task-set repeat count
  --keep-output        Do not clear a marked output directory first
  --json               Suppress human summary
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runAbHarnessSuite(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
