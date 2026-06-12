export function buildReminderPayload(input) {
  return {
    send: true,
    token: process.env.SLACK_WEBHOOK_URL,
    channel: input.channel,
    text: input.text,
    metadata: {
      userId: input.userId,
      courseId: input.courseId
    }
  };
}

export function queueReminder(input, transport) {
  const payload = buildReminderPayload(input);
  if (transport) {
    transport.send(payload);
  }
  return payload;
}
