# Meta-Harness New-Session Usage

Use this when a fresh Codex session is dropped into a repo and receives a feature request. The goal is to make completion depend on artifacts, not final prose.

## Starting Point

From this repository:

```bash
git status --short
npm run meta:final-audit
```

For a target repository:

```bash
npm run meta -- init --repo /path/to/repo --task "build the requested feature"
```

This creates:

```text
/path/to/repo/.task-runs/<id>/
```

The run folder is the source of truth. It contains the raw task, repo profile, requirements, proof plan, allowed-file policy, events, transcript, diff, verification evidence, verifier report, policy decision, and final report.

The key terminal artifacts are `verification.json`, `verifier-report.json`, `policy-decision.json`, and `final-report.json`.

## One-Command Flow

For a normal run, use:

```bash
npm run meta -- run --repo /path/to/repo --task "build the requested feature"
```

For a safe prompt/capture check without implementation edits:

```bash
npm run meta -- run --repo /path/to/repo --task "build the requested feature" --dry-run
```

For deterministic local harness testing:

```bash
npm run meta -- run --repo /path/to/repo --task "build the requested feature" --fake --scenario success
```

The two-step flow remains useful when you want to inspect or edit the task packet before running:

```bash
npm run meta -- init --repo /path/to/repo --task "build the requested feature"
npm run meta -- run --run /path/to/repo/.task-runs/<id>
```

## Verification Flow

After implementation artifacts exist:

```bash
npm run meta -- verify --run /path/to/repo/.task-runs/<id>
```

This runs command proof, surface proof, independent verifier, and policy unless explicitly skipped. The terminal decision is `policy-decision.json`.

Render reports:

```bash
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format text
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format html
```

The report is a readable projection. JSON artifacts remain authoritative.

## Decision Rules

Do not report completion from memory or assistant prose. Use the policy decision:

- `accepted`: required proof passed, verifier did not find blocking or major issues, and residual risk is recorded.
- `rejected`: current artifacts do not support the completion claim. The default next actor is the agent/harness repair loop: fix implementation, proof, or evidence, then rerun verification and policy, or start a child run.
- `blocked`: a real external condition prevents proof, such as missing credentials, unsafe approval boundary, unavailable target environment, or required live access. This is the user/operator-needed state.

Rejected is repairable by default. Do not notify the user by default unless retries repeat, scope changes, or the safe next action is unclear. Blocked is the state that asks the user/operator for input. If blocked, name the condition and evidence. Do not use blocked for inconvenience.

## Report Discipline

Final user-facing notes should state:

- policy decision
- blocking reason, if any
- commands and surface proof actually run
- evidence paths
- residual risk
- next action

The final answer must not say "done" unless `policy-decision.json` is accepted.

## Failure Corpus

Promote useful rejected or blocked runs into private staging:

```bash
npm run meta -- promote-failure --run /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
```

Promotion writes metadata only and does not copy raw run evidence. Minimize and sanitize before committing a corpus case.

Replay committed corpus cases:

```bash
npm run meta:corpus
```

## Built-In Regression Suites

Use these to check task-class coverage:

```bash
npm run web-ui:test-replay
npm run browser-extension:test-replay
npm run non-web:test-replay
npm run ab-harness:test
```

Use the full repository gate before claiming packaging health:

```bash
npm run check
git diff --check
```

## A/B Validation Scale

The A/B harness dry run is small and deterministic:

```bash
npm run ab-harness:dry-run
```

Use 200-500 total runs only for a validation campaign after the harness is stable. That number is not an implementation checklist.

## New-Session Prompt

Use this prompt when handing the project to a fresh Codex session:

```text
Work in /Users/levente/Documents/jarvis-2.
Use docs/meta-harness-new-session-usage.md and meta-harness/README.md.
For any target repo feature request, create or inspect the .task-runs/<id> packet first.
Completion means policy-decision.json is accepted, report output is evidence-linked, npm run check passes when package-level behavior changed, and remaining risk is explicit.
Do not read .env* contents. Do not run deploy, push, send, publish, migration, production mutation, or cost-bearing external API commands without explicit approval recorded in artifacts.
```
