import assert from "node:assert/strict";
import test from "node:test";

import { applyCoupon } from "../src/pricing.mjs";

test("keeps totals unchanged without a known coupon", () => {
  assert.equal(applyCoupon(120, undefined), 120);
  assert.equal(applyCoupon(120, "NOPE"), 120);
});

test("keeps existing welcome coupon behavior", () => {
  assert.equal(applyCoupon(120, "WELCOME10"), 110);
  assert.equal(applyCoupon(8, "WELCOME10"), 0);
});

test("applies VIP50 as a fifty percent discount", () => {
  assert.equal(applyCoupon(120, "VIP50"), 60);
  assert.equal(applyCoupon(15, "VIP50"), 7.5);
});

