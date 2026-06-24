import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPolicyEngine } from "../lib/policy-engine.mjs";
import { harvestRunnerEvidence } from "../lib/runner-evidence.mjs";
import { initTaskRun } from "../lib/task-packet.mjs";
import { runCompletedRunVerifier } from "../lib/verifier.mjs";

test("runner evidence harvester maps captured commands and final message to accepted proof", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-runner-evidence-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(repo, "README.md"), "# Runner Evidence Fixture\n");

  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a local source ingestion data pipeline with validation fixtures",
    runId: "runner-evidence-data-pipeline"
  }).runDir;
  const runnerStatePath = join(runDir, "runner-state.json");
  const runnerState = JSON.parse(readFileSync(runnerStatePath, "utf8"));
  runnerState.status = "implemented";
  writeFileSync(runnerStatePath, `${JSON.stringify(runnerState, null, 2)}\n`);
  const commandsDir = join(runDir, "evidence", "commands");
  const runnerDir = join(runDir, "evidence", "runner");
  mkdirSync(commandsDir, { recursive: true });
  mkdirSync(runnerDir, { recursive: true });

  writeCommandArtifact({ runDir, id: "cmd.codex.0001", stdout: "README.md\n" });
  writeCommandArtifact({ runDir, id: "cmd.codex.0002", stdout: "Ran 3 tests OK\n" });
  writeCommandArtifact({ runDir, id: "cmd.codex.0003", stdout: "", stderr: "invalid fixture rejected\n" });
  writeCommandArtifact({ runDir, id: "cmd.codex.0004", stdout: "manifest status passed\n" });
  writeCommandArtifact({ runDir, id: "cmd.codex.0005", stdout: "process complete\n" });
  writeFileSync(join(runnerDir, "codex-final-message.txt"), `${JSON.stringify({
    outcome: "implemented-not-fully-verified",
    evidence_by_requirement: {
      R1: "inspected repo",
      R2: "tests and manifest smoke passed",
      R3: "invalid fixture rejected",
      R4: "targeted tests passed",
      R5: "CLI data fixture smoke passed",
      R6: "final report maps evidence"
    },
    remaining_risks: ["Fixture is small and local."]
  }, null, 2)}\n`);
  writeFileSync(join(runDir, "command-log.jsonl"), [
    commandLogEntry({ id: "cmd.codex.0001", command: "rg --files", exitCode: 0 }),
    commandLogEntry({ id: "cmd.codex.0002", command: "PYTHONPATH=src python -m unittest tests.test_source_ingestion", exitCode: 0 }),
    commandLogEntry({ id: "cmd.codex.0003", command: "PYTHONPATH=src python -m statement_tracker ingest-source --input malformed.srt", exitCode: 1 }),
    commandLogEntry({ id: "cmd.codex.0004", command: "PYTHONPATH=src python -m statement_tracker ingest-source --input good.vtt --output manifest.json", exitCode: 0 }),
    commandLogEntry({ id: "cmd.codex.0005", command: "codex exec ...", exitCode: 0, source: "codex-cli-process", startedAt: "2026-06-24T10:00:00.000Z" })
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const harvested = harvestRunnerEvidence({ runDir });
  assert.equal(harvested.status, "passed");

  const verifier = runCompletedRunVerifier({ runDir, now: new Date("2026-06-24T10:11:00.000Z") });
  assert.equal(verifier.status, "passed", JSON.stringify(verifier.findings, null, 2));

  const policy = runPolicyEngine({ runDir, now: new Date("2026-06-24T10:12:00.000Z") });
  assert.equal(policy.decision, "accepted", JSON.stringify(policy.blockingRules, null, 2));
});

function writeCommandArtifact({ runDir, id, stdout = "", stderr = "" }) {
  writeFileSync(join(runDir, "evidence", "commands", `${id}.stdout.txt`), stdout);
  writeFileSync(join(runDir, "evidence", "commands", `${id}.stderr.txt`), stderr);
}

function commandLogEntry({ id, command, exitCode, source = "codex-cli-event", startedAt = null }) {
  const timestamp = startedAt || `2026-06-24T10:00:0${id.slice(-1)}.000Z`;
  return {
    id,
    phase: "run",
    command,
    cwd: "/tmp/runner-evidence-fixture",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode,
    signal: null,
    stdoutPath: `evidence/commands/${id}.stdout.txt`,
    stderrPath: `evidence/commands/${id}.stderr.txt`,
    requirementIds: [],
    proofObligationIds: [],
    source
  };
}
