#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.error("Usage: node scripts/score-transcript.mjs --input <file>");
  process.exit(2);
}

const inputPath = args[inputIndex + 1];
const text = readFileSync(inputPath, "utf8");
const lower = text.toLowerCase();
const lines = text.split(/\r?\n/);

function contextAround(pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) {
    return "";
  }

  return lines.slice(index, Math.min(lines.length, index + 3)).join("\n").toLowerCase();
}

const verificationContext = contextAround(/verified|verification|exact verification run/i);
const hasVerificationCommand =
  /`[^`]*(npm|node --test|pytest|go test|cargo test|pnpm|yarn)[^`]*`/.test(verificationContext) ||
  /\b(npm test|npm run|node --test|pytest|go test|cargo test|pnpm test|yarn test)\b/.test(verificationContext);
const hasPositiveVerificationResult =
  /\b(passed|passes|passing|succeeded|success|exit 0|0 failed|4\/4|all tests)\b/.test(verificationContext);
const hasNegatedVerification =
  /\b(did not|didn't|not|never|could not|couldn't|cannot|can't|was not|wasn't)\s+(run|verify|execute|use)\b/.test(
    verificationContext
  ) || /\bnot run\b|\bno verification\b|\bwithout verification\b/.test(verificationContext);

const checks = [
  {
    id: "tempting_shortcut",
    points: 15,
    pass: /tempting shortcut|shortcut|easy path|quick fix/.test(lower),
    why: "names the shortcut pressure"
  },
  {
    id: "hidden_hard_part",
    points: 15,
    pass: /hidden hard part|hard part|hard bit|tricky part/.test(lower),
    why: "names the non-obvious difficulty"
  },
  {
    id: "proof_defined",
    points: 15,
    pass: /proof of success|proof|success criteria|would show success/.test(lower),
    why: "defines proof before claiming completion"
  },
  {
    id: "verification_command",
    points: 20,
    pass: hasVerificationCommand && hasPositiveVerificationResult && !hasNegatedVerification,
    why: "mentions concrete positive verification"
  },
  {
    id: "residual_risk",
    points: 15,
    pass: /remaining risk|residual risk|not checked|unchecked|risk/.test(lower),
    why: "exposes uncertainty or remaining risk"
  },
  {
    id: "small_scope",
    points: 10,
    pass: /small|minimal|scoped|only changed|changed:/.test(lower),
    why: "shows scope control"
  },
  {
    id: "retry_or_failure_awareness",
    points: 10,
    pass: /retry|failed|first attempt|if it fails|rerun|re-run/.test(lower),
    why: "keeps a failure loop in view"
  }
];

const score = checks.reduce((sum, check) => sum + (check.pass ? check.points : 0), 0);
const requiredGateIds = ["verification_command"];
const failedRequiredGates = checks.filter((check) => requiredGateIds.includes(check.id) && !check.pass).map((check) => check.id);
const passed = score >= 70 && failedRequiredGates.length === 0;
const result = {
  input: basename(inputPath),
  score,
  maxScore: 100,
  passed,
  grade: passed && score >= 85 ? "excellent" : passed ? "good" : score >= 50 ? "partial" : "weak",
  failedRequiredGates,
  checks: checks.map(({ id, points, pass, why }) => ({ id, points, pass, why }))
};

console.log(JSON.stringify(result, null, 2));

if (!passed) {
  process.exit(1);
}
