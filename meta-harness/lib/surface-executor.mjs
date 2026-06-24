import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { classifyCommandSafety } from "./command-executor.mjs";
import {
  appendJsonl,
  readJson,
  relativeArtifact,
  writeJson
} from "./runner-utils.mjs";

const surfaceEvidenceTypes = new Set([
  "browser-smoke",
  "browser-extension-smoke",
  "api-smoke",
  "request-response",
  "cli-smoke",
  "data-fixture",
  "generated-artifact",
  "manifest",
  "screenshot",
  "trace",
  "manual-smoke-artifact"
]);

export async function runSurfaceProofExecutor({
  runDir,
  now = new Date(),
  timeoutMs = 30000,
  env = {},
  onlyProofIds = null,
  onlySurfaceIds = null
}) {
  const absoluteRunDir = resolve(runDir);
  const repoProfile = readJson(join(absoluteRunDir, "repo-profile.json"));
  const spec = readJson(join(absoluteRunDir, "spec.json"));
  const proofPlan = readJson(join(absoluteRunDir, "proof-plan.json"));
  const existingVerification = readJson(join(absoluteRunDir, "verification.json"));
  const runId = spec.runId || proofPlan.runId || basename(absoluteRunDir);
  const repoPath = repoProfile.targetPath || repoProfile.repoPath;
  const createdAt = now.toISOString();
  const state = {
    runId,
    runDir: absoluteRunDir,
    repoPath,
    createdAt,
    timestampIndex: 0,
    surfaceIndex: nextSurfaceIndex(existingVerification),
    evidenceIndex: nextSurfaceEvidenceIndex(existingVerification),
    eventIndex: Date.now(),
    timeoutMs,
    envKeys: Object.keys(env).sort()
  };

  const selected = selectSurfaceProofs({ spec, proofPlan, onlyProofIds, onlySurfaceIds });
  const missing = missingRequiredSurfaceProofs({
    proofPlan,
    existingVerification,
    selected,
    taskClass: spec.taskClass || proofPlan.taskClass,
    onlyProofIds
  });
  const events = [
    surfaceEvent({
      state,
      status: "started",
      message: `M5 surface proof executor selected ${selected.length} surface proof(s) and ${missing.length} missing required surface proof(s).`
    })
  ];
  const surfaceResults = [];
  const evidenceEntries = [];

  for (const proof of selected) {
    const result = await executeSurfaceProof({ state, proof, proofPlan, repoProfile, timeoutMs, env });
    surfaceResults.push(result.surfaceResult);
    evidenceEntries.push(result.evidence);
    events.push(surfaceEvent({
      state,
      status: result.surfaceResult.status,
      message: `Surface proof ${result.surfaceResult.id} ${result.surfaceResult.status}: ${proof.id}.`
    }));
  }

  for (const obligation of missing) {
    const result = blockedSurfaceProof({
      state,
      proof: missingProofForObligation(obligation),
      status: "blocked",
      reason: "missing-surface-proof",
      message: `Proof obligation ${obligation.id} requires runnable surface evidence but no matching surface proof is declared.`
    });
    surfaceResults.push(result.surfaceResult);
    evidenceEntries.push(result.evidence);
    events.push(surfaceEvent({
      state,
      status: "blocked",
      message: `Missing surface proof for ${obligation.id}.`
    }));
  }

  const verification = buildVerification({
    previous: existingVerification,
    runId,
    createdAt,
    spec,
    proofPlan,
    surfaceResults,
    evidenceEntries
  });
  writeJson(join(absoluteRunDir, "verification.json"), verification);
  appendJsonl(join(absoluteRunDir, "events.jsonl"), [
    ...events,
    surfaceEvent({
      state,
      status: verification.status,
      message: `M5 surface proof executor finished with verification status ${verification.status}.`
    })
  ]);

  return {
    runId,
    runDir: absoluteRunDir,
    status: verification.status,
    verification,
    surfaceResults,
    evidenceEntries
  };
}

function selectSurfaceProofs({ spec, proofPlan, onlyProofIds, onlySurfaceIds }) {
  const proofIdFilter = onlyProofIds ? new Set(onlyProofIds) : null;
  const surfaceIdFilter = onlySurfaceIds ? new Set(onlySurfaceIds) : null;
  const obligationsById = new Map((proofPlan.obligations || []).map((obligation) => [obligation.id, obligation]));
  const rawProofs = [
    ...(Array.isArray(proofPlan.surfaceProofs) ? proofPlan.surfaceProofs : []),
    ...(Array.isArray(spec.surfaceProofs) ? spec.surfaceProofs : [])
  ];
  return rawProofs
    .map((proof, index) => normalizeSurfaceProof(proof, index))
    .map((proof) => enrichSurfaceProofRequirements({ proof, obligationsById }))
    .filter((proof) => !surfaceIdFilter || surfaceIdFilter.has(proof.id))
    .filter((proof) => !proofIdFilter || proof.proofObligationIds.some((proofId) => proofIdFilter.has(proofId)));
}

