import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAbHarnessSuite } from "./run-suite.mjs";

test("A/B dry-run suite compares baseline and meta-harness variants", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ab-harness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const summary = runAbHarnessSuite({
    outputDir: join(root, "dry-run"),
    json: true
  });

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.taskSet.validationScale.recommendedRunsMin, 200);
  assert.equal(summary.taskSet.validationScale.recommendedRunsMax, 500);
  assert.match(summary.taskSet.validationScale.note, /not implementation steps/i);
  assert.equal(summary.aggregate.runCount, 12);

  const baseline = summary.aggregate.byVariant["baseline-codex"];
  const harnessed = summary.aggregate.byVariant["meta-harnessed-codex"];
  assert.equal(baseline.runCount, 6);
  assert.equal(harnessed.runCount, 6);
  assert.equal(baseline.falseAccepts, 4);
  assert.equal(harnessed.falseAccepts, 0);
  assert.ok(harnessed.averageScore > baseline.averageScore);

  const baselineExtension = summary.runs.find((run) => run.taskId === "browser-extension-syntax-trap" && run.variantId === "baseline-codex");
  assert.ok(baselineExtension.classifications.includes("false_accept"));
  assert.ok(baselineExtension.classifications.includes("missed_surface_proof"));
  assert.ok(baselineExtension.classifications.includes("no_policy_gate"));

  const harnessExtension = summary.runs.find((run) => run.taskId === "browser-extension-syntax-trap" && run.variantId === "meta-harnessed-codex");
  assert.equal(harnessExtension.actualDecision, "rejected");
  assert.deepEqual(harnessExtension.classifications, []);
});

test("A/B dry-run writes summary, report, and per-run artifact indexes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ab-harness-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const outputDir = join(root, "dry-run");
  const summary = runAbHarnessSuite({
    outputDir,
    repeats: 1,
    json: true
  });

  assert.ok(existsSync(join(outputDir, "summary.json")));
  assert.ok(existsSync(join(outputDir, "report.md")));
  assert.match(readFileSync(join(outputDir, "report.md"), "utf8"), /200-500 runs are for confidence measurement, not implementation steps/i);

  for (const run of summary.runs) {
    assert.ok(existsSync(join(run.artifactDir, "run.json")), run.runId);
    assert.ok(existsSync(join(run.artifactDir, "artifact-index.json")), run.runId);
    const index = JSON.parse(readFileSync(join(run.artifactDir, "artifact-index.json"), "utf8"));
    assert.equal(index.collectionMode, "dry-run-stub");
    assert.ok(index.expectedRealArtifacts.includes("final-report.json"));
  }
});

test("A/B dry-run validates task and variant formats", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ab-harness-validation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const invalidTaskSetPath = join(root, "invalid-task-set.json");
  const invalidVariantsPath = join(root, "invalid-variants.json");
  writeFileSync(invalidTaskSetPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "wrong-kind",
    id: "bad",
    title: "Bad",
    repeats: 1,
    validationScale: {
      recommendedRunsMin: 200,
      recommendedRunsMax: 500
    },
    tasks: []
  })}\n`);
  writeFileSync(invalidVariantsPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "meta-harness.ab-variants",
    id: "bad",
    variants: [{
      id: "broken",
      label: "Broken",
      kind: "baseline",
      runnerCommand: "codex exec",
      capabilities: ["command-proof"],
      artifactPolicy: ["final-response"],
      decisionPolicy: "maybe"
    }]
  })}\n`);

  assert.throws(
    () => runAbHarnessSuite({
      outputDir: join(root, "out"),
      taskSetPath: join(root, "missing-task-set.json"),
      json: true
    }),
    /ENOENT|no such file/i
  );

  assert.throws(
    () => runAbHarnessSuite({
      outputDir: join(root, "out"),
      taskSetPath: invalidTaskSetPath,
      json: true
    }),
    /taskSet.kind/
  );

  assert.throws(
    () => runAbHarnessSuite({
      outputDir: join(root, "out"),
      variantsPath: invalidVariantsPath,
      json: true
    }),
    /decisionPolicy/
  );

  assert.throws(
    () => runAbHarnessSuite({
      outputDir: join(root, "out"),
      repeats: 0,
      json: true
    }),
    /repeats must be a positive integer/
  );
});
