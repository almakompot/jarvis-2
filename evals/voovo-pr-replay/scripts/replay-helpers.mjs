import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { runCommand, writeCommandLog, writeJson } from "./lib.mjs";

export const implementationSectionPattern =
  /(^|\n)\s*(#{1,6}\s*)?(technical detail|root cause|what changed|approach|affected areas|files changed|implementation|migration|config|verification)\b/i;

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function sanitizeRefPart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseNumstat(text) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, path] = line.split("\t");
      return {
        path,
        additions: additions === "-" ? 0 : Number(additions || 0),
        deletions: deletions === "-" ? 0 : Number(deletions || 0),
        binary: additions === "-" || deletions === "-"
      };
    });
}

export function diffStatsFromNumstat(text) {
  const files = parseNumstat(text);
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles: files.length
  };
}

export function selectedStatsMismatch(githubStats, selectedStats) {
  return Boolean(
    githubStats &&
      (Number(githubStats.additions || 0) !== selectedStats.additions ||
        Number(githubStats.deletions || 0) !== selectedStats.deletions ||
        Number(githubStats.changedFiles || 0) !== selectedStats.changedFiles)
  );
}

export function buildCheckPlan(files) {
  const paths = files.map((file) => (typeof file === "string" ? file : file.path)).filter(Boolean);
  const checks = [];
  const manualProofs = [];
  const dartFiles = paths.filter((file) => file.endsWith(".dart"));
  const dartTests = dartFiles.filter((file) => file.startsWith("test/"));
  const analyzableDart = dartFiles.filter((file) => !file.endsWith(".g.dart") && !file.endsWith(".freezed.dart"));
  const functionsFiles = paths.filter((file) => file.startsWith("firebase/functions/"));
  const functionsTests = functionsFiles.filter((file) => /(^|\/)(test|tests)\/.*\.(test\.)?(ts|js)$/.test(file));
  const rulesFiles = paths.filter((file) => file.endsWith(".rules") || file.includes("firestore.rules"));
  const nativeFiles = paths.filter((file) =>
    /(^|\/)(android|ios)\//.test(file) || file.startsWith("packages/") && /\/(android|ios)\//.test(file)
  );

  if (dartTests.length > 0) {
    checks.push({
      name: "flutter-test",
      command: `flutter test ${dartTests.map(shellQuote).join(" ")}`,
      required: true
    });
  }

  if (analyzableDart.length > 0) {
    checks.push({
      name: "flutter-analyze",
      command: `flutter analyze ${analyzableDart.map(shellQuote).join(" ")}`,
      required: true
    });
  }

  if (functionsFiles.length > 0) {
    checks.push({
      name: "functions-build",
      command: "cd firebase/functions && npm run build",
      required: true
    });
  }

  for (const testFile of functionsTests) {
    const relativeTest = testFile.replace(/^firebase\/functions\/src\//, "").replace(/\.ts$/, ".js");
    checks.push({
      name: `functions-test-${slugCheckName(relativeTest)}`,
      command: `cd firebase/functions && npm run build && node --test ${shellQuote(`lib/${relativeTest}`)}`,
      required: true
    });
  }

  if (rulesFiles.length > 0) {
    manualProofs.push({
      name: "firestore-rules-proof",
      required: true,
      description: "Run emulator/rules validation or attach an explicit manual review note for Firestore rules behavior."
    });
  }

  if (nativeFiles.length > 0) {
    manualProofs.push({
      name: "native-device-proof",
      required: true,
      description: "Attach device or platform-specific proof for native Android/iOS behavior that cannot be covered by unit tests."
    });
  }

  if (checks.length === 0) {
    checks.push({
      name: "manual-review",
      command: "printf 'No automatic check planned for this case. See manualProofs in case.json.\\n'",
      required: false
    });
  }

  return { checks: dedupeChecks(checks), manualProofs };
}

export function buildGoalDraft(pr) {
  const body = pr.body || "";
  const safeSections = [
    extractUserImpact(body),
    extractRegressionRisk(body),
    extractSection(body, "Impact"),
    extractSection(body, "Why")
  ].filter(Boolean);
  const context = safeSections.join("\n\n").trim() || pr.title;

  return [
    "# Goal",
    "",
    "This is an auto-generated outcome-only draft. Human review is required before running agents.",
    "",
    "## Desired Outcome",
    "",
    redactImplementationHints(context, pr),
    "",
    "## Done Means",
    "",
    "- the original user-facing or developer-facing problem is fixed",
    "- existing behavior outside the goal is preserved",
    "- the allowed checks in `case.json` are run or explicitly reported as unavailable",
    "- the final answer states verification and remaining risk"
  ].join("\n");
}

export function buildLeakageReport(goal, pr, files = []) {
  const findings = [];
  const goalText = String(goal || "");
  const changedPaths = files.map((file) => (typeof file === "string" ? file : file.path)).filter(Boolean);
  const prUrlPattern = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i;

  if (prUrlPattern.test(goalText)) {
    findings.push({ severity: "block", type: "pr-url", message: "Goal contains a GitHub PR URL." });
  }

  for (const filePath of changedPaths) {
    if (filePath && goalText.includes(filePath)) {
      findings.push({ severity: "block", type: "changed-file-path", message: `Goal contains changed file path: ${filePath}` });
    }
  }

  if (implementationSectionPattern.test(goalText)) {
    findings.push({
      severity: "warn",
      type: "implementation-section-language",
      message: "Goal appears to contain implementation-section language such as root cause, what changed, or technical detail."
    });
  }

  for (const token of implementationTokensFromFiles(changedPaths)) {
    if (token.length >= 8 && new RegExp(`\\b${escapeRegExp(token)}\\b`).test(goalText)) {
      findings.push({ severity: "warn", type: "file-derived-identifier", message: `Goal contains file-derived identifier: ${token}` });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pr: {
      number: pr.number,
      state: pr.state,
      title: pr.title
    },
    changedFileCount: changedPaths.length,
    findings,
    blockingFindings: findings.filter((finding) => finding.severity === "block")
  };
}

export function assertNoBlockingLeakage(caseDir, manifest, allowLeakage = false) {
  if (allowLeakage || !manifest.goal?.leakageReportPath) {
    return;
  }
  const reportPath = resolve(caseDir, manifest.goal.leakageReportPath);
  if (!existsSync(reportPath)) {
    throw new Error(`Missing leakage report: ${reportPath}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if ((report.blockingFindings || []).length > 0) {
    throw new Error(`Refusing to run agents: goal leakage report has ${report.blockingFindings.length} blocking finding(s).`);
  }
}

export function selectPrePrSnapshot({ pr, sourceRepo, baseRemote = "origin", prHeadRef }) {
  const fetchBase = runCommand(
    `git fetch ${shellQuote(baseRemote)} ${shellQuote(`${pr.baseRefName}:refs/remotes/${baseRemote}/${pr.baseRefName}`)}`,
    sourceRepo
  );
  if (fetchBase.status !== 0) {
    return { error: `failed to fetch base branch ${pr.baseRefName}`, fetchBase };
  }

  const fetchHead = runCommand(`git fetch ${shellQuote(baseRemote)} ${shellQuote(`+refs/pull/${pr.number}/head:${prHeadRef}`)}`, sourceRepo);
  if (fetchHead.status !== 0) {
    return { error: `failed to fetch PR head ref ${pr.number}`, fetchBase, fetchHead };
  }

  const head = runCommand(`git rev-parse ${shellQuote(prHeadRef)}`, sourceRepo);
  if (head.status !== 0) {
    return { error: "failed to resolve fetched PR head", fetchBase, fetchHead, head };
  }

  const mergeSha = pr.mergeCommit?.oid || null;
  if (pr.state === "MERGED" && mergeSha) {
    const parents = runCommand(`git show -s --format=%P ${shellQuote(mergeSha)}`, sourceRepo);
    if (parents.status === 0) {
      const [firstParent] = parents.stdout.trim().split(/\s+/).filter(Boolean);
      if (firstParent) {
        return {
          preSha: firstParent,
          headSha: head.stdout.trim(),
          mergeSha,
          preMethod: `merge commit first parent (${mergeSha}^1)`,
          prHeadRef,
          snapshotSensitive: false,
          logs: { fetchBase, fetchHead, parents }
        };
      }
    }
  }

  if (pr.state === "MERGED" && pr.baseRefOid) {
    return {
      preSha: pr.baseRefOid,
      headSha: head.stdout.trim(),
      mergeSha,
      preMethod: "GitHub baseRefOid fallback",
      prHeadRef,
      snapshotSensitive: false,
      logs: { fetchBase, fetchHead }
    };
  }

  const mergeBase = runCommand(`git merge-base ${shellQuote(`refs/remotes/${baseRemote}/${pr.baseRefName}`)} ${shellQuote(prHeadRef)}`, sourceRepo);
  if (mergeBase.status !== 0) {
    return { error: "failed to compute merge-base", fetchBase, fetchHead, mergeBase };
  }

  return {
    preSha: mergeBase.stdout.trim(),
    headSha: head.stdout.trim(),
    mergeSha,
    preMethod: `merge-base refs/remotes/${baseRemote}/${pr.baseRefName} ${prHeadRef}`,
    prHeadRef,
    snapshotSensitive: pr.state !== "MERGED",
    logs: { fetchBase, fetchHead, mergeBase }
  };
}

export function generateSelectedSourceTruth({ sourceRepo, preSha, headSha, sourceDir }) {
  mkdirSync(sourceDir, { recursive: true });
  const patch = runCommand(`git diff --binary ${shellQuote(preSha)}..${shellQuote(headSha)}`, sourceRepo);
  const stat = runCommand(`git diff --stat ${shellQuote(preSha)}..${shellQuote(headSha)}`, sourceRepo);
  const numstat = runCommand(`git diff --numstat ${shellQuote(preSha)}..${shellQuote(headSha)}`, sourceRepo);
  const files = runCommand(`git diff --name-only ${shellQuote(preSha)}..${shellQuote(headSha)}`, sourceRepo);

  for (const [label, result] of [
    ["selected patch", patch],
    ["selected stat", stat],
    ["selected numstat", numstat],
    ["selected files", files]
  ]) {
    if (result.status !== 0) {
      writeCommandLog(resolve(sourceDir, `${label.replaceAll(" ", "-")}-error.log`), result);
      throw new Error(`failed to generate ${label}`);
    }
  }

  return { patch, stat, numstat, files, stats: diffStatsFromNumstat(numstat.stdout) };
}

export function verifyWorktree({ manifest, workdir, logDir }) {
  const expectedSha = manifest.workspace.preSha || manifest.workspace.baseRef;
  const head = runCommand("git rev-parse HEAD", workdir);
  const status = runCommand("git status --porcelain", workdir);
  writeCommandLog(resolve(logDir, "worktree-head.log"), head);
  writeCommandLog(resolve(logDir, "worktree-status.log"), status);
  const actualSha = head.stdout.trim();
  const clean = status.stdout.trim() === "";
  const summary = {
    expectedSha,
    actualSha,
    clean,
    workdir
  };
  writeJson(resolve(logDir, "worktree-verify.json"), summary);

  if (head.status !== 0 || actualSha !== expectedSha) {
    throw new Error(`worktree HEAD mismatch: expected ${expectedSha}, got ${actualSha || "<unresolved>"}`);
  }
  if (status.status !== 0 || !clean) {
    throw new Error(`worktree is not clean before agent run: ${workdir}`);
  }
  return summary;
}

export function assertSnapshotNotDrifted(manifest) {
  const { workspace } = manifest;
  if (!workspace?.snapshotSensitive) {
    return;
  }
  if (!workspace.sourceRepo || !workspace.prHeadRef || !workspace.headSha) {
    throw new Error("snapshot-sensitive cases require workspace.sourceRepo, workspace.prHeadRef, and workspace.headSha");
  }
  const currentHead = runCommand(`git rev-parse ${shellQuote(workspace.prHeadRef)}`, workspace.sourceRepo);
  if (currentHead.status !== 0) {
    throw new Error(`cannot verify snapshot-sensitive PR head ref: ${workspace.prHeadRef}`);
  }
  if (currentHead.stdout.trim() !== workspace.headSha) {
    throw new Error(`snapshot drift: ${workspace.prHeadRef} is ${currentHead.stdout.trim()}, expected ${workspace.headSha}`);
  }
}

export function assertPrivateOutputPath(outRoot, repoRoot, allowUnignoredOutput = false) {
  if (allowUnignoredOutput) {
    return;
  }
  const absolute = resolve(outRoot);
  const privateRoot = resolve(repoRoot, "evals", "voovo-pr-replay", "private-cases");
  if (absolute === privateRoot || absolute.startsWith(`${privateRoot}/`)) {
    return;
  }
  const ignored = runCommand(`git check-ignore -q ${shellQuote(relative(repoRoot, absolute) || absolute)}`, repoRoot);
  if (ignored.status !== 0) {
    throw new Error(`private VOOVO output path is not ignored by git: ${absolute}`);
  }
}

export const comparisonWinners = ["merged", "baseline", "resilient", "tie", "inconclusive"];
export const comparisonConfidences = ["low", "medium", "high"];
export const manualProofTypes = ["screenshot", "video", "log", "markdown-note", "device-matrix", "mock-transcript", "external-note"];
export const manualProofStatuses = ["missing", "provided", "accepted", "rejected"];

export function validateComparisonResult(result, expectedCriteria = []) {
  const errors = [];
  if (!result || typeof result !== "object") {
    return ["comparison result must be an object"];
  }
  if (!comparisonWinners.includes(result.winner)) {
    errors.push(`winner must be one of ${comparisonWinners.join(", ")}`);
  }
  if (!comparisonConfidences.includes(result.confidence)) {
    errors.push(`confidence must be one of ${comparisonConfidences.join(", ")}`);
  }
  if (!Array.isArray(result.criteria)) {
    errors.push("criteria must be an array");
  } else {
    const names = new Set(result.criteria.map((criterion) => criterion.name));
    for (const criterion of expectedCriteria) {
      if (!names.has(criterion)) {
        errors.push(`missing criterion: ${criterion}`);
      }
    }
    for (const criterion of result.criteria) {
      if (!criterion.name) {
        errors.push("criterion is missing name");
      }
      if (!["merged", "baseline", "resilient", "tie", "inconclusive", null].includes(criterion.winner ?? null)) {
        errors.push(`criterion ${criterion.name || "<unknown>"} has invalid winner`);
      }
      if (!Array.isArray(criterion.evidence)) {
        errors.push(`criterion ${criterion.name || "<unknown>"} evidence must be an array`);
      }
    }
  }
  for (const key of ["missingEvidence", "blockingIssues", "evidenceCitations", "residualRisk"]) {
    if (!Array.isArray(result[key])) {
      errors.push(`${key} must be an array`);
    }
  }
  if (result.confidence === "high" && (result.missingEvidence || []).length > 0) {
    errors.push("high confidence is not allowed when missingEvidence is non-empty");
  }
  return errors;
}

export function buildDefaultComparisonResult({ manifest, evidence, checksSummary = null, manualProofSummary = null }) {
  const missingEvidence = [];
  const blockingIssues = [];
  const criteria = (manifest.evaluation?.criteria || []).map((criterion) => ({
    name: criterion,
    winner: "inconclusive",
    score: null,
    evidence: [],
    notes: "Not evaluated yet."
  }));

  for (const variant of ["baseline", "resilient"]) {
    const summary = checksSummary?.[variant];
    if (!summary) {
      missingEvidence.push(`missing ${variant} checks summary`);
      continue;
    }
    if (summary.requiredPassed === false) {
      blockingIssues.push(`${variant} required checks failed: ${(summary.failedRequired || []).join(", ") || "unknown"}`);
    }
    for (const check of summary.checks || []) {
      if (check.required && check.status !== 0) {
        missingEvidence.push(`${variant} required check did not pass: ${check.name}`);
      }
    }
  }

  for (const proof of manualProofSummary?.proofs || []) {
    for (const error of proof.errors || []) {
      missingEvidence.push(`manual proof invalid: ${error}`);
    }
    if (proof.required && proof.status !== "accepted" && proof.status !== "provided") {
      missingEvidence.push(`missing required manual proof: ${proof.name}`);
    }
    if (proof.status === "rejected") {
      blockingIssues.push(`manual proof rejected: ${proof.name}`);
    }
  }

  return {
    schemaVersion: 1,
    caseId: manifest.caseId,
    title: manifest.title,
    winner: "inconclusive",
    confidence: "low",
    summary: "No evaluator verdict has been recorded yet. The result is inconclusive until evidence is reviewed.",
    criteria,
    missingEvidence,
    blockingIssues,
    evidenceCitations: [
      { label: "goal", path: evidence.goalPath },
      { label: "selected replay patch", path: evidence.selectedPatchPath },
      { label: "selected replay stats", path: evidence.selectedStatsPath },
      { label: "baseline patch", path: evidence.variants?.baseline?.implementationPatchPath },
      { label: "resilient patch", path: evidence.variants?.resilient?.implementationPatchPath },
      { label: "checks summary", path: evidence.checksSummaryPath },
      ...(manualProofSummary?.proofs || [])
        .filter((proof) => proof.artifactPath)
        .map((proof) => ({ label: `manual proof: ${proof.name}`, path: resolve(evidence.caseDir || "", proof.artifactPath) }))
    ].filter((citation) => citation.path),
    manualProofs: (manualProofSummary?.proofs || []).map(({ errors, ...proof }) => ({ ...proof, errors })),
    residualRisk: ["Structured comparison has not been performed by an evaluator yet."],
    recommendedNextAction: "Run or review an evaluator against the evidence manifest, then replace this default inconclusive result."
  };
}

export function renderComparisonReport(result, manifest, evidence, goalText) {
  return [
    `# Comparison Report: ${manifest.caseId}`,
    "",
    `Winner: ${result.winner}`,
    `Confidence: ${result.confidence}`,
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Goal",
    "",
    fence(goalText.trim()),
    "",
    "## Evidence Files",
    "",
    ...result.evidenceCitations.map((citation) => `- ${citation.label}: ${citation.path}`),
    "",
    "## Criteria",
    "",
    ...result.criteria.map((criterion) => `- ${criterion.name}: ${criterion.winner}; ${criterion.notes || "no notes"}`),
    "",
    "## Missing Evidence",
    "",
    ...(result.missingEvidence.length ? result.missingEvidence.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Blocking Issues",
    "",
    ...(result.blockingIssues.length ? result.blockingIssues.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Manual Proof",
    "",
    ...((result.manualProofs || []).length
      ? result.manualProofs.map((proof) => `- ${proof.name}: ${proof.status}${proof.required ? " (required)" : ""}`)
      : ["- none declared"]),
    "",
    "## Residual Risk",
    "",
    ...(result.residualRisk.length ? result.residualRisk.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Recommended Next Action",
    "",
    result.recommendedNextAction,
    "",
    "## Evaluator Instructions",
    "",
    "Do not reward diff similarity by itself. Compare outcomes against the goal, cite exact evidence, and keep the verdict inconclusive when required checks or manual proof are missing."
  ].join("\n");
}

export function buildEvaluatorPrompt({ caseDir, runDir, evidence }) {
  return [
    "Use resilient execution Level 3.",
    "",
    "Evaluate this PR replay case using only the evidence listed in `comparison/evidence-manifest.json`.",
    "",
    "You must compare the merged/source implementation, baseline implementation, and resilient implementation against the outcome-only goal. Do not reward diff similarity by itself. The merged implementation is not automatically correct.",
    "",
    "For every major claim, cite a concrete evidence path such as a patch, changed-files list, check log, final answer, selected replay stats, or manual-proof artifact.",
    "",
    "If required checks, required manual proof, or critical evidence are missing, choose `winner: inconclusive` or cap confidence below high. Missing proof beats confidence.",
    "",
    "Return machine-readable JSON matching `comparison-result.json` fields before any prose summary.",
    "",
    `Case directory: ${caseDir}`,
    `Run directory: ${runDir}`,
    `Evidence manifest: ${evidence.evidenceManifestPath || "comparison/evidence-manifest.json"}`
  ].join("\n");
}

export function validateManualProofs(caseDir, manifest) {
  const proofs = (manifest.manualProofs || []).map((proof) => {
    const status = proof.status || "missing";
    const normalized = { ...proof, status };
    const errors = [];
    if (!proof.name) {
      errors.push("manual proof missing name");
    }
    if (!proof.description) {
      errors.push(`manual proof ${proof.name || "<unknown>"} missing description`);
    }
    if (proof.artifactType && !manualProofTypes.includes(proof.artifactType)) {
      errors.push(`manual proof ${proof.name || "<unknown>"} has invalid artifactType`);
    }
    if (!manualProofStatuses.includes(status)) {
      errors.push(`manual proof ${proof.name || "<unknown>"} has invalid status`);
    }
    if ((status === "provided" || status === "accepted") && !proof.artifactPath) {
      errors.push(`manual proof ${proof.name || "<unknown>"} is ${status} but has no artifactPath`);
    }
    if (proof.artifactPath && !proof.artifactType) {
      errors.push(`manual proof ${proof.name || "<unknown>"} has artifactPath but no artifactType`);
    }
    if (proof.artifactPath && !existsSync(resolve(caseDir, proof.artifactPath))) {
      errors.push(`manual proof ${proof.name || "<unknown>"} missing artifactPath: ${proof.artifactPath}`);
    }
    normalized.errors = errors;
    return normalized;
  });
  return {
    proofs,
    errors: proofs.flatMap((proof) => proof.errors),
    missingRequired: proofs.filter((proof) => proof.required && proof.status !== "provided" && proof.status !== "accepted"),
    rejected: proofs.filter((proof) => proof.status === "rejected")
  };
}

export function classifyReplayCommand(command) {
  const value = String(command || "").trim();
  const dangerous = [
    ["firebase-deploy", /\bfirebase\s+deploy\b/i],
    ["gcloud-deploy", /\bgcloud\b[\s\S]*\bdeploy\b/i],
    ["git-push", /\bgit\s+push\b/i],
    ["gh-pr-create", /\bgh\s+pr\s+create\b/i],
    ["npm-deploy", /\bnpm\s+run\s+deploy\b/i],
    ["slack-post", /(chat\.postMessage|slack\.com\/api\/chat\.postMessage)/i],
    ["secret-read", /\b(cat|grep|rg|sed|awk|less|more|tail|head|open|code)\b[\s\S]*\.env[\w.-]*/i]
  ];
  const match = dangerous.find(([, pattern]) => pattern.test(value));
  return match
    ? { safe: false, reason: match[0], command: value }
    : { safe: true, reason: "allowed", command: value };
}

export function assertSafeReplayCommand(command, allowUnsafe = false) {
  const result = classifyReplayCommand(command);
  if (!allowUnsafe && !result.safe) {
    throw new Error(`unsafe replay command blocked (${result.reason}): ${command}`);
  }
  return result;
}

function fence(value) {
  return ["```text", value, "```"].join("\n");
}

export function redactImplementationHints(text, pr = {}) {
  let output = String(text || "");
  output = output.replace(/```[\s\S]*?```/g, "[redacted code block]");
  output = output.replace(/`[^`]*`/g, "[redacted implementation detail]");
  output = output.replace(/\b[A-Za-z0-9_./()[\]-]+\.(tsx|ts|jsx|js|mjs|cjs|css|scss|dart|kt|swift|yaml|json)\b/g, "[redacted file path]");
  output = output.replace(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/gi, "[redacted PR URL]");
  output = output.replace(/(^|\n)\s*[-*]\s*(Root cause|What changed|Technical detail|Affected areas)[^\n]*/gi, "");
  for (const file of pr.files || []) {
    if (file.path) {
      output = output.replaceAll(file.path, "[redacted file path]");
    }
  }
  return output.replace(/\n{3,}/g, "\n\n").trim();
}

function extractUserImpact(body) {
  const bullets = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /what (was broken|this adds|this delivers|was incomplete)|user impact|why it matters|regression risk/i.test(line))
    .filter((line) => !/root cause|what changed|affected areas|approach/i.test(line));
  return bullets.join("\n");
}

function extractRegressionRisk(body) {
  const match = String(body || "").match(/regression risk[^:\n]*:\s*([^\n]+)/i);
  return match ? `Regression risk to re-test: ${match[1].trim()}` : "";
}

function extractSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"));
  if (!match) {
    return "";
  }
  return match[1]
    .split(/\r?\n/)
    .filter((line) => !/root cause|what changed|technical detail|affected areas|approach/i.test(line))
    .join("\n")
    .trim();
}

function implementationTokensFromFiles(paths) {
  const tokens = new Set();
  for (const path of paths) {
    const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
    for (const token of base.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
      tokens.add(token);
    }
    const camelTokens = base.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|\d+/g) || [];
    for (const token of camelTokens) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

function dedupeChecks(checks) {
  const seen = new Set();
  return checks.filter((check) => {
    const key = `${check.name}\0${check.command}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function slugCheckName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
