# Meta-Harness Dashboard Spec

This is the target specification for the local run dashboard. It is not implemented yet. The implementation goal is to make a running harness visible without adding a database, queue, worker service, or hidden state.

## Purpose

The dashboard is a read-only, file-backed operations surface for one `.task-runs/<id>/` folder. It answers the operator's live questions:

- what is the runner doing now?
- which requirement or proof item is still pending?
- what changed?
- what evidence exists?
- why is the run accepted, rejected, blocked, or still running?

The dashboard must not become a second source of truth. Run-folder files remain authoritative.

## Target Command

```bash
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
```

Expected behavior:

- starts a local HTTP server on `127.0.0.1`
- prints the exact URL
- serves only the selected run folder
- reads files from disk on each poll or through a lightweight file watcher
- never writes run state
- exits cleanly on `Ctrl-C`

Optional later flags:

```bash
jarvis-harness dashboard --run <run-dir> --port 4817
jarvis-harness dashboard --run <run-dir> --open
```

## Architecture Boundary

Use the files. Do not add unnecessary wiring.

Allowed:

- a small local HTTP server
- static HTML/CSS/JS
- read-only JSON endpoints
- 1-2 second polling
- optional filesystem watch for faster refresh
- links to existing artifacts under the run folder

Not allowed for v1:

- No database
- queue
- new background worker
- remote service
- authentication system
- persistent state outside `.task-runs/<id>/`
- write actions from the dashboard
- mobile-specific layout

The browser is a projection of:

```text
task.md
spec.json
repo-profile.json
proof-plan.json
allowed-files.json
events.jsonl
transcript.jsonl
command-log.jsonl
runner-state.json
changed-files.json
diff.patch
verification.json
verifier-report.json
policy-decision.json
final-report.json
evidence/
```

Missing files should render as `pending` or `not written yet`, not as a dashboard crash.

## Live Streaming Prerequisite

The current runner may buffer some artifacts until the Codex process exits. For a useful live dashboard, the runner should append or flush the following artifacts during execution:

```text
events.jsonl
transcript.jsonl
command-log.jsonl
evidence/runner/codex.stdout.jsonl
evidence/runner/codex.stderr.txt
```

This is the only runner-side change required for v1 dashboard usefulness. The dashboard itself still only reads files.

Implementation rule:

- write raw stdout/stderr chunks as they arrive
- append parsed transcript entries as they are parsed
- append command/event entries when they are observed
- still write final `runner-state.json`, `changed-files.json`, and `diff.patch` after process exit

## Desktop-Only Layout

No mobile layout. If opened on a phone, the page must force the same desktop canvas and allow horizontal panning.

```css
html,
body {
  min-width: 1500px;
  overflow-x: auto;
}

.dashboard {
  width: 1500px;
  margin: 0 auto;
}
```

The dashboard should be dense, operational, and information-rich. Avoid marketing-page styling, oversized hero sections, decorative cards, and mobile rearrangement.

## ASCII Layout

