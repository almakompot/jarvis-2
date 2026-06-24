import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { inspectRepo } from "./repo-profiler.mjs";

export const requiredArtifacts = [
  "task.md",
  "repo-profile.json",
  "spec.json",
  "proof-plan.json",
  "allowed-files.json",
  "runner-config.json",
  "events.jsonl",
  "command-log.jsonl",
  "transcript.jsonl",
  "diff.patch",
  "changed-files.json",
  "runner-state.json",
  "verification.json",
  "verifier-report.json",
  "policy-decision.json",
  "final-report.json"
];

export const requiredDirectories = [
  "evidence",
  "html-report"
];

export function initTaskRun({ repoPath, task, runId, now = new Date(), overwrite = false }) {
  const absoluteRepoPath = resolveRequiredRepo(repoPath);
  const normalizedTask = normalizeTask(task);
  const createdAt = now.toISOString();
  const id = runId ? normalizeRunId(runId) : makeRunId(now, normalizedTask);
  const runDir = join(absoluteRepoPath, ".task-runs", id);

  if (existsSync(runDir)) {
    if (!overwrite) {
      throw new Error(`Run directory already exists: ${runDir}`);
    }
    assertSafeOverwrite(runDir);
    rmSync(runDir, { recursive: true, force: true });
  }

  mkdirSync(runDir, { recursive: true });
  for (const directory of requiredDirectories) {
    mkdirSync(join(runDir, directory), { recursive: true });
  }

  const repoProfile = inspectRepo({ repoPath: absoluteRepoPath, runId: id, createdAt });
  const spec = compileTaskSpec({ repoPath: absoluteRepoPath, repoProfile, runId: id, task: normalizedTask, createdAt });
  const proofPlan = buildProofPlan({ runId: id, createdAt, spec });
  const allowedFiles = buildAllowedFiles({ runId: id, createdAt });
  const runnerConfig = buildRunnerConfigSeed({ runId: id, createdAt, repoPath: absoluteRepoPath });
  const changedFiles = buildChangedFilesSeed({ runId: id, createdAt });
  const runnerState = buildRunnerStateSeed({ runId: id, createdAt, repoPath: absoluteRepoPath });
  const verification = buildVerificationSeed({ runId: id, createdAt, spec, proofPlan });
  const verifierReport = buildVerifierReportSeed({ runId: id, createdAt });
  const policyDecision = buildPolicyDecisionSeed({ runId: id, createdAt });
  const finalReport = buildFinalReportSeed({ runId: id, createdAt, spec, proofPlan });
  const events = buildSeedEvents({ runId: id, createdAt, repoProfile });

  writeFileSync(join(runDir, "task.md"), renderTaskMarkdown({ runId: id, task: normalizedTask, createdAt, spec }));
  writeJson(join(runDir, "repo-profile.json"), repoProfile);
  writeJson(join(runDir, "spec.json"), spec);
  writeJson(join(runDir, "proof-plan.json"), proofPlan);
  writeJson(join(runDir, "allowed-files.json"), allowedFiles);
  writeJson(join(runDir, "runner-config.json"), runnerConfig);
  writeFileSync(join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  writeFileSync(join(runDir, "command-log.jsonl"), "");
  writeFileSync(join(runDir, "transcript.jsonl"), "");
  writeFileSync(join(runDir, "diff.patch"), "");
  writeJson(join(runDir, "changed-files.json"), changedFiles);
  writeJson(join(runDir, "runner-state.json"), runnerState);
  writeJson(join(runDir, "verification.json"), verification);
  writeJson(join(runDir, "verifier-report.json"), verifierReport);
  writeJson(join(runDir, "policy-decision.json"), policyDecision);
  writeJson(join(runDir, "final-report.json"), finalReport);

  return {
    runId: id,
    runDir,
    artifacts: requiredArtifacts.map((artifact) => join(runDir, artifact)),
    directories: requiredDirectories.map((directory) => join(runDir, directory))
  };
}

export function validateTaskRunDir(runDir) {
  const absoluteRunDir = resolve(runDir);
  const errors = [];
  const warnings = [];

  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    errors.push(error("run-dir.missing", `Run directory does not exist: ${absoluteRunDir}`));
    return finish({ runDir: absoluteRunDir, errors, warnings });
  }

  for (const artifact of requiredArtifacts) {
    if (!existsSync(join(absoluteRunDir, artifact))) {
      errors.push(error("artifact.missing", `Missing required artifact: ${artifact}`, { artifact }));
    }
  }
  for (const directory of requiredDirectories) {
    const directoryPath = join(absoluteRunDir, directory);
    if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
      errors.push(error("directory.missing", `Missing required directory: ${directory}`, { directory }));
    }
  }

  const repoProfile = readJsonArtifact(absoluteRunDir, "repo-profile.json", errors);
  const spec = readJsonArtifact(absoluteRunDir, "spec.json", errors);
  const proofPlan = readJsonArtifact(absoluteRunDir, "proof-plan.json", errors);
  const allowedFiles = readJsonArtifact(absoluteRunDir, "allowed-files.json", errors);
  const runnerConfig = readJsonArtifact(absoluteRunDir, "runner-config.json", errors);
  const changedFiles = readJsonArtifact(absoluteRunDir, "changed-files.json", errors);
  const runnerState = readJsonArtifact(absoluteRunDir, "runner-state.json", errors);
  const verification = readJsonArtifact(absoluteRunDir, "verification.json", errors);
  const verifierReport = readJsonArtifact(absoluteRunDir, "verifier-report.json", errors);
  const policyDecision = readJsonArtifact(absoluteRunDir, "policy-decision.json", errors);
  const finalReport = readJsonArtifact(absoluteRunDir, "final-report.json", errors);
  const events = readJsonlArtifact(absoluteRunDir, "events.jsonl", errors);
  const commandLog = readJsonlArtifact(absoluteRunDir, "command-log.jsonl", errors);
  const transcript = readJsonlArtifact(absoluteRunDir, "transcript.jsonl", errors);
  const taskMarkdown = readTextArtifact(absoluteRunDir, "task.md", errors);
  const diffPatch = readTextArtifact(absoluteRunDir, "diff.patch", errors);

  const runIds = [
    repoProfile?.runId,
    spec?.runId,
    proofPlan?.runId,
    allowedFiles?.runId,
    runnerConfig?.runId,
    changedFiles?.runId,
    runnerState?.runId,
    verification?.runId,
    verifierReport?.runId,
    policyDecision?.runId,
    finalReport?.runId
  ].filter(Boolean);
  const runId = runIds[0] || null;
  if (runId) {
    validateRunId(runId, errors);
    if (basename(absoluteRunDir) !== runId) {
      errors.push(error("run-id.directory-name", `Run directory name ${basename(absoluteRunDir)} does not match artifact runId ${runId}.`));
    }
  }
  for (const seenRunId of runIds) {
    if (seenRunId !== runId) {
      errors.push(error("run-id.mismatch", `Artifact runId ${seenRunId} does not match ${runId}.`));
    }
  }

  validateRepoProfile(repoProfile, errors);
  validateSpec(spec, proofPlan, errors);
  validateProofPlan(proofPlan, spec, errors);
  validateAllowedFiles(allowedFiles, runId, errors);
  validateRunnerConfig(runnerConfig, errors);
  validateEvents(events, errors);
  validateCommandLog(commandLog, errors);
  validateTranscript(transcript, errors);
  validateChangedFiles(changedFiles, errors);
  validateRunnerState(runnerState, errors);
  validatePendingTextArtifact(diffPatch, "diff.patch", errors);
  validateVerification(verification, spec, proofPlan, errors);
  validateVerifierReport(verifierReport, errors);
  validatePolicyDecision(policyDecision, errors);
  validateFinalReport(finalReport, spec, proofPlan, verification, errors);

  if (taskMarkdown && spec?.task?.raw && !taskMarkdown.includes(spec.task.raw)) {
    errors.push(error("task-md.raw-task", "task.md must preserve the raw task text from spec.json."));
  }

  return finish({
    runDir: absoluteRunDir,
    runId,
    artifacts: requiredArtifacts,
    directories: requiredDirectories,
    gates: {
      artifactsPresent: requiredArtifacts.every((artifact) => existsSync(join(absoluteRunDir, artifact)))
        && requiredDirectories.every((directory) => existsSync(join(absoluteRunDir, directory)) && statSync(join(absoluteRunDir, directory)).isDirectory()),
      requirementsMapped: Boolean(spec && proofPlan) && !errors.some((item) => item.id.startsWith("spec.requirement")),
      proofPlanSound: Boolean(proofPlan) && !errors.some((item) => item.id.startsWith("proof-plan.")),
      finalReportNotOverclaiming: Boolean(finalReport) && !errors.some((item) => item.id.startsWith("final-report.")),
      verificationNotFaked: Boolean(verification) && !errors.some((item) => item.id.startsWith("verification."))
    },
    errors,
    warnings
  });
}

