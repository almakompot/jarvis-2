import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDefaultComparisonResult,
  buildCheckPlan,
  buildEvaluatorPrompt,
  buildLeakageReport,
  classifyReplayCommand,
  diffStatsFromNumstat,
  generateSelectedSourceTruth,
  assertNoBlockingLeakage,
  selectPrePrSnapshot,
  validateComparisonResult,
  validateManualProofs,
  verifyWorktree
} from "./replay-helpers.mjs";

test("diffStatsFromNumstat totals selected-base diff stats", () => {
  const stats = diffStatsFromNumstat(["10\t2\tlib/a.dart", "3\t0\ttest/a_test.dart", "-\t-\tassets/logo.png"].join("\n"));
  assert.equal(stats.additions, 13);
  assert.equal(stats.deletions, 2);
  assert.equal(stats.changedFiles, 3);
  assert.equal(stats.files[2].binary, true);
});

test("buildCheckPlan creates focused Flutter and Functions checks plus manual proof", () => {
  const plan = buildCheckPlan([
    { path: "lib/src/foo.dart" },
    { path: "test/foo_test.dart" },
    { path: "firebase/functions/src/V2/canteenMenuLogic.ts" },
    { path: "firebase/functions/src/tests/canteenMenuLogic.test.ts" },
    { path: "firebase/firestore.rules" },
    { path: "packages/video_codec_support/android/src/main/Plugin.kt" }
  ]);

  assert.deepEqual(
    plan.checks.map((check) => check.name),
    ["flutter-test", "flutter-analyze", "functions-build", "functions-test-tests-canteenmenulogic-test-js"]
  );
  assert.match(plan.checks[0].command, /^flutter test 'test\/foo_test\.dart'$/);
  assert.match(plan.checks[1].command, /^flutter analyze 'lib\/src\/foo\.dart' 'test\/foo_test\.dart'$/);
  assert.equal(plan.manualProofs.length, 2);
  assert.equal(plan.manualProofs[0].name, "firestore-rules-proof");
  assert.equal(plan.manualProofs[1].name, "native-device-proof");
});

test("buildLeakageReport marks PR URLs and changed paths as blocking", () => {
  const report = buildLeakageReport(
    "Fix this like https://github.com/VoovoStudy/voovo-mobile/pull/612 in lib/src/foo.dart",
    { number: 612, state: "OPEN", title: "Leak test" },
    [{ path: "lib/src/foo.dart" }]
  );

  assert.equal(report.blockingFindings.length, 2);
  assert.deepEqual(
    report.blockingFindings.map((finding) => finding.type).sort(),
    ["changed-file-path", "pr-url"]
  );
});

test("assertNoBlockingLeakage blocks reports with blocking findings", () => {
  const root = mkdtempSync(join(tmpdir(), "voovo-pr-replay-leakage-"));
  mkdirSync(join(root, "source"), { recursive: true });
  writeFileSync(
    join(root, "source", "goal-leakage-report.json"),
    JSON.stringify({ blockingFindings: [{ severity: "block", type: "pr-url" }] }, null, 2)
  );

  assert.throws(
    () =>
      assertNoBlockingLeakage(root, {
        goal: { leakageReportPath: "source/goal-leakage-report.json" }
      }),
    /blocking finding/
  );
});

test("open PR snapshot uses fetched PR head and merge-base preSha", () => {
  const fixture = createGitPrFixture();
  const snapshot = selectPrePrSnapshot({
    pr: {
      number: 7,
      state: "OPEN",
      baseRefName: "main",
      title: "Open replay",
      files: []
    },
    sourceRepo: fixture.clone,
    prHeadRef: "refs/codex-audit/test/pr-7-head"
  });

  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.preSha, fixture.baseSha);
  assert.equal(snapshot.headSha, fixture.headSha);
  assert.equal(snapshot.snapshotSensitive, true);
  assert.match(snapshot.preMethod, /merge-base/);
});

test("merged PR snapshot prefers merge commit first parent", () => {
  const fixture = createMergedGitPrFixture();
  const snapshot = selectPrePrSnapshot({
    pr: {
      number: 8,
      state: "MERGED",
      baseRefName: "main",
      title: "Merged replay",
      mergeCommit: { oid: fixture.mergeSha },
      baseRefOid: fixture.baseSha,
      files: []
    },
    sourceRepo: fixture.clone,
    prHeadRef: "refs/codex-audit/test/pr-8-head"
  });

  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.preSha, fixture.preMergeSha);
  assert.equal(snapshot.headSha, fixture.headSha);
  assert.equal(snapshot.snapshotSensitive, false);
  assert.match(snapshot.preMethod, /merge commit first parent/);
});

