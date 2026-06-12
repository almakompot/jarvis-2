#!/usr/bin/env node

import { readJson, loadCase, parseArgs, requiredArg } from "./lib.mjs";
import { validateComparisonResult } from "./replay-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const { manifest } = loadCase(requiredArg(args, "case"));
const result = readJson(requiredArg(args, "result"));
const errors = validateComparisonResult(result, manifest.evaluation.criteria);

if (errors.length > 0) {
  console.error("Comparison result validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated comparison result for ${result.caseId || manifest.caseId}.`);