function resolveRequiredRepo(repoPath) {
  if (!repoPath) {
    throw new Error("--repo is required.");
  }
  const absoluteRepoPath = resolve(repoPath);
  if (!existsSync(absoluteRepoPath) || !statSync(absoluteRepoPath).isDirectory()) {
    throw new Error(`Repo path is not a directory: ${absoluteRepoPath}`);
  }
  return absoluteRepoPath;
}

function normalizeTask(task) {
  const normalized = String(task || "").trim();
  if (normalized.length < 10) {
    throw new Error("--task must be at least 10 non-whitespace characters.");
  }
  return normalized;
}

function normalizeRunId(runId) {
  const normalized = String(runId || "").trim();
  const errors = [];
  validateRunId(normalized, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid run id: ${errors[0].message}`);
  }
  return normalized;
}

function validateRunId(runId, errors) {
  if (!runId || typeof runId !== "string") {
    errors.push(error("run-id.invalid", "runId must be a non-empty string."));
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(runId)) {
    errors.push(error("run-id.invalid", "runId may contain only letters, numbers, dots, underscores, and hyphens, and must not start with punctuation."));
  }
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\") || runId.startsWith(".")) {
    errors.push(error("run-id.traversal", "runId must not contain path traversal, slashes, or hidden-path syntax."));
  }
}

function assertSafeOverwrite(runDir) {
  const blockingReasons = [];
  const commandLog = readExistingText(join(runDir, "command-log.jsonl"));
  const transcript = readExistingText(join(runDir, "transcript.jsonl"));
  const diffPatch = readExistingText(join(runDir, "diff.patch"));
  const changedFiles = readExistingJson(join(runDir, "changed-files.json"));
  const runnerState = readExistingJson(join(runDir, "runner-state.json"));
  const verification = readExistingJson(join(runDir, "verification.json"));
  const finalReport = readExistingJson(join(runDir, "final-report.json"));

  if (commandLog.trim()) {
    blockingReasons.push("command-log.jsonl is not empty");
  }
  if (transcript.trim()) {
    blockingReasons.push("transcript.jsonl is not empty");
  }
  if (diffPatch.trim()) {
    blockingReasons.push("diff.patch is not empty");
  }
  if (Array.isArray(changedFiles?.files) && changedFiles.files.length > 0) {
    blockingReasons.push("changed-files.json records file changes");
  }
  if (runnerState?.status && runnerState.status !== "pending") {
    blockingReasons.push(`runner state is ${runnerState.status}`);
  }
  if (verification?.status && verification.status !== "pending") {
    blockingReasons.push(`verification status is ${verification.status}`);
  }
  if (finalReport?.outcome && finalReport.outcome !== "pending") {
    blockingReasons.push(`final report outcome is ${finalReport.outcome}`);
  }
  if (blockingReasons.length > 0) {
    throw new Error(`Refusing to overwrite non-seed run ${runDir}: ${blockingReasons.join("; ")}.`);
  }
}

function readExistingText(path) {
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

function readExistingJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function compileTaskSpec({ repoPath, repoProfile, runId, task, createdAt }) {
  const title = titleFromTask(task);
  const cues = inferTaskCues(task);
  const taskClass = inferTaskClass({ task, cues });
  const scriptCommands = inferScriptCommands(repoProfile);
  const proofObligations = buildSpecProofObligations({ taskClass, cues });
  const requirements = buildRequirements({ task, taskClass, cues });
  const userFlows = buildUserFlows({ task, taskClass, cues, scriptCommands });
  const requiredTests = buildRequiredTests({ taskClass, cues, scriptCommands });
  const nonRequirements = buildNonRequirements({ taskClass, cues });
  const risks = buildRisks({ taskClass, cues, repoProfile });

  return {
    schemaVersion: 1,
    kind: "meta-harness.task-spec",
    runId,
    createdAt,
    repo: {
      path: repoPath
    },
    task: {
      raw: task,
      title,
      summary: task,
      class: taskClass
    },
    taskClass,
    compiler: {
      milestone: "M1 Task Compiler",
      mode: "task-class-aware-template-with-repo-script-cues",
      specificityLevel: specificityLevelFor({ taskClass, cues, scriptCommands }),
      limitations: [
        "Does not perform deep stack inference.",
        "Does not know domain-specific correctness beyond the frozen user request.",
        "Requires later verifier artifacts before any pass claim is valid."
      ]
    },
    repoSignals: {
      packageManager: repoProfile.package.managerGuess || repoProfile.package.manager,
      availableScripts: getScriptNames(repoProfile),
      inferredTaskCues: cues
    },
    extractedBehavior: {
      targetSurfaces: inferTargetSurfaces({ taskClass, cues }),
      primaryInputs: inferPrimaryInputs(cues),
      expectedOutputs: inferExpectedOutputs({ taskClass, cues }),
      edgePaths: inferEdgePaths({ taskClass, cues })
    },
    requirements,
    nonRequirements,
    risks,
    userFlows,
    requiredTests,
    manualSmoke: {
      id: "S1",
      flowId: "F1",
      status: "pending",
      instructions: [
        scriptCommands.dev
          ? `Start the local surface with ${scriptCommands.dev}, then use the route or command named in F1.`
          : "Use the local runnable surface, not only source inspection.",
        "Capture exact command, URL, screenshot path, response, generated artifact, or transcript used as evidence.",
        "Record the primary path and the negative or validation path listed in userFlows."
      ]
    },
    proofObligations
  };
}

function buildSpecProofObligations({ taskClass, cues }) {
  const obligations = [
    { id: "P1", requirementIds: ["R1"] },
    { id: "P2", requirementIds: ["R2", "R4"] },
    { id: "P3", requirementIds: ["R3"] },
    { id: "P4", requirementIds: ["R2", "R3", "R5"] },
    { id: "P5", requirementIds: ["R6"] }
  ];
  if (taskClass === "unknown" && cues.length === 0) {
    obligations[1].requirementIds = ["R2", "R3"];
    obligations[2].requirementIds = ["R3"];
    obligations[3].requirementIds = ["R2", "R5"];
  }
  return obligations;
}

function buildRequirements({ task, taskClass, cues }) {
  const common = [
    {
      id: "R1",
      text: "Inspect the current repository before editing and use current files, scripts, and docs as the source of truth.",
      source: "fresh-repo-feature-protocol",
      proofObligationIds: ["P1"]
    }
  ];
  const final = [
    {
      id: "R4",
      text: "Add or update automated checks that would fail if the requested behavior is absent, broken, or only covered by a happy path.",
      source: "fresh-repo-feature-protocol",
      proofObligationIds: ["P2"]
    },
    {
      id: "R5",
      text: "Exercise the runnable user-facing surface in the same way the user is expected to try it, including the negative or edge path.",
      source: "fresh-repo-feature-protocol",
      proofObligationIds: ["P4"]
    },
    {
      id: "R6",
      text: "Final reporting must map requirements to evidence and name residual risk without overstating completion.",
      source: "acceptance-gate",
      proofObligationIds: ["P5"]
    }
  ];

  if (cues.includes("browse") && cues.includes("search") && cues.includes("empty-state")) {
    return [
      ...common,
      {
        id: "R2",
        text: "Searching unavailable or no-match browse marketplace content shows a clear no-results empty state instead of a crash, stale loading state, or misleading offerings.",
        source: "task-cue:browse-search-empty-state",
        proofObligationIds: ["P2", "P4"]
      },
      {
        id: "R3",
        text: cues.includes("reset-action")
          ? "The reset or clear action restores visible offerings after the no-results state without introducing checkout, pricing, or navigation regressions."
          : "The no-results path has a defined recovery or navigation path rather than trapping the user.",
        source: "task-cue:negative-path",
        proofObligationIds: ["P3", "P4"]
      },
      ...final
    ];
  }

  if (taskClass === "browser-extension") {
    return [
      ...common,
      {
        id: "R2",
        text: "The browser extension loads with the expected manifest, background or service worker logic, extension pages, and required Chrome API permissions.",
        source: "task-cue:browser-extension",
        proofObligationIds: ["P2", "P4"]
      },
      {
        id: "R3",
        text: "The extension exercises both allow and decline or validation paths through the unpacked-extension browser surface, preserving target URL and timing behavior when relevant.",
        source: "task-cue:extension-negative-path",
        proofObligationIds: ["P3", "P4"]
      },
      ...final
    ];
  }

  if (taskClass === "cli") {
    return [
      ...common,
      {
        id: "R2",
        text: "The requested tool behavior is available through the real CLI or script entrypoint, not only through internal helper functions.",
        source: "task-cue:cli",
        proofObligationIds: ["P2", "P4"]
      },
      {
        id: "R3",
        text: "Invalid input, missing arguments, or failure output is handled with the expected exit code and user-visible message.",
        source: "task-cue:cli-negative-path",
        proofObligationIds: ["P3", "P4"]
      },
      ...final
    ];
  }

  if (taskClass === "api") {
    return [
      ...common,
      {
        id: "R2",
        text: "The requested endpoint or backend behavior returns the expected success response through a real request path.",
        source: "task-cue:api",
        proofObligationIds: ["P2", "P4"]
      },
      {
        id: "R3",
        text: "Invalid request, auth, not-found, conflict, or idempotency behavior is covered when relevant to the task.",
        source: "task-cue:api-negative-path",
        proofObligationIds: ["P3", "P4"]
      },
      ...final
    ];
  }

  if (taskClass === "data-pipeline") {
    return [
      ...common,
      {
        id: "R2",
        text: "The requested data or artifact pipeline runs on a representative local fixture and produces validated output artifacts.",
        source: "task-cue:data-pipeline",
        proofObligationIds: ["P2", "P4"]
      },
      {
        id: "R3",
        text: "Missing, malformed, low-quality, or uncertain input is handled explicitly and reflected in manifests or status output.",
        source: "task-cue:data-negative-path",
        proofObligationIds: ["P3", "P4"]
      },
      ...final
    ];
  }

  return [
    ...common,
    {
      id: "R2",
      text: `Extract concrete acceptance criteria from the request before editing: ${task}`,
      source: "user-request",
      proofObligationIds: ["P2", "P4"]
    },
    {
      id: "R3",
      text: "Identify and verify at least one relevant failure, edge, or regression path implied by the task before reporting completion.",
      source: "fresh-repo-feature-protocol",
      proofObligationIds: ["P3", "P4"]
    },
    ...final
  ];
}

function buildUserFlows({ task, taskClass, cues, scriptCommands }) {
  const steps = [];
  if (scriptCommands.dev) {
    steps.push(`Start the app locally with ${scriptCommands.dev}.`);
  } else {
    steps.push("Launch or invoke the changed surface using the repo's normal local path.");
  }

  if (cues.includes("browse")) {
    steps.push("Open the browse marketplace surface, normally `/browse`.");
  }
  if (cues.includes("search")) {
    steps.push("Enter a search term that should return no matching offerings, such as `zzzzxqwerty999`.");
  }
  if (cues.includes("empty-state")) {
    steps.push("Verify the no-results empty state is visible, clear, and not a generic crash/loading state.");
  }
  if (cues.includes("reset-action")) {
    steps.push("Use the reset or clear action and verify visible offerings return without a page reload or error.");
  }
  if (taskClass === "browser-extension") {
    steps.push("Load the unpacked extension in a Chromium-family browser.");
    steps.push("Navigate to a target HTTP site and confirm the extension page or gate appears before target content.");
    steps.push("Exercise an allow path and a decline or validation path.");
  }
  if (taskClass === "cli") {
    steps.push("Invoke the actual CLI or package script entrypoint with valid arguments.");
    steps.push("Invoke the CLI with invalid or missing arguments and verify exit code and message.");
  }
  if (taskClass === "api") {
    steps.push("Make a real local request against the endpoint or service boundary.");
    steps.push("Make an invalid, unauthorized, or not-found request when relevant.");
  }
  if (taskClass === "data-pipeline") {
    steps.push("Run the pipeline on a representative local fixture.");
    steps.push("Validate generated artifacts and the manifest or status output.");
  }
  if (steps.length < 3) {
    steps.push("Perform the requested behavior from the user's point of view.");
    steps.push("Observe the expected result and at least one relevant failure or edge path when applicable.");
  }

  return [{
    id: "F1",
    actor: "target user",
    goal: task,
    steps,
    negativePath: negativePathFor({ taskClass, cues }),
    expectedOutcome: expectedOutcomeForCues({ taskClass, cues })
  }];
}

function buildRequiredTests({ taskClass, cues, scriptCommands }) {
  const tests = [];
  if (scriptCommands.test) {
    tests.push({
      id: "T1",
      type: "repo-native-check",
      command: scriptCommands.test,
      description: "Run the repo's automated test suite after implementation.",
      requirementIds: ["R1", "R2", "R3"]
    });
  } else {
    tests.push({
      id: "T1",
      type: "repo-native-check",
      command: null,
      description: "Run the repo-native test, lint, typecheck, or build command discovered during inspection.",
      requirementIds: ["R1", "R2", "R3"]
    });
  }

  if (scriptCommands.e2e) {
    tests.push({
      id: "T2",
      type: "browser-e2e",
      command: cues.includes("browse")
        ? `${scriptCommands.e2e} e2e/browse-to-purchase.spec.ts`
        : scriptCommands.e2e,
      description: "Run the browser e2e coverage that exercises the user-facing flow.",
      requirementIds: ["R2", "R3", "R4"]
    });
  }

  if (scriptCommands.build && (taskClass === "browser-extension" || taskClass === "web-ui")) {
    tests.push({
      id: `T${tests.length + 1}`,
      type: "build",
      command: scriptCommands.build,
      description: "Build the routed or packaged surface when the changed behavior depends on bundling.",
      requirementIds: ["R2", "R4"]
    });
  }

  if (scriptCommands.smokeBrowse || scriptCommands.smoke) {
    tests.push({
      id: `T${tests.length + 1}`,
      type: "user-smoke",
      command: scriptCommands.smokeBrowse || scriptCommands.smoke,
      description: "Run the repo's smoke check against the local app surface.",
      requirementIds: ["R2", "R4"]
    });
  } else {
    tests.push({
      id: `T${tests.length + 1}`,
      type: "user-smoke",
      command: null,
      description: "Exercise the user-facing flow described by F1 with a browser, CLI, API client, or documented manual artifact.",
      requirementIds: ["R2", "R4"]
    });
  }

  tests.push({
    id: `T${tests.length + 1}`,
    type: "negative-or-edge-path",
    command: null,
    description: negativePathFor({ taskClass, cues }),
    requirementIds: ["R3", "R5"]
  });

  return tests;
}

function inferTaskCues(task) {
  const text = task.toLowerCase();
  const cues = [];
  if (/\bchrome extension|browser extension|extension\b|manifest|service worker|background script|content script/.test(text)) {
    cues.push("browser-extension");
  }
  if (/\bgate|ask before|before opening|open this site|blocked page/.test(text)) {
    cues.push("gate");
  }
  if (/\ballow|1 ?min|5 ?min|minute|duration|custom minutes?/.test(text)) {
    cues.push("allow-duration");
  }
  if (/\bdecline|actually no|block|blocked/.test(text)) {
    cues.push("decline-path");
  }
  if (/\bbrowse|marketplace|offering|course|bundle/.test(text)) {
    cues.push("browse");
  }
  if (/\bsearch|filter|query/.test(text)) {
    cues.push("search");
  }
  if (/\bempty|no[- ]?result|no offerings|unavailable|not found/.test(text)) {
    cues.push("empty-state");
  }
  if (/\breset|clear|back to|visible offerings/.test(text)) {
    cues.push("reset-action");
  }
  if (/\bcheckout|purchase|stripe|paywall/.test(text)) {
    cues.push("checkout");
  }
  if (/\bcli|command|argument|stdin|stdout|stderr|exit code|terminal|script|local tool\b/.test(text)) {
    cues.push("cli");
  }
  if (/\bapi|endpoint|request|response|http|route|auth|status code/.test(text)) {
    cues.push("api");
  }
  if (/\bocr|pdf|csv|xlsx|pipeline|manifest|generated artifact|import|export|fixture/.test(text)) {
    cues.push("data-pipeline");
  }
  if (/\bvoice|parser|parse|wake word|transcript|control command/.test(text)) {
    cues.push("voice-control");
  }
  return cues;
}

function inferTaskClass({ cues }) {
  if (cues.includes("browser-extension")) {
    return "browser-extension";
  }
  if (cues.includes("browse") || cues.includes("checkout") || cues.includes("empty-state")) {
    return "web-ui";
  }
  if (cues.includes("api")) {
    return "api";
  }
  if (cues.includes("data-pipeline")) {
    return "data-pipeline";
  }
  if (cues.includes("cli") || cues.includes("voice-control")) {
    return "cli";
  }
  return "unknown";
}

function specificityLevelFor({ taskClass, cues, scriptCommands }) {
  const hasConcreteScript = Boolean(scriptCommands.test || scriptCommands.e2e || scriptCommands.smoke || scriptCommands.smokeBrowse);
  if (taskClass !== "unknown" && cues.length >= 3 && hasConcreteScript) {
    return 3;
  }
  if (taskClass !== "unknown" || hasConcreteScript) {
    return 2;
  }
  return 1;
}

function inferTargetSurfaces({ taskClass, cues }) {
  if (taskClass === "browser-extension") {
    return ["manifest", "background-or-service-worker", "extension-page", "target-tab-navigation"];
  }
  if (taskClass === "web-ui") {
    return cues.includes("browse") ? ["browse-route", "browser-dom", "local-dev-server"] : ["browser-route", "local-dev-server"];
  }
  if (taskClass === "cli") {
    return ["cli-entrypoint", "stdout-stderr-exit-code"];
  }
  if (taskClass === "api") {
    return ["http-endpoint", "request-response"];
  }
  if (taskClass === "data-pipeline") {
    return ["input-fixture", "generated-artifacts", "manifest-or-status-output"];
  }
  return ["repo-local-surface-to-be-discovered"];
}

function inferPrimaryInputs(cues) {
  const inputs = [];
  if (cues.includes("search")) {
    inputs.push("search query with no matching result");
  }
  if (cues.includes("allow-duration")) {
    inputs.push("allow duration option or custom minutes");
  }
  if (cues.includes("cli")) {
    inputs.push("CLI arguments");
  }
  if (cues.includes("api")) {
    inputs.push("HTTP request body, params, or auth state");
  }
  if (cues.includes("data-pipeline")) {
    inputs.push("representative input fixture");
  }
  return inputs.length > 0 ? inputs : ["task-specific input to be discovered during repo inspection"];
}

function inferExpectedOutputs({ taskClass, cues }) {
  if (cues.includes("empty-state") && cues.includes("reset-action")) {
    return ["clear no-results empty state", "reset action restores visible offerings"];
  }
  if (taskClass === "browser-extension") {
    return ["extension gate or page appears before target content", "allow path opens target", "decline or validation path blocks or stays on extension page"];
  }
  if (taskClass === "cli") {
    return ["expected stdout/stderr", "expected exit code", "expected file effects when relevant"];
  }
  if (taskClass === "api") {
    return ["expected response status", "expected response body", "expected error response"];
  }
  if (taskClass === "data-pipeline") {
    return ["validated generated files", "manifest/status row", "quality or searchable-content evidence when relevant"];
  }
  return ["observable requested behavior"];
}

function inferEdgePaths({ taskClass, cues }) {
  return [negativePathFor({ taskClass, cues })];
}

function buildNonRequirements({ taskClass, cues }) {
  const items = [
    {
      id: "N1",
      text: "Do not deploy, publish, send external messages, or mutate production systems unless a later task explicitly asks for that."
    },
    {
      id: "N2",
      text: "Do not broaden the request into unrelated refactors or framework migrations."
    },
    {
      id: "N3",
      text: "Do not read, print, or summarize secret env files as part of this task packet."
    }
  ];
  if (taskClass === "browser-extension") {
    items.push({
      id: `N${items.length + 1}`,
      text: "Do not publish the extension or broaden host permissions beyond the requested local verification scope."
    });
  }
  if (cues.includes("checkout")) {
    items.push({
      id: `N${items.length + 1}`,
      text: "Do not change checkout pricing, payment provider behavior, or live Stripe configuration unless explicitly requested."
    });
  }
  return items;
}

function buildRisks({ taskClass, cues, repoProfile }) {
  const risks = [
    {
      id: "K1",
      text: "The repo stack and test commands may be unknown before deeper inspection.",
      mitigation: "Require repo inspection evidence before edits and leave commands pending until discovered."
    },
    {
      id: "K2",
      text: "Generic green tests may miss the user-visible behavior.",
      mitigation: "Require a user-surface smoke proof obligation."
    },
    {
      id: "K3",
      text: "The final answer may overclaim completion after partial checks.",
      mitigation: "Require final claims to cite evidence and residual risk."
    }
  ];
  if (taskClass === "browser-extension") {
    risks.push({
      id: "K4",
      text: "Syntax checks can pass while the unpacked extension fails in a real browser.",
      mitigation: "Require browser-extension smoke or an equivalent CDP artifact."
    });
  }
  if (taskClass === "web-ui") {
    risks.push({
      id: "K4",
      text: "Build or unit tests can pass while the actual route remains broken.",
      mitigation: "Require browser-surface proof for the requested route or flow."
    });
  }
  if (taskClass === "data-pipeline") {
    risks.push({
      id: "K4",
      text: "Generated files can exist but still be low quality, incomplete, or unsearchable.",
      mitigation: "Require output validation beyond existence."
    });
  }
  if (cues.includes("checkout") || getScriptNames(repoProfile).some((script) => /deploy|publish|send|migrat|seed/i.test(script))) {
    risks.push({
      id: `K${risks.length + 1}`,
      text: "The repo may contain live-system, payment, deploy, send, or migration scripts.",
      mitigation: "Treat those commands as approval-required and do not include them as default proof commands."
    });
  }
  return risks;
}

function inferScriptCommands(repoProfile) {
  const scripts = new Set(getScriptNames(repoProfile));
  const runner = scriptRunner(repoProfile.package.managerGuess || repoProfile.package.manager);
  return {
    dev: scripts.has("dev:clean") ? `${runner} dev:clean` : scripts.has("dev") ? `${runner} dev` : null,
    test: scripts.has("test") ? `${runner} test` : null,
    e2e: scripts.has("test:e2e") ? `${runner} test:e2e` : null,
    smoke: scripts.has("smoke") ? `${runner} smoke` : null,
    smokeBrowse: scripts.has("smoke:browse") ? `BASE_URL=http://127.0.0.1:3001 ${runner} smoke:browse` : null,
    build: scripts.has("build") ? `${runner} build` : null,
    lint: scripts.has("lint") ? `${runner} lint` : null
  };
}