function normalizeSurfaceProof(proof, index) {
  const proofObligationIds = Array.isArray(proof.proofObligationIds)
    ? proof.proofObligationIds
    : proof.proofObligationId
      ? [proof.proofObligationId]
      : [];
  return {
    ...proof,
    id: proof.id || `surface-${index + 1}`,
    handler: proof.handler || handlerForEvidenceType(proof.evidenceType),
    evidenceType: proof.evidenceType || "manual-smoke-artifact",
    proofObligationIds,
    description: proof.description || ""
  };
}

function enrichSurfaceProofRequirements({ proof, obligationsById }) {
  if (Array.isArray(proof.requirementIds) && proof.requirementIds.length > 0) {
    return proof;
  }
  const requirementIds = new Set();
  for (const proofId of proof.proofObligationIds) {
    const obligation = obligationsById.get(proofId);
    for (const requirementId of obligation?.requirementIds || []) {
      requirementIds.add(requirementId);
    }
  }
  return {
    ...proof,
    requirementIds: [...requirementIds]
  };
}

function handlerForEvidenceType(evidenceType) {
  if (evidenceType === "browser-extension-smoke") {
    return "browser-extension";
  }
  if (evidenceType === "browser-smoke") {
    return "browser";
  }
  if (evidenceType === "api-smoke" || evidenceType === "request-response") {
    return "api";
  }
  if (evidenceType === "cli-smoke") {
    return "cli";
  }
  if (["data-fixture", "generated-artifact", "manifest"].includes(evidenceType)) {
    return "data";
  }
  if (["screenshot", "trace"].includes(evidenceType)) {
    return "visual";
  }
  return "manual";
}

function missingRequiredSurfaceProofs({ proofPlan, existingVerification, selected, taskClass, onlyProofIds }) {
  const proofIdFilter = onlyProofIds ? new Set(onlyProofIds) : null;
  const selectedProofIds = new Set(selected.flatMap((proof) => proof.proofObligationIds));
  const existingPassedSurfaceProofIds = new Set();
  for (const evidence of existingVerification.evidence || []) {
    if (evidence.status !== "passed" || !surfaceEvidenceTypes.has(evidence.type)) {
      continue;
    }
    for (const proofId of evidence.proofObligationIds || []) {
      existingPassedSurfaceProofIds.add(proofId);
    }
  }
  return (proofPlan.obligations || []).filter((obligation) => {
    if (proofIdFilter && !proofIdFilter.has(obligation.id)) {
      return false;
    }
    if (selectedProofIds.has(obligation.id) || existingPassedSurfaceProofIds.has(obligation.id)) {
      return false;
    }
    const requiredTypes = requiredSurfaceTypes({ taskClass, obligation });
    return requiredTypes.length > 0;
  });
}

function requiredSurfaceTypes({ taskClass, obligation }) {
  const accepted = new Set(obligation.acceptedEvidenceTypes || []);
  const requiredByClass = {
    "web-ui": ["browser-smoke", "screenshot", "trace"],
    "browser-extension": ["browser-extension-smoke", "browser-smoke"],
    "cli": ["cli-smoke"],
    "api": ["api-smoke", "request-response"],
    "data-pipeline": ["data-fixture", "generated-artifact", "manifest"]
  }[taskClass] || [];
  return requiredByClass.filter((type) => accepted.has(type));
}

function missingProofForObligation(obligation) {
  return {
    id: `missing-${obligation.id}`,
    handler: "missing",
    evidenceType: firstSurfaceEvidenceType(obligation.acceptedEvidenceTypes),
    proofObligationIds: [obligation.id],
    requirementIds: obligation.requirementIds || [],
    description: "Missing required runnable surface proof."
  };
}

function firstSurfaceEvidenceType(types = []) {
  return types.find((type) => surfaceEvidenceTypes.has(type)) || "manual-smoke-artifact";
}

