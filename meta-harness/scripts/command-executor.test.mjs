import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyCommandSafety, runCommandProofExecutor } from "../lib/command-executor.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";

test("command executor runs passing proof command and updates verification by proof and requirement", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-pass",
    scripts: { test: "node scripts/pass.mjs" },
    files: {
      "scripts/pass.mjs": "console.log('proof passed');\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run test" }]);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.status, "passed");
  assert.equal(verification.proofObligations[0].status, "passed");
  assert.equal(verification.requirementCoverage.every((item) => item.status === "passed"), true);
  assert.equal(verification.commands[0].status, "passed");
  assert.equal(verification.evidence[0].status, "passed");
  assert.match(readFileSync(join(runDir, verification.commands[0].stdoutPath), "utf8"), /proof passed/);
  assertStructuralValidation(runDir);
});

test("command executor records failed commands without satisfying proof", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-fail",
    scripts: { test: "node scripts/fail.mjs" },
    files: {
      "scripts/fail.mjs": "console.error('proof failed');\nprocess.exit(1);\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run test" }]);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "failed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.proofObligations[0].status, "failed");
  assert.deepEqual(verification.proofObligations[0].evidence, []);
  assert.equal(verification.proofObligations[0].failedEvidence.length, 1);
  assert.equal(verification.evidence[0].status, "failed");
  assert.equal(verification.commands[0].exitCode, 1);
  assertStructuralValidation(runDir);
});

test("command executor records timeouts as failed command proof", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-timeout",
    scripts: { test: "node scripts/timeout.mjs" },
    files: {
      "scripts/timeout.mjs": "setInterval(() => {}, 1000);\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run test" }]);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 50 });

  assert.equal(result.status, "failed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.commands[0].status, "timed-out");
  assert.equal(verification.commands[0].timedOut, true);
  assert.equal(verification.proofObligations[0].status, "failed");
  assertStructuralValidation(runDir);
});

test("command executor blocks missing commands", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-missing",
    scripts: {},
    files: {}
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: null }]);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "blocked");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.commands[0].status, "blocked");
  assert.equal(verification.commands[0].reason, "missing-command");
  assert.equal(readFileSync(join(runDir, "command-log.jsonl"), "utf8"), "");
  assertStructuralValidation(runDir);
});

test("command executor blocks unsafe package-script commands before execution", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-unsafe",
    scripts: { deploy: "vercel deploy --prod" },
    files: {}
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run deploy" }]);

  const safety = classifyCommandSafety({
    command: "npm run deploy",
    repoProfile: readJson(join(runDir, "repo-profile.json"))
  });
  assert.equal(safety.allowed, false);
  assert.equal(safety.reason, "unsafe-deploy");
  assert.equal(safety.approvalRequired, true);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "blocked");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.commands[0].status, "blocked");
  assert.equal(verification.commands[0].reason, "unsafe-deploy");
  assert.equal(verification.commands[0].approvalRequired, true);
  assert.equal(readFileSync(join(runDir, "command-log.jsonl"), "utf8"), "");
  assertStructuralValidation(runDir);
});

test("command guard blocks live mutation, send, migration, and cost-bearing proof commands", () => {
  const cases = [
    ["git push origin main", "unsafe-git-push"],
    ["gh release create v1.2.3", "unsafe-release"],
    ["vercel --prod", "unsafe-deploy"],
    ["supabase functions deploy api", "unsafe-deploy"],
    ["kubectl apply -f deploy.yaml", "unsafe-live-mutation"],
    ["docker push registry.example.com/app:latest", "unsafe-live-mutation"],
    ["npm publish", "unsafe-publish"],
    ["node scripts/send-email.mjs", "unsafe-send"],
    ["curl -X POST https://discord.com/api/webhooks/abc", "unsafe-webhook-send"],
    ["prisma migrate deploy", "unsafe-migration"],
    ["OPENAI_API_KEY=sk-test node scripts/generate.mjs", "unsafe-external-api-cost"],
    ["aws bedrock invoke-model --model-id fixture", "unsafe-external-api-cost"]
  ];

  for (const [command, reason] of cases) {
    const safety = classifyCommandSafety({ command, repoProfile: {} });
    assert.equal(safety.allowed, false, command);
    assert.equal(safety.reason, reason, command);
    assert.equal(safety.approvalRequired, true, command);
  }

  const packageScriptSafety = classifyCommandSafety({
    command: "npm run spend",
    repoProfile: {
      package: {
        scripts: {
          spend: "OPENAI_API_KEY=sk-test node scripts/generate.mjs"
        }
      }
    }
  });
  assert.equal(packageScriptSafety.allowed, false);
  assert.equal(packageScriptSafety.reason, "unsafe-external-api-cost");
  assert.equal(packageScriptSafety.approvalRequired, true);
});

