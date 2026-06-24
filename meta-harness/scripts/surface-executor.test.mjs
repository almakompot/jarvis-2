import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runSurfaceProofExecutor } from "../lib/surface-executor.mjs";
import { initTaskRun, validateTaskRunDir } from "../lib/task-packet.mjs";

test("surface executor blocks web UI proof when runnable browser evidence is missing", async (t) => {
  const { repo, runDir } = createSurfaceRun({ runId: "surface-missing-browser", taskClass: "web-ui" });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "web-ui",
    acceptedEvidenceTypes: ["browser-smoke"],
    surfaceProofs: []
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "blocked");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, "missing-surface-proof");
  assert.equal(verification.proofObligations[0].status, "blocked");
  assertStructuralValidation(runDir);
});

test("surface executor blocks wrong evidence type for a browser proof obligation", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-wrong-type",
    taskClass: "web-ui",
    files: {
      "manual/browser-note.txt": "I looked at it.\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "web-ui",
    acceptedEvidenceTypes: ["browser-smoke"],
    surfaceProofs: [{
      id: "S1",
      handler: "manual",
      evidenceType: "manual-smoke-artifact",
      proofObligationIds: ["P4"],
      artifactPaths: ["manual/browser-note.txt"]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "blocked");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, "unaccepted-evidence-type");
  assert.equal(verification.proofObligations[0].status, "blocked");
  assertStructuralValidation(runDir);
});

test("surface executor accepts browser-extension proof only with extension scenario artifacts", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-extension-pass",
    taskClass: "browser-extension",
    files: {
      "manifest.json": JSON.stringify({ manifest_version: 3, name: "Gate", version: "1.0.0" }, null, 2),
      "smoke/scenario.json": JSON.stringify({
        status: "passed",
        url: "chrome-extension://abc123/gate.html",
        extensionLoaded: true,
        assertions: ["decline redirects to blocked page", "five minute allow persists"],
        screenshotPath: "gate-screenshot.txt"
      }, null, 2),
      "smoke/gate-screenshot.txt": "fake screenshot bytes\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "browser-extension",
    acceptedEvidenceTypes: ["browser-extension-smoke"],
    surfaceProofs: [{
      id: "S1",
      evidenceType: "browser-extension-smoke",
      proofObligationIds: ["P4"],
      scenarioPath: "smoke/scenario.json",
      manifestPath: "manifest.json"
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].handler, "browser-extension");
  assert.equal(verification.evidence[0].type, "browser-extension-smoke");
  assert.equal(verification.proofObligations[0].status, "passed");
  assert.match(readFileSync(join(runDir, verification.evidence[0].path), "utf8"), /extensionLoaded/);
  assertStructuralValidation(runDir);
});

test("surface executor records API request and response proof", async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.method, "POST");
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "created", id: "fixture-1" }));
  });
  await listen(server);
  const address = server.address();
  const { repo, runDir } = createSurfaceRun({ runId: "surface-api-pass", taskClass: "api" });
  t.after(() => {
    server.close();
    rmSync(repo, { recursive: true, force: true });
  });
  configureSurfaceProof(runDir, {
    taskClass: "api",
    acceptedEvidenceTypes: ["api-smoke"],
    surfaceProofs: [{
      id: "S1",
      handler: "api",
      evidenceType: "api-smoke",
      proofObligationIds: ["P4"],
      request: {
        method: "POST",
        url: `http://127.0.0.1:${address.port}/items`,
        expectedStatus: 201,
        expectedBodyIncludes: ["created", "fixture-1"]
      }
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].statusCode, 201);
  assert.match(readFileSync(join(runDir, verification.evidence[0].bodyPath), "utf8"), /fixture-1/);
  assertStructuralValidation(runDir);
});

test("surface executor invokes an actual CLI binary for CLI smoke proof", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-cli-pass",
    taskClass: "cli",
    files: {
      "bin/hello.mjs": "#!/usr/bin/env node\nconsole.log(`hello ${process.argv[2]}`);\n"
    }
  });
  chmodSync(join(repo, "bin/hello.mjs"), 0o755);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "cli",
    acceptedEvidenceTypes: ["cli-smoke"],
    surfaceProofs: [{
      id: "S1",
      handler: "cli",
      evidenceType: "cli-smoke",
      proofObligationIds: ["P4"],
      binary: "./bin/hello.mjs",
      args: ["Ada"],
      expectedExitCode: 0,
      expectedStdoutIncludes: ["hello Ada"]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].handler, "cli");
  assert.equal(verification.surfaceResults[0].exitCode, 0);
  assert.match(readFileSync(join(runDir, verification.evidence[0].stdoutPath), "utf8"), /hello Ada/);
  assertStructuralValidation(runDir);
});