async function executeSurfaceProof({ state, proof, proofPlan, repoProfile, timeoutMs, env }) {
  const validation = validateSurfaceProof({ proof, proofPlan });
  if (!validation.allowed) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: validation.reason,
      message: validation.message
    });
  }
  if (proof.handler === "browser") {
    return validateBrowserProof({ state, proof, extension: false });
  }
  if (proof.handler === "browser-extension") {
    return validateBrowserProof({ state, proof, extension: true });
  }
  if (proof.handler === "api") {
    return executeApiProof({ state, proof, timeoutMs });
  }
  if (proof.handler === "cli") {
    return executeCliProof({ state, proof, repoProfile, timeoutMs, env });
  }
  if (proof.handler === "data") {
    return validateDataProof({ state, proof });
  }
  if (proof.handler === "visual") {
    return validateArtifactProof({ state, proof, artifactField: "artifactPaths", handler: "visual" });
  }
  if (proof.handler === "manual") {
    return validateArtifactProof({ state, proof, artifactField: "artifactPaths", handler: "manual" });
  }
  return blockedSurfaceProof({
    state,
    proof,
    status: "blocked",
    reason: "unsupported-surface-handler",
    message: `Unsupported surface proof handler: ${proof.handler}.`
  });
}

function validateSurfaceProof({ proof, proofPlan }) {
  if (!surfaceEvidenceTypes.has(proof.evidenceType)) {
    return {
      allowed: false,
      reason: "unsupported-surface-evidence-type",
      message: `Unsupported surface evidence type: ${proof.evidenceType}.`
    };
  }
  if (proof.proofObligationIds.length === 0) {
    return {
      allowed: false,
      reason: "missing-proof-obligation",
      message: "Surface proof must map to at least one proof obligation."
    };
  }
  const obligations = new Map((proofPlan.obligations || []).map((obligation) => [obligation.id, obligation]));
  for (const proofId of proof.proofObligationIds) {
    const obligation = obligations.get(proofId);
    if (!obligation) {
      return {
        allowed: false,
        reason: "unknown-proof-obligation",
        message: `Surface proof references unknown proof obligation ${proofId}.`
      };
    }
    if (!(obligation.acceptedEvidenceTypes || []).includes(proof.evidenceType)) {
      return {
        allowed: false,
        reason: "unaccepted-evidence-type",
        message: `Proof obligation ${proofId} does not accept evidence type ${proof.evidenceType}.`
      };
    }
  }
  return { allowed: true };
}

function validateBrowserProof({ state, proof, extension }) {
  if (!proof.scenarioPath) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: "missing-browser-scenario",
      message: "Browser proof must declare scenarioPath."
    });
  }
  const startedAt = nextTimestamp(state);
  const scenario = readJsonArtifact({ state, inputPath: proof.scenarioPath });
  if (!scenario.ok) {
    return surfaceProofFromArtifacts({
      state,
      proof,
      handler: proof.handler,
      status: "failed",
      startedAt,
      reason: scenario.reason,
      message: scenario.message,
      artifacts: []
    });
  }
  const scenarioData = scenario.value;
  const scenarioDir = dirname(scenario.absolutePath);
  const artifactPaths = [
    ...(Array.isArray(proof.artifactPaths) ? proof.artifactPaths : []),
    scenarioData.screenshotPath,
    scenarioData.tracePath,
    scenarioData.consoleLogPath
  ].filter(Boolean);
  const artifacts = [
    inspectArtifact({ state, inputPath: proof.scenarioPath }),
    ...artifactPaths.map((artifactPath) => inspectArtifact({ state, inputPath: artifactPath, baseDir: scenarioDir }))
  ];
  const missingArtifacts = artifacts.filter((artifact) => !artifact.exists);
  const assertions = Array.isArray(scenarioData.assertions) ? scenarioData.assertions : [];
  const scenarioPassed = scenarioData.status === "passed" || scenarioData.passed === true;
  const hasRunnableSurface = Boolean(scenarioData.url || proof.url || scenarioData.route || scenarioData.page);
  const extensionLoaded = !extension
    || scenarioData.extensionLoaded === true
    || scenarioData.extensionContext === true
    || proof.extensionLoaded === true;
  const extensionManifest = !extension
    ? null
    : inspectArtifact({ state, inputPath: proof.manifestPath || scenarioData.manifestPath || "manifest.json" });
  if (extensionManifest) {
    artifacts.push(extensionManifest);
  }

  let status = "passed";
  let reason = null;
  let message = "Browser surface evidence passed.";
  if (!scenarioPassed) {
    status = "failed";
    reason = "browser-scenario-failed";
    message = "Browser scenario artifact did not report passed status.";
  } else if (!hasRunnableSurface) {
    status = "blocked";
    reason = "missing-browser-target";
    message = "Browser scenario must name a URL, route, or page target.";
  } else if (extension && !extensionLoaded) {
    status = "failed";
    reason = "extension-not-loaded";
    message = "Browser-extension scenario did not prove an unpacked extension context.";
  } else if (extensionManifest && !extensionManifest.exists) {
    status = "failed";
    reason = "missing-extension-manifest";
    message = "Browser-extension proof must reference an existing manifest artifact.";
  } else if (missingArtifacts.length > 0) {
    status = "failed";
    reason = "missing-browser-artifact";
    message = `Missing browser artifact(s): ${missingArtifacts.map((artifact) => artifact.inputPath).join(", ")}.`;
  } else if (assertions.length === 0) {
    status = "blocked";
    reason = "missing-browser-assertions";
    message = "Browser scenario must record at least one user-visible assertion.";
  }

  return surfaceProofFromArtifacts({
    state,
    proof,
    handler: proof.handler,
    status,
    startedAt,
    reason,
    message,
    artifacts,
    details: {
      url: scenarioData.url || proof.url || null,
      route: scenarioData.route || null,
      assertions,
      extensionLoaded: extension ? extensionLoaded : undefined
    }
  });
}

