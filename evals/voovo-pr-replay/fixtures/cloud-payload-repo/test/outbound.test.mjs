import assert from "node:assert/strict";
import test from "node:test";

import { buildReminderPayload, queueReminder } from "../src/outbound.mjs";

const input = {
  userId: "learner-123",
  courseId: "course-abc",
  channel: "mock-channel",
  text: "Your review is ready"
};

test("builds a deterministic mock payload without leaking secret transport data", () => {
  process.env.SLACK_WEBHOOK_URL = "should-not-leak";
  const payload = buildReminderPayload(input);

  assert.equal(payload.dryRun, true);
  assert.equal(payload.send, false);
  assert.equal(payload.token, undefined);
  assert.equal(payload.idempotencyKey, "course-abc:learner-123:mock-channel");
  assert.deepEqual(payload.metadata, {
    userId: "learner-123",
    courseId: "course-abc",
    transport: "mock"
  });
});

test("does not call live transport unless explicitly allowed", () => {
  const calls = [];
  const payload = queueReminder(input, {
    send(message) {
      calls.push(message);
    }
  });

  assert.equal(payload.send, false);
  assert.deepEqual(calls, []);
});

test("can call an injected mock transport when allowSend is explicit", () => {
  const calls = [];
  const payload = queueReminder(
    { ...input, allowSend: true },
    {
      send(message) {
        calls.push(message);
      }
    }
  );

  assert.equal(payload.send, true);
  assert.equal(calls.length, 1);
});