test("surface executor fails data proof when expected generated output is missing", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-data-missing-output",
    taskClass: "data-pipeline",
    files: {
      "out/manifest.json": JSON.stringify({ status: "complete" }, null, 2)
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "data-pipeline",
    acceptedEvidenceTypes: ["data-fixture"],
    surfaceProofs: [{
      id: "S1",
      handler: "data",
      evidenceType: "data-fixture",
      proofObligationIds: ["P4"],
      expectedArtifacts: ["out/result.json"],
      manifestPath: "out/manifest.json",
      requiredManifestFields: ["status"]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "failed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, "missing-data-artifact");
  assert.equal(verification.proofObligations[0].status, "failed");
  assertStructuralValidation(runDir);
});

test("surface executor validates data manifest values and artifact contents", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-data-content-pass",
    taskClass: "data-pipeline",
    files: {
      "out/manifest.json": JSON.stringify({
        status: "passed",
        textLayer: { searchable: true, characters: 42 },
        cost: { externalApiCalls: 0 }
      }, null, 2),
      "out/searchable.txt": "Searchable text layer contains Arvizturo tukorfurogep.\n",
      "out/index.json": JSON.stringify({ documentId: "hu-old-doc-001", tokens: ["arvizturo"] }, null, 2)
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "data-pipeline",
    acceptedEvidenceTypes: ["data-fixture"],
    surfaceProofs: [{
      id: "S1",
      handler: "data",
      evidenceType: "data-fixture",
      proofObligationIds: ["P4"],
      expectedArtifacts: ["out/searchable.txt", "out/index.json"],
      manifestPath: "out/manifest.json",
      requiredManifestFields: ["status", "textLayer.searchable", "cost.externalApiCalls"],
      manifestAssertions: [
        { path: "status", equals: "passed" },
        { path: "textLayer.searchable", equals: true },
        { path: "textLayer.characters", min: 20 },
        { path: "cost.externalApiCalls", equals: 0 }
      ],
      artifactAssertions: [
        { path: "out/searchable.txt", includes: ["Searchable text layer", "Arvizturo"] },
        { path: "out/index.json", jsonPath: "documentId", equals: "hu-old-doc-001" }
      ]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, null);
  assert.equal(verification.proofObligations[0].status, "passed");
  assertStructuralValidation(runDir);
});

test("surface executor fails data proof when existing artifacts have wrong content", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-data-content-fail",
    taskClass: "data-pipeline",
    files: {
      "out/manifest.json": JSON.stringify({
        status: "passed",
        textLayer: { searchable: false, characters: 0 },
        cost: { externalApiCalls: 0 }
      }, null, 2),
      "out/searchable.txt": "placeholder output\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "data-pipeline",
    acceptedEvidenceTypes: ["data-fixture"],
    surfaceProofs: [{
      id: "S1",
      handler: "data",
      evidenceType: "data-fixture",
      proofObligationIds: ["P4"],
      expectedArtifacts: ["out/searchable.txt"],
      manifestPath: "out/manifest.json",
      requiredManifestFields: ["status", "textLayer.searchable", "cost.externalApiCalls"],
      manifestAssertions: [
        { path: "textLayer.searchable", equals: true },
        { path: "textLayer.characters", min: 20 }
      ],
      artifactAssertions: [
        { path: "out/searchable.txt", includes: ["Searchable text layer"] }
      ]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "failed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, "data-assertion-failed");
  assert.match(verification.surfaceResults[0].message, /textLayer\.searchable/);
  assert.equal(verification.proofObligations[0].status, "failed");
  assertStructuralValidation(runDir);
});

test("surface executor requires concrete manual artifact paths", async (t) => {
  const { repo, runDir } = createSurfaceRun({ runId: "surface-manual-missing-artifact", taskClass: "unknown" });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "unknown",
    acceptedEvidenceTypes: ["manual-smoke-artifact"],
    surfaceProofs: [{
      id: "S1",
      handler: "manual",
      evidenceType: "manual-smoke-artifact",
      proofObligationIds: ["P4"]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "blocked");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.surfaceResults[0].reason, "missing-manual-artifacts");
  assert.equal(verification.proofObligations[0].status, "blocked");
  assertStructuralValidation(runDir);
});

test("surface executor accepts visual artifacts as screenshot proof", async (t) => {
  const { repo, runDir } = createSurfaceRun({
    runId: "surface-visual-pass",
    taskClass: "web-ui",
    files: {
      "visual/page-screenshot.txt": "fake image bytes\n"
    }
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  configureSurfaceProof(runDir, {
    taskClass: "web-ui",
    acceptedEvidenceTypes: ["screenshot"],
    surfaceProofs: [{
      id: "S1",
      handler: "visual",
      evidenceType: "screenshot",
      proofObligationIds: ["P4"],
      artifactPaths: ["visual/page-screenshot.txt"]
    }]
  });

  const result = await runSurfaceProofExecutor({ runDir, timeoutMs: 1000 });

  assert.equal(result.status, "passed");
  const verification = readJson(join(runDir, "verification.json"));
  assert.equal(verification.evidence[0].type, "screenshot");
  assert.equal(verification.proofObligations[0].status, "passed");
  assertStructuralValidation(runDir);
});

function createSurfaceRun({ runId, taskClass, files = {} }) {
  const repo = mkdtempSync(join(tmpdir(), "meta-harness-surface-executor-"));
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ scripts: {}, type: "module" }, null, 2)}\n`);
  writeFileSync(join(repo, "README.md"), "# Surface Executor Fixture\n");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  const runDir = initTaskRun({
    repoPath: repo,
    task: `build a ${taskClass} feature with runnable surface proof`,
    runId
  }).runDir;
  return { repo, runDir };
}

function configureSurfaceProof(runDir, { taskClass, acceptedEvidenceTypes, surfaceProofs }) {
  const spec = readJson(join(runDir, "spec.json"));
  spec.taskClass = taskClass;
  spec.task.class = taskClass;
  spec.repoSignals.inferredTaskCues = [];
  spec.repoSignals.availableScripts = [];
  spec.requirements = [{
    id: "R5",
    text: `Exercise the ${taskClass} runnable surface through accepted evidence.`,
    source: "goal-7-fixture",
    proofObligationIds: ["P4"]
  }];
  spec.proofObligations = [{ id: "P4", requirementIds: ["R5"] }];
  spec.requiredTests = [{
    id: "T1",
    type: (taskClass === "web-ui" || taskClass === "browser-extension") ? "user-smoke" : "surface-smoke",
    command: null,
    description: "Surface proof is executed by the M5 surface executor fixture.",
    requirementIds: ["R5"]
  }];
  spec.userFlows = [{
    id: "F1",
    name: "Surface proof fixture flow",
    steps: ["Run the declared surface proof handler."],
    negativePath: "Invalid or missing surface evidence is rejected.",
    expectedOutcome: "The accepted evidence type proves the runnable surface."
  }];
  writeJson(join(runDir, "spec.json"), spec);

  const proofPlan = readJson(join(runDir, "proof-plan.json"));
  proofPlan.taskClass = taskClass;
  proofPlan.obligations = [{
    id: "P4",
    statement: `The ${taskClass} runnable surface is exercised from the user's point of view.`,
    requirementIds: ["R5"],
    acceptedEvidenceTypes,
    minimumEvidence: 1,
    status: "pending"
  }];
  proofPlan.requirementCoverage = [{
    requirementId: "R5",
    proofObligationIds: ["P4"]
  }];
  proofPlan.surfaceProofs = surfaceProofs;
  writeJson(join(runDir, "proof-plan.json"), proofPlan);

  const finalReport = readJson(join(runDir, "final-report.json"));
  finalReport.claims = {
    userSmoke: { status: "pending", requirementIds: ["R5"], evidence: [] }
  };
  finalReport.proofObligations = {
    P4: { status: "pending", evidence: [] }
  };
  finalReport.requirementResults = [{
    requirementId: "R5",
    status: "pending",
    evidence: []
  }];
  writeJson(join(runDir, "final-report.json"), finalReport);
}

function assertStructuralValidation(runDir) {
  const validation = validateTaskRunDir(runDir);
  assert.equal(validation.passed, true, JSON.stringify(validation.errors, null, 2));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