async function executeApiProof({ state, proof, timeoutMs }) {
  const startedAt = nextTimestamp(state);
  const apiDir = join(state.runDir, "evidence", "api");
  mkdirSync(apiDir, { recursive: true });
  const surfaceId = nextSurfaceId(state);
  const evidenceId = nextEvidenceId(state);
  const requestPath = join(apiDir, `${surfaceId}.request.json`);
  const responsePath = join(apiDir, `${surfaceId}.response.json`);
  const bodyPath = join(apiDir, `${surfaceId}.body.txt`);
  const request = proof.request || {};
  const method = String(request.method || "GET").toUpperCase();
  const url = request.url || proof.url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let responseMeta = null;
  let responseBody = "";
  let status = "passed";
  let reason = null;
  let message = "API request/response proof passed.";

  writeJson(requestPath, {
    method,
    url,
    headers: redactHeaders(request.headers || {}),
    hasBody: request.body !== undefined
  });

  try {
    if (!url || !/^https?:\/\//.test(String(url))) {
      throw new Error("API proof request.url must be an absolute http(s) URL.");
    }
    const response = await fetch(url, {
      method,
      headers: request.headers || {},
      body: request.body,
      signal: controller.signal
    });
    responseBody = await response.text();
    responseMeta = {
      status: response.status,
      statusText: response.statusText,
      headers: redactHeaders(Object.fromEntries(response.headers.entries()))
    };
    const expectedStatus = Number.isInteger(request.expectedStatus) ? request.expectedStatus : 200;
    const expectedBodyIncludes = Array.isArray(request.expectedBodyIncludes) ? request.expectedBodyIncludes : [];
    if (response.status !== expectedStatus) {
      status = "failed";
      reason = "unexpected-api-status";
      message = `API response status ${response.status} did not match expected ${expectedStatus}.`;
    } else if (!expectedBodyIncludes.every((text) => responseBody.includes(text))) {
      status = "failed";
      reason = "missing-api-body-text";
      message = "API response body did not include all expected text fragments.";
    }
  } catch (error) {
    status = "failed";
    reason = error.name === "AbortError" ? "api-timeout" : "api-request-failed";
    message = error.message || String(error);
    responseMeta = { error: message };
  } finally {
    clearTimeout(timeout);
  }

  writeJson(responsePath, responseMeta);
  writeFileSync(bodyPath, responseBody);
  const finishedAt = nextTimestamp(state);
  return makeSurfaceResult({
    state,
    surfaceId,
    evidenceId,
    proof,
    handler: "api",
    status,
    startedAt,
    finishedAt,
    reason,
    message,
    path: relativeArtifact(state.runDir, responsePath),
    artifacts: [
      artifactRecord({ state, absolutePath: requestPath, inputPath: "request" }),
      artifactRecord({ state, absolutePath: responsePath, inputPath: "response" }),
      artifactRecord({ state, absolutePath: bodyPath, inputPath: "body" })
    ],
    extraEvidence: {
      requestPath: relativeArtifact(state.runDir, requestPath),
      responsePath: relativeArtifact(state.runDir, responsePath),
      bodyPath: relativeArtifact(state.runDir, bodyPath),
      statusCode: responseMeta?.status ?? null
    },
    extraResult: {
      request: { method, url },
      statusCode: responseMeta?.status ?? null
    }
  });
}

