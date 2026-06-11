#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync("node", ["--test", "evals/shortcut-trap/test/*.test.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: true,
  maxBuffer: 1024 * 1024 * 10
});

if (result.status === 0) {
  console.error("Expected shortcut-trap fixture to fail before Codex fixes a copied eval run.");
  process.exit(1);
}

const output = `${result.stdout || ""}${result.stderr || ""}`;
const expectedFailures = [
  "keeps commas inside quoted cells",
  "unescapes doubled quotes inside quoted cells",
  "preserves intentional spaces inside quoted cells"
];

for (const name of expectedFailures) {
  if (!output.includes(name)) {
    console.error(`Expected failing test name not found: ${name}`);
    process.exit(1);
  }
}

console.log("shortcut-trap fixture is armed: expected CSV tests fail before repair.");