function getScriptNames(repoProfile) {
  const scripts = repoProfile.package?.scripts || [];
  if (Array.isArray(scripts)) {
    return [...scripts].sort();
  }
  if (scripts && typeof scripts === "object") {
    return Object.keys(scripts).sort();
  }
  return repoProfile.package?.scriptNames || [];
}

function scriptRunner(packageManager) {
  if (packageManager === "pnpm") {
    return "pnpm run";
  }
  if (packageManager === "yarn") {
    return "yarn";
  }
  if (packageManager === "bun") {
    return "bun run";
  }
  return "npm run";
}

function negativePathFor({ taskClass, cues }) {
  if (cues.includes("search") && cues.includes("empty-state")) {
    return "Use a no-match input such as `zzzzxqwerty999` and verify the empty state plus recovery path.";
  }
  if (taskClass === "browser-extension") {
    return "Exercise decline, invalid custom minutes, blocked target, or permission behavior through the unpacked extension.";
  }
  if (taskClass === "cli") {
    return "Invoke invalid or missing arguments and verify nonzero exit or clear usage output.";
  }
  if (taskClass === "api") {
    return "Send invalid, unauthorized, not-found, or conflict input and verify status and response body.";
  }
  if (taskClass === "data-pipeline") {
    return "Run a malformed, missing, low-quality, or uncertain fixture and verify manifest/status handling.";
  }
  return "Identify and exercise a relevant edge, failure, or regression path implied by the task.";
}