async function executeCliProof({ state, proof, repoProfile, timeoutMs, env }) {
  if (!proof.binary) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: "missing-cli-binary",
      message: "CLI proof must declare binary."
    });
  }
  const args = Array.isArray(proof.args) ? proof.args.map(String) : [];
  const commandText = [proof.binary, ...args].map(shellToken).join(" ");
  const safety = classifyCommandSafety({ command: commandText, repoProfile });
  if (!safety.allowed) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: safety.reason,
      message: safety.message
    });
  }

  const startedAt = nextTimestamp(state);
  const startedHr = process.hrtime.bigint();
  const cliDir = join(state.runDir, "evidence", "cli");
  mkdirSync(cliDir, { recursive: true });
  const surfaceId = nextSurfaceId(state);
  const evidenceId = nextEvidenceId(state);
  const stdoutPath = join(cliDir, `${surfaceId}.stdout.txt`);
  const stderrPath = join(cliDir, `${surfaceId}.stderr.txt`);
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;
  const child = spawn(resolveCliBinary({ binary: proof.binary, repoPath: state.repoPath }), args, {
    cwd: state.repoPath,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  const terminal = await new Promise((resolvePromise) => {
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => resolvePromise({ exitCode: null, signal: null, error }));
    child.on("close", (exitCode, signal) => resolvePromise({ exitCode, signal, error: null }));
  });
  clearTimeout(timeout);

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, terminal.error ? String(terminal.error.message || terminal.error) : stderr);

  const expectedExitCode = Number.isInteger(proof.expectedExitCode) ? proof.expectedExitCode : 0;
  const expectedStdoutIncludes = Array.isArray(proof.expectedStdoutIncludes) ? proof.expectedStdoutIncludes : [];
  let status = timedOut ? "timed-out" : terminal.error ? "failed" : terminal.exitCode === expectedExitCode ? "passed" : "failed";
  let reason = null;
  let message = "CLI smoke proof passed.";
  if (timedOut) {
    reason = "cli-timeout";
    message = "CLI proof timed out.";
  } else if (terminal.error) {
    reason = "cli-spawn-failed";
    message = terminal.error.message || String(terminal.error);
  } else if (terminal.exitCode !== expectedExitCode) {
    reason = "unexpected-cli-exit";
    message = `CLI exit ${terminal.exitCode} did not match expected ${expectedExitCode}.`;
  } else if (!expectedStdoutIncludes.every((text) => stdout.includes(text))) {
    status = "failed";
    reason = "missing-cli-output";
    message = "CLI stdout did not include all expected text fragments.";
  }
  const finishedAt = nextTimestamp(state);
  const durationMs = Number((process.hrtime.bigint() - startedHr) / 1000000n);
  return makeSurfaceResult({
    state,
    surfaceId,
    evidenceId,
    proof,
    handler: "cli",
    status,
    startedAt,
    finishedAt,
    durationMs,
    reason,
    message,
    path: relativeArtifact(state.runDir, stdoutPath),
    artifacts: [
      artifactRecord({ state, absolutePath: stdoutPath, inputPath: "stdout" }),
      artifactRecord({ state, absolutePath: stderrPath, inputPath: "stderr" })
    ],
    extraEvidence: {
      stdoutPath: relativeArtifact(state.runDir, stdoutPath),
      stderrPath: relativeArtifact(state.runDir, stderrPath),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut
    },
    extraResult: {
      command: commandText,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut
    }
  });
}

function validateDataProof({ state, proof }) {
  const startedAt = nextTimestamp(state);
  const expectedArtifacts = Array.isArray(proof.expectedArtifacts)
    ? proof.expectedArtifacts
    : Array.isArray(proof.artifactPaths)
      ? proof.artifactPaths
      : [];
  if (expectedArtifacts.length === 0 && !proof.manifestPath) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: "missing-data-artifacts",
      message: "Data proof must declare expectedArtifacts, artifactPaths, or manifestPath."
    });
  }
  const artifacts = expectedArtifacts.map((artifactPath) => inspectArtifact({ state, inputPath: artifactPath }));
  const manifest = proof.manifestPath ? readJsonArtifact({ state, inputPath: proof.manifestPath }) : null;
  if (manifest) {
    artifacts.push(inspectArtifact({ state, inputPath: proof.manifestPath }));
  }
  const missingArtifacts = artifacts.filter((artifact) => !artifact.exists);
  const missingFields = manifest?.ok
    ? missingManifestFields({ manifest: manifest.value, fields: proof.requiredManifestFields || [] })
    : [];
  let status = "passed";
  let reason = null;
  let message = "Data artifact proof passed.";
  if (manifest && !manifest.ok) {
    status = "failed";
    reason = manifest.reason;
    message = manifest.message;
  } else if (missingArtifacts.length > 0) {
    status = "failed";
    reason = "missing-data-artifact";
    message = `Missing data artifact(s): ${missingArtifacts.map((artifact) => artifact.inputPath).join(", ")}.`;
  } else if (missingFields.length > 0) {
    status = "failed";
    reason = "missing-manifest-field";
    message = `Manifest missing required field(s): ${missingFields.join(", ")}.`;
  }
  return surfaceProofFromArtifacts({
    state,
    proof,
    handler: "data",
    status,
    startedAt,
    reason,
    message,
    artifacts,
    details: {
      requiredManifestFields: proof.requiredManifestFields || [],
      missingManifestFields: missingFields
    }
  });
}

