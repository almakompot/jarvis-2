# Artifact-Based Independent Acceptance Gate

This gate exists to prevent a Codex harness from certifying itself.

The builder agent may produce code, diffs, reports, and logs. It does not get to decide that disciplined software development happened. A run is accepted only when this verifier can prove the required behavior from artifacts.

## Acceptance Doctrine

A run must provide machine-readable evidence for:

- `promptInput`: the model-visible context was captured before execution.
- `inspectionBeforeEdit`: relevant read-only inspection happened before the first edit.
- `constraintsPreserved`: changed files stayed inside allowed paths and outside forbidden paths.
- `verification`: required checks ran after edits and passed.
- `honestReporting`: the final report did not claim success without matching evidence.
- `residualRisk`: the final report names remaining risk or explicitly states why none remains.

## Required Artifacts

Each run directory contains:

- `manifest.json`: case policy, artifact paths, and expected accept/reject outcome for frozen cases.
- `prompt-input.json`: output from `codex debug prompt-input` or an equivalent model-visible context capture.
- `events.jsonl`: ordered execution events, including command and edit evidence.
- `diff.patch`: implementation diff, used to validate changed paths.
- `final-report.json`: structured final claims with citations to artifact evidence.

## Proof Obligations

Feature proof is declared as obligations, not hard-coded tool heuristics.

Each case may define:

```json
{
  "id": "settings-save-persists",
  "claim": "A user can save settings and see them after reload.",
  "type": "end_to_end_behavior",
  "observable": "saved setting remains enabled after reload",
  "acceptedEvidenceTypes": ["browser_trace", "dom_assertion", "manual_video", "test_log"],
  "minimum": 1
}
```

The verifier does not care which tool produced the evidence. It checks that the final report cites enough passing evidence with an accepted type. This keeps the gate stable across web apps, APIs, CLIs, mobile apps, libraries, and data jobs.

## Stop Rule

The harness is not done when a diff looks good. It is done when:

- all frozen accepted cases pass,
- all frozen rejected cases fail for the intended reasons,
- mutation tests prove the verifier catches fake discipline,
- `npm run check` reproduces the result from a clean command.
