#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

const doctrinePath = "docs/fresh-repo-feature-protocol.md";
const text = readFileSync(doctrinePath, "utf8");
const lower = text.toLowerCase();

const requiredHeadings = [
  "Stop Rule",
  "Fresh Context Orientation",
  "Request Parsing",
  "Risk Classification",
  "Test Plan Before Editing",
  "Current-State Reproduction",
  "Design Discipline",
  "Implementation Discipline",
  "Automated Test Discipline",
  "User Smoke Test Discipline",
  "Browser/UI Verification",
  "API Verification",
  "Data Verification",
  "Review Discipline",
  "Deploy And Operations Discipline",
  "Final Report Discipline",
  "Verifier Contract",
  "A/B Harness Contract",
  "Definition Of Done"
];

const requiredPhrases = [
  "A feature is not complete when code is written or checks pass.",
  "If the smoke test did not run, the final report cannot say done.",
  "Automated checks must run after the final code edit.",
  "The final claim must be no stronger than the evidence.",
  "Mutation tests must deliberately corrupt artifacts",
  "user-facing smoke test"
];

const errors = [];

for (const heading of requiredHeadings) {
  if (!text.includes(`## Page`) || !text.includes(heading)) {
    errors.push(`Missing required heading: ${heading}`);
  }
}

for (const phrase of requiredPhrases) {
  if (!lower.includes(phrase.toLowerCase())) {
    errors.push(`Missing required phrase: ${phrase}`);
  }
}

const pageCount = (text.match(/^## Page /gm) || []).length;
if (pageCount < 20) {
  errors.push(`Expected at least 20 page sections, found ${pageCount}.`);
}

const testingMentions = (lower.match(/\b(test|tests|testing|check|checks|verification|verified|smoke)\b/g) || []).length;
if (testingMentions < 80) {
  errors.push(`Expected heavy testing emphasis, found ${testingMentions} testing-related mentions.`);
}

if (errors.length > 0) {
  console.error(`Doctrine validation failed for ${doctrinePath}:`);
  for (const item of errors) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(`Doctrine validation passed: ${pageCount} page sections, ${testingMentions} testing-related mentions.`);