function validateArtifactProof({ state, proof, artifactField, handler }) {
  const startedAt = nextTimestamp(state);
  const artifactPaths = Array.isArray(proof[artifactField]) ? proof[artifactField] : [];
  if (artifactPaths.length === 0) {
    return blockedSurfaceProof({
      state,
      proof,
      status: "blocked",
      reason: `missing-${handler}-artifacts`,
      message: `${handler} proof must declare concrete artifactPaths.`
    });
  }
  const artifacts = artifactPaths.map((artifactPath) => inspectArtifact({ state, inputPath: artifactPath }));
  const missingArtifacts = artifacts.filter((artifact) => !artifact.exists);
  const status = missingArtifacts.length > 0 ? "failed" : "passed";
  return surfaceProofFromArtifacts({
    state,
    proof,
    handler,
    status,
    startedAt,
    reason: missingArtifacts.length > 0 ? `missing-${handler}-artifact` : null,
    message: missingArtifacts.length > 0
      ? `Missing ${handler} artifact(s): ${missingArtifacts.map((artifact) => artifact.inputPath).join(", ")}.`
      : `${handler} artifact proof passed.`,
    artifacts
  });
}

function surfaceProofFromArtifacts({ state, proof, handler, status, startedAt, reason, message, artifacts, details = {} }) {
  const surfaceId = nextSurfaceId(state);
  const evidenceId = nextEvidenceId(state);
  const finishedAt = nextTimestamp(state);
  const surfaceDir = join(state.runDir, "evidence", handler);
  mkdirSync(surfaceDir, { recursive: true });
  const manifestPath = join(surfaceDir, `${surfaceId}.json`);
  writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "meta-harness.surface-evidence",
    runId: state.runId,
    proofId: proof.id,
    surfaceResultId: surfaceId,
    evidenceId,
    handler,
    evidenceType: proof.evidenceType,
    status,
    reason,
    message,
    artifacts,
    details
  });
  return makeSurfaceResult({
    state,
    surfaceId,
    evidenceId,
    proof,
    handler,
    status,
    startedAt,
    finishedAt,
    reason,
    message,
    path: relativeArtifact(state.runDir, manifestPath),
    artifacts
  });
}

function blockedSurfaceProof({ state, proof, status, reason, message }) {
  const startedAt = nextTimestamp(state);
  const surfaceId = nextSurfaceId(state);
  const evidenceId = nextEvidenceId(state);
  const finishedAt = nextTimestamp(state);
  return makeSurfaceResult({
    state,
    surfaceId,
    evidenceId,
    proof,
    handler: proof.handler || "missing",
    status,
    startedAt,
    finishedAt,
    reason,
    message,
    path: null,
    artifacts: []
  });
}

function makeSurfaceResult({
  state,
  surfaceId,
  evidenceId,
  proof,
  handler,
  status,
  startedAt,
  finishedAt,
  durationMs = null,
  reason = null,
  message = "",
  path,
  artifacts,
  extraEvidence = {},
  extraResult = {}
}) {
  const proofObligations = proofObligationsForResult({ proof });
  const requirementIds = proof.requirementIds || [];
  const finalDurationMs = durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const surfaceResult = {
    id: surfaceId,
    proofId: proof.id,
    handler,
    evidenceType: proof.evidenceType,
    status,
    startedAt,
    finishedAt,
    durationMs: finalDurationMs,
    reason,
    message,
    requirementIds,
    proofObligationIds: proofObligations,
    evidenceIds: [evidenceId],
    artifacts,
    ...extraResult
  };
  const evidence = {
    id: evidenceId,
    type: proof.evidenceType,
    status,
    surfaceResultId: surfaceId,
    proofId: proof.id,
    handler,
    path,
    reason,
    message,
    requirementIds,
    proofObligationIds: proofObligations,
    artifacts,
    ...extraEvidence
  };
  return { surfaceResult, evidence };
}

function proofObligationsForResult({ proof }) {
  return Array.isArray(proof.proofObligationIds) ? proof.proofObligationIds : [];
}