test("command executor reruns append evidence and let later passing proof supersede failure", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-rerun",
    scripts: { test: "node scripts/check-marker.mjs" },
    files: {
      "scripts/check-marker.mjs": "import { existsSync } from 'node:fs';\nif (!existsSync('marker.txt')) {\n  console.error('marker missing');\n  process.exit(1);\n}\nconsole.log('marker present');\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run test" }]);

  const first = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });
  assert.equal(first.status, "failed");
  writeFileSync(join(repo, "marker.txt"), "ok\n");
  const second = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(second.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.commands.length, 2);
  assert.equal(verification.evidence.length, 2);
  assert.deepEqual(verification.commands.map((command) => command.status), ["failed", "passed"]);
  assert.equal(verification.proofObligations[0].status, "passed");
  assert.deepEqual(verification.proofObligations[0].evidence, ["E.cmd.verify.0002"]);
  assert.deepEqual(verification.proofObligations[0].failedEvidence, ["E.cmd.verify.0001"]);
  assert.equal(readFileSync(join(runDir, "command-log.jsonl"), "utf8").trim().split(/\r?\n/).length, 2);
  assertStructuralValidation(runDir);
});

test("command executor does not pass the run while non-command proof remains pending", async (t) => {
  const { repo, runDir } = createCommandRun({
    runId: "command-pending-surface-proof",
    scripts: { test: "node scripts/pass.mjs" },
    files: {
      "scripts/pass.mjs": "console.log('command proof passed');\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  simplifyToCommandProof(runDir, [{ id: "T1", type: "repo-native-check", command: "npm run test" }]);

  const spec = readJson(join(runDir, "spec.json"));
  spec.proofObligations.push({ id: "P3", requirementIds: [spec.requirements[0].id] });
  spec.requirements[0].proofObligationIds.push("P3");
  writeJson(join(runDir, "spec.json"), spec);

  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.obligations.push({
    id: "P3",
    statement: "Fixture browser proof remains for a later surface executor.",
    requirementIds: [spec.requirements[0].id],
    acceptedEvidenceTypes: ["browser-smoke"],
    minimumEvidence: 1,
    status: "pending"
  });
  proofPlan.requirementCoverage[0].proofObligationIds.push("P3");
  writeJson(join(runDir, "proof-plan.json"), proofPlan);

  const result = await runCommandProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "pending");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.status, "pending");
  assert.deepEqual(verification.proofObligations.map((proof) => [proof.id, proof.status]), [
    ["P2", "passed"],
    ["P3", "pending"]
  ]);
  assert.equal(verification.requirementCoverage[0].status, "pending");
  assertStructuralValidation(runDir);
});

function createCommandRun({ runId, scripts, files }) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-command-executor-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Command Executor Fixture\n");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  const runDir = initTaskRun({
    repoPath: repo,
    task: "build a local CLI tool that validates task packets",
    runId
  }).runDir;
  return { repo, runDir };
}

function simplifyToCommandProof(runDir, requiredTests) {
  const spec = readJson(join(runDir, "spec.json"));
  const requirementIds = spec.requirements.map((requirement) => requirement.id);
  spec.requirements = spec.requirements.map((requirement) => ({
    ...requirement,
    proofObligationIds: ["P2"]
  }));
  spec.proofObligations = [{ id: "P2", requirementIds }];
  spec.requiredTests = requiredTests.map((testCase) => ({
    ...testCase,
    description: "Fixture command proof.",
    requirementIds
  }));
  writeJson(join(runDir, "spec.json"), spec);

  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.obligations = [{
    id: "P2",
    statement: "Fixture command proof passes.",
    requirementIds,
    acceptedEvidenceTypes: ["test-command"],
    minimumEvidence: 1,
    status: "pending"
  }];
  proofPlan.requirementCoverage = requirementIds.map((requirementId) => ({
    requirementId,
    proofObligationIds: ["P2"]
  }));
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
