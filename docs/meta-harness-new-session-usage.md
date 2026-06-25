# Meta-Harness New-Session Usage

Use this when a fresh Codex session is dropped into a repo and receives a feature request. The goal is to make completion depend on artifacts, not final prose.

## Starting Point

The harness is available as the local global `jarvis-harness` CLI. Start by checking the CLI and Codex prerequisite:

```bash
jarvis-harness doctor
codex --version
```

If `jarvis-harness` is missing, install or refresh it from the `jarvis-2` checkout:

```bash
cd /Users/levente/Documents/jarvis-2
npm install -g .
jarvis-harness doctor
```

For a target repository:

```bash
jarvis-harness web
jarvis-harness init --repo /path/to/repo --task "build the requested feature"
```

This creates:

```text
/path/to/repo/.task-runs/<id>/
```

The run folder is the source of truth. It contains the raw task, repo profile, requirements, proof plan, allowed-file policy, events, transcript, diff, verification evidence, verifier report, policy decision, and final report.

The key terminal artifacts are `verification.json`, `verifier-report.json`, `policy-decision.json`, and `final-report.json`.

## Current Packaging Status

Use the harness through `jarvis-harness ...` after local global install.

The package remains private and is not published to npm. The repo-local development fallback still works from `/Users/levente/Documents/jarvis-2`:

```bash
npm run meta -- run --repo /path/to/repo --task "build X"
```

Codex CLI is an external prerequisite. `codex --version` must work before live runner commands can work.

Default live runner settings:

```bash
META_HARNESS_CODEX_MODEL=gpt-5.5
META_HARNESS_CODEX_REASONING_EFFORT=high
META_HARNESS_CODEX_IGNORE_USER_CONFIG=1
```

## One-Command Flow

For a normal run, use:

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature"
```

Normal implementation runs have no default wall-clock timeout. Do not add `--timeout-ms` for large feature work unless the operator explicitly wants the harness to stop the Codex process after that many milliseconds. Proof commands and browser/API surface checks still have finite verification timeouts.

For a safe prompt/capture check without implementation edits:

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature" --dry-run
```

For deterministic local harness testing:

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature" --fake --scenario success
```

The two-step flow remains useful when you want to inspect or edit the task packet before running:

```bash
jarvis-harness init --repo /path/to/repo --task "build the requested feature"
jarvis-harness run --run /path/to/repo/.task-runs/<id>
```

## Verification Flow

After implementation artifacts exist:

```bash
jarvis-harness verify --run /path/to/repo/.task-runs/<id>
```

This runs command proof, surface proof, independent verifier, and policy unless explicitly skipped. The terminal decision is `policy-decision.json`.

Render reports:

```bash
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format text
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format html
```

The report is a readable projection. JSON artifacts remain authoritative.

## Dashboard

Open the local harness web app:

```bash
jarvis-harness web
```

The web app is specified in `docs/meta-harness-webapp-spec.md`. It can start runs, initialize packets, list discovered active/recent `.task-runs`, and open each run on its own dashboard page.

Open a local read-only dashboard for a run:

```bash
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
```

The design is in `docs/meta-harness-dashboard-spec.md`. It is a desktop-only, read-only, file-backed local web surface over one run folder. It is useful while a run is active because the runner flushes raw stdout/stderr and parsed JSONL artifacts during execution.

The dashboard opens in the default browser by default. Use `--no-open` when running it in an automation or when you only want the URL printed.

## Decision Rules

Do not report completion from memory or assistant prose. Use the policy decision, but translate it to the operator lifecycle:

- `finished`: internal policy is `accepted`.
- `repairing`: internal policy is `rejected`; keep fixing implementation, proof, or evidence by default.
- `blocked`: internal policy is `blocked`; user/operator input or an external condition is required.

Internal policy meanings:

- `accepted`: required proof passed, verifier did not find blocking or major issues, and residual risk is recorded.
- `rejected`: current artifacts do not support the completion claim. This is not a user-facing terminal state.
- `blocked`: a real external condition prevents proof, such as missing credentials, unsafe approval boundary, unavailable target environment, or required live access. This is the user/operator-needed state.

Internal policy `rejected` is repairable by default and should be presented as operator `repairing`. Do not notify the user by default unless retries repeat, scope changes, or the safe next action is unclear. Blocked is the state that asks the user/operator for input. If blocked, name the condition and evidence. Do not use blocked for inconvenience. Blocked `run` and `verify` commands exit `3`, show a timed macOS error popup when available, and write `blocked-notification.json` with the resume command.

Accepted `meta verify` runs exit `0`, show a timed macOS completion popup when available, and write `completion-notification.json` with the report command.

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
jarvis-harness promote-failure --run /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
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

If live runner startup fails:

- Unsupported model: check `META_HARNESS_CODEX_MODEL` and the account's available Codex CLI models.
- Missing Codex command: fix the local Codex CLI install or `PATH`.
- Wrong command shape: use `jarvis-harness ...`; if `jarvis-harness` is missing, reinstall with `npm install -g .` from `jarvis-2`.
- Unexpected timeout: check whether `--timeout-ms` was passed explicitly; there is no default wall-clock timeout for implementation runs.

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
Use `jarvis-harness run`, `jarvis-harness verify`, and `jarvis-harness report`. If implementing dashboard work, use `docs/meta-harness-dashboard-spec.md` as the controlling spec. If blocked, stop after notification. Resume with `jarvis-harness run --run <run-dir>` for runner blockers or `jarvis-harness verify --run <run-dir>` for verification blockers.
```