function buildVerification({ previous, runId, createdAt, spec, proofPlan, surfaceResults, evidenceEntries }) {
  const previousCommands = Array.isArray(previous.commands) ? previous.commands : [];
  const previousSurfaces = Array.isArray(previous.surfaceResults) ? previous.surfaceResults : [];
  const previousEvidence = Array.isArray(previous.evidence) ? previous.evidence : [];
  const commands = previousCommands;
  const surfaceResultsAll = [...previousSurfaces, ...surfaceResults];
  const evidence = [...previousEvidence, ...evidenceEntries];
  const evidenceByProof = new Map();
  for (const evidenceItem of evidence) {
    for (const proofId of evidenceItem.proofObligationIds || []) {
      if (!evidenceByProof.has(proofId)) {
        evidenceByProof.set(proofId, []);
      }
      evidenceByProof.get(proofId).push(evidenceItem);
    }
  }

  const proofObligations = (proofPlan.obligations || []).map((obligation) => {
    const items = evidenceByProof.get(obligation.id) || [];
    const passed = items.filter((item) => item.status === "passed");
    const failed = items.filter((item) => item.status === "failed" || item.status === "timed-out");
    const blocked = items.filter((item) => item.status === "blocked");
    let status = "pending";
    if (passed.length >= obligation.minimumEvidence) {
      status = "passed";
    } else if (blocked.length > 0) {
      status = "blocked";
    } else if (failed.length > 0) {
      status = "failed";
    }
    return {
      id: obligation.id,
      status,
      evidence: passed.map((item) => item.id),
      failedEvidence: failed.map((item) => item.id),
      blockedEvidence: blocked.map((item) => item.id)
    };
  });

  const proofStatusById = new Map(proofObligations.map((proof) => [proof.id, proof.status]));
  const requirementCoverage = (spec.requirements || []).map((requirement) => {
    const proofIds = requirement.proofObligationIds || [];
    const statuses = proofIds.map((proofId) => proofStatusById.get(proofId)).filter(Boolean);
    let status = "pending";
    if (statuses.length > 0 && statuses.every((item) => item === "passed")) {
      status = "passed";
    } else if (statuses.includes("failed")) {
      status = "failed";
    } else if (statuses.includes("blocked")) {
      status = "blocked";
    }
    return {
      requirementId: requirement.id,
      status,
      proofObligationIds: proofIds
    };
  });

  const currentStatuses = surfaceResults.map((result) => result.status);
  const status = statusForRun({ currentStatuses, proofObligations, currentResults: surfaceResults });
  return {
    schemaVersion: 1,
    kind: "meta-harness.verification",
    runId,
    createdAt: previous.createdAt || createdAt,
    updatedAt: createdAt,
    status,
    scope: "m5-surface-proof-executor",
    commands,
    surfaceResults: surfaceResultsAll,
    evidence,
    requirementCoverage,
    proofObligations,
    summary: {
      ...(previous.summary || {}),
      executedSurfaceProofs: surfaceResults.filter((result) => ["passed", "failed", "timed-out"].includes(result.status)).length,
      passedSurfaceProofs: surfaceResults.filter((result) => result.status === "passed").length,
      failedSurfaceProofs: surfaceResults.filter((result) => result.status === "failed").length,
      timedOutSurfaceProofs: surfaceResults.filter((result) => result.status === "timed-out").length,
      blockedSurfaceProofs: surfaceResults.filter((result) => result.status === "blocked").length,
      note: "M5 surface executor records browser, extension, API, CLI, data, visual, and manual proof evidence."
    }
  };
}

function statusForRun({ currentStatuses, proofObligations, currentResults }) {
  if (currentResults.length === 0) {
    return "blocked";
  }
  if (currentStatuses.includes("blocked")) {
    return "blocked";
  }
  if (currentStatuses.includes("failed") || currentStatuses.includes("timed-out")) {
    return "failed";
  }
  if (proofObligations.some((proof) => proof.status === "failed")) {
    return "failed";
  }
  if (proofObligations.some((proof) => proof.status === "blocked")) {
    return "blocked";
  }
  if (proofObligations.some((proof) => proof.status === "pending")) {
    return "pending";
  }
  return currentStatuses.every((status) => status === "passed") ? "passed" : "pending";
}

function inspectArtifact({ state, inputPath, baseDir = state.repoPath }) {
  const resolved = resolveArtifactPath({ state, inputPath, baseDir });
  if (!resolved.ok) {
    return {
      inputPath,
      exists: false,
      path: null,
      reason: resolved.reason,
      message: resolved.message
    };
  }
  if (!existsSync(resolved.absolutePath)) {
    return {
      inputPath,
      exists: false,
      path: resolved.displayPath,
      reason: "artifact-not-found",
      message: `Artifact does not exist: ${inputPath}.`
    };
  }
  return artifactRecord({ state, absolutePath: resolved.absolutePath, inputPath });
}

