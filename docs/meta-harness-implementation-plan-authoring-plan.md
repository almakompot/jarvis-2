# Meta-Harness Implementation Plan Authoring Plan

## Purpose

Write the serious implementation plan for the full meta-harness described in `docs/meta-harness-roadmap.md`.

The output of this task is not code. The output is one durable planning document:

```text
docs/meta-harness-implementation-plan.md
```

That implementation plan must be detailed enough that a fresh Codex session can use it to build the meta-harness without turning the project into a toy scaffold. It should connect product goals, software-development mechanics, artifact contracts, state transitions, verification behavior, failure corpus design, and policy enforcement into one coherent build plan.

## Target Size

Aim for:

```text
30-45 page-equivalent sections
18,000-25,000 words
```

Hard floor:

```text
16,000 words
```

Do not inflate the document with generic software advice. Every section must either define a harness component, an artifact, a state transition, a gate, a verification method, an example, or a build sequence.

## Inputs To Read First

Read these files before drafting:

```text
docs/meta-harness-roadmap.md
docs/fresh-repo-feature-protocol.md
README.md
AGENTS.md
meta-harness/README.md
meta-harness/lib/task-packet.mjs
meta-harness/scripts/task-packet.test.mjs
evals/acceptance-gate/ACCEPTANCE.md
evals/acceptance-gate/scripts/verify-run.mjs
```

Optional but useful:

```text
evals/voovo-pr-replay/README.md
apps/site-gate-extension/README.md
```

## Writing Rules

- Keep the full M0-M10 roadmap in view.
- Do not redefine the project as only the current M1/M3 implementation.
- Separate current state from target state.
- Define every important artifact as a machine-readable file or directory.
- Define every important process as a state transition.
- Define every acceptance claim as something a verifier can check.
- Include concrete examples, not only prose.
- Use names that can become filenames, command names, schema names, or test names.
- Explicitly name what remains unknown or deferred.
- Do not hide hard parts behind words like "intelligently", "robustly", or "automatically" without explaining the mechanism.

## Required Output Structure

Create `docs/meta-harness-implementation-plan.md` with the sections below.

### 1. Executive Summary

Define the final deliverable in one paragraph:

```text
A local meta-harness CLI that takes a repo plus feature request, creates a frozen contract, runs or controls Codex against that contract, captures evidence, executes verification, independently reviews the result, and rejects "done" unless the requested user-facing behavior is proven.
```

Include the intended top-level command:

```bash
meta run --repo /path/to/repo --task "build X"
```

Include the expected run output directory:

```text
.task-runs/<id>/
```

### 2. Product Goal And Non-Goals

Define what the harness is and is not.

Must include:

- not a generic app builder
- not a replacement for tests
- not a production deploy system
- not a perfect semantic oracle
- yes: a delivery judge and execution harness around Codex
- yes: a system for making claims rejectable

### 3. End-To-End User Workflow

Describe the ideal user flow from request to accepted/rejected result.

Include:

```text
meta run
repo inspection
task compilation
implementation run
verification execution
independent review
policy decision
human-readable report
promotion into failure corpus when useful
```

Include at least one full worked example using `voovo-checkout` or another local project.

### 4. Current State

Document what exists now.

Must mention:

- M0 doctrine exists in `docs/fresh-repo-feature-protocol.md`
- roadmap exists in `docs/meta-harness-roadmap.md`
- M1/M3 v0 exists in `meta-harness`
- `npm run meta:init`
- `npm run meta:validate`
- `npm run meta:check`
- acceptance gate exists in `evals/acceptance-gate`
- Site Gate extension smoke exists
- VOOVO replay harness exists

Also state current limitations clearly.

### 5. Target Architecture

Define the major components:

- task compiler
- repo adapter
- run envelope
- Codex runner
- verification executor
- independent verifier
- failure corpus
- policy engine
- report/dashboard surface
- task-class adapters

For each component, include:

- responsibility
- inputs
- outputs
- state transitions it owns
- artifact files it reads/writes
- failure modes
- tests required for the component

### 6. Run State Machine

Define the canonical states:

```text
created
specified
profiled
planned
running
implemented
verification-running
verified
reviewing
accepted
rejected
blocked
archived
```

For each state:

- entry condition
- allowed transitions
- required artifacts
- forbidden claims
- what can still be edited

Include a transition table.

### 7. Artifact Model

Define the run directory.

Minimum target shape:

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

For every artifact:

- owner component
- schema version
- required fields
- when it is written
- whether it is append-only or replaceable
- which later component consumes it
- how it can be faked
- how it is verified

### 8. Requirement And Proof Traceability

Define the central traceability chain:

```text
Requirement -> Proof obligation -> Verification command/scenario -> Evidence artifact -> Verifier finding -> Policy decision
```

Include:

- requirement IDs
- proof obligation IDs
- evidence IDs
- claim IDs
- policy rule IDs
- mapping rules
- examples of valid and invalid mappings

Hard rule:

```text
No requirement can be accepted without at least one passing proof obligation.
```

### 9. Task Compiler Mechanics

Specify how vague requests become frozen specs.

Include:

- request parsing
- requirement extraction
- non-requirement extraction
- user-flow extraction
- risk classification
- proof obligation generation
- allowed file seed generation
- required test class generation
- ambiguous request handling
- specificity levels

Include examples:

- browser extension task
- Next.js UI task
- CLI task
- API task
- data/OCR pipeline task

Define how the compiler avoids generic mush.

### 10. Repo Adapter Mechanics

Specify how the harness profiles repos.

Include:

- package manager detection
- framework detection
- script detection
- test command detection
- dev server detection
- route/surface detection
- existing test style detection
- forbidden/sensitive file detection
- deploy/live-system risk detection
- dirty worktree handling
- nested repo handling

Include adapter output schema.

### 11. Run Envelope Mechanics

Specify how `.task-runs/<id>/` is created and protected.

Include:

- run ID generation
- overwrite policy
- artifact initialization
- append-only event log rules
- path normalization
- cross-repo run storage choices
- cleanup policy
- how generated runs appear in git status

### 12. Codex Runner Mechanics

Specify how Codex CLI is wrapped.

Include:

- command invocation model
- prompt construction
- protocol injection
- cwd and sandbox selection
- timeout model
- transcript capture
- tool/event capture
- stdout/stderr capture
- diff capture
- exit behavior
- retry policy
- interruption handling
- blocked handling

Do not claim this exists yet unless implemented later.

### 13. Verification Executor Mechanics

Specify how proof is run.

Include test classes:

- unit
- integration
- lint
- typecheck
- build
- browser smoke
- API smoke
- CLI smoke
- visual/screenshot
- migration/data check
- manual artifact

For each class:

- when it is required
- command shape
- evidence shape
- failure shape
- common false positives

Include negative testing requirements.

### 14. Independent Verifier Mechanics

Specify the second-pass reviewer.

Verifier must check:

- artifact presence
- schema validity
- state machine validity
- requirement-proof mapping
- command exit codes
- command timing relative to edits
- final claims and citations
- diff boundaries
- forbidden paths
- missing user smoke
- hidden failures
- weak happy-path-only tests
- residual risk honesty

Define verifier output:

```text
verifier-report.json
```

Include severity levels:

```text
blocking
major
minor
info
```

### 15. Failure Corpus Mechanics

Specify how real failures become permanent tests.

Include:

- failure intake
- minimization
- fixture format
- mutation tests
- replay tests
- expected-fail and expected-pass cases
- adding policy rules from failures

Include categories:

- fake verification
- UI runtime crash
- missing smoke
- wrong repo assumption
- broken edge case
- overbroad refactor
- hidden failed command
- final overclaim

### 16. Policy Enforcement Mechanics

Specify M9 as hard gates over M5-M7 outputs.

Include:

- policy rule schema
- rule IDs
- severity
- pass/reject/block decision
- configurability by task class
- default non-negotiable rules

Must explain:

```text
M5 produces evidence.
M6 audits evidence.
M7 supplies known failure patterns.
M9 turns all of that into hard pass/reject/block decisions.
```

### 17. Product Surface And Reports

Specify CLI/report UX.

Include:

- `meta init`
- `meta run`
- `meta verify`
- `meta report`
- `meta promote-failure`
- `meta rerun`

Define human report format:

```text
Operator status: repairing
Internal policy decision: rejected
Reason: R4 has no user-smoke evidence
Passed commands: ...
Failed commands: ...
Evidence: ...
Residual risk: ...
Next action: ...
```

### 18. Security And Safety Boundaries

Specify forbidden actions and sensitive data handling.

Include:

- `.env*` handling
- deploy/push/send restrictions
- production data restrictions
- external API cost restrictions
- secrets redaction
- generated artifact redaction
- user approval boundaries

### 19. Task-Class Generalization

