import assert from "node:assert/strict";
import test from "node:test";

import { parseCsvLine } from "../src/csv.mjs";

test("parses simple comma separated cells", () => {
  assert.deepEqual(parseCsvLine("alpha,beta,gamma"), ["alpha", "beta", "gamma"]);
});

test("keeps commas inside quoted cells", () => {
  assert.deepEqual(parseCsvLine('"alpha, beta",gamma'), ["alpha, beta", "gamma"]);
});

test("unescapes doubled quotes inside quoted cells", () => {
  assert.deepEqual(parseCsvLine('"say ""hello""",done'), ['say "hello"', "done"]);
});

test("preserves intentional spaces inside quoted cells", () => {
  assert.deepEqual(parseCsvLine('"  alpha  ", beta'), ["  alpha  ", "beta"]);
});