function artifactRecord({ state, absolutePath, inputPath }) {
  const stats = statSync(absolutePath);
  const buffer = readFileSync(absolutePath);
  return {
    inputPath,
    exists: true,
    path: artifactDisplayPath({ state, absolutePath }),
    bytes: stats.size,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

function readJsonArtifact({ state, inputPath, baseDir = state.repoPath }) {
  const artifact = inspectArtifact({ state, inputPath, baseDir });
  if (!artifact.exists) {
    return {
      ok: false,
      reason: artifact.reason || "artifact-not-found",
      message: artifact.message || `Artifact does not exist: ${inputPath}.`,
      artifact
    };
  }
  const resolved = resolveArtifactPath({ state, inputPath, baseDir });
  try {
    return {
      ok: true,
      value: JSON.parse(readFileSync(resolved.absolutePath, "utf8")),
      absolutePath: resolved.absolutePath,
      artifact
    };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid-json-artifact",
      message: error.message || String(error),
      artifact
    };
  }
}

function resolveArtifactPath({ state, inputPath, baseDir }) {
  if (!inputPath || typeof inputPath !== "string") {
    return {
      ok: false,
      reason: "missing-artifact-path",
      message: "Artifact path is missing."
    };
  }
  const candidates = [];
  if (isAbsolute(inputPath)) {
    candidates.push(resolve(inputPath));
  } else {
    candidates.push(resolve(baseDir, inputPath));
    candidates.push(resolve(state.repoPath, inputPath));
    candidates.push(resolve(state.runDir, inputPath));
  }
  for (const absolutePath of candidates) {
    if (!isInside(absolutePath, state.repoPath) && !isInside(absolutePath, state.runDir)) {
      continue;
    }
    if (existsSync(absolutePath)) {
      return {
        ok: true,
        absolutePath,
        displayPath: artifactDisplayPath({ state, absolutePath })
      };
    }
  }
  const fallback = candidates.find((absolutePath) => isInside(absolutePath, state.repoPath) || isInside(absolutePath, state.runDir));
  if (!fallback) {
    return {
      ok: false,
      reason: "artifact-outside-allowed-roots",
      message: `Artifact path is outside the target repo and run folder: ${inputPath}.`
    };
  }
  return {
    ok: true,
    absolutePath: fallback,
    displayPath: artifactDisplayPath({ state, absolutePath: fallback })
  };
}

function artifactDisplayPath({ state, absolutePath }) {
  if (isInside(absolutePath, state.runDir)) {
    return relativeArtifact(state.runDir, absolutePath);
  }
  return `target:${relative(state.repoPath, absolutePath).replace(/\\/g, "/")}`;
}

function isInside(child, parent) {
  const relPath = relative(resolve(parent), resolve(child));
  return relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath));
}

function missingManifestFields({ manifest, fields }) {
  return fields.filter((field) => getByPath(manifest, field) === undefined);
}

function getByPath(value, path) {
  return String(path).split(".").reduce((cursor, part) => {
    if (cursor && Object.prototype.hasOwnProperty.call(cursor, part)) {
      return cursor[part];
    }
    return undefined;
  }, value);
}

function redactHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => {
    if (/authorization|cookie|token|secret|api[-_]?key/i.test(key)) {
      return [key, "[redacted]"];
    }
    return [key, value];
  }));
}

function resolveCliBinary({ binary, repoPath }) {
  if (binary.includes("/") || binary.includes("\\")) {
    return isAbsolute(binary) ? binary : resolve(repoPath, binary);
  }
  return binary;
}

function shellToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function nextSurfaceIndex(verification) {
  return maxIndex((verification.surfaceResults || []).map((surface) => surface.id), /^surface\.verify\.(\d+)$/) + 1;
}

function nextSurfaceEvidenceIndex(verification) {
  return maxIndex((verification.evidence || []).map((evidence) => evidence.id), /^E\.surface\.verify\.(\d+)$/) + 1;
}

function maxIndex(ids, pattern) {
  let max = 0;
  for (const id of ids) {
    const match = pattern.exec(String(id || ""));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

function nextSurfaceId(state) {
  const id = `surface.verify.${String(state.surfaceIndex).padStart(4, "0")}`;
  state.surfaceIndex += 1;
  return id;
}

function nextEvidenceId(state) {
  const id = `E.surface.verify.${String(state.evidenceIndex).padStart(4, "0")}`;
  state.evidenceIndex += 1;
  return id;
}

function surfaceEvent({ state, status, message }) {
  state.eventIndex += 1;
  return {
    id: `event.verification.${state.eventIndex}`,
    type: "verification-event",
    phase: "verify",
    status,
    timestamp: nextTimestamp(state),
    message
  };
}

function nextTimestamp(state) {
  const base = Date.parse(state.createdAt);
  const value = new Date(base + state.timestampIndex).toISOString();
  state.timestampIndex += 1;
  return value;
}
