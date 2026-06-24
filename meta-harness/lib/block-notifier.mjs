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
  const notification = {
    schemaVersion: 1,
    kind: "meta-harness.blocked-notification",
    createdAt: now.toISOString(),
    runDir: runDir || null,
    phase: phase || "unknown",
    decision: "blocked",
    title: "Meta-Harness blocked",
    subtitle: "User/operator input needed",
    reason: reason || "A blocked condition requires user/operator input.",
    resumeCommand: resumeCommand || null,
    status: "pending"
  };

  if (!runDir) {
    notification.status = "skipped";
    notification.skipReason = "missing-run-dir";
    return notification;
  }

  if (isNotificationDisabled(env)) {
    notification.status = "skipped";
    notification.skipReason = "disabled";
    return writeNotificationArtifact(runDir, notification);
  }

  if (platform !== "darwin") {
    notification.status = "skipped";
    notification.skipReason = "unsupported-platform";
    return writeNotificationArtifact(runDir, notification);
  }

  const message = notificationMessage(notification);
  const script = [
    "display notification",
    appleScriptString(message),
    "with title",
    appleScriptString(notification.title),
    "subtitle",
    appleScriptString(notification.subtitle),
    "sound name",
    appleScriptString("Basso")
  ].join(" ");
  const result = runner("osascript", ["-e", script]);
  notification.command = {
    executable: "osascript",
    args: ["-e", script],
    exitCode: result.status ?? null,
    signal: result.signal || null,
    stderr: result.stderr || ""
  };
  notification.status = result.status === 0 ? "sent" : "failed";
  if (notification.status === "failed") {
    notification.failure = result.error?.message || result.stderr || "osascript notification failed";
  }
  return writeNotificationArtifact(runDir, notification);
}

export function notificationMessage(notification) {
  return [
    `Blocked in ${notification.phase}.`,
    notification.reason,
    notification.resumeCommand ? `Resume: ${notification.resumeCommand}` : ""
  ].filter(Boolean).join("\n");
}

function isNotificationDisabled(env) {
  const value = String(env.META_HARNESS_NOTIFY_BLOCKED || "").toLowerCase();
  return value === "0" || value === "false" || value === "off" || value === "disabled";
}

function defaultRunner(executable, args) {
  return spawnSync(executable, args, { encoding: "utf8" });
}

function writeNotificationArtifact(runDir, notification) {
  const path = join(runDir, "blocked-notification.json");
  mkdirSync(runDir, { recursive: true });
  const withArtifact = { ...notification, artifact: "blocked-notification.json" };
  writeFileSync(path, `${JSON.stringify(withArtifact, null, 2)}\n`);
  return withArtifact;
}

function appleScriptString(value) {
  return JSON.stringify(String(value || ""));
}
