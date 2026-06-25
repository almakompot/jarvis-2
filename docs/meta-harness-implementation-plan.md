# Meta-Harness Implementation Plan

## 1. Executive Summary

The final deliverable is a local meta-harness CLI that takes a repository plus a feature request, creates a frozen contract, runs or controls Codex against that contract, captures evidence, executes verification, independently reviews the result, and rejects "done" unless the requested user-facing behavior is proven. The harness is not intended to make an agent morally disciplined. It is intended to make undisciplined behavior observable, incomplete work rejectable, and real proof easier to produce than vague completion prose.

The intended top-level command is:

```bash
meta run --repo /path/to/repo --task "build X"
```

The expected run output is a structured task folder:

```text
.task-runs/<id>/
```

That folder is the central object of the system. It contains the task contract, repository profile, proof plan, allowed file policy, command log, transcript, diff, verification evidence, verifier report, policy decision, and final report. A human can read it. A verifier can audit it. A later regression suite can replay it. A policy engine can reject it.

The meta-harness is built around the M0-M10 roadmap. M0 defines the doctrine and contract. M1 compiles a vague feature request into requirements and proof obligations. M2 profiles the repository so the harness does not guess scripts, routes, or risk surfaces. M3 creates the run envelope. M4 wraps Codex CLI execution. M5 runs declared proof. M6 independently audits the proof and final claims. M7 collects real failures into a corpus. M8 makes the system usable through CLI and reports. M9 turns verification and failure knowledge into hard pass/reject/block policy. M10 generalizes across task classes after the first classes are proven.

The key design invariant is traceability:

```text
Requirement -> Proof obligation -> Verification command/scenario -> Evidence artifact -> Verifier finding -> Policy decision
```

The system is accepted only when the final decision is based on artifacts, not assistant prose. If a requirement has no proof obligation, the run cannot pass. If a proof obligation cites no evidence, the run cannot pass. If a final report cites nonexistent evidence, the run cannot pass. If a UI feature was not exercised through the runnable surface, the run cannot pass for a UI task. The final value is not that Codex writes code. The final value is that the system can answer: what was requested, what changed, what proof ran, what evidence exists, what remains risky, and whether the run should be accepted.

## 2. Product Goal And Non-Goals

The product goal is to build a delivery judge and execution harness around Codex for local software work. The harness should take a fresh repository and a task, force the task into a structured contract, execute or supervise the implementation, collect evidence, and make a final acceptance decision. It should be useful when the user says "build this" and also when the user asks whether a run was actually done. It should reduce the gap between model capability and delivered reliability by changing the work environment, not by trusting the model to remember every discipline rule.

The harness is not a generic app builder. It should not promise to create any product from any sentence with no human judgment. The harness creates a controlled delivery process. It may call Codex to build a feature, but its own responsibility is to define, execute, verify, and judge the run. The product should be evaluated by whether it rejects weak runs and preserves evidence, not by whether it can invent arbitrary product ideas.

The harness is not a replacement for tests. It uses tests, generates test obligations, runs tests, and audits tests. Existing unit tests, integration tests, browser tests, smoke checks, and manual artifacts remain first-class proof. The harness makes sure they are the right tests for the claim. A green generic test suite is not enough if the requested user behavior is untested.

The harness is not a production deploy system. It may eventually understand deploy risk, verify preview deployments, or require rollback plans, but production deployment is not the core deliverable. Deployment, sends, pushes, database writes, external API spending, and production mutations require explicit policy and approval boundaries. The harness should default to local verification and read-only inspection unless the task explicitly requires otherwise.

The harness is not a perfect semantic oracle. It cannot know all domain truth from a short request. It can, however, force requirements to be explicit, force ambiguity to be recorded, force evidence to map to claims, and make weak proof visible. When semantic uncertainty remains, the correct outcome is a residual risk or blocked decision, not a confident pass.

The harness is a system for making claims rejectable. This is the central product goal. "I tested it" becomes a command record with exit code, time, stdout path, stderr path, and linked requirement IDs. "The button works" becomes a browser trace, screenshot, DOM assertion, or manual artifact. "Done" becomes a policy decision that can be accepted or rejected.

The product should also become a learning system. Every real failure should be eligible for promotion into the failure corpus. If Codex once claimed a UI flow worked while the button crashed, that failure should become a fixture, a mutation, or a replay case. Over time the harness improves because it accumulates concrete examples of what weak work looks like.

## 3. End-To-End User Workflow

The ideal workflow begins with a user request:

```bash
meta run --repo /Users/levente/Documents/Jarvis/Projects/Work/VOOVO/DEV/voovo-checkout --task "Improve the browse marketplace no-results search state so a user who searches for unavailable content sees a clear empty state and can reset back to visible offerings."
```

The harness creates a run ID and initializes `.task-runs/<id>/`. It records `task.md` with the raw request. It records an initial `events.jsonl` entry saying the run was created. From this moment forward, every meaningful action has a place to write evidence. The run starts in `created`.

Next the repo adapter profiles the repository. It inspects package manager files, scripts, framework signals, routes, test directories, existing smoke commands, dirty worktree state, and sensitive paths. For `voovo-checkout`, it should detect a Next app, pnpm, `dev:clean`, `test`, `test:e2e`, `smoke:browse`, Playwright config, Vitest config, and browse routes under `app/(browse)`. It writes `repo-profile.json` and moves the run toward `profiled`.

The task compiler then creates `spec.json`, `proof-plan.json`, and `allowed-files.json`. The browse empty-state task becomes requirements such as: preserve current browse behavior, show a clear no-results state for unavailable searches, provide a reset action that restores visible offerings, update automated coverage, and verify through the browser surface. The proof plan maps those requirements to a unit or component test, a Playwright browse scenario, and the existing smoke check. The run becomes `specified` and `planned`.

The Codex runner builds a prompt from the task packet and launches Codex in the target repository. It captures transcript and event data. It records inspection commands before edit commands. It records file changes and produces `diff.patch` and `changed-files.json`. If Codex attempts to edit forbidden paths, the runner records a violation. If Codex gets interrupted, times out, or declares a blocker, the run state reflects that rather than pretending completion.

After implementation, the verification executor runs the declared proof. For the browse example it might run:

```bash
pnpm run test
pnpm run test:e2e e2e/browse-to-purchase.spec.ts
BASE_URL=http://127.0.0.1:3001 pnpm run smoke:browse
```

The executor records command exits, logs, screenshots, browser traces, and requirement mappings in `verification.json` and `evidence/`. If the dev server is required, the executor records how it started, which port was used, and whether the smoke actually hit the local app.

The independent verifier then reads the run folder. It does not trust the final report. It checks that the requirements have proof obligations, the proof obligations cite accepted evidence types, the commands passed, the browser flow exists, the diff stayed in allowed paths, inspection preceded edits, and the final claims cite real evidence. It writes `verifier-report.json`.

The policy engine reads M5 verification output, M6 verifier findings, and M7 failure-corpus rules. It writes `policy-decision.json`. If the user-smoke proof is missing, the decision is reject. If tests failed and the final report says passed, the decision is reject. If a production credential is needed and missing, the decision may be blocked. If all required gates pass, the decision is accepted.

The report surface then renders a human result:

```text
Operator status: repairing
Internal policy decision: rejected
Reason: R4 has no user-smoke evidence.
Passed commands: pnpm run test
Failed commands: none
Missing evidence: browser smoke for reset action
Residual risk: browse data came from local fixtures only
Next action: run Playwright reset scenario and rerun policy
```

When a run reveals a useful failure, the user can promote it:

```bash
meta promote-failure --run .task-runs/<id> --category missing-user-smoke
```

Promotion creates a minimized fixture or replay case. Later changes to the harness must keep rejecting that failure. This closes the learning loop.

## 4. Current State

The current repository already contains important foundations. M0 doctrine exists in `docs/fresh-repo-feature-protocol.md`. That document defines the testing-first fresh-repo workflow: inspect before editing, define proof before implementation, run automated checks after the final edit, exercise user-facing surfaces, and keep final claims no stronger than evidence.

The roadmap exists in `docs/meta-harness-roadmap.md`. It defines M0 through M10 and names the final direction: a meta-harness that takes a fresh repo plus feature request, forces disciplined build process, and rejects "done" unless the runnable surface was actually verified.

M1/M3 v0 exists in `meta-harness`. The current implementation provides a task-packet generator and validator. `npm run meta:init` creates a `.task-runs/<id>/` folder in a target repo. It writes `task.md`, `repo-profile.json`, `spec.json`, `proof-plan.json`, `allowed-files.json`, `events.jsonl`, `verification.json`, and `final-report.json`. `npm run meta:validate` validates generated packets. `npm run meta:check` runs tests and a smoke generator.

The current compiler is intentionally conservative. It preserves the raw request, creates a small set of standard requirements, maps them to proof obligations, records non-requirements and risks, and detects simple repo script cues. For a `voovo-checkout` browse search task, it can infer browse/search/empty-state/reset cues and suggest `pnpm run test`, `pnpm run test:e2e e2e/browse-to-purchase.spec.ts`, and `BASE_URL=http://127.0.0.1:3001 pnpm run smoke:browse`. This is useful but not yet a deep semantic compiler.

The acceptance gate exists in `evals/acceptance-gate`. It is an early independent verifier for disciplined Codex runs. It rejects missing prompt input, edits before inspection, forbidden file edits, missing verification, failed verification reported as passed, unknown evidence citations, missing proof obligation results, unaccepted evidence types, and missing declared proof artifacts.

The Site Gate extension smoke exists in `apps/site-gate-extension`. It is a concrete browser-extension example with a real Chromium smoke flow. It verifies the gate page, invalid custom minutes, one-minute allow, five-minute allow, custom allow, same-origin reuse, and decline-to-blocked behavior. It also records local evidence.

The VOOVO replay harness exists in `evals/voovo-pr-replay`. It is a scaffold for counterfactual PR replay and structured comparison. It has safety gates for leakage, command guards, manual proof validation, and replay case validation.

The current limitations are substantial. There is no deep M2 repo adapter. There is no M4 Codex runner wrapper that captures a live Codex implementation transcript. There is no M5 verification executor that runs arbitrary proof plans from `proof-plan.json`. There is no completed-run M6 verifier for the target architecture. There is no M7 failure corpus manager. There is no M9 policy engine. There is no M8 daily report/dashboard surface beyond existing command output. The current system can create and validate a task packet; it cannot yet prove that an implementation run completed correctly.

## 5. Target Architecture

The target architecture is a pipeline of components connected by durable artifacts. Each component owns a narrow job and writes files the next component consumes.

The task compiler owns request interpretation. Its inputs are the raw task, user-provided constraints, optional examples, and the repo profile. Its outputs are `spec.json`, `proof-plan.json`, and initial `allowed-files.json`. It moves a run from `created` to `specified` or `planned`. Its failure modes include generic requirements, missing non-requirements, missing negative paths, and proof obligations that do not cover the actual user surface. Tests for the compiler must include mutation cases where requirements are unmapped, required smoke is missing, and task-specific cues are ignored.

The repo adapter owns current-state discovery. Its inputs are a repo path and optional adapter configuration. Its output is `repo-profile.json`. It moves the run toward `profiled`. It reads package files, configs, source tree shape, test directories, scripts, route files, Git status, and safety signals. Its failure modes include stale assumptions, missing package-manager detection, wrong dev server command, reading secrets, treating generated build artifacts as source, and ignoring dirty worktree state. Tests must use fixture repos for Next, Node CLI, browser extension, Python pipeline, and mobile-style repositories.

The run envelope owns persistence. Its inputs are the run ID, target repo, task text, and initial compiled artifacts. Its output is the `.task-runs/<id>/` folder. It owns `events.jsonl` and run-state metadata. Its failure modes include overwriting previous runs, path traversal, writing artifacts outside the repo unexpectedly, and losing append-only event history. Tests must cover run ID generation, overwrite policy, required artifact presence, and path normalization.

The Codex runner owns implementation execution. Its inputs are the compiled task packet, protocol text, repo path, sandbox policy, and runner options. Its outputs are `transcript.jsonl`, `command-log.jsonl`, `diff.patch`, `changed-files.json`, and event entries. It moves a run through `running` and `implemented`, or to `blocked`/`rejected` if execution fails. Its failure modes include losing command evidence, allowing edits before inspection, failing to capture diff, hiding failed commands, or letting Codex final prose bypass artifacts. Tests must simulate successful runs, failed runs, interrupted runs, and attempts to touch forbidden files.

