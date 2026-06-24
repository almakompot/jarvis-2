import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export function notifyBlockedRun({
  runDir,
  phase,
  reason,
  resumeCommand,
  now = new Date(),
  env = process.env,
  platform = process.platform,
  runner = defaultRunner
} = {}) {
  return notifyRunDecision({
    runDir,
    phase,
    reason: reason || "A blocked condition requires user/operator input.",
    resumeCommand,
    now,
    env,
    platform,
    runner,
    notification: {
      kind: "meta-harness.blocked-notification",
      decision: "blocked",
      title: "Meta-Harness blocked",
      subtitle: "User/operator input needed",
      macosIcon: "stop",
      artifact: "blocked-notification.json"
    }
  });
}

export function notifyCompletionRun({
  runDir,
  phase = "verify",
  reason,
  nextCommand,
  now = new Date(),
  env = process.env,
  platform = process.platform,
  runner = defaultRunner
} = {}) {
  return notifyRunDecision({
    runDir,
    phase,
    reason: reason || "Policy accepted. Required proof passed and residual risk is recorded.",
    nextCommand,
    now,
    env,
    platform,
    runner,
    notification: {
      kind: "meta-harness.completion-notification",
      decision: "accepted",
      title: "Meta-Harness accepted",
      subtitle: "Policy accepted",
      macosIcon: "note",
      artifact: "completion-notification.json"
    }
  });
}

function notifyRunDecision({
  runDir,
  phase,
  reason,
  resumeCommand,
  nextCommand,
  now,
  env,
  platform,
  runner,
  notification: template
}) {
  const notification = {
    schemaVersion: 1,
    kind: template.kind,
    createdAt: now.toISOString(),
    runDir: runDir || null,
    phase: phase || "unknown",
    decision: template.decision,
    title: template.title,
    subtitle: template.subtitle,
    reason,
    resumeCommand: resumeCommand || null,
    nextCommand: nextCommand || null,
    macosDelivery: "timed-alert-dialog",
    timeoutSeconds: 30,
    status: "pending"
  };

  if (!runDir) {
    notification.status = "skipped";
    notification.skipReason = "missing-run-dir";
    return notification;
  }

  if (isNotificationDisabled(env, template.decision)) {
    notification.status = "skipped";
    notification.skipReason = "disabled";
    return writeNotificationArtifact(runDir, notification, template.artifact);
  }

  if (platform !== "darwin") {
    notification.status = "skipped";
    notification.skipReason = "unsupported-platform";
    return writeNotificationArtifact(runDir, notification, template.artifact);
  }

  const message = notificationMessage(notification);
  const script = [
    "display dialog",
    appleScriptString(message),
    "with title",
    appleScriptString(notification.title),
    "buttons {\"OK\"}",
    "default button \"OK\"",
    "with icon",
    template.macosIcon,
    "giving up after",
    String(notification.timeoutSeconds)
  ].join(" ");
  const result = runner("osascript", ["-e", script]);
  notification.command = {
    executable: "osascript",
    args: ["-e", script],
    exitCode: result.status ?? null,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
  notification.status = result.status === 0 ? "sent" : "failed";
  if (notification.status === "failed") {
    notification.failure = result.error?.message || result.stderr || "osascript notification failed";
  }
  return writeNotificationArtifact(runDir, notification, template.artifact);
}

export function notificationMessage(notification) {
  const firstLine = notification.decision === "accepted"
    ? `Meta-Harness accepted in ${notification.phase}.`
    : `ERROR: Meta-Harness blocked in ${notification.phase}.`;
  return [
    firstLine,
    notification.subtitle,
    notification.reason,
    notification.resumeCommand ? `Resume: ${notification.resumeCommand}` : "",
    notification.nextCommand ? `Next: ${notification.nextCommand}` : ""
  ].filter(Boolean).join("\n");
}

function isNotificationDisabled(env, decision) {
  const key = decision === "accepted" ? "META_HARNESS_NOTIFY_COMPLETION" : "META_HARNESS_NOTIFY_BLOCKED";
  const value = String(env[key] || "").toLowerCase();
  return value === "0" || value === "false" || value === "off" || value === "disabled";
}

function defaultRunner(executable, args) {
  return spawnSync(executable, args, { encoding: "utf8" });
}

function writeNotificationArtifact(runDir, notification, artifactName) {
  const path = join(runDir, artifactName);
  mkdirSync(runDir, { recursive: true });
  const withArtifact = { ...notification, artifact: artifactName };
  writeFileSync(path, `${JSON.stringify(withArtifact, null, 2)}\n`);
  return withArtifact;
}

function appleScriptString(value) {
  return JSON.stringify(String(value || ""));
}
