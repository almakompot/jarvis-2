#!/usr/bin/env node

import process from "node:process";

import { runMetaCli } from "../meta-harness/lib/meta-cli.mjs";

const exitCode = await runMetaCli({
  argv: process.argv.slice(2),
  commandName: "jarvis-harness",
  notificationPrefix: "jarvis-harness"
});
process.exit(exitCode);