function expectedOutcomeForCues({ taskClass, cues }) {
  if (cues.includes("search") && cues.includes("empty-state") && cues.includes("reset-action")) {
    return "A no-results search shows a clear empty state, the reset action restores visible offerings, and the page does not crash or remain stuck loading.";
  }
  if (taskClass === "browser-extension") {
    return "The extension behavior is proven in an unpacked browser context, including allow and decline or validation paths.";
  }
  if (taskClass === "cli") {
    return "The real CLI entrypoint returns the expected output and exit code for valid and invalid input.";
  }
  if (taskClass === "api") {
    return "The endpoint returns expected success and failure responses through real request/response proof.";
  }
  if (taskClass === "data-pipeline") {
    return "The pipeline produces validated artifacts and handles bad or uncertain inputs explicitly.";
  }
  if (cues.includes("browse")) {
    return "The browse flow works without runtime errors, and the requested state is visible through the browser surface.";
  }
  return "The requested behavior works without runtime errors, and failures are handled visibly when the request implies validation or blocking.";
}

function buildProofPlan({ runId, createdAt, spec }) {
  const obligations = spec.proofObligations.map((obligation) => ({
    id: obligation.id,
    statement: proofStatementFor(obligation.id, spec),
    requirementIds: obligation.requirementIds,
    acceptedEvidenceTypes: acceptedEvidenceTypesFor(obligation.id, spec.taskClass),
    minimumEvidence: 1,
    status: "pending"
  }));
  return {
    schemaVersion: 1,
    kind: "meta-harness.proof-plan",
    runId,
    createdAt,
    milestone: "M3 Run Envelope",
    taskClass: spec.taskClass,
    obligations,
    requirementCoverage: spec.requirements.map((requirement) => ({
      requirementId: requirement.id,
      proofObligationIds: requirement.proofObligationIds
    }))
  };
}

function proofStatementFor(proofId, spec) {
  if (proofId === "P1") {
    return "Repository inspection happened before implementation edits.";
  }
  if (proofId === "P2") {
    return "Automated checks cover the requested behavior and run after the final edit.";
  }
  if (proofId === "P3") {
    return "The negative, validation, or edge path implied by the task is exercised.";
  }
  if (proofId === "P4") {
    return `The ${spec.taskClass} runnable surface is exercised from the user's point of view.`;
  }
  if (proofId === "P5") {
    return "Final report maps every requirement to evidence and residual risk.";
  }
  return "Proof obligation generated from task specification.";
}

