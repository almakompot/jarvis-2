# Meta-Harness

This directory contains the bounded M1-M9 slice from `docs/meta-harness-roadmap.md`.

It does three things:

- M1 Task Compiler: freeze a raw feature request into requirements, risks, user flow, required checks, manual smoke, and proof obligations.
- M2 Repo Profiler: inspect the live local repository for package manager, scripts, framework/test signals, routes, dirty state, sensitive paths, and live-system risks without reading secret contents.
- M3 Run Envelope: create `.task-runs/<id>/` with the artifacts future runners and verifiers will use.
- M4 Fake Codex Runner: spawn a deterministic fake Codex process and capture transcript, command logs, command evidence, changed files, diff, runner events, and terminal state.
- M4 Real Codex Wrapper: construct a prompt from an initialized task packet, launch Codex CLI in the target repo, and capture process output, transcript rows, diff, changed files, runner events, and terminal state.
- M5 Command Proof Executor: run allowed local proof commands, capture stdout/stderr/exit/timing, and update requirement/proof coverage.
- M5 Surface Proof Executor: record runnable-surface evidence for browser, extension, API, CLI, data, visual, and manual proof obligations.
- M6 Completed-Run Verifier: independently audit a completed run folder and write severity-classified findings to `verifier-report.json`.
- M7 Failure Corpus: replay sanitized expected-fail and expected-pass cases against the verifier and policy engine.
- M8 CLI/Report UX: expose daily `meta` commands and render findings-first text/HTML reports from run artifacts.
- M9 Policy Engine: convert verification, verifier findings, task-class policy, optional corpus replay, and explicit overrides into `policy-decision.json`.

It does not yet provide a dashboard or automatic minimization and sanitization for promoted corpus cases.

## Commands

```bash
npm run meta -- run --repo /path/to/repo --task "build X"
npm run meta -- init --repo /path/to/repo --task "build X"
npm run meta -- run --run /path/to/repo/.task-runs/<id> --dry-run
npm run meta -- verify --run /path/to/repo/.task-runs/<id>
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format text
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format html
npm run meta -- rerun --from /path/to/repo/.task-runs/<id>
npm run meta -- promote-failure --run /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
npm run meta -- cleanup --repo /path/to/repo --dry-run
npm run meta:final-audit
```

The older focused scripts remain available for direct component work:

```bash
npm run meta:init -- --repo /path/to/repo --task "build X"
npm run meta:validate -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:codex-runner -- --run-dir /path/to/repo/.task-runs/<id> --dry-run
npm run meta:verify-commands -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:verify-surfaces -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:verifier -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:policy -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:corpus
npm run meta:promote-failure -- --run-dir /path/to/repo/.task-runs/<id> --category missing-smoke --case-id browse-reset
npm run meta:check
```

## Required Artifacts

```text
task.md
repo-profile.json
spec.json
proof-plan.json
allowed-files.json
runner-config.json
events.jsonl
command-log.jsonl
transcript.jsonl
diff.patch
changed-files.json
runner-state.json
verification.json
evidence/
verifier-report.json
policy-decision.json
final-report.json
html-report/
```

The validator rejects packets that are incomplete, unmapped, too generic for concrete task cues, missing repo-native proof commands, unsafe for secret paths, or already claiming success without evidence.

## M4 Fake Runner

`meta-harness/lib/fake-runner.mjs` wraps `meta-harness/scripts/fake-codex.mjs` as a child process. The fake process can simulate:

- successful implementation attempts
- failed verification commands
- edits before inspection
- forbidden file edits
- total runner timeout
- user interruption
- final overclaim before verification
- web UI browse empty-state/reset implementation attempts

The runner writes command stdout/stderr under `evidence/commands/`, process stdout/stderr under `evidence/runner/`, appends JSONL transcript and event rows, captures a before/after filesystem diff excluding `.task-runs`, `.git`, and `node_modules`, and records terminal status in `runner-state.json`. Forbidden or sensitive paths such as `.env` are listed by path only; their content is redacted from `diff.patch`.

## M4 Real Codex Wrapper

`meta-harness/lib/codex-runner.mjs` detects the installed Codex CLI flags, builds the runner prompt from `task.md`, `repo-profile.json`, `spec.json`, `proof-plan.json`, `allowed-files.json`, the local fresh-repo protocol, and target repo `AGENTS.md`, then launches `codex exec` in the target repo.

The wrapper records:

- `runner-config.json` with CLI version, supported flags, command, sandbox request, prompt source, and capture mode
- `evidence/runner/codex-prompt.md` or `codex-dry-run-prompt.md`
- raw Codex stdout/stderr under `evidence/runner/`
- parsed transcript entries in `transcript.jsonl`
- the Codex process command in `command-log.jsonl`
- filesystem snapshot diff in `diff.patch` and `changed-files.json`
- terminal status, timeout, interruption, blockers, warnings, and capture completeness in `runner-state.json`

Dry-run mode requests read-only Codex execution and is meant for safe capture checks. It must not modify files or change `final-report.json`; later M5/M6/M9 components remain responsible for proof execution, verification, and acceptance.

