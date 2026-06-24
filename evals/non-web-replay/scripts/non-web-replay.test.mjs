import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runNonWebReplay } from "./run-replay.mjs";

test("non-web replay accepts OCR pipeline proof and rejects weak artifact proof", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "non-web-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const summary = await runNonWebReplay({
    outputDir: join(root, "replay"),
    json: true
  });

  assert.equal(summary.accepted.runnerStatus, "implemented");
  assert.equal(summary.accepted.verificationStatus, "passed");
  assert.equal(summary.accepted.verifierStatus, "passed");
  assert.equal(summary.accepted.policyDecision, "accepted");
  assert.equal(summary.accepted.proofStatuses.P1, "passed");
  assert.equal(summary.accepted.proofStatuses.P2, "passed");
  assert.equal(summary.accepted.proofStatuses.P3, "passed");
  assert.equal(summary.accepted.proofStatuses.P4, "passed");
  assert.equal(summary.accepted.proofStatuses.P5, "passed");
  assert.ok(summary.accepted.evidenceTypes.includes("data-fixture"));
  assert.ok(summary.accepted.evidenceTypes.includes("negative-test-command"));
  assert.ok(summary.accepted.passedSurfaceEvidenceTypes.includes("data-fixture"));

  const acceptedReport = readFileSync(summary.accepted.reports.text, "utf8");
  assert.match(acceptedReport, /Decision:\s+accepted/i);
  assert.match(acceptedReport, /data-fixture/);
  assert.match(acceptedReport, /Residual Risk/i);

  assert.equal(summary.weakArtifact.verificationStatus, "failed");
  assert.equal(summary.weakArtifact.policyDecision, "rejected");
  assert.ok(summary.weakArtifact.activePolicyRules.includes("POL-VERIFY-002"));
  assert.ok(summary.weakArtifact.activePolicyRules.includes("POL-SURFACE-001"));
  assert.ok(summary.weakArtifact.failedSurfaceReasons.includes("data-assertion-failed"));
  assert.ok(!summary.weakArtifact.passedSurfaceEvidenceTypes.includes("data-fixture"));
});