function acceptedEvidenceTypesFor(proofId, taskClass) {
  if (proofId === "P1") {
    return ["repo-profile", "inspection-command", "file-read"];
  }
  if (proofId === "P2") {
    return ["test-command", "build-command", "lint-command", "typecheck-command"];
  }
  if (proofId === "P3") {
    return ["negative-test-command", "browser-extension-smoke", "browser-smoke", "api-smoke", "cli-smoke", "manual-smoke-artifact", "data-fixture"];
  }
  if (proofId === "P4") {
    if (taskClass === "browser-extension") {
      return ["browser-extension-smoke", "browser-smoke", "manual-smoke-artifact"];
    }
    if (taskClass === "web-ui") {
      return ["browser-smoke", "screenshot", "trace", "manual-smoke-artifact"];
    }
    if (taskClass === "cli") {
      return ["cli-smoke", "command-output"];
    }
    if (taskClass === "api") {
      return ["api-smoke", "request-response"];
    }
    if (taskClass === "data-pipeline") {
      return ["data-fixture", "generated-artifact", "manifest"];
    }
    return ["browser-smoke", "api-smoke", "cli-smoke", "manual-smoke-artifact"];
  }
  if (proofId === "P5") {
    return ["final-report"];
  }
  return ["manual-smoke-artifact"];
}

function buildAllowedFiles({ runId, createdAt }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.allowed-files",
    runId,
    createdAt,
    mode: "initial-bounds-before-implementation-plan",
    artifactRoot: `.task-runs/${runId}`,
    allowedPatterns: ["**/*"],
    forbiddenPatterns: [
      ".git/**",
      ".env",
      ".env.*",
      "node_modules/**",
      "**/*.pem",
      "**/*.key",
      "**/service-account*.json",
      ".task-runs/**/transcript-secrets/**"
    ],
    requiresJustificationPatterns: [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lockb",
      "vercel.json",
      "firebase.json",
      "migration/**",
      "migrations/**",
      "supabase/migrations/**"
    ],
    notes: [
      "This is a starting boundary for M1/M3, not a final implementation plan.",
      "The later implementation run must narrow allowed paths after repo inspection."
    ]
  };
}

function buildRunnerConfigSeed({ runId, createdAt, repoPath }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.runner-config",
    runId,
    createdAt,
    status: "pending",
    mode: "pending",
    cwd: repoPath,
    command: [],
    sandbox: {
      mode: "pending",
      networkAccess: "unknown",
      filesystem: "target-repo"
    },
    timeouts: {
      idleMs: null,
      commandMs: null,
      totalMs: null
    },
    capture: {
      transcript: "pending",
      commandLog: "pending",
      diff: "pending",
      changedFiles: "pending",
      terminalState: "pending"
    },
    promptSources: [
      "task.md",
      "repo-profile.json",
      "spec.json",
      "proof-plan.json",
      "allowed-files.json",
      "docs/fresh-repo-feature-protocol.md",
      "AGENTS.md"
    ],
    note: "M4 has not executed a runner yet."
  };
}

function buildChangedFilesSeed({ runId, createdAt }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.changed-files",
    runId,
    createdAt,
    status: "pending",
    files: [],
    note: "No implementation has run yet. M4 will replace this with captured changed-file metadata."
  };
}

function buildRunnerStateSeed({ runId, createdAt, repoPath }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.runner-state",
    runId,
    createdAt,
    updatedAt: createdAt,
    status: "pending",
    mode: "pending",
    cwd: repoPath,
    process: {
      pid: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      interrupted: false
    },
    terminalState: {
      cwd: repoPath,
      exitCode: null,
      signal: null,
      reason: "not-started",
      stdoutPath: null,
      stderrPath: null
    },
    counters: {
      transcriptEntries: 0,
      commandEntries: 0,
      changedFiles: 0,
      events: 0
    },
    failures: [],
    warnings: [],
    captureCompleteness: {
      transcript: "pending",
      commandLog: "pending",
      diff: "pending",
      changedFiles: "pending",
      terminalState: "pending"
    },
    note: "No runner process has executed yet."
  };
}

function buildVerificationSeed({ runId, createdAt, spec, proofPlan }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.verification",
    runId,
    createdAt,
    status: "pending",
    commands: [],
    evidence: [],
    requirementCoverage: spec.requirements.map((requirement) => ({
      requirementId: requirement.id,
      status: "pending",
      proofObligationIds: requirement.proofObligationIds
    })),
    proofObligations: proofPlan.obligations.map((obligation) => ({
      id: obligation.id,
      status: "pending",
      evidence: []
    }))
  };
}

function buildVerifierReportSeed({ runId, createdAt }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.verifier-report",
    runId,
    createdAt,
    status: "pending",
    findings: [],
    decisionRecommendation: "pending",
    note: "No completed run has been independently verified yet."
  };
}

function buildPolicyDecisionSeed({ runId, createdAt }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.policy-decision",
    runId,
    createdAt,
    decision: "pending",
    blockingRules: [],
    warnings: [],
    overrides: [],
    note: "No policy decision can be made before verification and independent review."
  };
}

function buildFinalReportSeed({ runId, createdAt, spec, proofPlan }) {
  return {
    schemaVersion: 1,
    kind: "meta-harness.final-report",
    runId,
    createdAt,
    outcome: "pending",
    claims: {
      repoInspection: { status: "pending", requirementIds: ["R1"], evidence: [] },
      implementation: { status: "pending", requirementIds: ["R2"], evidence: [] },
      negativeOrEdgePath: { status: "pending", requirementIds: ["R3"], evidence: [] },
      automatedVerification: { status: "pending", requirementIds: ["R4"], evidence: [] },
      userSmoke: { status: "pending", requirementIds: ["R5"], evidence: [] },
      requirementMapping: { status: "pending", requirementIds: ["R6"], evidence: [] }
    },
    proofObligations: Object.fromEntries(
      proofPlan.obligations.map((obligation) => [obligation.id, { status: "pending", evidence: [] }])
    ),
    requirementResults: spec.requirements.map((requirement) => ({
      requirementId: requirement.id,
      status: "pending",
      evidence: []
    })),
    residualRisk: [
      "Implementation has not started. This packet only freezes the task and required proof."
    ],
    stillUnenforced: [
      "No Codex runner has executed yet.",
      "No implementation diff exists yet.",
      "No verification command has run yet.",
      "No independent verifier has accepted a completed run yet.",
      "No policy engine has accepted or rejected the run yet."
    ]
  };
}

function buildSeedEvents({ runId, createdAt, repoProfile }) {
  return [
    {
      id: "event.run-created",
      type: "harness-event",
      phase: "init",
      status: "passed",
      timestamp: createdAt,
      message: "Run envelope created."
    },
    {
      id: "event.repo-profile",
      type: "artifact",
      phase: "inspect",
      status: "passed",
      timestamp: createdAt,
      artifact: "repo-profile.json",
      message: `Minimal repo profile captured for ${repoProfile.root.name}.`
    },
    {
      id: "event.task-packet",
      type: "artifact",
      phase: "compile",
      status: "passed",
      timestamp: createdAt,
      artifact: "spec.json",
      message: "Task request compiled into frozen requirements and proof obligations."
    }
  ];
}

function validateRepoProfile(repoProfile, errors) {
  if (!repoProfile) {
    return;
  }
  requireSchema(repoProfile, "repo-profile", errors);
  if (repoProfile.kind !== "meta-harness.repo-profile") {
    errors.push(error("repo-profile.kind", "repo-profile.json has the wrong kind."));
  }
  if (repoProfile.adapterStatus !== "m2-core") {
    errors.push(error("repo-profile.adapter-status", "repo-profile.json must be produced by the M2 core profiler."));
  }
  if (!repoProfile.repoPath) {
    errors.push(error("repo-profile.repo-path", "repo-profile.json must include repoPath."));
  }
  if (!repoProfile.package || typeof repoProfile.package !== "object") {
    errors.push(error("repo-profile.package", "repo-profile.json must include package profile."));
  } else {
    if (!Array.isArray(repoProfile.package.managerSignals)) {
      errors.push(error("repo-profile.package.manager-signals", "package.managerSignals must be an array."));
    }
    if (!repoProfile.package.scripts || typeof repoProfile.package.scripts !== "object" || Array.isArray(repoProfile.package.scripts)) {
      errors.push(error("repo-profile.package.scripts", "package.scripts must be an object mapping names to commands."));
    }
    if (!Array.isArray(repoProfile.package.scriptClassifications)) {
      errors.push(error("repo-profile.package.script-classifications", "package.scriptClassifications must be an array."));
    }
  }
  if (!Array.isArray(repoProfile.frameworkSignals)) {
    errors.push(error("repo-profile.framework-signals", "frameworkSignals must be an array."));
  }
  if (!Array.isArray(repoProfile.testSignals)) {
    errors.push(error("repo-profile.test-signals", "testSignals must be an array."));
  }
  if (!repoProfile.devServer || !Array.isArray(repoProfile.devServer.candidates)) {
    errors.push(error("repo-profile.dev-server", "devServer.candidates must be present."));
  }
  if (!repoProfile.surfaces || typeof repoProfile.surfaces !== "object") {
    errors.push(error("repo-profile.surfaces", "surfaces must be present."));
  }
  if (!repoProfile.sensitivePathPolicy || repoProfile.sensitivePathPolicy.contentsRead !== false) {
    errors.push(error("repo-profile.sensitive-path-policy", "sensitivePathPolicy must declare that secret contents were not read."));
  }
  if (!Array.isArray(repoProfile.liveSystemRisks)) {
    errors.push(error("repo-profile.live-system-risks", "liveSystemRisks must be an array."));
  }
}