## M5 Proof Executors

`meta-harness/lib/command-executor.mjs` reads `spec.requiredTests`, runs allowed local commands, stores command stdout/stderr under `evidence/commands/`, appends `command-log.jsonl`, and updates `verification.json`.

`meta-harness/lib/surface-executor.mjs` reads `proof-plan.json` `surfaceProofs` and writes typed evidence for:

- `browser-smoke` and `browser-extension-smoke` scenario artifacts
- `api-smoke` and `request-response` local HTTP request/response proof
- `cli-smoke` direct binary invocation without a shell
- `data-fixture`, `generated-artifact`, and `manifest` output validation
- `screenshot`, `trace`, and `manual-smoke-artifact` concrete artifact references

Passed evidence must match an accepted evidence type on the target proof obligation. Missing web or extension surface proof is blocked instead of left as a vague pending claim.

## M6 Completed-Run Verifier

`meta-harness/lib/verifier.mjs` reads the full run folder after runner and proof execution. It does not trust `final-report.json`; it recomputes whether the artifacts support the completion claim and writes `verifier-report.json`.

The verifier audits:

- required artifact presence and schema validation
- run-state/event ordering, including edits before inspection and verification before final edits
- runner-state failures that should block completion
- requirement, proof-obligation, and evidence traceability
- existence of passed evidence artifacts, including surface-evidence manifests and captured artifact records
- command exit/status consistency and referenced stdout/stderr artifacts
- accepted evidence types and task-class surface evidence
- changed-file boundaries, forbidden paths, and diff/changed-file mismatches
- final-report claims, proof results, requirement results, evidence citations, and residual risk

Findings use `blocking`, `major`, `minor`, or `info`. A run with any blocking or major finding gets `status: failed` and `decisionRecommendation: reject`; otherwise the verifier recommends `accept`.

The adversarial mutation suite in `meta-harness/scripts/verifier-mutations.test.mjs` starts from valid command and browser-smoke runs, then mutates them by deleting evidence, changing exit codes, removing browser smoke, adding `.env` edits, moving proof before edits, citing unknown evidence, removing residual risk, and claiming pass after failed verification.

## M7 Failure Corpus

`corpus/meta-harness` stores committed, sanitized replay cases for known false-pass patterns. Each case has `case.json`, `mutation.json`, `input/task.md`, `expected/policy-decision.json`, and a short README.

Committed cases must be public synthetic or otherwise sanitized:

- `privacy.classification` must be set.
- `privacy.sanitized` must be `true`.
- `privacy.containsPrivateData` must be `false`.
- `privacy.allowedForCommit` must be `true`.

`npm run meta:corpus` builds deterministic fixture runs, applies the case mutation, reruns M6 and M9, and writes `tmp/meta-harness-corpus/replay-summary.json`. The current corpus includes five expected-fail cases for fake verification, missing browser smoke, forbidden `.env` edits, failed verification reported as passed, and proof timing before final edits. It also includes one expected-pass case proving a valid command-proof run is still accepted.

`npm run meta:promote-failure` creates a private-staging skeleton from a rejected or blocked run. It records the source decision and expected rules but does not copy raw run artifacts; promoted cases must be minimized and sanitized before commit.

## Web UI Replay

`evals/web-ui-replay` contains the first full web UI replay for the harness. It creates a public synthetic VOOVO-style browse fixture, initializes a real task packet from the raw request, runs the `web-ui-success` fake implementation scenario, executes command and browser-smoke proof, adds repo-profile and final-report bridge evidence, runs M6 verifier, runs M9 policy, and renders M8 reports.

```bash
npm run web-ui:replay
npm run web-ui:test-replay
```

The replay must end with `verification: passed`, `verifier: passed`, and `policy: accepted`. `npm run check` includes the regression test.

## Browser Extension Replay

`evals/browser-extension-replay` contains the first full browser-extension replay. It copies the public Site Gate extension into isolated temporary repos, initializes task packets from the raw Site Gate request, runs the `browser-extension-success` fake implementation scenario, executes manifest validation and unpacked-extension CDP smoke, validates the generated extension scenario through the surface executor, and renders reports.

```bash
npm run browser-extension:replay
npm run browser-extension:test-replay
```

The accepted run must pass with real `browser-extension-smoke` surface evidence. The syntax-only run intentionally labels `npm run syntax` as user smoke; verifier and policy must reject it because no passed surface-executor extension evidence exists.

## Non-Web Replay

`evals/non-web-replay` contains the first full data-pipeline replay. It creates a synthetic Hungarian old-doc OCR fixture repo, initializes task packets from the raw OCR/data request, runs the `data-pipeline-success` fake implementation scenario, invokes the actual local pipeline CLI, validates invalid-input behavior, checks generated artifacts through manifest value and content assertions, and renders reports.

```bash
npm run non-web:replay
npm run non-web:test-replay
```

The accepted run must pass with real `data-fixture` surface evidence. The weak-artifact run intentionally writes files that exist but lack searchable text-layer content; verifier and policy must reject it because generated artifact existence is not enough.

## M8 CLI And Reports