The verification executor owns proof execution. Its inputs are `proof-plan.json`, `repo-profile.json`, `changed-files.json`, and task-class adapters. Its outputs are `verification.json` and files under `evidence/`. It moves the run through `verification-running` and `verified` or to `rejected`/`blocked`. Its failure modes include running generic tests but not user smoke, misclassifying failed commands, missing logs, allowing stale dev servers, or accepting manual claims with no artifact. Tests must include unit, browser, API, CLI, and manual-evidence scenarios.

The independent verifier owns audit. Its inputs are all prior artifacts. Its output is `verifier-report.json`. It moves the run to `reviewing`. It checks schemas, state transitions, command exits, requirement mappings, final claims, proof obligation evidence, diff boundaries, timing, and residual risk. Its failure modes include being too permissive, relying on final report prose, missing evidence mismatch, or failing to detect happy-path-only proof. Tests must mutate artifacts and assert rejection.

The failure corpus owns institutional memory. Its inputs are rejected runs, user-reported failures, minimized fixtures, and replay cases. Its outputs are corpus entries, mutation tests, and policy rule proposals. It does not move a normal run state directly, but it informs verification and policy. Its failure modes include storing large unminimized cases, leaking private data, or creating brittle cases that fail for irrelevant reasons.

The policy engine owns final acceptance. Its inputs are `verification.json`, `verifier-report.json`, corpus results, task-class policy, and user override state. Its output is `policy-decision.json`. It moves the run to `accepted`, `rejected`, or `blocked`. Its failure modes include accepting warnings as passes, missing severity thresholds, not distinguishing blocked from rejected, or allowing manual override without recording it.

The report surface owns daily usability. Its inputs are all final artifacts. Its outputs are CLI output and `html-report/`. It does not decide. It explains. Its failure modes include hiding blockers, burying evidence, or producing a pretty report that is not traceable.

Task-class adapters own specialization. A web UI adapter knows browser smoke and routes. A browser extension adapter knows manifest and unpacked-extension testing. A CLI adapter knows command invocation and stdout assertions. An API adapter knows request/response proof. A data/OCR adapter knows manifests, generated files, and quality gates. Adapters do not replace the core pipeline; they supply proof templates and repo-signal interpretation.

## 6. Run State Machine

The run state machine prevents "done" from being a free-form sentence. Each state has an entry condition, allowed transitions, required artifacts, forbidden claims, and edit rules.

`created` begins when the run envelope is initialized. `task.md` and the first `events.jsonl` entry exist. The run cannot claim requirements, implementation, verification, or acceptance. The only allowed next transitions are `specified`, `blocked`, or `archived`.

`specified` begins when `spec.json` exists and passes schema validation. Requirements, non-requirements, risks, user flows, required test classes, and proof obligations are defined. The run cannot claim the repository has been profiled unless `repo-profile.json` exists. The next states are `profiled`, `planned`, `blocked`, or `archived`.

`profiled` begins when `repo-profile.json` exists and records current-state discovery. It should include package manager, scripts, stack signals, test signals, dirty state, and risk signals. It cannot claim implementation readiness if forbidden paths or live-system risks are unresolved. The next states are `planned`, `blocked`, or `archived`.

`planned` begins when `proof-plan.json` and `allowed-files.json` exist and all requirements map to proof obligations. It cannot claim tests have run. It may narrow allowed files after repo inspection. The next states are `running`, `blocked`, or `archived`.

`running` begins when the Codex runner launches. It requires transcript and command logging to be active. Edits are allowed only within policy. Inspection events must precede first edit unless explicitly waived and recorded. The next states are `implemented`, `blocked`, `rejected`, or `archived`.

`implemented` begins when the runner exits and `diff.patch` plus `changed-files.json` exist. It cannot claim verification. It can only say implementation artifacts exist. The next states are `verification-running`, `rejected`, `blocked`, or `archived`.

`verification-running` begins when the verification executor starts running proof. It requires command logging and evidence paths. It cannot claim final acceptance. The next states are `verified`, `rejected`, or `blocked`.

`verified` begins when `verification.json` exists. It may be passed, failed, or partial. The state means verification artifacts exist, not that the task is accepted. The next state is `reviewing`, `rejected`, `blocked`, or `archived`.

`reviewing` begins when the independent verifier reads the artifacts and writes `verifier-report.json`. It cannot claim policy acceptance. It can report findings. The next states are `accepted`, `rejected`, `blocked`, or `archived`.

`accepted` begins only when `policy-decision.json` says accepted and all blocking policy gates pass. It requires `final-report.json` to cite real evidence. Accepted runs are immutable except for archival metadata and corpus promotion.

`rejected` begins when policy or verifier findings show the claim should not pass. Rejected does not mean the task is impossible. It means the current run failed acceptance. Follow-up runs may start from the same task with a new run ID or a recorded retry relationship.

`blocked` begins when a required external condition prevents meaningful progress: missing credentials, unavailable dependency, unsafe approval boundary, or unavailable target environment. Blocked must name the condition and the evidence. It is not a substitute for hard work.

`archived` is for completed, abandoned, or superseded runs. Archival must not rewrite evidence.

### Run State Transition Table

| From | To | Required artifact or event | Invalid shortcut |
| --- | --- | --- | --- |
| created | specified | `spec.json` valid | claiming proof before requirements |
| specified | profiled | `repo-profile.json` valid | guessing scripts from memory |
| profiled | planned | `proof-plan.json`, `allowed-files.json` | generic "run tests" proof |
| planned | running | Codex runner event | manual edits outside run |
| running | implemented | `diff.patch`, `changed-files.json` | final prose without diff |
| implemented | verification-running | verification start event | saying tests passed before command |
| verification-running | verified | `verification.json` | missing command logs |
| verified | reviewing | `verifier-report.json` | trusting final report |
| reviewing | accepted | `policy-decision.json` accepted | ignoring blocking findings |
| reviewing | rejected | blocking findings or failed policy | pretending partial proof is enough |
| any active | blocked | blocker event with evidence | using blocked for inconvenience |
| any terminal | archived | archive event | rewriting historical evidence |

## 7. Artifact Model

The target run directory is:

```text
.task-runs/<id>/
  task.md
  repo-profile.json
  spec.json
  proof-plan.json
  allowed-files.json
  events.jsonl
  command-log.jsonl
  transcript.jsonl
  diff.patch
  changed-files.json
  verification.json
  evidence/
  verifier-report.json
  policy-decision.json
  final-report.json
  html-report/
```

`task.md` is owned by the run envelope. It preserves the raw user request, creation time, run ID, and links to generated artifacts. It is written at run creation and should not be edited after `specified` except to add a supersession note. It can be faked by rewriting the user request after implementation. It is verified by comparing it to `spec.task.raw`, initial event logs, and runner transcript.

`repo-profile.json` is owned by the repo adapter. Required fields include `schemaVersion`, `runId`, `repoPath`, `package`, `frameworkSignals`, `scripts`, `testSignals`, `routes`, `dirtyState`, `sensitivePathPolicy`, and `liveSystemRisks`. It is written before implementation. It can be faked by omitting risky scripts or dirty files. It is verified by spot-checking the repo, Git status, package files, and route/test files.

`spec.json` is owned by the task compiler. Required fields include `requirements`, `nonRequirements`, `risks`, `userFlows`, `requiredTests`, `manualSmoke`, and `proofObligations`. It is replaceable only before `running`; later changes require a new event and reviewer note. It can be faked by making generic requirements that do not express the task. It is verified by checking raw request preservation, requirement specificity, proof mapping, and task-class cues.

`proof-plan.json` is owned by the task compiler and verification planner. It defines proof obligations, accepted evidence types, minimum evidence counts, required command classes, and negative paths. It is written before implementation and may be narrowed after repo profiling. It can be faked by accepting weak evidence types. It is verified by checking every requirement has at least one proof obligation and every obligation maps back to requirements.

`allowed-files.json` is owned by the task compiler and runner. It defines initial path boundaries, forbidden patterns, justification-required paths, and later implementation narrowing. It is written before edits. It can be faked by allowing everything and forbidding nothing. It is verified by comparing `changed-files.json` and `diff.patch` to allowed and forbidden patterns.

`events.jsonl` is owned by the run envelope and all components. It is append-only. Each event includes `id`, `timestamp`, `phase`, `type`, `status`, and optional artifact IDs. It can be faked by inserting events after the fact. It is verified by ordering, timestamps, command log correlation, and append-only hash chain in later versions.

`command-log.jsonl` is owned by the runner and verification executor. Each command event includes `command`, `cwd`, `startedAt`, `finishedAt`, `exitCode`, `stdoutPath`, `stderrPath`, `requirementIds`, and `proofObligationIds`. It is append-only. It can be faked by recording commands that did not run. It is verified by stdout/stderr files, exit code consistency, and runner process records.

`transcript.jsonl` is owned by the Codex runner. It captures prompt, model messages, tool calls, and final response where available. It can be faked by omitting failed attempts. It is verified by event counts, runner logs, and consistency with `command-log.jsonl`.

`diff.patch` is owned by the runner after implementation. It is generated from Git diff or an equivalent file-change capture. It can be faked by omitting untracked files. It is verified by `changed-files.json`, Git status, and file hashes.

`changed-files.json` lists changed, added, deleted, and untracked files. It is consumed by the verifier and policy engine. It can be faked by excluding forbidden changes. It is verified by Git status and diff parsing.

`verification.json` is owned by the verification executor. It records command results, scenario results, evidence IDs, requirement coverage, and proof obligation status. It can be faked by claiming passed with no evidence. It is verified by command logs, evidence files, and accepted evidence types.

`evidence/` stores logs, screenshots, traces, response bodies, generated PDFs, manifests, and manual artifacts. Each file should have an evidence ID in `verification.json`. Evidence can be faked by uploading irrelevant screenshots or stale logs. It is verified by timestamps, command references, URL/route matching, and requirement linkage.

`verifier-report.json` is owned by the independent verifier. It records findings, severity, evidence references, and acceptability. It can be faked if the builder writes it. It is verified by running the verifier independently and checking the tool identity/event that produced it.

`policy-decision.json` is owned by the policy engine. It records decision, blocking rule IDs, warnings, overrides, and final state transition. It can be faked by bypassing policy. It is verified by recomputing policy from verification and verifier outputs.

`final-report.json` is owned by the runner or report generator after policy. It maps claims to evidence and residual risk. It can be faked by citing nonexistent evidence or overstating pass. It is verified by evidence registry lookup and policy decision consistency.

`html-report/` is owned by the report surface. It is generated from artifacts. It is not authoritative. If HTML and JSON disagree, JSON artifacts win.

### Artifact Ownership Matrix

| Artifact | Owner | Written in state | Append-only | Primary consumer | Core verification |
| --- | --- | --- | --- | --- | --- |
| `task.md` | run envelope | created | no | compiler, human | matches `spec.task.raw` |
| `repo-profile.json` | repo adapter | profiled | no | compiler, verifier | re-scan repo signals |
| `spec.json` | task compiler | specified | no after run | runner, verifier | requirements mapped |
| `proof-plan.json` | task compiler | planned | no after run | verifier executor | obligations cover requirements |
| `allowed-files.json` | task compiler/runner | planned | no after run | runner, policy | diff boundary check |
| `events.jsonl` | all components | all states | yes | verifier | ordering and required events |
| `command-log.jsonl` | runner/executor | running/verification | yes | verifier | exit code/log files |
| `transcript.jsonl` | Codex runner | running | yes | verifier/report | event consistency |
| `diff.patch` | runner | implemented | no | verifier/policy | Git diff comparison |
| `changed-files.json` | runner | implemented | no | policy | Git status comparison |
| `verification.json` | verification executor | verified | no | verifier/policy | evidence exists and passes |
| `evidence/` | executor/manual collector | verified | mostly append | verifier | IDs and timestamps |
| `verifier-report.json` | independent verifier | reviewing | no | policy | recomputable findings |
| `policy-decision.json` | policy engine | accepted/rejected/blocked | no | report | rule recomputation |
| `final-report.json` | report generator | terminal | no | human/corpus | claims cite evidence |

## 8. Requirement And Proof Traceability

Traceability is the backbone of the harness. A run cannot be accepted because it has a nice final message. It can be accepted only when every requirement has a proof path.