function validateSpec(spec, proofPlan, errors) {
  if (!spec) {
    return;
  }
  requireSchema(spec, "spec", errors);
  if (spec.kind !== "meta-harness.task-spec") {
    errors.push(error("spec.kind", "spec.json has the wrong kind."));
  }
  if (!spec.task?.raw || spec.task.raw.length < 10) {
    errors.push(error("spec.task.raw", "spec.task.raw must preserve the feature request."));
  }
  if (!spec.taskClass || typeof spec.taskClass !== "string") {
    errors.push(error("spec.task-class.missing", "spec.taskClass is required."));
  }
  if (!Number.isInteger(spec.compiler?.specificityLevel) || spec.compiler.specificityLevel < 1) {
    errors.push(error("spec.specificity-level.missing", "spec.compiler.specificityLevel must be a positive integer."));
  }
  const requirements = Array.isArray(spec.requirements) ? spec.requirements : [];
  if (requirements.length === 0) {
    errors.push(error("spec.requirements.missing", "spec.requirements must be a non-empty array."));
  }
  if (!Array.isArray(spec.nonRequirements) || spec.nonRequirements.length === 0) {
    errors.push(error("spec.non-requirements.missing", "spec.nonRequirements must be a non-empty array."));
  }
  if (!Array.isArray(spec.risks) || spec.risks.length === 0) {
    errors.push(error("spec.risks.missing", "spec.risks must be a non-empty array."));
  }
  if (!Array.isArray(spec.userFlows) || spec.userFlows.length === 0) {
    errors.push(error("spec.user-flows.missing", "spec.userFlows must be a non-empty array."));
  }
  if (!Array.isArray(spec.requiredTests) || spec.requiredTests.length === 0) {
    errors.push(error("spec.required-tests.missing", "spec.requiredTests must be a non-empty array."));
  }
  if (!spec.manualSmoke?.id) {
    errors.push(error("spec.manual-smoke.missing", "spec.manualSmoke is required."));
  }
  const obligationIds = new Set((proofPlan?.obligations || []).map((obligation) => obligation.id));
  const seenRequirementIds = new Set();
  for (const requirement of requirements) {
    if (!requirement.id || seenRequirementIds.has(requirement.id)) {
      errors.push(error("spec.requirement.id", "Every requirement must have a unique id."));
    }
    seenRequirementIds.add(requirement.id);
    if (!requirement.text) {
      errors.push(error("spec.requirement.text", `Requirement ${requirement.id || "(missing id)"} must include text.`));
    }
    if (!Array.isArray(requirement.proofObligationIds) || requirement.proofObligationIds.length === 0) {
      errors.push(error("spec.requirement.unmapped", `Requirement ${requirement.id} must map to at least one proof obligation.`));
      continue;
    }
    for (const proofId of requirement.proofObligationIds) {
      if (proofPlan && !obligationIds.has(proofId)) {
        errors.push(error("spec.requirement.unknown-proof", `Requirement ${requirement.id} references unknown proof obligation ${proofId}.`));
      }
    }
  }
  validateSpecProofObligations(spec, proofPlan, errors);
  validateSpecSpecificity(spec, errors);
}

function validateSpecProofObligations(spec, proofPlan, errors) {
  const specProofObligations = Array.isArray(spec.proofObligations) ? spec.proofObligations : [];
  if (specProofObligations.length === 0) {
    errors.push(error("spec.proof-obligations.missing", "spec.proofObligations must be a non-empty array."));
    return;
  }
  const proofPlanIds = new Set((proofPlan?.obligations || []).map((obligation) => obligation.id));
  for (const obligation of specProofObligations) {
    if (!obligation.id) {
      errors.push(error("spec.proof-obligation.id", "Every spec proof obligation must include an id."));
      continue;
    }
    if (proofPlan && !proofPlanIds.has(obligation.id)) {
      errors.push(error("spec.proof-obligation.not-in-plan", `Spec proof obligation ${obligation.id} is missing from proof-plan.json.`));
    }
    if (!Array.isArray(obligation.requirementIds) || obligation.requirementIds.length === 0) {
      errors.push(error("spec.proof-obligation.requirements", `Spec proof obligation ${obligation.id} must map to requirements.`));
    }
  }
}

function validateSpecSpecificity(spec, errors) {
  const cues = spec.repoSignals?.inferredTaskCues || [];
  const scripts = spec.repoSignals?.availableScripts || [];
  const requirementText = (spec.requirements || []).map((requirement) => requirement.text || "").join("\n").toLowerCase();
  const flowText = (spec.userFlows || []).flatMap((flow) => [...(flow.steps || []), flow.negativePath || "", flow.expectedOutcome || ""]).join("\n").toLowerCase();
  const requiredTestCommands = (spec.requiredTests || []).map((item) => item.command || "").join("\n");

  if (cues.length > 0 && /implement the requested behavior:/.test(requirementText)) {
    errors.push(error("spec.specificity.generic-requirement", "Concrete task cues cannot be compiled into a generic implementation requirement."));
  }
  if (cues.includes("empty-state") && !/(empty|no-results|no result|no-match|unavailable|not found)/.test(requirementText)) {
    errors.push(error("spec.specificity.empty-state", "Empty-state tasks must name the no-results or unavailable-content requirement."));
  }
  if (cues.includes("reset-action") && !/(reset|clear|restore|visible offerings|recovery)/.test(requirementText)) {
    errors.push(error("spec.specificity.reset-action", "Reset-action tasks must name the reset or recovery requirement."));
  }
  if (cues.includes("browser-extension") && !/(extension|manifest|background|service worker|chrome api|unpacked)/.test(requirementText)) {
    errors.push(error("spec.specificity.browser-extension", "Browser-extension tasks must name extension-specific surfaces."));
  }
  if ((cues.includes("search") || cues.includes("decline-path") || cues.includes("allow-duration") || spec.taskClass === "cli" || spec.taskClass === "api") && !/(negative|invalid|decline|no-match|no-results|missing|failure|edge)/.test(flowText)) {
    errors.push(error("spec.specificity.negative-path", "Tasks with inputs, choices, or validation must include a negative or edge path."));
  }
  if (scripts.includes("test") && !/\b(?:npm|pnpm|yarn|bun)(?: run)? test\b/.test(requiredTestCommands)) {
    errors.push(error("spec.required-tests.missing-script", "Repo script `test` exists but is missing from requiredTests."));
  }
  if (scripts.includes("test:e2e") && !/test:e2e/.test(requiredTestCommands)) {
    errors.push(error("spec.required-tests.missing-e2e", "Repo script `test:e2e` exists but is missing from requiredTests."));
  }
  if (scripts.includes("smoke:browse") && !/smoke:browse/.test(requiredTestCommands)) {
    errors.push(error("spec.required-tests.missing-smoke-browse", "Repo script `smoke:browse` exists but is missing from requiredTests."));
  }
  if ((spec.taskClass === "web-ui" || spec.taskClass === "browser-extension") && !(spec.requiredTests || []).some((item) => item.type === "user-smoke")) {
    errors.push(error("spec.required-tests.user-smoke", "User-facing web and extension tasks must require a user-smoke test."));
  }
}

function validateProofPlan(proofPlan, spec, errors) {
  if (!proofPlan) {
    return;
  }
  requireSchema(proofPlan, "proof-plan", errors);
  if (proofPlan.kind !== "meta-harness.proof-plan") {
    errors.push(error("proof-plan.kind", "proof-plan.json has the wrong kind."));
  }
  const obligations = Array.isArray(proofPlan.obligations) ? proofPlan.obligations : [];
  if (obligations.length === 0) {
    errors.push(error("proof-plan.obligations.missing", "proof-plan.obligations must be a non-empty array."));
  }
  const requirementIds = new Set((spec?.requirements || []).map((requirement) => requirement.id));
  const seenObligationIds = new Set();
  for (const obligation of obligations) {
    if (!obligation.id || seenObligationIds.has(obligation.id)) {
      errors.push(error("proof-plan.obligation.id", "Every proof obligation must have a unique id."));
    }
    seenObligationIds.add(obligation.id);
    if (!obligation.statement) {
      errors.push(error("proof-plan.obligation.statement", `Proof obligation ${obligation.id || "(missing id)"} must include statement.`));
    }
    if (!Array.isArray(obligation.requirementIds) || obligation.requirementIds.length === 0) {
      errors.push(error("proof-plan.obligation.requirements", `Proof obligation ${obligation.id} must map to requirements.`));
    } else {
      for (const requirementId of obligation.requirementIds) {
        if (spec && !requirementIds.has(requirementId)) {
          errors.push(error("proof-plan.unknown-requirement", `Proof obligation ${obligation.id} references unknown requirement ${requirementId}.`));
        }
      }
    }
    if (!Array.isArray(obligation.acceptedEvidenceTypes) || obligation.acceptedEvidenceTypes.length === 0) {
      errors.push(error("proof-plan.evidence-types", `Proof obligation ${obligation.id} must declare accepted evidence types.`));
    }
    if (!Number.isInteger(obligation.minimumEvidence) || obligation.minimumEvidence < 1) {
      errors.push(error("proof-plan.minimum-evidence", `Proof obligation ${obligation.id} must require at least one evidence item.`));
    }
  }
}

