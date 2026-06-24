import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWebUiReplay } from "./run-replay.mjs";

test("web UI replay runs raw task to accepted policy and report", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "web-ui-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const summary = await runWebUiReplay({
    outputDir: join(root, "replay"),
    json: true
  });

  assert.equal(summary.runnerStatus, "implemented");
  assert.equal(summary.verificationStatus, "passed");
  assert.equal(summary.verifierStatus, "passed");
  assert.equal(summary.policyDecision, "accepted");
  assert.equal(summary.validationPassed, true);
  assert.equal(summary.proofStatuses.P1, "passed");
  assert.equal(summary.proofStatuses.P2, "passed");
  assert.equal(summary.proofStatuses.P3, "passed");
  assert.equal(summary.proofStatuses.P4, "passed");
  assert.equal(summary.proofStatuses.P5, "passed");
  assert.ok(summary.evidenceTypes.includes("repo-profile"));
  assert.ok(summary.evidenceTypes.includes("test-command"));
  assert.ok(summary.evidenceTypes.includes("browser-smoke"));
  assert.ok(summary.evidenceTypes.includes("negative-test-command"));
  assert.ok(summary.evidenceTypes.includes("final-report"));

  const report = readFileSync(summary.reports.text, "utf8");
  assert.match(report, /Decision:\s+accepted/i);
  assert.match(report, /browser-smoke/);
  assert.match(report, /Residual Risk/i);
});
