# Meta-Harness Goal Tool Calls

Plan version for all calls in this file:

- Implementation plan: `docs/meta-harness-implementation-plan.md`
- Plan version label: `implementation-plan-v1-accepted-2026-06-24`
- Verification report: `docs/meta-harness-implementation-plan-verification-report.md`
- Verified status: `ACCEPTED`
- Verified word count: `16,887`

Use these calls in order. Each goal must start by rereading the implementation plan version named in that goal and the verification report above. A goal is complete only when its own capability is implemented, locally verified, documented where needed, and does not weaken any previously accepted milestone.

## 1. M1/M3 Hardening

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 4, 9, 11, 20, 25, 26, 30, and 33) as the controlling spec, harden M1 task compiler and M3 run envelope. Improve task cue extraction, requirement specificity, non-requirements, risks, user flows, proof-obligation mapping, allowed-file defaults, seed artifacts, run ID/path safety, and validators. Acceptance: concrete packets reject generic proof for concrete tasks, target artifact placeholders are present where appropriate, `npm run meta:check`, `npm run check`, and `git diff --check` pass, and a real `voovo-checkout` packet demonstrates richer proof planning."
}
```

## 2. M2 Repo Profiler Core

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 10, 19, 20, 25, 26, 30, and 33) as the controlling spec, build M2 repo profiler core. Implement live repo discovery for package manager, scripts, framework signals, test signals, routes, dev-server hints, dirty state, nested repo boundaries, sensitive path policy, and live-system risks without reading secret contents. Acceptance: `repo-profile.json` schema is explicit, profiler tests cover real filesystem fixtures, stale memory cannot satisfy profiling, `npm run check`, and `git diff --check` pass."
}
```

## 3. M2 Fixture Matrix

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 10, 19, 20, 21, 22, 25, 26, 30, and 33) as the controlling spec, build the M2 fixture matrix for Next/web UI, browser extension, Node CLI, Python/data pipeline, dirty repo, and sensitive-path scenarios. Acceptance: fixtures are small, deterministic, and checked by repo-profiler tests; expected profiles include scripts, routes/surfaces, tests, risks, dirty state, and forbidden paths; `npm run check`, and `git diff --check` pass."
}
```

## 4. M4 Fake Runner Harness

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 12, 20, 22, 25, 26, 30, and 33) as the controlling spec, build the M4 fake Codex runner harness. Use a fake executable/process to simulate successful runs, failed commands, edits before inspection, forbidden edits, timeouts, interruptions, and final overclaim. Acceptance: runner captures transcript, command log, diff, changed files, events, and terminal state from fake runs; mutation tests prove weak runs are rejectable; `npm run check`, and `git diff --check` pass."
}
```

## 5. M4 Real Codex Wrapper

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 3, 6, 7, 12, 20, 25, 26, 30, and 33) as the controlling spec, build the first real Codex CLI wrapper around initialized task runs. It must construct the runner prompt from the frozen task packet, launch Codex in the target repo, capture transcript/process output where available, record command/diff artifacts, handle timeouts/blockers, and preserve run state. Acceptance: fake-run tests still pass, one safe local dry run captures artifacts, no final prose bypasses artifacts, `npm run check`, and `git diff --check` pass."
}
```

## 6. M5 Command Executor

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 13, 20, 22, 25, 26, 27, 30, and 33) as the controlling spec, build M5 command proof executor. It must read `proof-plan.json`, run allowed local commands with cwd/env/timeouts, capture stdout/stderr/exit/timing, write `command-log.jsonl`, write command evidence files, and update `verification.json` by requirement and proof-obligation ID. Acceptance: tests cover pass, fail, timeout, missing command, unsafe command classification, and rerun behavior; failed commands cannot satisfy proof; `npm run check`, and `git diff --check` pass."
}
```

## 7. M5 Surface Executors

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 13, 19, 20, 21, 22, 25, 26, 30, and 33) as the controlling spec, extend M5 beyond shell commands with browser, extension, API, CLI, data/artifact, visual/manual evidence handlers. Acceptance: web UI and browser-extension proof obligations require runnable-surface evidence, API proof records request/response, CLI proof invokes the actual binary, data proof validates generated outputs, manual evidence requires concrete artifact paths, tests cover missing and wrong evidence types, `npm run check`, and `git diff --check` pass."
}
```

## 8. M6 Verifier Core

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 6, 7, 8, 14, 20, 22, 25, 26, 30, 31, and 33) as the controlling spec, build M6 completed-run verifier core. It must validate artifact presence, schemas, run-state transitions, requirement-proof-evidence traceability, command exits, accepted evidence types, changed-file boundaries, event ordering, and final-claim citations. Acceptance: verifier writes `verifier-report.json`, distinguishes blocking/major/minor findings, rejects invalid run folders, tests cover all core gates, `npm run check`, and `git diff --check` pass."
}
```