test("selected source truth is generated from preSha..headSha", () => {
  const fixture = createGitPrFixture();
  const sourceDir = join(fixture.root, "source");
  const selected = generateSelectedSourceTruth({
    sourceRepo: fixture.clone,
    preSha: fixture.baseSha,
    headSha: fixture.headSha,
    sourceDir
  });

  assert.match(selected.patch.stdout, /changed from feature/);
  assert.equal(selected.stats.changedFiles, 1);
  assert.equal(selected.stats.additions, 1);
  assert.equal(selected.stats.deletions, 1);
});

test("verifyWorktree rejects wrong preSha", () => {
  const fixture = createGitPrFixture();
  const worktree = join(fixture.root, "worktree");
  execFileSync("git", ["-C", fixture.clone, "worktree", "add", "--detach", worktree, fixture.baseSha], { encoding: "utf8" });

  const ok = verifyWorktree({
    manifest: { workspace: { preSha: fixture.baseSha } },
    workdir: worktree,
    logDir: join(fixture.root, "logs-ok")
  });
  assert.equal(ok.actualSha, fixture.baseSha);

  assert.throws(
    () =>
      verifyWorktree({
        manifest: { workspace: { preSha: fixture.headSha } },
        workdir: worktree,
        logDir: join(fixture.root, "logs-bad")
      }),
    /worktree HEAD mismatch/
  );
});

test("comparison result validator rejects malformed verdicts and missing criteria", () => {
  const result = {
    schemaVersion: 1,
    caseId: "case-a",
    title: "Case A",
    winner: "resilient",
    confidence: "medium",
    summary: "Resilient wins on the evidence.",
    criteria: [{ name: "correctness", winner: "resilient", evidence: ["comparison/evidence-manifest.json"] }],
    missingEvidence: [],
    blockingIssues: [],
    evidenceCitations: [{ label: "goal", path: "goal.md" }],
    residualRisk: []
  };

  assert.deepEqual(validateComparisonResult(result, ["correctness"]), []);
  assert.match(validateComparisonResult({ ...result, winner: "maybe" }, ["correctness"]).join("\n"), /winner/);
  assert.match(validateComparisonResult(result, ["correctness", "test quality"]).join("\n"), /missing criterion/);
  assert.match(validateComparisonResult({ ...result, confidence: "high", missingEvidence: ["manual proof"] }, ["correctness"]).join("\n"), /high confidence/);
});

test("default comparison result surfaces missing checks and required manual proof", () => {
  const result = buildDefaultComparisonResult({
    manifest: {
      caseId: "case-a",
      title: "Case A",
      evaluation: { criteria: ["correctness"] }
    },
    evidence: {
      goalPath: "goal.md",
      selectedPatchPath: "source/merged.patch",
      checksSummaryPath: "checks-summary.json",
      variants: {
        baseline: { implementationPatchPath: "baseline.patch" },
        resilient: { implementationPatchPath: "resilient.patch" }
      }
    },
    checksSummary: {
      baseline: {
        requiredPassed: false,
        failedRequired: ["test"],
        checks: [{ name: "test", required: true, status: 1 }]
      },
      resilient: {
        requiredPassed: true,
        failedRequired: [],
        checks: [{ name: "test", required: true, status: 0 }]
      }
    },
    manualProofSummary: {
      proofs: [{ name: "device-proof", required: true, status: "missing", errors: [] }]
    }
  });

  assert.equal(result.winner, "inconclusive");
  assert.match(result.blockingIssues.join("\n"), /baseline required checks failed/);
  assert.match(result.missingEvidence.join("\n"), /missing required manual proof/);
});

test("evaluator prompt requires citations and rejects diff-similarity as the win condition", () => {
  const prompt = buildEvaluatorPrompt({
    caseDir: "/case",
    runDir: "/run",
    evidence: { evidenceManifestPath: "/run/comparison/evidence-manifest.json" }
  });

  assert.match(prompt, /Do not reward diff similarity/);
  assert.match(prompt, /cite a concrete evidence path/);
  assert.match(prompt, /Missing proof beats confidence/);
});

