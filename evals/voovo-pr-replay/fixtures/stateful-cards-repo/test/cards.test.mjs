import assert from "node:assert/strict";
import test from "node:test";

import { getVisibleStudyCards } from "../src/cards.mjs";

test("shows only actionable study cards while preserving order", () => {
  const cards = [
    { id: "hidden-ready", title: "Hidden ready", ready: true, hidden: true, status: "ready" },
    { id: "started-active", title: "Started active", ready: false, hidden: false, status: "started" },
    { id: "public-ready", title: "Public ready", ready: true, hidden: false, status: "ready" },
    { id: "ended-custom", title: "Ended custom", ready: true, hidden: false, status: "ended", custom: true }
  ];

  assert.deepEqual(
    getVisibleStudyCards(cards).map((card) => card.id),
    ["started-active", "public-ready"]
  );
});