## 9. M6 Adversarial Mutation Suite

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 14, 22, 28, 30, 31, and 33) as the controlling spec, build the adversarial M6 mutation suite. Mutate valid run folders by deleting evidence, changing exit codes, removing browser smoke, editing `.env`, moving tests before edits, citing unknown evidence, removing residual risk, and claiming pass after failure. Acceptance: each mutation is rejected or produces the expected blocking finding, expected-good runs still pass verifier review, `npm run check`, and `git diff --check` pass."
}
```

## 10. M9 Policy Engine

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 16, 20, 22, 25, 26, 28, 30, 31, and 33) as the controlling spec, build M9 deterministic policy engine. It must consume `verification.json`, `verifier-report.json`, corpus replay status, task-class policy, and override records to write `policy-decision.json` with accepted/rejected/blocked decisions. Acceptance: rules cover missing artifacts, unmapped requirements, failed verification, missing required smoke, forbidden edits, unknown evidence, corpus regression, blocked conditions, and explicit overrides; policy recomputation is deterministic; `npm run check`, and `git diff --check` pass."
}
```

## 11. M7 Failure Corpus V1

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 15, 20, 22, 25, 26, 30, 31, and 33) as the controlling spec, build M7 failure corpus v1. Define corpus case format, privacy classification, minimized fixtures, expected-pass/expected-fail labels, replay command, and promotion workflow from rejected runs. Acceptance: at least five known false-pass cases replay and reject, at least one expected-pass case proves the harness is satisfiable, corpus replay participates in `npm run check`, and `git diff --check` passes."
}
```

## 12. M8 CLI And Report UX

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 17, 20, 24, 25, 26, 30, and 33) as the controlling spec, build M8 CLI/report UX. Implement or stabilize `meta init`, `meta run`, `meta verify`, `meta report`, `meta rerun`, `meta promote-failure`, and `meta cleanup` around the run folder. Reports must lead with findings, show policy decision, commands, evidence links, residual risk, and next actions. Acceptance: CLI snapshot tests cover accepted, rejected, blocked, missing-file, and evidence-link cases; `npm run check`, and `git diff --check` pass."
}
```

## 13. End-To-End Web UI Replay

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 3, 19, 20, 21, 24, 25, 30, and 33) as the controlling spec, run the first full end-to-end web UI replay through the meta-harness, preferably the `voovo-checkout` browse empty-state/reset class from the worked example. Acceptance: the run starts from raw task and repo, creates profile/spec/proof/envelope, executes or simulates implementation safely as needed, runs user-surface proof, verifier audits it, policy decides, report renders, and the replay becomes a regression case; `npm run check`, and `git diff --check` pass."
}
```

## 14. End-To-End Browser Extension Replay

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 19, 20, 21, 24, 25, 30, 31, and 33) as the controlling spec, run a full browser-extension replay through the meta-harness using the Site Gate task class. Acceptance: manifest validation, unpacked-extension/browser smoke, invalid custom minutes, one-minute allow, five-minute allow, custom allow, same-origin reuse, and decline-to-blocked behavior are represented as proof obligations and evidence; syntax-only proof is rejected; replay is added to regression checks; `npm run check`, and `git diff --check` pass."
}
```

## 15. End-To-End CLI/Data Replay

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 19, 20, 21, 24, 25, 30, 31, and 33) as the controlling spec, run a full non-web replay through the meta-harness for either a CLI task or data/OCR pipeline task. Acceptance: the adapter detects real command surfaces, proof invokes the actual CLI or pipeline, invalid-input/negative behavior is tested, generated artifacts are validated beyond existence, cost/approval boundaries are recorded where relevant, replay becomes a regression case, `npm run check`, and `git diff --check` pass."
}
```

## 16. Security, Secrets, And Live-System Hardening

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 2, 7, 10, 12, 16, 18, 22, 24, 30, 31, and 33) as the controlling spec, harden security, secret, and live-system boundaries across the harness. Acceptance: repo profiling records `.env*` existence without reading contents, command guards block deploy/push/send/spend/migration actions unless explicitly approved, forbidden path edits reject, corpus promotion sanitizes private evidence, approval events are recorded, tests cover secret leaks and live mutation attempts, `npm run check`, and `git diff --check` pass."
}
```

## 17. A/B Eval Harness

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 15, 19, 21, 22, 24, 30, and 33) as the controlling spec, build the A/B evaluation harness for comparing baseline Codex runs against meta-harnessed runs. Acceptance: define task set format, harness variant format, repeated-run protocol, scoring rubric, artifact collection, failure classification, and summary report. Include a small dry-run suite and make it clear that 200-500 runs are validation scale, not implementation steps; `npm run check`, and `git diff --check` pass."
}
```

## 18. Final Packaging, CI, Docs, And New-Session Usage

```json
{
  "objective": "Using implementation-plan-v1-accepted-2026-06-24 (`docs/meta-harness-implementation-plan.md`, sections 1, 3, 17, 20, 23, 24, 25, 26, 32, and 33) as the controlling spec, finish packaging, CI integration, docs, and new-session usage for the full M0-M10 meta-harness. Acceptance: stable npm scripts and/or `meta` CLI entrypoints exist, CI/check script runs the right suites, docs explain how to use the harness in a new Codex session, examples are current, final report format is documented, all prior milestone tests pass, `npm run check`, `git diff --check`, and a final verifier audit pass."
}
```