`meta-harness/scripts/meta.mjs` is the daily command surface. It delegates to the existing runner, verifier, policy, corpus, and run-envelope libraries instead of replacing their JSON artifacts.

`npm run meta -- report --run <dir>` renders a text report that starts with findings, then shows:

- policy decision and blocking reason
- active policy rules
- passed and failed commands with exit codes
- missing proof obligations
- evidence IDs and artifact paths
- residual risk
- next action

`npm run meta -- report --run <dir> --format html` writes `html-report/index.html` with evidence links back to run-folder artifacts. JSON files remain authoritative; the report is a readable projection of the current run state.

`meta rerun` creates a child run with `parent-run.json`. `meta cleanup --dry-run` lists only directories under repo-local `.task-runs/` that contain a matching `meta-harness.task-spec`; `--delete` is required before it removes anything.

## New-Session Usage

Use `docs/meta-harness-new-session-usage.md` when a fresh Codex session needs to operate the harness. The short version is:

```bash
npm run meta -- run --repo /path/to/repo --task "build X"
npm run meta -- verify --run /path/to/repo/.task-runs/<id>
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format text
```

Do not report completion unless `policy-decision.json` is accepted. Rejected runs should lead with the failed acceptance reason and an agent/harness repair action. Blocked runs should lead with the external condition and the user/operator input needed.

## Final Report Format

The report contract is documented in `docs/meta-harness-final-report-format.md`.

Text reports render these sections in order:

```text
Findings:
Decision:
Blocking reason:
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

`policy-decision.json`, `verification.json`, `verifier-report.json`, and evidence files remain authoritative. The text and HTML reports are projections for humans.

## A/B Evaluation Harness

`evals/ab-harness` compares baseline Codex behavior against meta-harnessed Codex behavior. The committed suite is deterministic and small:

```bash
npm run ab-harness:dry-run
npm run ab-harness:test
```

It defines task sets, harness variants, repeated-run records, scoring rubric, artifact collection, failure classification, and summary reports. The 200-500 run count is validation campaign scale after the harness is stable, not an implementation checklist.

## Final Packaging Audit

`npm run meta:final-audit` verifies that stable scripts, docs, CI wiring, report-format docs, new-session docs, task-class replay docs, and final goal metadata are present. It writes:

```text
tmp/meta-harness-final-audit/summary.json
tmp/meta-harness-final-audit/report.md
```

`npm run check` includes this audit.

## M9 Policy Engine

`meta-harness/lib/policy-engine.mjs` reads a run folder and writes the authoritative `policy-decision.json`. It is deterministic for the same inputs and separates `accepted`, `rejected`, and `blocked`.

Default rules cover:

- missing required artifacts as `POL-ARTIFACT-001`
- unmapped or broken requirement/proof links as `POL-TRACE-001`
- verification not run or failed as `POL-VERIFY-001` / `POL-VERIFY-002`
- missing task-class surface proof as `POL-UI-001` or `POL-SURFACE-001`
- forbidden file edits as `POL-FILES-001`
- unknown, missing, or non-passing evidence citations as `POL-HONESTY-001` / `POL-HONESTY-002`
- verifier ordering failures as `POL-ORDER-001`
- corpus replay regression as `POL-CORPUS-001`
- runner, verifier, verification, or corpus blocked states as `POL-BLOCKED-001`

Optional `policy-overrides.json` records explicit human overrides with user, timestamp, reason, and remaining risk. Overrides do not delete the fired rule; they mark overrideable rules as overridden inside `policy-decision.json`.

## Repo Profile

`repo-profile.json` is produced by the M2 core profiler. It records:

- package manager signals from `packageManager` and lockfiles
- full package script names and command bodies with risk categories
- framework signals such as Next App Router, browser extension, Node CLI, Python pipeline, and Flutter
- test signals from scripts, configs, dependencies, and test files
- dev-server candidates and inferred ports
- route, extension, CLI, API, and data-pipeline surfaces
- Git root, target-relative path, dirty summary, and status entries
- sensitive path patterns and detected secret-like paths with `contentsRead: false`
- live-system risks from deploy/send/migration/cost scripts and dependencies

The profiler may record that `.env.local` exists, but it must not read or copy its contents.

## M2 Fixture Matrix

Profiler tests use deterministic fixture builders in `meta-harness/scripts/fixtures/repo-fixtures.mjs`.

The current matrix covers:

- `next-web`: package-manager conflicts, Next App Router routes, dev/build/test/e2e/smoke scripts, deploy risk, Stripe/Supabase risk, and `.env.local` detection without content reads.
- `browser-extension`: Manifest V3, background/content scripts, extension pages, host permissions, smoke script, and publish risk.
- `node-cli`: package `bin`, CLI files, node test script, and CLI smoke script.
- `python-data`: `pyproject.toml`, pipeline scripts, fixtures, outputs, manifests, and pytest-style tests.
- `dirty-nested`: target path inside a nested Git repo with dirty/untracked files recorded and untouched.
- `sensitive-paths`: `.env`, private key, and service-account-like files recorded as paths only, with secret text excluded from profile JSON.