test("manual proof validation requires artifacts for provided or accepted proof", () => {
  const root = mkdtempSync(join(tmpdir(), "voovo-manual-proof-"));
  mkdirSync(join(root, "proofs"), { recursive: true });
  writeFileSync(join(root, "proofs", "note.md"), "accepted\n");

  const ok = validateManualProofs(root, {
    manualProofs: [
      {
        name: "browser-proof",
        description: "Synthetic browser proof.",
        required: true,
        status: "accepted",
        artifactPath: "proofs/note.md",
        artifactType: "markdown-note"
      }
    ]
  });
  assert.deepEqual(ok.errors, []);

  const bad = validateManualProofs(root, {
    manualProofs: [
      {
        name: "browser-proof",
        description: "Synthetic browser proof.",
        required: true,
        status: "accepted"
      },
      {
        name: "weird-proof",
        description: "Invalid proof.",
        status: "provided",
        artifactPath: "proofs/note.md",
        artifactType: "invalid-proof-kind"
      }
    ]
  });
  assert.match(bad.errors.join("\n"), /no artifactPath/);
  assert.match(bad.errors.join("\n"), /invalid artifactType/);
});

test("replay command guard blocks deploy, push, PR creation, Slack posts, and env reads", () => {
  for (const command of [
    "firebase deploy --only functions",
    "gcloud functions deploy api",
    "git push origin main",
    "gh pr create --fill",
    "curl https://slack.com/api/chat.postMessage",
    "rg SECRET .env.local"
  ]) {
    assert.equal(classifyReplayCommand(command).safe, false, command);
  }

  for (const command of ["npm test", "npm run build", "node --test test/*.mjs", "flutter test test/foo_test.dart"]) {
    assert.equal(classifyReplayCommand(command).safe, true, command);
  }
});