function validateAllowedFiles(allowedFiles, runId, errors) {
  if (!allowedFiles) {
    return;
  }
  requireSchema(allowedFiles, "allowed-files", errors);
  if (allowedFiles.kind !== "meta-harness.allowed-files") {
    errors.push(error("allowed-files.kind", "allowed-files.json has the wrong kind."));
  }
  const forbidden = Array.isArray(allowedFiles.forbiddenPatterns) ? allowedFiles.forbiddenPatterns : [];
  for (const requiredPattern of [".git/**", ".env", ".env.*", "node_modules/**"]) {
    if (!forbidden.includes(requiredPattern)) {
      errors.push(error("allowed-files.forbidden-pattern", `allowed-files.json must forbid ${requiredPattern}.`));
    }
  }
  if (runId && allowedFiles.artifactRoot !== `.task-runs/${runId}`) {
    errors.push(error("allowed-files.artifact-root", "allowed-files.artifactRoot must point at this run directory."));
  }
}

function validateRunnerConfig(runnerConfig, errors) {
  if (!runnerConfig) {
    return;
  }
  requireSchema(runnerConfig, "runner-config", errors);
  if (runnerConfig.kind !== "meta-harness.runner-config") {
    errors.push(error("runner-config.kind", "runner-config.json has the wrong kind."));
  }
  if (!["pending", "captured"].includes(runnerConfig.status)) {
    errors.push(error("runner-config.status", "runner-config.status must be pending or captured."));
  }
  if (!["pending", "fake-codex", "codex-cli"].includes(runnerConfig.mode)) {
    errors.push(error("runner-config.mode", "runner-config.mode must be pending, fake-codex, or codex-cli."));
  }
  if (!runnerConfig.cwd || typeof runnerConfig.cwd !== "string") {
    errors.push(error("runner-config.cwd", "runner-config.cwd must record the execution working directory."));
  }
  if (!Array.isArray(runnerConfig.command)) {
    errors.push(error("runner-config.command", "runner-config.command must be an array."));
  }
  if (runnerConfig.status === "captured" && runnerConfig.command.length === 0) {
    errors.push(error("runner-config.command.missing", "Captured runner-config.json must record the executed command."));
  }
}

function validateEvents(events, errors) {
  const eventIds = new Set(events.map((event) => event.id));
  for (const requiredEvent of ["event.run-created", "event.repo-profile", "event.task-packet"]) {
    if (!eventIds.has(requiredEvent)) {
      errors.push(error("events.missing-seed", `events.jsonl missing seed event ${requiredEvent}.`));
    }
  }
}

function validateCommandLog(commandLog, errors) {
  for (const [index, entry] of commandLog.entries()) {
    if (!entry.id || !entry.command || !entry.phase) {
      errors.push(error("command-log.entry", `command-log.jsonl entry ${index + 1} must include id, command, and phase.`));
    }
  }
}

function validateTranscript(transcript, errors) {
  for (const [index, entry] of transcript.entries()) {
    if (!entry.id || !entry.type) {
      errors.push(error("transcript.entry", `transcript.jsonl entry ${index + 1} must include id and type.`));
    }
  }
}

function validateChangedFiles(changedFiles, errors) {
  if (!changedFiles) {
    return;
  }
  requireSchema(changedFiles, "changed-files", errors);
  if (changedFiles.kind !== "meta-harness.changed-files") {
    errors.push(error("changed-files.kind", "changed-files.json has the wrong kind."));
  }
  if (!["pending", "captured"].includes(changedFiles.status)) {
    errors.push(error("changed-files.status", "changed-files.status must be pending or captured."));
  }
  if (!Array.isArray(changedFiles.files)) {
    errors.push(error("changed-files.files", "changed-files.files must be an array."));
  }
  if (changedFiles.status === "pending" && Array.isArray(changedFiles.files) && changedFiles.files.length > 0) {
    errors.push(error("changed-files.pending-with-files", "changed-files.json cannot be pending while listing changed files."));
  }
  for (const [index, file] of (changedFiles.files || []).entries()) {
    if (!file.path || !file.status) {
      errors.push(error("changed-files.file-entry", `changed-files.json entry ${index + 1} must include path and status.`));
    }
    if (file.path && (file.path.includes("..") || file.path.startsWith("/") || file.path.includes("\\"))) {
      errors.push(error("changed-files.file-path", `changed-files.json entry ${index + 1} has an unsafe path.`));
    }
    if (file.forbidden === true && file.contentCaptured !== false) {
      errors.push(error("changed-files.forbidden-captured", `Forbidden changed file ${file.path} must not capture file contents.`));
    }
  }
}

function validateRunnerState(runnerState, errors) {
  if (!runnerState) {
    return;
  }
  requireSchema(runnerState, "runner-state", errors);
  if (runnerState.kind !== "meta-harness.runner-state") {
    errors.push(error("runner-state.kind", "runner-state.json has the wrong kind."));
  }
  if (!["pending", "implemented", "rejected", "blocked", "interrupted"].includes(runnerState.status)) {
    errors.push(error("runner-state.status", "runner-state.status must be pending, implemented, rejected, blocked, or interrupted."));
  }
  if (!runnerState.process || typeof runnerState.process !== "object" || Array.isArray(runnerState.process)) {
    errors.push(error("runner-state.process", "runner-state.process must record process terminal state."));
  }
  if (!runnerState.terminalState || typeof runnerState.terminalState !== "object" || Array.isArray(runnerState.terminalState)) {
    errors.push(error("runner-state.terminal-state", "runner-state.terminalState must be present."));
  }
  if (!Array.isArray(runnerState.failures)) {
    errors.push(error("runner-state.failures", "runner-state.failures must be an array."));
  }
  if (!Array.isArray(runnerState.warnings)) {
    errors.push(error("runner-state.warnings", "runner-state.warnings must be an array."));
  }
  if (runnerState.status === "implemented" && Array.isArray(runnerState.failures) && runnerState.failures.length > 0) {
    errors.push(error("runner-state.implemented-with-failures", "runner-state.json cannot be implemented while listing failures."));
  }
}

function validatePendingTextArtifact(content, artifact, errors) {
  if (artifact === "diff.patch" && content.trim().length > 0 && !content.includes("diff --git")) {
    errors.push(error("diff.patch.invalid", "diff.patch is non-empty but does not look like a git diff."));
  }
}

function validateVerification(verification, spec, proofPlan, errors) {
  if (!verification) {
    return;
  }
  requireSchema(verification, "verification", errors);
  if (verification.kind !== "meta-harness.verification") {
    errors.push(error("verification.kind", "verification.json has the wrong kind."));
  }
  if (!["pending", "passed", "failed", "blocked"].includes(verification.status)) {
    errors.push(error("verification.status", "verification.status must be pending, passed, failed, or blocked."));
  }
  const commands = Array.isArray(verification.commands) ? verification.commands : [];
  const surfaceResults = Array.isArray(verification.surfaceResults) ? verification.surfaceResults : [];
  const evidence = Array.isArray(verification.evidence) ? verification.evidence : [];
  if (verification.status === "passed" && commands.length === 0 && evidence.length === 0) {
    errors.push(error("verification.fake-pass", "verification.json cannot claim passed without commands or evidence."));
  }
  validateVerificationCommands(commands, errors);
  validateVerificationSurfaceResults(surfaceResults, errors);
  const evidenceById = validateVerificationEvidence(evidence, errors);
  validateVerificationEvidenceMappings(evidence, proofPlan, errors);
  const coverageIds = new Set((verification.requirementCoverage || []).map((item) => item.requirementId));
  for (const requirement of spec?.requirements || []) {
    if (!coverageIds.has(requirement.id)) {
      errors.push(error("verification.coverage.missing", `verification.json missing coverage for ${requirement.id}.`));
    }
  }
  const proofIds = new Set((proofPlan?.obligations || []).map((obligation) => obligation.id));
  for (const proof of verification.proofObligations || []) {
    if (!proofIds.has(proof.id)) {
      errors.push(error("verification.unknown-proof", `verification.json references unknown proof obligation ${proof.id}.`));
    }
    if (proof.status === "passed") {
      if (!Array.isArray(proof.evidence) || proof.evidence.length === 0) {
        errors.push(error("verification.proof-no-evidence", `Passed proof obligation ${proof.id} must cite evidence.`));
      }
      for (const evidenceId of proof.evidence || []) {
        const evidenceItem = evidenceById.get(evidenceId);
        if (!evidenceItem) {
          errors.push(error("verification.unknown-evidence", `Passed proof obligation ${proof.id} cites unknown evidence ${evidenceId}.`));
        } else if (evidenceItem.status !== "passed") {
          errors.push(error("verification.failed-evidence-cited", `Passed proof obligation ${proof.id} cites non-passing evidence ${evidenceId}.`));
        }
      }
    }
  }
}