Requirement IDs use `R<number>`. Proof obligations use `P<number>`. Commands use `C<number>` or stable event IDs. Evidence uses `E<number>` or descriptive IDs such as `evidence.browser.reset-screenshot`. Verifier findings use `V<number>` or rule IDs. Policy rules use `POL<number>` or names like `policy.user-smoke.required`.

The valid chain is:

```text
R4 "Exercise reset through browse UI"
-> P3 "Browser smoke covers no-results reset"
-> C7 "pnpm run test:e2e e2e/browse-to-purchase.spec.ts"
-> E12 "evidence/browser/reset-trace.zip"
-> V4 "browser reset evidence present and passed"
-> POL-UI-001 "UI tasks require user smoke"
-> decision accepted
```

An invalid chain is:

```text
R4 "Exercise reset through browse UI"
-> P3 "Browser smoke covers no-results reset"
-> C2 "pnpm run test"
-> no browser evidence
-> final report says "manually checked"
-> decision rejected
```

Another invalid chain is:

```text
R2 "Implement Site Gate decline behavior"
-> P2 "Automated checks"
-> C5 "node --check background.js"
-> E5 syntax check log
-> no actual decline click
-> decision rejected for missing user-flow proof
```

The mapping rules are:

1. Every requirement must list at least one proof obligation.
2. Every proof obligation must list at least one requirement.
3. Every proof obligation must define accepted evidence types and a minimum count.
4. Every verification result must cite known requirement IDs and proof obligation IDs.
5. Every final claim must cite evidence IDs already present in the evidence registry.
6. Policy decisions must cite verifier findings or verification results, not raw prose.
7. Accepted runs cannot have unmapped requirements, unknown evidence IDs, or passing proof obligations with failed evidence.

### Requirement/Proof/Evidence Traceability Example

| Requirement | Proof obligation | Command/scenario | Evidence | Verifier finding | Policy rule | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `R1` inspect repo | `P1` inspection before edit | `C1 rg routes` | `E1 command log` | `V1 passed` | `POL-ORDER-001` | allow |
| `R2` implement reset | `P2` automated coverage | `C4 pnpm test` | `E4 test log` | `V2 passed` | `POL-TEST-001` | allow |
| `R4` user smoke | `P3` browser reset flow | `C7 playwright` | `E7 trace` | `V3 passed` | `POL-UI-001` | allow |
| `R5` honest report | `P4` final cites evidence | report generation | `final-report.json` | `V4 passed` | `POL-HONESTY-001` | accept |

This table shows why a generic test is not enough. The policy accepts only when the correct type of proof exists for each requirement.

## 9. Task Compiler Mechanics

The task compiler turns a vague request into a frozen spec. It must not merely wrap the user's sentence in a generic requirement. It must preserve the raw request, extract behavior, identify likely user flows, name non-requirements, classify risks, select proof obligation classes, and seed allowed files. The compiler is the first defense against later drift.

Request parsing begins with the raw task. The raw text is never rewritten in place. The compiler stores it in `spec.task.raw` and creates a title and summary. It then extracts verbs, nouns, target surfaces, actors, inputs, outputs, and constraints. For "Improve the browse marketplace no-results search state so a user who searches for unavailable content sees a clear empty state and can reset back to visible offerings", it should extract browse marketplace, search, no-results empty state, reset action, visible offerings, and verification via existing browse e2e and smoke.

Requirement extraction produces explicit requirements. A UI task should not have only "implement requested behavior." It should have requirements for the visible state, action behavior, automated coverage, user smoke, and final reporting. An API task should have request/response behavior, error behavior, and contract tests. A CLI task should have command invocation, output, exit code, and invalid input behavior. A data/OCR pipeline task should have input fixtures, generated files, manifest fields, and quality gates.

Non-requirement extraction prevents scope creep. For a browse empty-state task, non-requirements might say do not change checkout pricing, do not alter Stripe integration, do not deploy, and do not migrate the UI framework. For a Site Gate task, non-requirements might say do not publish the extension and do not intercept non-http protocols unless requested.

User-flow extraction defines how the changed surface is exercised. The compiler should choose at least one primary flow and one negative or edge path when the task contains inputs, choices, blocking, validation, permissions, or failure states. A search task implies a no-results negative path. A browser extension with allow/decline options implies both allow and decline flows. A CLI parser implies valid command and invalid command paths.

Risk classification tags the task. Risks include UI false pass, production data, external API cost, missing credentials, flaky e2e, dirty worktree, generated artifacts, and security-sensitive files. Risk tags influence proof obligations and policy.

Proof obligation generation maps requirements to evidence classes. A UI behavior requires browser-smoke or screenshot/trace evidence. A pure parser can use unit tests and CLI smoke. An API endpoint requires request/response evidence. A deployment task requires live endpoint or preview proof plus rollback notes.

Allowed file seed generation starts broad but safe. It must forbid `.git/**`, `.env`, `.env.*`, `node_modules/**`, generated secret transcript folders, and production credential files. It should mark lockfiles, migrations, deploy configs, and generated build outputs as justification-required unless the task obviously needs them.

Required test class generation uses repo signals. If a repo has `pnpm run test`, `pnpm run test:e2e`, and `pnpm run smoke:browse`, the compiler should mention those exact commands. If the repo has no test command, the spec must state that tests need to be discovered or created. If a user explicitly names a verification command, that command should appear in required tests unless unsafe.

Ambiguous request handling should produce either clarifying questions or explicit assumptions. If the user says "make checkout better", the compiler should not invent a precise scope silently. It should create a blocked or assumption-bearing spec. If the user says "fix the button crash on /browse", the compiler can proceed with a concrete UI proof plan.

Specificity levels are useful:

- Level 0: raw task only, rejected for implementation.
- Level 1: generic requirements, acceptable only for rough planning.
- Level 2: repo-script-aware requirements and proof, current M1/M3 target.
- Level 3: task-class-aware flows, negative paths, and file boundaries.
- Level 4: domain-specific acceptance criteria and generated tests.

The compiler avoids generic mush by requiring task cues, command suggestions, user-flow steps, negative paths, and proof mapping. If those are missing for a task where they should be inferable, the validator should warn or reject depending on maturity level.

Examples:

- Browser extension task: requirements for manifest, background logic, gate page, allow duration, decline path, storage behavior, extension smoke.
- Next.js UI task: requirements for route, component state, accessibility, responsive layout, tests, Playwright smoke.
- CLI task: requirements for arguments, stdin/stdout/stderr, exit codes, config files, invalid input.
- API task: requirements for endpoint, method, auth boundary, success response, error response, idempotency, integration tests.
- Data/OCR pipeline task: requirements for input fixture, generated searchable PDF, sidecar text, manifest row, quality status, cost boundary.

## 10. Repo Adapter Mechanics

The repo adapter profiles the current repository. It is not allowed to rely on memory alone. It writes `repo-profile.json` from live files and commands.

Package manager detection checks lockfiles and package metadata. `pnpm-lock.yaml` means pnpm, `package-lock.json` means npm, `yarn.lock` means yarn, `bun.lockb` means bun. If multiple lockfiles exist, the adapter records all signals and a confidence level. It should not silently choose npm when `packageManager` says pnpm.

Framework detection reads dependencies and file structure. Next.js signals include `next` dependency, `app/`, `pages/`, `next.config.*`, and scripts invoking `next`. Browser extension signals include `manifest.json`, `background.js`, `content.js`, `chrome.*` APIs, and `manifest_version`. Python pipeline signals include `pyproject.toml`, `src/`, `scripts/`, and test files. Flutter signals include `pubspec.yaml` and `lib/`.

Script detection records package scripts with names and command bodies. It should classify scripts into dev, build, lint, test, e2e, smoke, deploy, live, seed, migration, and dangerous categories. A script named `smoke:browse` should become a user-smoke candidate. A script named `vercel:sync-live-env` should become live-system risk.

Test command detection checks package scripts, config files, test directories, and naming. It should record Vitest, Jest, Node test runner, Playwright, Cypress, Pytest, cargo test, xcodebuild, Flutter test, and custom smoke scripts. It should also record missing tests.

Dev server detection finds local start commands and ports. It reads scripts, README, Playwright config, Next configs, and smoke scripts. It records whether the server can run locally, whether it needs env vars, and whether there is a clean-start command. For `voovo-checkout`, `dev:clean` and port 3001 are important.

Route/surface detection is task-class-specific. For Next.js App Router, route files under `app/` become route candidates. For CLI repos, project scripts and binaries become surfaces. For browser extensions, extension pages and content scripts become surfaces. For OCR pipelines, input/output directories and run scripts become surfaces.

Existing test style detection reads test files and assertions. It should record whether tests use screenshots, DOM locators, fixtures, mocks, live services, or generated files. This prevents the compiler from suggesting a test style alien to the repo.

Forbidden and sensitive file detection must skip secret reads. The adapter can record that `.env.local` exists without reading it. It can record paths matching `.env*`, credentials, service account files, private keys, and production config. It must not print secrets into artifacts.

Deploy and live-system risk detection scans script names and config. Scripts containing deploy, vercel, firebase deploy, stripe live, send email, production, migrate, seed, push, or publish are not automatically forbidden, but they require policy and approval. The adapter records them as risk signals.

Dirty worktree handling is crucial. The adapter records `git status --short` counts and categories. It should not overwrite unrelated user changes. It should recommend a fresh worktree for PR-grade changes in dirty repos. It should explicitly list untracked generated run folders.

Nested repo handling matters in the Jarvis workspace. The adapter must detect when a path is inside a nested Git repo and use the nearest repo root unless the user specifies otherwise. It must avoid scanning every nested research repo when the target task belongs to the parent app.

