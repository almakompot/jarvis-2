import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runBrowserExtensionReplay } from "./run-replay.mjs";

test("browser-extension replay accepts Site Gate smoke and rejects syntax-only proof", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "browser-extension-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const summary = await runBrowserExtensionReplay({
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
  assert.ok(summary.accepted.evidenceTypes.includes("browser-extension-smoke"));
  assert.ok(summary.accepted.evidenceTypes.includes("negative-test-command"));

  const acceptedReport = readFileSync(summary.accepted.reports.text, "utf8");
  assert.match(acceptedReport, /Decision:\s+accepted/i);
  assert.match(acceptedReport, /browser-extension-smoke/);
  assert.match(acceptedReport, /Residual Risk/i);

  assert.equal(summary.syntaxOnly.policyDecision, "rejected");
  assert.ok(summary.syntaxOnly.activePolicyRules.includes("POL-UI-001"));
  assert.ok(summary.syntaxOnly.passedEvidenceTypes.includes("browser-extension-smoke"));
  assert.ok(!summary.syntaxOnly.passedSurfaceEvidenceTypes.includes("browser-extension-smoke"));
});