function validateVerificationCommands(commands, errors) {
  for (const [index, command] of commands.entries()) {
    if (!command.id || !command.status) {
      errors.push(error("verification.command-entry", `verification.commands entry ${index + 1} must include id and status.`));
    }
    if (command.status && !["pending", "passed", "failed", "blocked", "timed-out"].includes(command.status)) {
      errors.push(error("verification.command-status", `verification.commands entry ${command.id || index + 1} has invalid status.`));
    }
  }
}

function validateVerificationSurfaceResults(surfaceResults, errors) {
  for (const [index, result] of surfaceResults.entries()) {
    if (!result.id || !result.status || !result.evidenceType) {
      errors.push(error("verification.surface-entry", `verification.surfaceResults entry ${index + 1} must include id, status, and evidenceType.`));
    }
    if (result.status && !["pending", "passed", "failed", "blocked", "timed-out"].includes(result.status)) {
      errors.push(error("verification.surface-status", `verification.surfaceResults entry ${result.id || index + 1} has invalid status.`));
    }
  }
}

function validateVerificationEvidence(evidence, errors) {
  const evidenceById = new Map();
  for (const [index, evidenceItem] of evidence.entries()) {
    if (!evidenceItem.id || !evidenceItem.type || !evidenceItem.status) {
      errors.push(error("verification.evidence-entry", `verification.evidence entry ${index + 1} must include id, type, and status.`));
      continue;
    }
    if (evidenceById.has(evidenceItem.id)) {
      errors.push(error("verification.evidence-duplicate", `verification.evidence has duplicate id ${evidenceItem.id}.`));
    }
    evidenceById.set(evidenceItem.id, evidenceItem);
    if (!["pending", "passed", "failed", "blocked", "timed-out"].includes(evidenceItem.status)) {
      errors.push(error("verification.evidence-status", `verification.evidence entry ${evidenceItem.id} has invalid status.`));
    }
    if (evidenceItem.status === "passed" && !evidenceItem.path) {
      errors.push(error("verification.evidence-path", `Passed evidence ${evidenceItem.id} must include an artifact path.`));
    }
  }
  return evidenceById;
}

function validateVerificationEvidenceMappings(evidence, proofPlan, errors) {
  const obligationsById = new Map((proofPlan?.obligations || []).map((obligation) => [obligation.id, obligation]));
  for (const evidenceItem of evidence) {
    if (evidenceItem.status !== "passed") {
      continue;
    }
    for (const proofId of evidenceItem.proofObligationIds || []) {
      const obligation = obligationsById.get(proofId);
      if (obligation && !(obligation.acceptedEvidenceTypes || []).includes(evidenceItem.type)) {
        errors.push(error("verification.evidence-type-unaccepted", `Passed evidence ${evidenceItem.id} has type ${evidenceItem.type}, which proof obligation ${proofId} does not accept.`));
      }
    }
  }
}

function validateVerifierReport(verifierReport, errors) {
  if (!verifierReport) {
    return;
  }
  requireSchema(verifierReport, "verifier-report", errors);
  if (verifierReport.kind !== "meta-harness.verifier-report") {
    errors.push(error("verifier-report.kind", "verifier-report.json has the wrong kind."));
  }
  if (!["pending", "passed", "failed", "blocked"].includes(verifierReport.status)) {
    errors.push(error("verifier-report.status", "verifier-report.status must be pending, passed, failed, or blocked."));
  }
  if (!Array.isArray(verifierReport.findings)) {
    errors.push(error("verifier-report.findings", "verifier-report.findings must be an array."));
  }
}

function validatePolicyDecision(policyDecision, errors) {
  if (!policyDecision) {
    return;
  }
  requireSchema(policyDecision, "policy-decision", errors);
  if (policyDecision.kind !== "meta-harness.policy-decision") {
    errors.push(error("policy-decision.kind", "policy-decision.json has the wrong kind."));
  }
  if (!["pending", "accepted", "rejected", "blocked"].includes(policyDecision.decision)) {
    errors.push(error("policy-decision.decision", "policy-decision.decision must be pending, accepted, rejected, or blocked."));
  }
  for (const field of ["blockingRules", "warnings", "overrides"]) {
    if (!Array.isArray(policyDecision[field])) {
      errors.push(error(`policy-decision.${field}`, `policy-decision.${field} must be an array.`));
    }
  }
}

function validateFinalReport(finalReport, spec, proofPlan, verification, errors) {
  if (!finalReport) {
    return;
  }
  requireSchema(finalReport, "final-report", errors);
  if (finalReport.kind !== "meta-harness.final-report") {
    errors.push(error("final-report.kind", "final-report.json has the wrong kind."));
  }
  if (!["pending", "passed", "failed", "blocked"].includes(finalReport.outcome)) {
    errors.push(error("final-report.outcome", "final-report.outcome must be pending, passed, failed, or blocked."));
  }
  if (!finalReport.claims || typeof finalReport.claims !== "object" || Array.isArray(finalReport.claims)) {
    errors.push(error("final-report.claims", "final-report.claims must be an object."));
  }
  if (!Array.isArray(finalReport.residualRisk) || finalReport.residualRisk.length === 0) {
    errors.push(error("final-report.residual-risk", "final-report.residualRisk must be non-empty."));
  }
  const requirementResultIds = new Set((finalReport.requirementResults || []).map((item) => item.requirementId));
  for (const requirement of spec?.requirements || []) {
    if (!requirementResultIds.has(requirement.id)) {
      errors.push(error("final-report.requirement-result", `final-report.json missing requirement result for ${requirement.id}.`));
    }
  }
  const proofResults = finalReport.proofObligations && typeof finalReport.proofObligations === "object" ? finalReport.proofObligations : {};
  for (const obligation of proofPlan?.obligations || []) {
    if (!proofResults[obligation.id]) {
      errors.push(error("final-report.proof-result", `final-report.json missing proof obligation result for ${obligation.id}.`));
    }
  }
  if (finalReport.outcome === "passed") {
    if (verification?.status !== "passed") {
      errors.push(error("final-report.passed-without-verification", "final-report.json cannot claim passed unless verification.json is passed."));
    }
    for (const [claimId, claim] of Object.entries(finalReport.claims || {})) {
      if (claim.status !== "passed") {
        errors.push(error("final-report.claim-not-passed", `Passed final report has non-passed claim ${claimId}.`));
      }
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
        errors.push(error("final-report.claim-no-evidence", `Passed final report claim ${claimId} must cite evidence.`));
      }
    }
  }
}

function requireSchema(value, label, errors) {
  if (value.schemaVersion !== 1) {
    errors.push(error(`${label}.schema-version`, `${label}.schemaVersion must be 1.`));
  }
  if (!value.runId) {
    errors.push(error(`${label}.run-id`, `${label}.runId is required.`));
  }
}

function readJsonArtifact(runDir, artifact, errors) {
  const artifactPath = join(runDir, artifact);
  if (!existsSync(artifactPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (readError) {
    errors.push(error("artifact.invalid-json", `${artifact} is not valid JSON: ${readError.message}`, { artifact }));
    return null;
  }
}

function readJsonlArtifact(runDir, artifact, errors) {
  const artifactPath = join(runDir, artifact);
  if (!existsSync(artifactPath)) {
    return [];
  }
  const lines = readFileSync(artifactPath, "utf8").split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch (readError) {
      errors.push(error("artifact.invalid-jsonl", `${artifact}:${index + 1} is not valid JSON: ${readError.message}`, { artifact }));
    }
  }
  return events;
}

function readTextArtifact(runDir, artifact, errors) {
  const artifactPath = join(runDir, artifact);
  if (!existsSync(artifactPath)) {
    return "";
  }
  try {
    return readFileSync(artifactPath, "utf8");
  } catch (readError) {
    errors.push(error("artifact.unreadable", `${artifact} could not be read: ${readError.message}`, { artifact }));
    return "";
  }
}

function renderTaskMarkdown({ runId, task, createdAt, spec }) {
  return `# Task Run ${runId}

Created: ${createdAt}

## Raw Request

${task}

## Frozen Requirements

${spec.requirements.map((requirement) => `- ${requirement.id}: ${requirement.text}`).join("\n")}

## Required Proof

${spec.proofObligations.map((obligation) => `- ${obligation.id}: covers ${obligation.requirementIds.join(", ")}`).join("\n")}

## Stop Rule

This task is not complete until verification artifacts map every requirement to evidence and the final report names residual risk.
`;
}

function titleFromTask(task) {
  return task
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function makeRunId(now, task) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${slugify(task).slice(0, 48) || "task"}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function finish(result) {
  return {
    ...result,
    passed: result.errors.length === 0
  };
}

function error(id, message, details = {}) {
  return { id, message, ...details };
}