### `repo-profile.json` Example

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.repo-profile",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "repoPath": "/Users/levente/Documents/Jarvis/Projects/Work/VOOVO/DEV/voovo-checkout",
  "git": {
    "isRepo": true,
    "branch": "fix/checkout-course-sidebar-flow",
    "dirty": true,
    "dirtySummary": { "modified": 0, "untracked": 2 }
  },
  "package": {
    "manager": "pnpm",
    "scripts": {
      "dev:clean": "NEXT_DIST_DIR=.next-dev next dev -p 3001",
      "test": "vitest run",
      "test:e2e": "playwright test",
      "smoke:browse": "node scripts/smoke-browse.mjs"
    }
  },
  "frameworkSignals": [
    { "kind": "next-app-router", "confidence": "high", "evidence": ["app/", "next.config.mjs"] }
  ],
  "testSignals": [
    { "kind": "vitest", "command": "pnpm run test" },
    { "kind": "playwright", "command": "pnpm run test:e2e" },
    { "kind": "browse-smoke", "command": "BASE_URL=http://127.0.0.1:3001 pnpm run smoke:browse" }
  ],
  "liveSystemRisks": [
    { "kind": "stripe", "source": "dependencies", "policy": "no live checkout without explicit approval" }
  ],
  "sensitivePaths": [".env", ".env.*", "node_modules/**", ".git/**"]
}
```

## 11. Run Envelope Mechanics

The run envelope creates `.task-runs/<id>/` and protects it as the durable record of a task. The run ID should be deterministic enough to read and unique enough not to collide. A good default is timestamp plus task slug:

```text
20260624T101530Z-voovo-checkout-browse-empty-state
```

If the user provides `--id`, the harness should validate it against a safe slug pattern. It should reject path separators, `..`, hidden paths, and shell metacharacters.

Overwrite policy must be explicit. Default behavior is fail if the run directory exists. `--overwrite` may be allowed only before implementation states exist, or only with a backup event. For serious runs, prefer `meta rerun --from <id>` over overwriting.

Artifact initialization writes required seed artifacts. `task.md`, `repo-profile.json`, `spec.json`, `proof-plan.json`, `allowed-files.json`, `events.jsonl`, `verification.json`, and `final-report.json` exist today. Target M3 adds `command-log.jsonl`, `transcript.jsonl`, `changed-files.json`, and placeholder directories such as `evidence/` and `html-report/`. Seed verification and final report must say `pending`, not `passed`.

Append-only event log rules prevent silent history edits. Every component writes events with stable IDs, timestamp, phase, status, and artifact references. Later versions should add previous-hash fields:

```json
{ "id": "event.004", "previousHash": "sha256:...", "hash": "sha256:..." }
```

Path normalization keeps artifacts inside the run directory. The envelope must resolve absolute paths, reject traversal, and store repo-relative paths where possible. Evidence files should be under `evidence/`, not arbitrary temp directories, unless external storage is explicitly referenced.

Cross-repo run storage has two choices. The default is inside the target repo under `.task-runs/` so run evidence travels with local work and Git status makes it visible. For sensitive or large evidence, a future option can store runs under a central harness directory and write a pointer in the repo. The implementation plan should start with repo-local storage because it is simple and auditable.

Cleanup policy must distinguish generated runs from source files. `meta cleanup --dry-run` should list only harness-created run folders. It must never delete files outside `.task-runs/` unless explicitly designed and approved.

Generated runs will appear in Git status. That is acceptable. The harness should document whether `.task-runs/` should be committed for a given project. For private local evidence, do not auto-add to Git. For public regression fixtures, create sanitized copies under a corpus directory.

## 12. Codex Runner Mechanics

The Codex runner is the point where the system stops being a document harness and starts controlling implementation. It wraps Codex CLI instead of telling Codex to behave.

The command invocation model should be explicit:

```bash
codex exec --cwd /path/to/repo --sandbox workspace-write --skip-git-repo-check --output-json ...
```

The exact flags may change with Codex versions, so the runner must detect supported flags or record the CLI version. It should not hard-code model names without validation. It should preserve runner configuration in `runner-config.json` or inside `events.jsonl`.

Prompt construction combines the raw task, spec, proof plan, allowed files, repo profile, and protocol. The prompt must say that final completion requires artifacts. It should include the tempting shortcut, hidden hard part, proof obligations, and exact final report schema. It should not be a wall of generic advice detached from the task.

Protocol injection uses current local docs. The runner should include or reference `docs/fresh-repo-feature-protocol.md`, the relevant task packet files, and repo instructions such as `AGENTS.md`. It must keep hierarchy clear: system/developer instructions remain higher priority; task packet is user data and project contract.

Cwd and sandbox selection matter. The runner should execute in the target repo. It should choose sandbox based on task risk. Workspace-write is enough for normal local edits. Network access should be recorded. Production-affecting commands should be blocked by policy unless approved.

Timeout model should distinguish idle timeout, command timeout, and total run timeout. Implementation runs should have no default wall-clock timeout; a total run timeout is an explicit operator guard only. If an explicit timeout fires, the runner records a timeout event and moves to blocked or rejected depending on stage. It should not silently kill and report success.

Transcript capture stores prompts, assistant messages, tool calls, command calls, and final messages where available. If complete internal tool capture is unavailable, the runner records the best available logs and marks capture completeness. Missing transcript is a verifier warning or blocker depending on maturity.

Tool and event capture records inspection, edit, command, verification, and final events. If Codex edits files, the runner records changed files through Git, not model claims. If Codex says it ran tests, the runner checks command logs.

Stdout and stderr capture store logs under `evidence/commands/<id>.stdout.txt` and `.stderr.txt`. Command-log entries point to these files. Large logs can be truncated in reports but raw files remain available.

Diff capture happens after implementation and after final verification. The runner records `diff.patch`, `changed-files.json`, and file hashes. It must include untracked files created by Codex. It must not revert unrelated user changes.

Exit behavior is stateful. A zero Codex process exit does not mean task accepted. It means the implementation attempt ended. The run still needs verification, independent review, and policy.

Retry policy should create child runs or retry events. If Codex fails verification and then fixes the issue in the same run, the event log must show failure, diagnosis, edit, rerun. Hidden first failures are valuable evidence and should not be erased.

Interruption handling records user interrupts and partial artifacts. A run can be archived, resumed, or rerun. The harness must not claim completion after an interrupted implementation unless verification and policy later pass.

Blocked handling must be strict. Blocked requires a specific condition, evidence, and next action. "This is hard" is not blocked. Missing credentials, unavailable browser, unsafe approval boundary, or required external service outage can be blocked.

## 13. Verification Executor Mechanics

The verification executor runs declared proof. It does not decide acceptance. It creates evidence.

Unit tests are required when the change touches isolated logic, parsers, reducers, validators, formatters, or data transforms. Command shape examples include `pnpm run test`, `node --test`, `pytest`, and `cargo test`. Evidence shape includes command log, stdout, stderr, and optionally coverage. Failure shape includes nonzero exit, failed assertion, timeout, or missing test command. False positives include tests that assert implementation details while missing user behavior.

Integration tests are required when multiple modules, services, or adapters interact. Evidence includes command log, fixture inputs, outputs, and service mocks. False positives include mocks that do not match production contracts.

Lint is required when the repo has a lint script and the change touches linted files. It proves style and static issues only. It never proves behavior.

Typecheck is required for TypeScript, Python typing, Rust, Swift, or similar typed surfaces when scripts exist. It proves type consistency, not runtime correctness.

Build is required when the change affects bundling, routing, app configuration, or deployable surfaces. It catches missing imports and production build errors. It does not prove the user flow works.

Browser smoke is required for web UI and browser extension tasks. Evidence should include URL, browser name, viewport, actions, assertions, screenshot or trace, and console/page errors. For the browse empty-state task, browser smoke must exercise `/browse`, search `zzzzxqwerty999`, observe empty state, click reset, and observe offerings return.

API smoke is required for endpoint tasks. Evidence includes request method, URL, headers class without secrets, request body, response status, response body, and assertions. Negative cases should include invalid input, missing auth, or not-found when relevant.

CLI smoke is required for command-line tools. Evidence includes command, cwd, args, stdin if used, stdout, stderr, exit code, and output files.

Visual/screenshot checks are required when layout, rendering, canvas, PDF, or design fidelity matters. Evidence includes screenshots and comparison criteria. Not every screenshot needs pixel diff, but visual tasks need inspectable artifacts.

Migration/data checks are required when changing database schemas, migrations, ETL, OCR, or generated files. Evidence includes input fixture, output file, manifest row, validation command, and rollback or replay instructions.

Manual artifacts are allowed only when automation is impossible or unsafe. Manual evidence must be concrete: screenshot, copied response, saved PDF, exported report, or typed checklist with exact environment. "I clicked it" is not enough.

Negative testing is required when the task includes validation, permissions, blocking, empty states, retries, invalid input, external failure, or multiple choices. A happy path alone is a verifier finding. The proof plan should say which negative path is required before implementation.

### Test Taxonomy Table

| Test class | Required when | Command shape | Evidence | Common false pass |
| --- | --- | --- | --- | --- |
| unit | isolated logic changes | `pnpm run test` | command logs | tests wrong helper only |
| integration | module/service contract | repo script or custom | fixtures, logs | mocks too generous |
| lint | lint script exists | `pnpm run lint` | stdout/stderr | style only |
| typecheck | typed code changed | `tsc`, build, compiler | compiler logs | no runtime proof |
| build | routed/bundled app changed | `pnpm run build` | build log | no user flow |
| browser smoke | web UI/extension | Playwright/CDP/manual browser | trace/screenshot | loaded page only |
| API smoke | endpoint behavior | fetch/curl/test client | req/res body | no negative case |
| CLI smoke | CLI behavior | executable command | stdout/stderr/exit | no invalid args |
| visual/PDF | layout/PDF/canvas | screenshot/PDF verifier | image/PDF artifacts | not inspected |
| data/migration | generated data/schema | migration/test script | manifest/output | fixture too small |
| manual artifact | unsafe to automate | recorded checklist | screenshot/export | vague statement |

## 14. Independent Verifier Mechanics

The independent verifier is the second pass. It assumes the builder may be wrong. It reads artifacts and tries to falsify the completion claim.

Artifact presence is the first gate. Missing required artifacts are blocking. A run cannot be accepted without `spec.json`, `proof-plan.json`, `verification.json`, `verifier-report.json`, `policy-decision.json`, and `final-report.json` in the target architecture.

Schema validity is next. Every JSON artifact has `schemaVersion`, `runId`, `kind`, and required fields. The verifier rejects invalid JSON, mismatched run IDs, unknown state values, and missing arrays.

State machine validity checks event ordering. Inspection must precede edits when required. Verification must occur after final implementation edit. Policy must occur after verifier. Final report must occur after policy or cite policy state. A run cannot jump from `created` to `accepted`.

Requirement-proof mapping checks that every requirement maps to proof obligations and every proof obligation maps back to known requirements. Missing links are blocking.

Command exit codes are checked against claims. If a command failed, a final report cannot cite it as passing. If a command timed out, it cannot satisfy a proof obligation unless the obligation is about timeout behavior.

Command timing relative to edits matters. Tests run before the final edit do not prove final code. The verifier compares command timestamps to edit events and diff generation.

Final claims and citations are audited. Every claim in `final-report.json` cites evidence IDs. Evidence IDs must exist. Evidence type must be accepted by the related proof obligation. Claim status must not exceed evidence status.

Diff boundaries are audited. Changed files must be allowed. Forbidden paths are blocking. Justification-required paths need recorded justification and policy acceptance.

Forbidden paths include `.env`, `.env.*`, `.git/**`, `node_modules/**`, secrets, private keys, and production credential files. Reading existence may be allowed; printing contents is not.

Missing user smoke is a common blocker. For UI, browser extension, CLI, API, and data-output tasks, proof must exercise the runnable surface. Syntax checks and unit tests may be necessary but are not sufficient.

Hidden failures are detected by scanning command logs, final report claims, and event statuses. If a failed verification exists and no later passing rerun covers the same proof obligation, the run cannot pass.

Weak happy-path-only tests are major or blocking depending on task. If the task asks for invalid email validation and only valid email is tested, policy rejects. If the task asks for a reset path and only empty-state display is tested, policy rejects.

Residual risk honesty is required. Accepted runs can still have residual risk, but the risk must be named. Missing residual risk in a nontrivial run is a finding.

`verifier-report.json` structure:

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.verifier-report",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "decisionRecommendation": "reject",
  "findings": [
    {
      "id": "V1",
      "severity": "blocking",
      "ruleId": "verify.user-smoke.missing",
      "requirementIds": ["R4"],
      "message": "No browser smoke evidence exercises the reset action.",
      "evidence": ["verification.json"]
    }
  ],
  "coverage": {
    "requirementsWithPassingProof": ["R1", "R2", "R3"],
    "requirementsMissingProof": ["R4"]
  }
}
```

Severity levels are `blocking`, `major`, `minor`, and `info`. Blocking prevents acceptance. Major should usually be fixed before serious use. Minor can be accepted with residual risk. Info is contextual.

## 15. Failure Corpus Mechanics

The failure corpus turns real mistakes into permanent pressure. It is how the harness learns from actual bad runs.

Failure intake starts from a rejected run, user bug report, or manual discovery. The intake record should include run ID, repo, task class, failure category, exact symptom, expected behavior, actual behavior, artifacts, and privacy classification. Sensitive data is redacted before promotion.

Minimization turns a large failure into the smallest useful fixture. For a UI crash, keep a tiny route/component or mocked data response. For fake verification, keep a small run folder with final report citing nonexistent evidence. For a data pipeline failure, keep a small input fixture and expected manifest.

Fixture format should be consistent:

```text
corpus/<category>/<case-id>/
  README.md
  input/
  expected/
  run/
  mutation.json
  verify.mjs
```

Mutation tests deliberately corrupt artifacts. Existing acceptance-gate tests already mutate missing prompt input, edit order, forbidden paths, failed tests, unknown evidence, missing proof obligations, unaccepted evidence types, and missing proof artifacts. The target corpus expands this approach across task classes.

Replay tests run old tasks against current harness behavior. A replay may not need to rerun Codex every time. Some replays validate that the verifier or policy still rejects a known bad run. Others rerun a small implementation task and compare evidence.

Expected-fail and expected-pass cases are both needed. Expected-fail cases prove rejection. Expected-pass cases prove the harness is not impossible to satisfy. A harness that rejects everything is not useful.

Adding policy rules from failures should be disciplined. A real failure should first become a fixture. Then add a verifier check or policy rule. Then prove the fixture fails before the rule and passes/fails correctly after the rule. Avoid overfitting to filenames unless the failure is path-specific.

Categories include fake verification, UI runtime crash, missing smoke, wrong repo assumption, broken edge case, overbroad refactor, hidden failed command, final overclaim, stale dev server, secret leak, production mutation, and task-class mismatch.

For example, if Codex says the Site Gate extension works after only `node --check background.js`, create a corpus case where `final-report.json` claims decline behavior but evidence only contains syntax check. The verifier should reject because `P3` requires browser-smoke evidence.

For a `voovo-checkout` browse reset failure, create a fixture where tests pass but Playwright trace shows no reset action. The policy should reject because `POL-UI-NEGATIVE-001` requires the negative or reset path.

The corpus must also track privacy. VOOVO private code and data cannot be blindly copied into public fixtures. Sanitized fixtures should remove secrets, customer data, tokens, private URLs, and proprietary content while preserving the failure mechanism.

## 16. Policy Enforcement Mechanics

M9 is the hard gate layer. M5 produces evidence. M6 audits evidence. M7 supplies real failure patterns and regression cases. M9 turns those outputs into hard pass/reject/block policy.

Without M5, policy has no command results, screenshots, traces, logs, or generated artifacts. Without M6, policy has no independent judgment about whether the evidence actually supports the claims. Without M7, policy lacks pressure from known failures and tends to stay theoretical. Without M9, M5-M7 are only reports that Codex can ignore.

Policy rules have IDs, severity, applicability, condition, evidence input, and decision impact. Example:

```json
{
  "id": "POL-UI-001",
  "severity": "blocking",
  "appliesWhen": ["taskClass:web-ui", "taskClass:browser-extension"],
  "condition": "required user-facing smoke proof is missing or failed",
  "decision": "reject",
  "message": "UI tasks cannot pass without runnable user-surface evidence."
}
```

Default non-negotiable rules:

- no pass if required artifacts are missing
- no pass if any requirement lacks proof obligation
- no pass if required verification did not run
- no pass if required verification failed
- no pass if UI/browser/CLI/API/data surface smoke is missing for that task class
- no pass if final report cites unknown evidence
- no pass if forbidden files were changed
- no pass if final says passed while verifier has blocking findings
- no pass if tests ran before final edit and were not rerun
- no pass if known corpus regression fails

Pass/reject/block decisions must be distinct. Pass means evidence satisfies policy. Reject means the run was attempted but did not satisfy policy. Block means the run cannot continue safely or meaningfully due to an external or approval condition. Blocked is not a way to avoid rejection after failed proof.

Configurability should be task-class-specific. A browser extension requires extension smoke. A data/OCR task requires output artifacts and manifest validation. A deploy task requires preview/live proof plus rollback. But core honesty rules are global.

Policy overrides require explicit human action. If the user accepts a risk, `policy-decision.json` records override ID, user, timestamp, reason, and remaining risk. Overrides must not erase failed evidence.

### Failure Category To Policy Rule Table

| Failure category | Policy rule | Required evidence | Decision |
| --- | --- | --- | --- |
| tests not run | `POL-VERIFY-001` | command-log entry | reject |
| browser smoke missing | `POL-UI-001` | browser trace/screenshot/log | reject |
| nonexistent evidence citation | `POL-HONESTY-001` | evidence registry lookup | reject |
| failed command reported passed | `POL-HONESTY-002` | command exit code | reject |
| forbidden file edited | `POL-FILES-001` | diff and changed-files | reject |
| requirement unmapped | `POL-TRACE-001` | spec/proof-plan mapping | reject |
| happy path only | `POL-NEGATIVE-001` | negative scenario result | reject or major |
| corpus regression | `POL-CORPUS-001` | corpus replay result | reject |

### `policy-decision.json` Example

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.policy-decision",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "decision": "rejected",
  "decidedAt": "2026-06-24T12:20:00Z",
  "blockingRules": [
    {
      "ruleId": "POL-UI-001",
      "findingId": "V3",
      "requirementIds": ["R4"],
      "message": "Reset action was not exercised through browser smoke evidence."
    }
  ],
  "warnings": [],
  "overrides": []
}
```

## 17. Product Surface And Reports

The product surface should start as CLI. A dashboard can come later, but the CLI must be usable every day.

`meta init` creates a task packet without running Codex:

```bash
meta init --repo /path/to/repo --task "build X"
```

It is useful for planning and calibration. It writes M1/M3 artifacts.

`meta run` creates or reuses a task packet, invokes the Codex runner, captures implementation artifacts, runs verification, runs verifier, runs policy, and prints the decision:

```bash
meta run --repo /path/to/repo --task "build X"
```

`meta verify` runs M5 verification and M6 audit against an existing run:

```bash
meta verify --run .task-runs/<id>
```

`meta report` renders the human report:

```bash
meta report --run .task-runs/<id> --format text
meta report --run .task-runs/<id> --format html
```

`meta promote-failure` creates a sanitized corpus case:

```bash
meta promote-failure --run .task-runs/<id> --category missing-user-smoke
```

`meta rerun` creates a child run with a link to the failed run:

```bash
meta rerun --from .task-runs/<id>
```

The human report should be concise and evidence-first:

```text
Operator status: repairing
Internal policy decision: rejected
Reason: R4 has no user-smoke evidence.
Passed commands:
- C1 pnpm run test
Failed commands:
- none
Missing proof:
- P3 browser smoke for reset action
Evidence:
- E1 test stdout
- E2 diff.patch
Residual risk:
- Browse data depends on current public-list fixture.
Next action:
- Add Playwright reset scenario and rerun meta verify.
```

The report must not hide failures below a summary. Findings come first. Evidence links should point to files. If a command failed, show the command and exit code. If the decision is accepted, still show residual risk.

The HTML report is generated from JSON artifacts. It can include tabs for overview, requirements, proof obligations, commands, diff, evidence, verifier findings, policy decision, and corpus promotion. It must not become the source of truth. JSON artifacts remain authoritative.

## 18. Security And Safety Boundaries

Security policy starts with `.env*`. The harness must not read, print, summarize, or store secret env contents unless the task explicitly requires blind file operations and the policy allows it. Repo adapter may record existence of `.env.local`, not contents. Diff verifier rejects `.env` changes by default.

Secret redaction applies to command logs, transcripts, evidence files, screenshots, and reports. Redaction should cover known env var names, tokens, API keys, cookies, Authorization headers, private keys, service account JSON, Stripe secrets, Supabase service role keys, Firebase credentials, and session IDs. Redaction must preserve enough context to debug without leaking secrets.

Forbidden path policy starts with `.git/**`, `.env`, `.env.*`, `node_modules/**`, private key patterns, and generated transcript secret directories. Some repos may add project-specific forbidden paths. The policy engine rejects changed forbidden paths unless an explicit approved exception exists.

Deploy, push, send, publish, and production mutation restrictions are default. Commands containing `git push`, `gh pr create`, `vercel deploy`, `firebase deploy`, `stripe live`, email send scripts, Slack posts, database migrations, or production seeds require explicit task permission and approval gates. The harness may inspect deploy configs but should not execute deploys by default.

Production data restrictions protect live customer/user data. Read-only inspection may be allowed for specific tasks, but artifacts should avoid storing raw personal data. Writes require explicit approval and rollback plan.

External API cost restrictions matter for AI/OCR tasks. The spec should record budget. Verification should not call paid APIs unless the task approves it. The `hungarian-old-docs-ocr` project has a budget boundary; the harness should preserve that kind of constraint.

Human approval boundaries must be explicit. If a task needs credentials, live deployment, external send, or spending money, the run enters blocked or approval-required state. Approval is recorded in `events.jsonl` and `policy-decision.json`.

Generated artifact redaction happens before corpus promotion. Private VOOVO evidence should not be copied into public fixtures. Sanitization should be verified by scans for secrets and private identifiers.

## 19. Task-Class Generalization

Task classes let the harness generalize without becoming vague.

Web UI tasks have signals such as Next, React, Vue, app routes, Playwright, Cypress, browser smoke scripts, CSS, and component tests. Likely proof obligations include route render, user interaction, negative state, responsive or accessibility checks, build, and e2e. Required smoke type is browser. Common false passes are build-only proof, screenshot of wrong route, and happy path only.

Browser extension tasks have manifest, background/content scripts, extension pages, Chrome APIs, permissions, storage, and host permissions. Proof obligations include manifest validation, extension load, user flow through extension pages, permission behavior, and persistence. Required smoke type is browser with unpacked extension or an equivalent CDP run. Common false passes are syntax-only checks and testing a normal web page instead of the extension context.

CLI tasks have package binaries, scripts, argument parsers, stdin/stdout, config files, and exit codes. Proof obligations include valid command, invalid args, output content, exit codes, and file effects. Required smoke type is CLI command. Common false passes are calling internal functions without invoking the real binary.

API/backend tasks have route files, controllers, OpenAPI schemas, service tests, auth middleware, and database adapters. Proof obligations include success request, invalid request, auth boundary, not-found or conflict, idempotency when relevant, and integration tests. Required smoke type is API request/response. Common false passes are unit tests with unrealistic mocks.

Data/OCR pipeline tasks have input fixtures, scripts, generated PDFs, manifests, sidecars, quality gates, and cost controls. Proof obligations include fixture input, output files, manifest validation, quality metrics, and failed/uncertain route behavior. Required smoke type is pipeline run on representative fixture. Common false passes are checking that a file exists without validating content or searchability.

Mobile tasks have Flutter, React Native, Swift, Xcode, Android, emulator, or simulator signals. Proof obligations include build, unit/widget tests, and simulator/manual evidence for user flow. Required smoke type may be simulator screenshot or recorded steps. Common false passes are static checks without running the screen.

Deploy/ops tasks have Vercel, Firebase, Supabase, Docker, CI, migrations, env, and logs. Proof obligations include dry-run, preview, logs, health check, rollback, and approval. Required smoke type is environment-specific. Common false passes are successful local build with no deployed endpoint check.

Task-class adapters provide proof templates. They do not decide policy alone. A web adapter can suggest Playwright. The core policy still checks evidence, traceability, and final claims.

## 20. Incremental Build Plan

### Phase Implementation Table

| Phase | Goal | Deliverables | Likely files | Tests | Acceptance gate | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | harden M1/M3 | better task compiler, run envelope | `meta-harness/lib` | schema/mutation/smoke | `npm run meta:check` | no runner |
| 2 | M2 repo adapter v1 | deep `repo-profile.json` | `meta-harness/adapters` | fixture repos | profile matches known repos | partial frameworks |
| 3 | M4 Codex runner v1 | execute Codex and capture diff/transcript | `meta-harness/runner` | fake Codex process tests | run folder has transcript/diff | CLI drift |
| 4 | M5 verification executor v1 | run proof commands | `meta-harness/verify` | command fixture tests | failed commands reject | browser complexity |
| 5 | M6 verifier v1 | completed-run verifier | `meta-harness/verifier` | mutation tests | fake passes rejected | semantic limits |
| 6 | M7 failure corpus v1 | corpus format and replay | `corpus/`, `evals/` | expected pass/fail | known failures stay rejected | privacy |
| 7 | M9 policy engine v1 | pass/reject/block rules | `meta-harness/policy` | rule tests | policy-decision generated | overrides |
| 8 | M8 CLI/report/dashboard UX | daily commands, reports, dashboard | `meta-harness/cli`, report, dashboard | CLI/dashboard snapshots | report and dashboard explain decision | multi-run view later |
| 9 | M10 adapters | web, extension, CLI, API, data | adapter dirs | task-class fixtures | 3 classes proven | broader classes later |

Phase 1 hardens current M1/M3. Deliverables include richer compiler cues, stronger validators, target artifact placeholders, and a real packet generated for `voovo-checkout`. Acceptance requires `npm run meta:check`, `npm run check`, and a validator rejecting generic packets for tasks where concrete scripts are available.

Phase 2 builds the repo adapter. Deliverables include fixture repos and `repo-profile.json` schema. Acceptance requires detection of package manager, scripts, dev server, tests, routes, dirty state, and sensitive paths across at least Next, browser extension, Node CLI, and Python pipeline fixtures.

Phase 3 builds the Codex runner. Deliverables include runner config, subprocess wrapper, transcript capture, command capture, diff capture, and interruption behavior. Acceptance requires a fake Codex process fixture and one real local Codex dry run where artifacts are captured.

Phase 4 builds the verification executor. Deliverables include command runner, browser runner integration, API/CLI/manual evidence handlers, and `verification.json`. Acceptance requires failed commands to remain failed and browser smoke evidence to be required for UI tasks.

Phase 5 builds the independent verifier. Deliverables include schema checks, traceability audit, diff audit, claim audit, and severity findings. Acceptance requires mutation tests for fake evidence, missing smoke, wrong timing, forbidden path, and overclaim.

Phase 6 builds failure corpus v1. Deliverables include corpus format, sanitized fixtures, replay command, and promotion workflow. Acceptance requires at least five known failure cases and expected rejection.

Phase 7 builds policy engine v1. Deliverables include rule schema, default rules, task-class policies, pass/reject/block decisions, and override recording. Acceptance requires `policy-decision.json` and rejection of incomplete runs.

Phase 8 builds CLI/report UX. Deliverables include `meta init`, `meta run`, `meta verify`, `meta report`, `meta rerun`, and text/HTML reports. Acceptance requires a human-readable report that leads with findings and links evidence.

Phase 9 builds M10 adapters for at least three task classes. Start with web UI, browser extension, and CLI or data pipeline. Acceptance requires 10-30 real tasks replayed, including VOOVO and non-VOOVO examples.

## 21. Worked Examples

### Example 1: `voovo-checkout` Browse Empty-State Reset

Input task:

```text
Improve the browse marketplace no-results search state so a user who searches for unavailable content sees a clear empty state and can reset back to visible offerings.
```

Generated requirements:

- `R1`: inspect `voovo-checkout` current browse routes, tests, and scripts.
- `R2`: searching unavailable content on `/browse` shows a clear no-results state.
- `R3`: a reset or clear action returns the user to visible offerings.
- `R4`: automated coverage fails if the empty-state/reset behavior breaks.
- `R5`: browser smoke exercises the behavior through the runnable app.

Proof obligations:

- `P1` repo inspection: `package.json`, `scripts/smoke-browse.mjs`, `e2e/browse-to-purchase.spec.ts`.
- `P2` automated tests: `pnpm run test`.
- `P3` browser e2e: `pnpm run test:e2e e2e/browse-to-purchase.spec.ts`.
- `P4` browse smoke: `BASE_URL=http://127.0.0.1:3001 pnpm run smoke:browse`.

Expected evidence:

- command logs for tests and smoke
- Playwright trace or screenshot showing `zzzzxqwerty999` no-results state
- screenshot or assertion after reset showing offerings return
- diff touching browse components and e2e test only

Possible verifier rejection:

```text
R3 has no evidence. The test confirms empty state appears, but no reset action was clicked or asserted.
```

Possible accepted final report:

```json
{
  "claim": "Browse empty-state reset works",
  "requirements": ["R2", "R3", "R5"],
  "evidence": ["C4", "E7", "E8"],
  "residualRisk": ["Smoke used local public-list data from current dev environment."]
}
```

### Example 2: Site Gate Browser Extension

Input task:

```text
Build a Chrome extension that asks before opening a site, with Actually no, 1 min, 5 min, and custom minutes.
```

Generated requirements:

- `R1`: create Manifest V3 extension with background service worker and gate page.
- `R2`: first navigation to HTTP/HTTPS target opens gate before continuing.
- `R3`: 1 min, 5 min, and custom minutes allow target and persist per origin.
- `R4`: Actually no prevents target and opens blocked page.
- `R5`: invalid custom minutes stay on gate with visible validation.
- `R6`: real browser smoke verifies extension behavior.

Proof obligations:

- manifest/source validation
- browser extension load
- gate render assertion
- allow-flow assertions
- decline-flow assertion
- invalid-input assertion

Expected commands:

```bash
npm run site-gate:validate
npm run site-gate:smoke
```

Expected evidence:

- `tmp/site-gate-smoke/scenario.json`
- command logs
- browser target URL assertions
- gate and blocked page text assertions

Possible verifier rejection:

```text
The run used only node --check and never loaded the unpacked extension in a browser.
```

Possible accepted final report cites `site-gate:smoke` evidence and names residual risk that local Google Chrome may not load the extension worker while Edge/Chromium did.

### Example 3: `jarvis-voice-codex` Parser Behavior

Input task:

```text
Ensure Okay remains prompt-only while switch, exit, and stop are top-level controls.
```

Generated requirements:

- `R1`: inspect current parser and voice-control tests.
- `R2`: `Okay` must not be parsed as a control.
- `R3`: `switch instance N`, `exit instance N`, `exit all`, and `stop` remain controls.
- `R4`: raw spoken text must not normalize `slash resume` into `/resume` unless explicitly requested.
- `R5`: verification runs local parser/voice-control checks.

Proof obligations:

- parser unit tests
- `npm run verify:voice-controls`
- `npm run check`
- examples of raw transcript preservation

Expected evidence:

- command logs
- test output naming cases
- diff in parser/test/docs only

Possible verifier rejection:

```text
Final report claims raw transcript fidelity, but no test covers slash resume normalization.
```

Possible accepted final report maps `R2`, `R3`, and `R4` to named parser tests and `npm run verify:voice-controls`.

### Example 4: `hungarian-old-docs-ocr` Pipeline Validation

Input task:

```text
Add a local smoke test that rejects OCR pipeline outputs missing searchable PDF text layer evidence.
```

Generated requirements:

- preserve original visible page image
- produce searchable text layer
- produce sidecar text
- record manifest row
- reject missing text-layer proof
- stay local unless paid/cloud route is approved

Proof obligations:

- local fixture input
- generated PDF
- sidecar text
- manifest validation
- smoke test proving missing text layer fails

Expected commands:

```bash
python3 scripts/smoke_test_pdf_visual_verification.py
python3 scripts/smoke_test_pipeline.py
```

Possible verifier rejection:

```text
The output PDF exists, but no command verifies searchable text layer or manifest linkage.
```

This example matters because it is not web UI. It proves the harness must support artifact-heavy data pipelines, not only browser tests.

## 22. Acceptance Tests For The Harness Itself

Schema tests validate every artifact. Invalid JSON, missing schema versions, mismatched run IDs, missing required arrays, and unknown states must fail.

Mutation tests deliberately corrupt valid run folders. Remove `spec.json`, delete a proof obligation, change a command exit code, remove an evidence file, edit a forbidden path, or change final report outcome to passed. The verifier or policy must reject.

Fake verification rejection tests set `verification.status` to passed with no commands or evidence. This already exists in M1/M3 form and must expand to completed runs.

Missing user smoke rejection tests create a UI run where unit tests pass but no browser evidence exists. Policy must reject for web UI and browser extension task classes.

Forbidden path rejection tests add `.env` to `changed-files.json` and `diff.patch`. Policy must reject even if tests pass.

Dirty repo handling tests create fixture repos with unrelated dirty files. The repo adapter must record dirty state. The runner must not revert unrelated files. The policy may require fresh worktree for PR-grade tasks.

Command failure handling tests include a failed verification command and a final report claiming passed. The verifier must produce a blocking honesty finding.

Final overclaim rejection tests cite nonexistent evidence or claim a requirement passed with only unrelated proof. The verifier must reject.

Corpus replay tests load known failure cases and assert they still reject. Expected-pass corpus cases assert that valid runs remain acceptable.

Browser smoke tests use a local fixture app. They should verify actual user interaction, not just HTTP 200. API smoke tests use local endpoints or mocked servers. CLI smoke tests invoke real binaries.

The harness should also test its own report output. A rejected run must show blocking reasons first. An accepted run must show residual risk. Reports must link evidence paths.

## 23. Open Questions And Deferred Choices

Exact Codex CLI event capture is still a real unknown. The runner may need to use JSON output, logs, shell wrappers, or transcript files depending on current CLI support. The implementation must record capture completeness and not pretend full introspection if unavailable.

The best browser runner is not settled. Playwright is a strong default for web apps. Browser extensions may need Chrome DevTools Protocol or Playwright persistent contexts. Local Chrome builds can behave differently, as the Site Gate smoke showed. The harness should support a browser runner abstraction and record browser path/version.

Large evidence storage needs a decision. Screenshots, traces, videos, generated PDFs, and logs can grow. Repo-local storage is simple, but long-term storage may need compression, pruning, or central artifact directories.

Human approval boundaries need a UX. Approval should be explicit and recorded. It might be a CLI prompt, config file, or signed event. The first implementation can block instead of approving live actions.

Semantic task compilation may use models later, but the first compiler should remain conservative and testable. If a model is used to extract requirements, its output must be validated by schemas and verifier checks.

Isolation for untrusted repo commands is unresolved. Local tasks may run arbitrary scripts. The harness should start with clear policy and sandbox options, then consider stronger isolation for risky repos.

Corpus privacy is unresolved for private work. Sanitization tools and private corpus storage are needed before broad VOOVO failure promotion.

Policy override governance is unresolved. The system needs a way to let the user accept known risk without weakening default gates.

## 24. Final Definition Of Done For The Meta-Harness

The full M0-M10 meta-harness is done only when it proves itself on real work.

At least three task classes must be supported end to end. The minimum recommended set is web UI, browser extension, and CLI or data pipeline. Each class must have task compiler templates, repo adapter signals, proof templates, verification execution, verifier checks, and policy rules.

At least 10-30 real tasks must be replayed. These should include VOOVO work, a local Jarvis tool, a browser extension, and an artifact-heavy pipeline. The replay set should include accepted and rejected runs.

The known failure corpus must catch regressions. If fake verification or missing browser smoke once slipped through, a corpus case must now reject it. The corpus must run in CI or `npm run check`.

The policy engine must reject incomplete runs. It must reject missing artifacts, unmapped requirements, failed commands reported as passed, missing user smoke for UI tasks, forbidden file edits, unknown evidence citations, and failed corpus replays.

The human-readable report must be usable. A user should be able to read the report and know what passed, what failed, what evidence exists, what is risky, and what to do next.

The final decision must be based on artifacts, not assistant prose. The final report can explain the decision, but `policy-decision.json` and the evidence chain are authoritative.

The system must also preserve humility. It should not claim semantic certainty where only partial proof exists. It should say rejected, blocked, or accepted with residual risk.

## 25. Milestone-To-Component Matrix

| Milestone | Purpose | Main components | Primary artifacts | Acceptance test |
| --- | --- | --- | --- | --- |
| M0 | doctrine and contract | protocol docs, acceptance gate | protocol, final report rules | fake done rejected |
| M1 | task compiler | compiler | `spec.json`, `proof-plan.json` | requirements mapped |
| M2 | repo adapter | adapter registry | `repo-profile.json` | fixture repos profiled |
| M3 | run envelope | run store | `.task-runs/<id>/` | required artifacts present |
| M4 | Codex runner | runner | transcript, command log, diff | implementation captured |
| M5 | verification executor | command/browser/API runners | `verification.json`, `evidence/` | proof commands executed |
| M6 | independent verifier | verifier | `verifier-report.json` | fake claims rejected |
| M7 | failure corpus | corpus manager | corpus fixtures | known failures replay |
| M8 | product surface | CLI/report | text/html report | usable daily output |
| M9 | policy enforcement | policy engine | `policy-decision.json` | hard reject/pass/block |
| M10 | generalization | task-class adapters | adapter templates | three task classes proven |

## 26. Current-Vs-Target Capability Table

| Capability | Current state | Target state | Gap |
| --- | --- | --- | --- |
| M0 doctrine | exists | enforced through policy | connect to M9 |
| M1 compiler | v0 with script cues | task-class-aware compiler | semantic depth |
| M2 adapter | minimal profile | deep repo profile | framework/test/risk detection |
| M3 envelope | basic artifacts | full run folder | command/diff/evidence placeholders |
| M4 runner | absent | Codex wrapper | transcript/diff capture |
| M5 verification | manual scripts exist | proof executor | command/browser/API runners |
| M6 verifier | acceptance-gate early form | completed-run verifier | full artifact audit |
| M7 corpus | scattered evals | failure corpus | intake/promotion/replay |
| M8 UX | npm scripts | `meta` CLI and report | user surface |
| M9 policy | implicit gates | rule engine | hard decisions |
| M10 generalization | examples | task-class adapters | coverage across classes |

## 27. Required JSON Examples

### `spec.json`

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.task-spec",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "task": {
    "raw": "Improve the browse marketplace no-results search state...",
    "title": "Browse empty-state reset"
  },
  "requirements": [
    { "id": "R1", "text": "Inspect current browse implementation.", "proofObligationIds": ["P1"] },
    { "id": "R2", "text": "Show clear no-results state.", "proofObligationIds": ["P2", "P3"] },
    { "id": "R3", "text": "Reset returns visible offerings.", "proofObligationIds": ["P3"] }
  ],
  "userFlows": [{ "id": "F1", "steps": ["Open /browse", "Search zzzzxqwerty999", "Click reset"] }]
}
```

### `proof-plan.json`

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.proof-plan",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "obligations": [
    {
      "id": "P3",
      "requirementIds": ["R2", "R3"],
      "acceptedEvidenceTypes": ["browser-smoke", "playwright-trace"],
      "minimumEvidence": 1
    }
  ]
}
```

### `command-log.jsonl`

```json
{"schemaVersion":1,"id":"C7","runId":"20260624-voovo-checkout-browse-empty-state","phase":"verify","command":"pnpm run test:e2e e2e/browse-to-purchase.spec.ts","cwd":"/repo","startedAt":"2026-06-24T12:00:00Z","finishedAt":"2026-06-24T12:00:45Z","exitCode":0,"stdoutPath":"evidence/commands/C7.stdout.txt","stderrPath":"evidence/commands/C7.stderr.txt","requirementIds":["R2","R3"],"proofObligationIds":["P3"]}
```

### `verification.json`

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.verification",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "status": "passed",
  "proofObligations": [
    { "id": "P3", "status": "passed", "evidence": ["C7", "E7"] }
  ],
  "evidence": [
    { "id": "E7", "type": "playwright-trace", "path": "evidence/browser/reset-trace.zip" }
  ]
}
```

### `final-report.json`

```json
{
  "schemaVersion": 1,
  "kind": "meta-harness.final-report",
  "runId": "20260624-voovo-checkout-browse-empty-state",
  "outcome": "passed",
  "claims": {
    "userSmoke": { "status": "passed", "requirementIds": ["R2", "R3"], "evidence": ["C7", "E7"] }
  },
  "residualRisk": ["Smoke used current local offering data only."]
}
```

The `repo-profile.json`, `verifier-report.json`, and `policy-decision.json` examples appear in sections 10, 14, and 16.

## 28. Required Rejection Examples

Tests not run: `verification.json` has no command records and final report claims passed. Reject with `POL-VERIFY-001`.

Browser smoke missing: UI task has unit tests but no browser trace, screenshot, or route smoke. Reject with `POL-UI-001`.

Final report cites nonexistent evidence: claim references `E999`, but evidence registry has no `E999`. Reject with `POL-HONESTY-001`.

Verification failed but final says passed: command `C4` has exit code 1 and final report cites it as passed. Reject with `POL-HONESTY-002`.

Forbidden file edited: `changed-files.json` contains `.env.local`. Reject with `POL-FILES-001`.

Requirement has no proof obligation: `R4` exists but no obligation lists it. Reject with `POL-TRACE-001`.

Happy path only: checkout accepts valid email but invalid email validation was required and untested. Reject or major finding with `POL-NEGATIVE-001`.

## 29. Completion Criteria For This Implementation Plan

This document is implementation-ready only if it satisfies the verifier handbook: word count at least 16,000, M0-M10 coverage, required sections, required tables, required JSON examples, at least five rejection examples, at least three worked examples, current-vs-target honesty, security boundaries, testability, and no blocking findings after audit.

The plan intentionally does not claim the meta-harness is finished. It defines how to build it. The next implementation work should create new bounded goals for the phases above, starting with hardening M1/M3 and then building M2 repo adapter v1.

## 30. Milestone Mechanical Coverage

This section restates M0-M10 as mechanical implementation contracts. It exists so a future builder cannot treat the roadmap as motivational language. Each milestone must produce artifacts, commands, tests, and policy-visible outputs.

### M0 Doctrine And Contract

M0 owns the language of correct work. Its purpose is to define what a valid software-development run means before any harness code tries to enforce it. The current source is `docs/fresh-repo-feature-protocol.md`, plus `AGENTS.md` and the acceptance-gate fixtures. The target state is not just a document. The target state is a set of policy-readable obligations: inspect before editing, define proof before implementation, run automated checks after final edits, run user-surface smoke for user-facing tasks, cite real evidence, and state residual risk.

Target artifacts include `doctrine.json` or a policy-extractable section in the docs, `required-final-claims.json`, and default proof-obligation templates. Implementation mechanics include parsing the doctrine into named rules, assigning rule IDs, and mapping those rules to verifier and policy checks. Acceptance tests include fake final reports that claim "done" without proof, transcripts that edit before inspection, and runs that omit residual risk.

M0 relates to every later milestone. M1 converts doctrine into requirements and proof obligations. M5 runs the proof doctrine demands. M6 audits whether the doctrine was followed. M9 enforces it. M0 is incomplete if it remains advice that the runner can ignore.

### M1 Task Compiler

M1 owns the first translation from request to contract. Its purpose is to turn a vague task into explicit requirements, non-requirements, risks, user flows, required tests, manual smoke instructions, and proof obligations. The current implementation in `meta-harness/lib/task-packet.mjs` is a v0. It preserves raw task text, uses simple repo script and task cues, and writes `spec.json` plus `proof-plan.json`.

Target artifacts are `spec.json`, `proof-plan.json`, and the initial `allowed-files.json`. Implementation mechanics include task cue extraction, task-class classification, requirement templates, negative-path detection, proof obligation generation, ambiguity handling, and specificity validation. The compiler should emit warnings or blockers when a request is too broad. For example, "make checkout better" should not silently become a passable spec.

Acceptance tests must include fixture tasks for web UI, browser extension, CLI, API, and data pipeline classes. Mutations should remove proof mappings, remove negative paths, remove user smoke for a UI task, or replace task-specific requirements with generic prose. M1 relates to M2 because repository facts make specs specific. It relates to M5 because proof obligations become executable proof. It relates to M9 because unmapped requirements become hard rejects.

### M2 Repo Adapter

M2 owns current-state understanding. Its purpose is to stop the harness from guessing how a repository works. It profiles stack, scripts, test commands, dev server commands, routes, test style, sensitive paths, dirty state, live-system risk, and nested repo boundaries. The current state is only a minimal inspection stub. The target state is a reliable `repo-profile.json` that future components can trust enough to plan proof.

Target artifacts include `repo-profile.json`, optional `repo-signals.json`, and adapter debug evidence under `evidence/repo-profile/`. Implementation mechanics include reading package metadata, lockfiles, configs, route trees, test directories, Git status, and docs without reading secrets. It should classify scripts into safe local checks, smoke checks, live-system actions, deploy actions, migrations, sends, and cost-bearing external calls.

Acceptance tests require fixture repositories. A Next fixture should yield package manager, dev server, build, test, e2e, and route signals. A browser extension fixture should yield manifest and extension surfaces. A Python pipeline fixture should yield scripts and generated artifact expectations. A dirty repo fixture should record dirty state without reverting it. M2 relates to M1 by making task specs concrete. It relates to M4 by selecting cwd and safe command boundaries. It relates to M5 by selecting likely proof commands.

### M3 Run Envelope

M3 owns the durable run folder. Its purpose is to make every task a record, not a memory. The current implementation creates the eight basic artifacts. The target state adds command logs, transcript, diff, changed files, evidence directory, verifier report, policy decision, and reports.

Target artifacts are the full `.task-runs/<id>/` directory. Implementation mechanics include safe run ID generation, overwrite protection, append-only event logging, evidence path normalization, artifact schema versions, and cleanup rules. It should make current state visible in Git status without auto-committing private evidence.

Acceptance tests include missing-artifact rejection, invalid run ID rejection, overwrite behavior, path traversal rejection, event-log append behavior, and validation that seed final reports remain `pending`. M3 relates to every other milestone because it is the filesystem API between them. M4 writes runner evidence into the envelope. M5 writes verification evidence. M6 and M9 read the envelope. M7 can promote sanitized envelope slices into corpus fixtures.

### M4 Codex Runner

M4 owns execution control. Its purpose is to wrap Codex CLI and record what happens. It is the difference between "ask Codex nicely" and "run Codex inside a harness." It does not decide correctness. It captures enough evidence that later components can judge correctness.

Target artifacts include `runner-config.json`, `transcript.jsonl`, `command-log.jsonl`, `diff.patch`, `changed-files.json`, and runner events. Implementation mechanics include prompt construction from the task packet, CLI invocation, sandbox selection, timeout handling, process exit recording, command capture, stdout/stderr capture, transcript capture, diff capture, and interruption handling.

Acceptance tests should use a fake Codex executable that emits known transcripts, runs commands, fails commands, and edits files. Tests must prove the runner captures successful edits, failed commands, forbidden edit attempts, interruptions, and timeouts. A real local Codex smoke can be added later but should not be the only proof. M4 relates to M3 by writing artifacts, M5 by handing off implemented state, M6 by providing audit material, and M9 by creating command and diff evidence that policy can enforce.

### M5 Verification Executor

M5 owns proof execution. Its purpose is to run the proof plan rather than accept claims. It reads `proof-plan.json`, repo profile, changed files, and task-class adapter hints. It runs commands and scenarios and writes `verification.json` plus evidence files.

Target artifacts include `verification.json`, command logs, screenshots, traces, response bodies, generated files, manifests, and manual evidence. Implementation mechanics include command execution, dev server lifecycle, browser automation, API request capture, CLI invocation, data fixture execution, timeout policy, log capture, and evidence registry creation.

Acceptance tests include a passing command, a failing command, a timed-out command, a browser flow that passes, a browser flow that fails, an API smoke with invalid input, a CLI smoke with bad args, and a data fixture missing an expected output. M5 relates to M1 because proof obligations decide what it runs. It relates to M6 because verifier audits its outputs. It relates to M9 because policy cannot enforce missing or failed proof without M5 evidence.

### M6 Independent Verifier

M6 owns adversarial review. Its purpose is to disprove the builder's final claim using artifacts. It is not the same process as the builder. It must be able to reject plausible-looking runs.

Target artifact is `verifier-report.json`. Implementation mechanics include schema validation, run-state validation, requirement-proof mapping, command exit audit, command timing audit, diff audit, evidence registry lookup, final-claim audit, residual-risk audit, and task-class-specific evidence checks. The verifier should be deterministic where possible. When model-assisted review is used later, its output must still be grounded in artifact IDs and rule IDs.

Acceptance tests are mostly mutation tests. Mutate a valid run by deleting evidence, changing an exit code, removing browser smoke, editing `.env`, moving tests before edits, making final report cite unknown evidence, and removing residual risk. The verifier must reject or produce major findings. M6 relates to M5 by auditing evidence, to M7 by incorporating known failure patterns, and to M9 by feeding findings into final policy.

### M7 Failure Corpus

M7 owns learning from real failures. Its purpose is to prevent the harness from remaining theoretical. A real failure should become a minimized, repeatable case that future harness changes must handle.

Target artifacts include `corpus/<category>/<case-id>/README.md`, input fixtures, expected artifacts, bad run folders, mutation files, and replay scripts. Implementation mechanics include failure intake, privacy classification, minimization, fixture generation, expected-pass/expected-fail labeling, replay command creation, and promotion from real runs.

Acceptance tests include corpus replay. Known fake verification cases should reject. Known good runs should pass. A corpus case should fail if the policy rule is removed. M7 relates to M6 by adding verifier cases and to M9 by adding rules. It relates to M10 because each task class needs its own failure patterns. It is the strongest defense against brittle heuristics because it grounds policy in real observed failures.

### M8 Product Surface

M8 owns daily usability. Its purpose is to make the harness practical. Without M8, the system becomes a pile of JSON that only its author can use. The product surface starts as CLI, HTML reports, and a local dashboard. The dashboard target is `docs/meta-harness-dashboard-spec.md`: a desktop-only, read-only, file-backed local web surface over one `.task-runs/<id>/` folder.

Target commands include `meta init`, `meta run`, `meta verify`, `meta report`, `meta dashboard`, `meta rerun`, `meta promote-failure`, and `meta cleanup`. Target artifacts include generated text reports and `html-report/`. Implementation mechanics include argument parsing, useful errors, file links, concise report rendering, rerun discovery, evidence navigation, corpus promotion prompts, read-only dashboard endpoints, bounded output tails, and safe artifact path normalization.

Acceptance tests include CLI snapshot tests, rejected-run report tests, accepted-run report tests, missing-file errors, evidence-link checks, dashboard summary parsing, artifact traversal rejection, local server startup, and rendered HTML smoke. M8 relates to M9 because users need to see policy decisions clearly. It relates to M7 because promoting failures must be ergonomic. It relates to every milestone because poor UX makes disciplined use unlikely.

### M9 Policy And Enforcement

M9 owns hard decisions. Its purpose is to convert evidence and verifier findings into pass, reject, or block. M9 is not another test runner. M5 produces evidence. M6 audits evidence. M7 supplies real failure patterns and regression cases. M9 turns those outputs into non-negotiable acceptance policy.

Target artifact is `policy-decision.json`. Implementation mechanics include rule schema, rule registry, task-class applicability, severity handling, override recording, blocked-vs-rejected classification, and deterministic decision generation. Default hard rules include missing artifacts, unmapped requirements, failed verification, missing required smoke, forbidden file edits, unknown evidence citations, and corpus regressions.

Acceptance tests include accepted run, rejected run, blocked run, override run, and policy recomputation. M9 relates to M0 because doctrine becomes law here. It relates to M5-M7 as described above. It relates to M8 because decisions must be explainable. M9 is complete only when a Codex final answer cannot bypass it.

### M10 Generalization

M10 owns expansion across task classes. Its purpose is to make the harness useful beyond one demo. Generalization must come after the first classes work. The project should start with web UI, browser extension, and CLI or data pipeline. Then expand to API/backend, mobile, and deploy/ops.

Target artifacts include task-class adapter modules, proof templates, fixture repos, corpus cases, and policy profiles. Implementation mechanics include adapter selection, task cue extraction, repo-signal interpretation, proof template generation, evidence validation, and class-specific false-pass detection.

Acceptance tests require end-to-end runs across at least three task classes and replay of 10-30 real tasks. M10 relates to M1 and M2 because class adapters improve compilation and profiling. It relates to M5 because proof execution differs by class. It relates to M7 because every class needs real failure cases. M10 is not "make it universal"; it is prove more classes without weakening the core traceability model.

## 31. Anti-Toy Harness Failure Audit

This section maps common weak-agent failures to the component that must catch them. A plan that cannot answer these failures is not implementation-ready.

1. Codex edits files before inspecting the repo. M4 captures edit and inspection events. M6 checks ordering. M9 rejects with `POL-ORDER-001` unless the task explicitly allows no inspection, which should be rare. Evidence is `events.jsonl`, `command-log.jsonl`, and `diff.patch`.

2. Codex runs `npm test`, but the UI button still crashes. M1 must require user-surface proof for UI tasks. M5 must run browser smoke. M6 must detect missing browser evidence if only unit tests ran. M9 rejects with `POL-UI-001`. Evidence is Playwright trace, screenshot, console log, and command exit.

3. Codex claims browser smoke passed but no screenshot, trace, log, or scenario artifact exists. M5 evidence registry will be empty or missing accepted evidence type. M6 rejects unknown or absent evidence. M9 rejects with `POL-HONESTY-001` or `POL-UI-001`.

4. Codex changes `.env`. M3 seeds forbidden paths. M4 captures changed files. M6 audits diff boundaries. M9 rejects with `POL-FILES-001`. If the task truly requires env changes, it must be an explicit approved exception with redacted evidence.

5. Codex says "done" after a failed command. M5 records exit code. M6 compares command status to final claims. M9 rejects with `POL-HONESTY-002`. The report shows the failed command first.

6. Codex tests only the happy path while the task required invalid-input behavior. M1 must generate a negative proof obligation. M5 must run negative scenario. M6 checks coverage. M9 rejects with `POL-NEGATIVE-001` if the negative path is absent.

7. Codex modifies unrelated files. M3 and M1 define allowed and justification-required paths. M4 records diff. M6 audits changed paths against requirements. M9 rejects or flags major depending on scope.

8. Codex ignores existing repo scripts. M2 records scripts. M1 uses repo profile to choose proof commands. M6 can warn if verification uses ad hoc commands while better repo-native scripts exist. M9 may reject if required repo-native commands were skipped.

9. Codex produces a final report that cites nonexistent evidence. M6 evidence registry lookup rejects. M9 rejects with `POL-HONESTY-001`. This is already covered by acceptance-gate style tests.

10. Codex passes one real task but regresses on a known failure case. M7 corpus replay catches it. M9 rejects with `POL-CORPUS-001`. The report links to the corpus case so the user can understand the regression.

11. Codex uses stale dev-server state. M5 records dev server start command, port, process, and base URL. M6 checks whether smoke hit the expected server and whether stale build markers appeared. M9 can reject if smoke evidence came from the wrong server or if the command output shows stale chunk errors.

12. Codex hides uncertainty. M6 checks residual risk. M9 rejects missing residual risk for nontrivial accepted runs or downgrades to major finding for simple tasks. Final reports must separate verified facts from remaining risk.

## 32. Verification Handbook Self-Audit

This implementation plan is designed to satisfy the verification handbook, but the handbook must still be run after drafting. The audit procedure is:

```bash
wc -w docs/meta-harness-implementation-plan.md
rg -n "^## " docs/meta-harness-implementation-plan.md
rg -n "M0|M1|M2|M3|M4|M5|M6|M7|M8|M9|M10" docs/meta-harness-implementation-plan.md
rg -n "spec.json|repo-profile.json|proof-plan.json|command-log.jsonl|verification.json|verifier-report.json|policy-decision.json|final-report.json" docs/meta-harness-implementation-plan.md
rg -n "voovo-checkout|Site Gate|jarvis-voice-codex|hungarian-old-docs-ocr" docs/meta-harness-implementation-plan.md
git diff --check
```

The verifier should reject if the word count is under 16,000. It should also reject if any core section is missing, if M0-M10 are merely named but not mechanically specified, if required tables are missing, if required JSON examples are missing, if fewer than three worked examples exist, or if fewer than five concrete rejection examples exist.

The plan includes eight required tables: run state transition, artifact ownership, traceability example, test taxonomy, failure category to policy rule, phase implementation, milestone-to-component, and current-vs-target capability. The verifier should inspect each table for real content rather than checking only that pipe characters exist.

The plan includes JSON examples for `repo-profile.json`, `verifier-report.json`, and `policy-decision.json` in their component sections, and examples for `spec.json`, `proof-plan.json`, `command-log.jsonl`, `verification.json`, and `final-report.json` in the required JSON section. The verifier should confirm that these examples contain stable IDs and traceability fields.

The plan includes worked examples for `voovo-checkout`, Site Gate, `jarvis-voice-codex`, and `hungarian-old-docs-ocr`. The verifier should check that each example includes input task, requirements, proof obligations, commands or evidence, possible rejection, and possible accepted result.

The plan names current-vs-target honestly. It states that M1/M3 v0 exists; `npm run meta:init`, `npm run meta:validate`, and `npm run meta:check` exist; acceptance-gate exists; Site Gate smoke exists; VOOVO replay exists. It also states that deep repo adapter, Codex runner, verification executor, completed-run verifier, policy engine, failure corpus manager, and product report UX are not complete.

If the verifier finds only minor wording issues, the plan can be accepted. If the verifier finds missing mechanics, missing examples, or a word count below floor, the plan must be rejected and patched before any implementation goal uses it.

## 33. Verifier Acceptance Mapping

This section gives the future verifier a direct map from handbook checks to evidence in the plan. It exists because a long plan can still be vague, and a short checklist can still be too easy to satisfy cosmetically. The verifier should treat this section as a navigation aid, not as self-certification. If a row claims coverage that the referenced section does not actually provide, the verifier should reject the plan.

| Handbook Check | Evidence In This Plan | Acceptance Meaning |
| --- | --- | --- |
| Word floor | Whole document word count | At least 16,000 words before acceptance. |
| M0-M10 coverage | Sections 4, 6-16, 18, 24, 25, 30 | Every milestone has target artifacts, mechanics, tests, and dependencies. |
| Current-state honesty | Sections 5 and 26 | The plan separates existing v0 pieces from target capabilities. |
| M5-M7-M9 relationship | Sections 10, 11, 12, 14, 17, 30 | Evidence, independent audit, corpus learning, and policy decision are distinct. |
| Required tables | Sections 6, 7, 8, 18, 19, 22, 25, 26, 33 | Tables encode decisions rather than decoration. |
| Required JSON examples | Sections 9, 11, 14, 27 | Artifacts have stable IDs, references, and decision fields. |
| Rejection examples | Sections 6, 9, 10, 11, 14, 19, 28, 31 | The harness rejects plausible false-completion patterns. |
| Worked examples | Sections 20 and 21 | Real task classes show how the same contract behaves differently. |
| Implementation order | Sections 22, 23, 24 | Build phases are incremental and testable. |
| Anti-toy audit | Sections 19 and 31 | Weak heuristics are translated into observable failure modes. |

The most important acceptance mapping is the requirement-to-proof-to-policy chain. The plan must not be accepted if it allows an implementation where requirements are parsed, tests are run, and final text is produced without a deterministic link among those facts. The link starts with M1 requirement IDs, continues through M1 proof obligations, is executed by M5, is audited by M6, and is enforced by M9. M7 adds regression pressure by turning real failures into permanent cases. M8 makes the outcome readable. M10 repeats the same chain across task classes instead of replacing it with a looser general-purpose prompt.

The second important acceptance mapping is current versus target. Existing work has a doctrine, a roadmap, initial packet/run-folder scaffolding, acceptance tests for basic false-completion cases, and at least one product-smoke direction. That does not equal a finished harness. The missing pieces are the ones that turn a useful protocol into an executable product: repo profiling, run orchestration, command and browser proof execution, independent verification, policy decisions, corpus replay, and reports that are good enough to use under pressure. The implementation plan names those gaps so future work does not confuse a scaffold with the system.

The third important acceptance mapping is task-class specificity. The plan should not be read as "always run npm test and Playwright." It says the harness needs proof templates for web UI, browser extension, CLI, backend/API, data pipeline, and voice/control tasks. For a browser extension that asks before opening pages, the proof plan should include extension packaging, browser install, navigation interception, option behavior for "actually no", one-minute delay, five-minute delay, custom delay, persistence, and bypass or failure behavior. For a CLI tool, it should include command arguments, invalid input, filesystem output, and idempotency. For a data repair, it should include fixtures, dry-run output, mutation scope, and rollback evidence. The invariant is traceability, not one test command.

The fourth important acceptance mapping is independent rejection. The verifier must be able to reject a run even when the builder's final report sounds coherent. That means it must inspect artifacts rather than trust summaries. It should reject unknown evidence IDs, missing command logs, failed commands represented as success, absent browser traces for browser tasks, changed forbidden paths, and requirements that never received proof. It should also reject a plan implementation that lets the builder write the verifier verdict directly. The verifier may use model assistance later, but the final reject or accept decision must remain grounded in structured artifacts and deterministic policy rules.

The fifth important acceptance mapping is corpus-backed improvement. A real task failure should not disappear into chat history. It should become a minimized case with input packet, expected proof obligations, bad artifacts, and expected rejection. When a future policy or verifier change fails to reject that case, the harness build should fail. This is the answer to the concern that specific heuristics become brittle: individual rules can be revised, but the corpus preserves the observed false-pass behavior and forces replacements to keep catching it.

The sixth important acceptance mapping is user-surface verification. The plan should be rejected if it treats internal tests as enough for user-facing work. A user does not experience "unit tests passed"; a user experiences a button, route, extension prompt, generated file, email draft, API response, or deployed page. The proof plan must therefore include at least one evidence obligation at the level where the user would notice the bug, unless the task is explicitly internal. For UI work this usually means a browser scenario. For a CLI it means executing the installed command. For a backend it means making a real request against the local service. For a document or generated artifact it means inspecting the output file.

The seventh important acceptance mapping is final-report discipline. The final report is not just prose. It is the user-facing rendering of the run state, proof results, verifier findings, policy decision, and residual risks. It must not say "done" unless the policy decision is accepted. If blocked, it should say what external condition blocked verification. If rejected, it should put the rejection reason first. If accepted with residual risk, it should separate verified facts from unverified assumptions. This prevents a common failure where an agent does some useful work but reports a stronger state than the evidence supports.

The eighth important acceptance mapping is implementation granularity. Each milestone must produce executable increments. M0 can be accepted with doctrine checks. M1 and M3 can be accepted with frozen packets and run folders. M2 can be accepted with repo profiles on a fixture matrix. M4 can be accepted with event capture and diff boundaries. M5 can be accepted with command and browser proof execution. M6 can be accepted with mutation rejection. M7 can be accepted with replayable corpus cases. M8 can be accepted with usable CLI reports. M9 can be accepted with deterministic decisions. M10 can be accepted only after several task classes run end to end. This prevents the implementation from becoming a single vague "build harness" epic.

The final acceptance question for the verifier is simple: if Codex receives a fresh repo and a feature request, can this plan guide implementation of a harness that forces the run to create a task packet, inspect the repo, map requirements to proof obligations, execute the right proof, preserve evidence, run an independent audit, apply policy, and only then report completion? If the answer is yes and the hard checklist passes, the implementation plan is usable. If any link in that chain is optional, unclear, or only described as future aspiration, the plan needs another patch before it becomes the basis for milestone execution.
