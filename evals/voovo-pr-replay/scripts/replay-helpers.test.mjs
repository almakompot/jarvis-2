import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCheckPlan,
  buildLeakageReport,
  diffStatsFromNumstat,
  generateSelectedSourceTruth,
  assertNoBlockingLeakage,
  selectPrePrSnapshot,
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