Define task classes:

- web UI
- browser extension
- CLI
- API/backend
- data/OCR pipeline
- mobile
- deploy/ops

For each:

- typical repo signals
- likely proof obligations
- required smoke type
- common false passes
- example tasks

### 20. Incremental Build Plan

Turn the architecture into implementation phases.

Include at least these phases:

```text
Phase 1: harden M1/M3 current implementation
Phase 2: M2 repo adapter v1
Phase 3: M4 Codex runner v1
Phase 4: M5 verification executor v1
Phase 5: M6 independent verifier v1
Phase 6: M7 failure corpus v1
Phase 7: M9 policy engine v1
Phase 8: M8 CLI/report UX
Phase 9: M10 task-class adapters
```

For each phase:

- goal
- deliverables
- files likely touched
- tests
- acceptance gates
- residual risks

### 21. Worked Examples

Include at least three complete examples:

1. `voovo-checkout` browse empty-state/reset task.
2. Site Gate browser extension task.
3. A local non-web task such as `jarvis-voice-codex` parser behavior or `hungarian-old-docs-ocr` pipeline validation.

Each example must show:

- input task
- generated requirements
- proof obligations
- expected commands
- expected evidence
- possible verifier rejection
- possible accepted final report

### 22. Acceptance Tests For The Harness Itself

Define tests the implementation must eventually pass.

Include:

- schema tests
- mutation tests
- fake verification rejection
- missing user smoke rejection
- forbidden path rejection
- dirty repo handling
- command failure handling
- final overclaim rejection
- corpus replay

### 23. Open Questions And Deferred Choices

List real unknowns.

Examples:

- exact Codex CLI event capture API
- best browser runner choice
- where to store large evidence
- when to require human approval
- how much semantic task compilation should be model-driven
- how to isolate untrusted repo commands

### 24. Final Definition Of Done For The Meta-Harness

Define what the final system must prove before M0-M10 is considered complete.

Must include:

- at least three task classes supported
- 10-30 real tasks replayed
- known failure corpus catches regressions
- policy engine rejects incomplete runs
- human-readable report is usable
- final decision is based on artifacts, not assistant prose

## Required Tables

The implementation plan must contain these tables:

1. Milestone-to-component matrix.
2. Artifact ownership matrix.
3. Run state transition table.
4. Requirement/proof/evidence traceability example.
5. Test taxonomy table.
6. Failure category to policy rule table.
7. Phase implementation table.
8. Current-vs-target capability table.

## Required JSON Examples

Include JSON examples for:

- `spec.json`
- `repo-profile.json`
- `proof-plan.json`
- `command-log.jsonl` single event
- `verification.json`
- `verifier-report.json`
- `policy-decision.json`
- `final-report.json`

Examples may be abbreviated, but they must show required fields and IDs.

## Required Rejection Examples

Include at least five rejection examples:

- tests not run
- browser smoke missing
- final report cites nonexistent evidence
- verification failed but final says passed
- forbidden file edited
- requirement has no proof obligation
- happy path only when negative path is required

## Authoring Process

Follow this process:

1. Read all required inputs.
2. Create an outline matching the required output structure.
3. Draft sections 1-8 first because they define the backbone.
4. Draft sections 9-16 next because they define mechanics.
5. Draft sections 17-24 last because they define UX, rollout, examples, and acceptance.
6. Add required tables.
7. Add required JSON examples.
8. Add rejection examples.
9. Run word count and structural checks.
10. Self-audit against `docs/meta-harness-implementation-plan-verification-handbook.md`.
11. Only then mark the implementation plan complete.

## Suggested Local Checks

Run:

```bash
wc -w docs/meta-harness-implementation-plan.md
rg -n "^## " docs/meta-harness-implementation-plan.md
rg -n "spec.json|repo-profile.json|proof-plan.json|verification.json|verifier-report.json|policy-decision.json|final-report.json" docs/meta-harness-implementation-plan.md
rg -n "voovo-checkout|Site Gate|jarvis-voice-codex|hungarian-old-docs-ocr" docs/meta-harness-implementation-plan.md
git diff --check
```

If the word count is below 16,000, do not call the plan complete.

## Completion Report Requirements

The writer's final response must include:

- path to the implementation plan
- word count
- section count
- required tables present or missing
- required JSON examples present or missing
- worked examples present or missing
- checks run
- remaining risks

The writer must not claim the plan is implementation-ready unless the verification handbook checklist passes.