```text
+----------------------------------------------------------------------------------------------------------------------------------------------------------------+
| JARVIS HARNESS RUN                                                                                                           RUNNING  00:18:42  no timeout     |
| Repo: statement-tracker        Branch: feature/statement-db-mvp        Run: 20260625T095410Z-build-the-one-week-statement-tracker-app-mvp-the                 |
| Task: Build the one-week Statement Tracker app MVP                                                                                                             |
| Run dir: /Users/levente/Documents/Jarvis/Projects/statement-tracker/.task-runs/20260625T095410Z-build-the-one-week-statement-tracker-app-mvp-the              |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Resume: jarvis-harness run --run <run-dir>       Verify: jarvis-harness verify --run <run-dir>       Report: jarvis-harness report --run <run-dir> --format text |
+----------------------------------------------+--------------------------------------------------------------+------------------------------------------------------------+
| RUN TIMELINE                                  | CURRENT ACTIVITY                                             | LIVE OUTPUT                                                |
|                                              |                                                              |                                                            |
| 11:54:10  runner started                      | Phase: implementation                                        | > inspecting persistence/store code                        |
| 11:54:14  read package.json                   | Active file: src/store.ts                                    | > found enriched_timeline.json seed path                   |
| 11:54:22  inspected src/store.ts              | Active command: npm test                                     | > adding source begin datetime persistence                 |
| 11:55:03  edited src/store.ts                 | Last event: file edit captured                               | > computing absolute timestamp from start_seconds          |
| 11:56:18  edited src/App.tsx                  | Last artifact: transcript.jsonl                              |                                                            |
| 11:57:02  ran npm test                        | Elapsed: 18m 42s                                             | stderr: none                                               |
| 11:58:44  fixed timestamp import              | Wall-clock limit: none                                       |                                                            |
+----------------------------------------------+--------------------------------------------------------------+------------------------------------------------------------+
| REQUIREMENTS / PROOF                                                                                                         | FILES / DIFF             |
|                                                                                                                              |                          |
| R1  Source metadata persisted: title, URL/file, type, begin datetime, timezone             PENDING   needs command proof      | M src/store.ts           |
| R2  Imported statements receive absolute timestamps from begin datetime + start_seconds     PENDING   test not run yet         | M src/App.tsx            |
| R3  Existing enriched_timeline.json loads into database seed path                           PENDING   seed import pending      | A tests/store.test.ts    |
| R4  Local app has source list, source detail, global timeline, filters                      PENDING   browser smoke pending    | M package.json           |
| R5  Statement detail shows evidence, quote, source offset                                   PENDING   UI smoke pending         |                          |
| R6  Empty/loading/error states are visible                                                  PENDING   browser smoke pending    | Diff: diff.patch         |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------+
| COMMANDS                                                                                          | EVIDENCE                                                       |
|                                                                                                   |                                                                |
| cmd.0001  ls / inspect repo                                      PASS      0.2s                   | evidence/runner/codex.stdout.jsonl                            |
| cmd.0002  npm test                                               RUNNING   14.8s                  | evidence/runner/codex.stderr.txt                              |
| cmd.0003  browser smoke                                          PENDING                          | evidence/commands/cmd.0002.stdout.txt                         |
| cmd.0004  final policy                                           PENDING                          | verification.json                                              |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------+
| DECISION / TRUST STATE                                                                                                                                          |
|                                                                                                                                                                |
| Runner status: running                                                                                                                                          |
| Verification status: pending                                                                                                                                    |
| Policy decision: not-run                                                                                                                                        |
| Blocking reason: none                                                                                                                                           |
| Reject reason: none yet                                                                                                                                         |
| Current risk: no browser proof yet; timestamp import behavior not independently verified                                                                         |
| Next expected transition: implementation exits -> verify command proof -> surface smoke -> verifier -> policy                                                    |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

## Panels

Header:

- run status badge: `running`, `implemented`, `verifying`, `accepted`, `rejected`, `blocked`, `interrupted`
- elapsed time
- wall-clock limit: `none` unless `runner-config.json.timeouts.totalMs` is set
- repo name, branch if available, run id, task title, run dir

Command strip:

- resume command
- verify command
- text report command
- HTML report command after it exists

Run timeline:

- latest events from `events.jsonl`
- parsed inspection/edit/command/final events from `transcript.jsonl`
- newest entries first or time-ordered with sticky bottom; pick the simpler implementation and make it consistent

Current activity:

- phase from latest event or runner state
- latest command from `command-log.jsonl`
- latest edited file from transcript or changed file snapshot
- latest artifact path
- elapsed time

Live output:

- tail of `evidence/runner/codex.stdout.jsonl`
- tail of `evidence/runner/codex.stderr.txt`
- stderr highlighted only when non-empty
- bounded display so huge logs do not lock the browser

Requirements / proof:

- requirements from `spec.json`
- proof obligations from `proof-plan.json`
- status from `verification.json`
- evidence links where present
- pending/fail/pass/block state per row

Files / diff:

- files from `changed-files.json`
- forbidden/sensitive flags highlighted
- link to `diff.patch`
- note when changed files are unavailable because runner is still active

Commands:

- command id
- phase
- command string
- cwd
- status/exit/signal
- duration
- stdout/stderr artifact links

Evidence:

- grouped links to runner, command, surface, manual, and report artifacts
- missing required evidence called out as pending or failed

Decision / trust state:

- runner status from `runner-state.json`
- verification status from `verification.json`
- verifier recommendation from `verifier-report.json`
- policy decision from `policy-decision.json`
- blocking reason
- reject reason
- current residual risk
- next expected transition

## Endpoints

Keep endpoints boring and bounded:

```text
GET /                         dashboard HTML
GET /api/summary              merged run summary
GET /api/events               latest events, bounded
GET /api/output               latest stdout/stderr tails, bounded
GET /api/artifact?path=...    safe artifact reader inside the run dir
```

All paths must be normalized under the selected run dir. Reject traversal, absolute paths outside the run dir, and secret-looking paths. The dashboard is local, but it must still avoid becoming a file browser for the whole machine.

## Acceptance

Implementation is acceptable only when:

- `jarvis-harness dashboard --run <run-dir>` starts a local URL
- dashboard renders an initialized run with missing live artifacts
- dashboard renders an active or fake running run from incrementally written files
- dashboard renders accepted, rejected, blocked, and pending states from fixtures
- dashboard does not write to the run folder
- artifact endpoint rejects path traversal
- page is fixed desktop width with no mobile layout
- large output tails are bounded
- tests cover summary parsing, artifact safety, server startup, and rendered HTML smoke
- `npm run check` and `git diff --check` pass

## Non-Goals

Do not build these in v1:

- multi-run dashboard
- editing task packets
- approving blocked runs from the browser
- rerunning commands from the browser
- pushing/committing/deploying
- external sharing
- auth
- mobile responsive layout