test("suite dry-run filters public cases by tier", () => {
  const outDir = mkdtempSync(join(tmpdir(), "voovo-suite-"));
  execFileSync(
    "node",
    [
      "evals/voovo-pr-replay/scripts/run-suite.mjs",
      "--tier",
      "medium",
      "--case-root",
      "evals/voovo-pr-replay/cases",
      "--out-dir",
      outDir
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  const summary = JSON.parse(readFileSync(join(outDir, "suite-summary.json"), "utf8"));
  assert.deepEqual(
    summary.selected.map((item) => item.caseId).sort(),
    ["cloud-payload", "stateful-cards"]
  );
  assert.deepEqual(
    summary.results.map((item) => item.status),
    ["dry-run", "dry-run"]
  );
});

test("compare-case writes structured result, report, and evaluator prompt", () => {
  const runDir = mkdtempSync(join(tmpdir(), "voovo-compare-"));
  const summaries = {};
  for (const variant of ["baseline", "resilient"]) {
    const variantDir = join(runDir, variant);
    mkdirSync(variantDir, { recursive: true });
    writeFileSync(join(variantDir, "final.md"), `${variant} done\n`);
    writeFileSync(join(variantDir, "implementation.patch"), `diff --git a/example b/example\n`);
    writeFileSync(join(variantDir, "changed-files.txt"), "example\n");
    summaries[variant] = {
      variant,
      workdir: join(variantDir, "workdir"),
      checks: [{ name: "test", command: "npm test", required: true, status: 0, logPath: join(variantDir, "checks", "test.log") }],
      requiredPassed: true,
      allPassed: true,
      failedRequired: [],
      failedOptional: [],
      unavailable: []
    };
    writeFileSync(join(variantDir, "checks-summary.json"), JSON.stringify(summaries[variant], null, 2));
  }
  writeFileSync(join(runDir, "checks-summary.json"), JSON.stringify(summaries, null, 2));

  execFileSync(
    "node",
    ["evals/voovo-pr-replay/scripts/compare-case.mjs", "--case", "evals/voovo-pr-replay/cases/smoke-discount", "--run-dir", runDir],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  const result = JSON.parse(readFileSync(join(runDir, "comparison", "comparison-result.json"), "utf8"));
  assert.equal(result.winner, "inconclusive");
  assert.deepEqual(validateComparisonResult(result, ["correctness", "regression risk", "maintainability", "minimality", "test quality", "product behavior", "repo-pattern fit", "review burden"]), []);
  assert.match(readFileSync(join(runDir, "comparison", "comparison-report.md"), "utf8"), /## Manual Proof/);
  assert.match(readFileSync(join(runDir, "comparison", "evaluator-prompt.md"), "utf8"), /Do not reward diff similarity/);
});

test("suite stress tier requires explicit opt-in", () => {
  const result = spawnSync("node", ["evals/voovo-pr-replay/scripts/run-suite.mjs", "--tier", "stress", "--case-root", "evals/voovo-pr-replay/cases"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stress tier requires --include-stress/);
});

test("cleanup dry-run lists only harness-created workdirs", () => {
  const runDir = mkdtempSync(join(tmpdir(), "voovo-cleanup-"));
  mkdirSync(join(runDir, "baseline", "workdir"), { recursive: true });
  mkdirSync(join(runDir, "resilient", "workdir"), { recursive: true });
  writeFileSync(
    join(runDir, "summary.json"),
    JSON.stringify(
      {
        runs: [
          { variant: "baseline", workdir: join(runDir, "baseline", "workdir") },
          { variant: "resilient", workdir: join(runDir, "resilient", "workdir") }
        ]
      },
      null,
      2
    )
  );

  execFileSync("node", ["evals/voovo-pr-replay/scripts/cleanup-worktrees.mjs", "--run-dir", runDir], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const summary = JSON.parse(readFileSync(join(runDir, "cleanup-summary.json"), "utf8"));
  assert.equal(summary.execute, false);
  assert.equal(summary.removed.length, 2);
  assert.equal(summary.removed.every((item) => item.status === "dry-run"), true);
});

function createGitPrFixture() {
  const root = mkdtempSync(join(tmpdir(), "voovo-pr-replay-test-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  mkdirSync(source, { recursive: true });
  git(["init", "-b", "main"], source);
  git(["config", "user.name", "Replay Test"], source);
  git(["config", "user.email", "replay@example.invalid"], source);
  writeFileSync(join(source, "file.txt"), "base\n");
  git(["add", "file.txt"], source);
  git(["commit", "-m", "base"], source);
  const baseSha = git(["rev-parse", "HEAD"], source).trim();
  git(["checkout", "-b", "feature"], source);
  writeFileSync(join(source, "file.txt"), "changed from feature\n");
  git(["commit", "-am", "feature"], source);
  const headSha = git(["rev-parse", "HEAD"], source).trim();
  git(["clone", "--bare", source, remote], root);
  git(["--git-dir", remote, "update-ref", "refs/pull/7/head", headSha], root);
  git(["clone", remote, clone], root);
  return { root, source, remote, clone, baseSha, headSha };
}

function createMergedGitPrFixture() {
  const root = mkdtempSync(join(tmpdir(), "voovo-pr-replay-merged-test-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  mkdirSync(source, { recursive: true });
  git(["init", "-b", "main"], source);
  git(["config", "user.name", "Replay Test"], source);
  git(["config", "user.email", "replay@example.invalid"], source);
  writeFileSync(join(source, "base.txt"), "base\n");
  git(["add", "base.txt"], source);
  git(["commit", "-m", "base"], source);
  const baseSha = git(["rev-parse", "HEAD"], source).trim();
  git(["checkout", "-b", "feature"], source);
  writeFileSync(join(source, "feature.txt"), "feature\n");
  git(["add", "feature.txt"], source);
  git(["commit", "-m", "feature"], source);
  const headSha = git(["rev-parse", "HEAD"], source).trim();
  git(["checkout", "main"], source);
  writeFileSync(join(source, "main.txt"), "main before merge\n");
  git(["add", "main.txt"], source);
  git(["commit", "-m", "main before merge"], source);
  const preMergeSha = git(["rev-parse", "HEAD"], source).trim();
  git(["merge", "--no-ff", "feature", "-m", "merge feature"], source);
  const mergeSha = git(["rev-parse", "HEAD"], source).trim();
  git(["clone", "--bare", source, remote], root);
  git(["--git-dir", remote, "update-ref", "refs/pull/8/head", headSha], root);
  git(["clone", remote, clone], root);
  return { root, source, remote, clone, baseSha, preMergeSha, headSha, mergeSha };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
