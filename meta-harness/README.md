# Meta-Harness

Meta-Harness is a local Codex CLI delivery gate. It turns a raw feature request into a run folder, captures implementation and proof artifacts, independently verifies those artifacts, and writes an internal `accepted`, `rejected`, or `blocked` policy decision. The user-facing lifecycle is stricter: `accepted` means `finished`, `rejected` means `repairing`, and `blocked` means user/operator input is needed.

Use it when "done" should mean the requested surface was exercised and the evidence supports the claim.

It includes a local read-only dashboard, but it is not a semantic oracle. It is a structured way to make weak completion claims rejectable. The dashboard behavior is specified in `docs/meta-harness-dashboard-spec.md`.

## Use It

### Standalone CLI

Install or refresh the private local CLI from the `jarvis-2` repo:

```bash
cd /Users/levente/Documents/jarvis-2
npm install -g .
jarvis-harness doctor
codex --version
```

If `codex --version` fails, install or fix the Codex CLI first. The harness wraps the local Codex CLI; it does not bundle Codex.

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature"
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
jarvis-harness verify --run /path/to/repo/.task-runs/<id>
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format text
```

Implementation runs have no default wall-clock timeout. Use `--timeout-ms <ms>` only as an explicit operator guard for a run you are willing to stop; verification commands and surface checks still keep finite proof-level timeouts.

### Packaging Status

`jarvis-harness` is available through local global install from this checkout. The package remains private and is not published to npm.

The repo-local development facade still works:

```bash
npm run meta -- run --repo /path/to/repo --task "build X"
```

Do not assume a public registry package exists. Use `npm install -g .` from `/Users/levente/Documents/jarvis-2`.

By default, the runner launches Codex with:

```bash
META_HARNESS_CODEX_MODEL=gpt-5.5
META_HARNESS_CODEX_REASONING_EFFORT=high
META_HARNESS_CODEX_IGNORE_USER_CONFIG=1
```

Environment reference:

| Variable | Default | Purpose |
| --- | --- | --- |
| `META_HARNESS_CODEX_MODEL` | `gpt-5.5` | Codex model passed to `codex exec` unless a run explicitly overrides it. |
| `META_HARNESS_CODEX_REASONING_EFFORT` | `high` | Reasoning effort passed to `codex exec`. |
| `META_HARNESS_CODEX_IGNORE_USER_CONFIG` | `1` | Adds `--ignore-user-config` by default so local Codex config does not silently break runs. |

Override these in the environment when the account or task needs a different model:

```bash
META_HARNESS_CODEX_MODEL=gpt-5.5 \
META_HARNESS_CODEX_REASONING_EFFORT=high \
jarvis-harness run --repo /path/to/repo --task "build X"
```

If a specific run needs one-off Codex `exec` flags, pass them through with repeated `--codex-arg` entries. Explicit `--codex-arg --model ...` overrides the environment default:

```bash
jarvis-harness run --repo /path/to/repo --task "build X" --codex-arg --ignore-user-config --codex-arg --model --codex-arg gpt-5.5
```

The report is readable, but the JSON artifacts are authoritative. Do not report completion unless `policy-decision.json` says `accepted`.

Operator lifecycle:

- `finished`: policy accepted. The requested proof passed and the run can be reported as complete.
- `repairing`: current artifacts do not support completion, but the agent/harness should keep fixing implementation, proof, or evidence. This is not a user-needed state.
- `blocked`: an external condition prevents proof or progress. This is the user/operator input needed state.

Internal policy decision meanings:

- `accepted`: required proof passed, verifier found no blocking or major issues, and residual risk is recorded.
- `rejected`: artifacts do not support the completion claim. Product surfaces must map this to `repairing`, not a terminal user state.
- `blocked`: an external condition prevents proof or progress. This is the user/operator input needed state. On macOS, blocked `run` and `verify` commands show a timed error popup and write `blocked-notification.json`.

When `meta verify` accepts a run, macOS shows a timed completion popup and writes `completion-notification.json`.

## Fresh Session Prompt

For a new Codex session, give it this:

```text
Use docs/meta-harness-new-session-usage.md and meta-harness/README.md.
Use the `jarvis-harness` CLI. If missing, install it from /Users/levente/Documents/jarvis-2 with `npm install -g .`.
Target repo: /path/to/repo
Task: <paste the exact task>
Do not claim done unless policy-decision.json is accepted.
If policy is rejected, treat it as repairing: keep fixing implementation, proof, or evidence and rerun verification by default.
If blocked, name the external condition and what user/operator input is needed.
```

## Common Commands

Create or run a task packet:

```bash
jarvis-harness run --repo /path/to/repo --task "build X"
jarvis-harness init --repo /path/to/repo --task "build X"
jarvis-harness run --run /path/to/repo/.task-runs/<id>
jarvis-harness run --run /path/to/repo/.task-runs/<id> --dry-run
jarvis-harness run --run /path/to/repo/.task-runs/<id> --timeout-ms 3600000
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
```

Verify and render:

```bash
jarvis-harness verify --run /path/to/repo/.task-runs/<id>
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format text
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format html
```

Repair or archive:

```bash
jarvis-harness rerun --from /path/to/repo/.task-runs/<id>
jarvis-harness promote-failure --run /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
jarvis-harness cleanup --repo /path/to/repo --dry-run
```

Validate the harness itself:

```bash
npm run meta:check
npm run meta:final-audit
npm run check
```

## Reading A Run

Each run lives in the target repo:

```text
/path/to/repo/.task-runs/<id>/
```

The most useful files are:

```text
task.md
spec.json
repo-profile.json
proof-plan.json
allowed-files.json
runner-state.json
command-log.jsonl
diff.patch
changed-files.json
verification.json
evidence/
verifier-report.json
policy-decision.json
final-report.json
html-report/
```

Read them in this order when debugging:

1. `policy-decision.json`
2. `verifier-report.json`
3. `verification.json`
4. `final-report.json`
5. `evidence/`
6. `diff.patch`

## Dashboard

Open a local read-only dashboard for one run folder:

```bash
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
```

The dashboard is a desktop-only, read-only, file-backed local web surface over one run folder. It opens the URL in the default browser by default; pass `--no-open` to only print the URL. It does not add a database, queue, background worker, remote service, or hidden state. It serves bounded JSON endpoints, safe artifact links, live runner output tails, requirement/proof status, changed files, command logs, and the decision/trust state. See `docs/meta-harness-dashboard-spec.md` for the layout, endpoints, artifact safety rules, and acceptance gates.

## Report Format

The Final Report Format is documented in `docs/meta-harness-final-report-format.md`.

Text reports render these sections in order:

```text
Findings:
Operator status:
Internal policy decision:
Reason:
Run:
Task:
Policy rules:
Passed commands:
Failed commands:
Missing proof:
Evidence:
Residual risk:
Next action:
```

`meta report --format html` writes `html-report/index.html` with links back to evidence files.

## Repairing And Blocked Runs

Internal `rejected` decisions are repair work by default. They should appear to the operator as `repairing`, not as a terminal product state:

1. Read `Next action` in the report.
2. Fix the implementation, proof plan, evidence, or final-report mismatch.
3. Rerun `jarvis-harness verify --run <run-dir>`.
4. Rerender the report.
5. Stop only when `policy-decision.json` is `accepted` or a real blocker appears.

Blocked runs require user/operator input:

- missing credentials
- unsafe approval boundary
- unavailable target environment
- required live access
- unclear scope that cannot be safely inferred

Do not use `blocked` for ordinary implementation failure.

Blocked exits are loud:

- `meta run` exits `3` when the runner blocks.
- `meta verify` exits `3` when policy or verification blocks.
- macOS shows a timed error popup unless `META_HARNESS_NOTIFY_BLOCKED=0` is set.
- `blocked-notification.json` records the notification payload, blocker, and resume command.

Resume after unblocking:

- Implementation runner blocker: resolve the condition, then run `jarvis-harness run --run <run-dir>`.
- Verification blocker: resolve the condition, then run `jarvis-harness verify --run <run-dir>`.

## Completion Notifications

Accepted verification is also loud:

- `meta verify` exits `0` only when policy accepts the run.
- macOS shows a timed completion popup unless `META_HARNESS_NOTIFY_COMPLETION=0` is set.
- `completion-notification.json` records the accepted decision and report command.

## Failure Corpus

Replay known false-pass patterns:

```bash
npm run meta:corpus
```

Promote a useful rejected or blocked run into private staging:

```bash
npm run meta:promote-failure -- --run-dir /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset
```

Promotion records the source decision and expected policy rules, but it does not copy raw run artifacts. Minimize and sanitize before committing a corpus case.

## A/B Evaluation Harness

`evals/ab-harness` compares baseline Codex behavior against meta-harnessed Codex behavior.

```bash
npm run ab-harness:dry-run
npm run ab-harness:test
```

The committed A/B suite is deterministic and small. The 200-500 run count is validation campaign scale after the harness is stable, not an implementation checklist.

## Task-Class Replays

Use these to prove the harness still accepts realistic good runs and rejects weak proof:

```bash
npm run web-ui:replay
npm run browser-extension:replay
npm run non-web:replay
npm run voovo:validate-cases
```

Regression commands:

```bash
npm run web-ui:test-replay
npm run browser-extension:test-replay
npm run non-web:test-replay
npm run voovo:test-repairs
```

## Focused Component Commands

The daily `jarvis-harness ...` facade is preferred. These lower-level scripts remain available for component work:

```bash
npm run meta:init -- --repo /path/to/repo --task "build X"
npm run meta:validate -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:codex-runner -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:verify-commands -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:verify-surfaces -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:verifier -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:policy -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:promote-failure -- --run-dir /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
```

## How It Works

The harness is the bounded M1-M9 slice from `docs/meta-harness-roadmap.md`.

Pipeline:

1. M1 Task Compiler freezes the raw request into requirements, risks, required checks, user flows, and proof obligations.
2. M2 Repo Profiler inspects the live local repo for scripts, stack signals, routes, tests, dirty state, sensitive paths, and live-system risk without reading secret contents.
3. M3 Run Envelope creates `.task-runs/<id>/` and seeds the artifact contract.
4. M4 Codex Runner launches either the fake deterministic runner or the real Codex CLI wrapper and captures transcript, command log, diff, changed files, and runner state.
5. M5 Proof Executors run local command proof and collect typed surface evidence for browser, extension, API, CLI, data, visual, and manual proof obligations.
6. M6 Completed-Run Verifier audits artifacts independently and writes `verifier-report.json` with blocking, major, minor, and info findings.
7. M7 Failure Corpus replays sanitized expected-fail and expected-pass cases so known false-pass patterns stay rejected.
8. M8 CLI/Report UX exposes the daily `meta` commands, renders findings-first text/HTML reports, and serves the file-backed dashboard in `docs/meta-harness-dashboard-spec.md`.
9. M9 Policy Engine consumes verification, verifier findings, task-class policy, optional corpus replay, and overrides, then writes `policy-decision.json`.

Acceptance is artifact-based:

```text
Requirement -> Proof obligation -> Verification command/scenario -> Evidence artifact -> Verifier finding -> Policy decision
```

The validator rejects incomplete packets, unmapped requirements, proof obligations pointing at unknown requirements, unsafe secret-path policies, fake passed verification without evidence, and final reports that claim success without passed verification and cited evidence.

The policy engine rules cover missing artifacts, broken traceability, failed verification, missing required surface proof, forbidden file edits, unknown or non-passing evidence citations, verifier ordering failures, corpus regressions, and blocked runner/verifier/verification states.

Optional `policy-overrides.json` can record explicit human overrides with user, timestamp, reason, and remaining risk. Overrides do not erase fired rules; they mark overrideable rules as overridden inside `policy-decision.json`.
