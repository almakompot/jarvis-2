# Meta-Harness Roadmap

The dream:

> A meta-harness that takes "fresh repo + feature request", forces a disciplined build process, and rejects "done" unless the runnable user surface was actually verified.

## M0: Doctrine And Contract

Define what a valid run must contain.

Done means:

- task spec exists
- repo inspection happened before edits
- proof plan exists before implementation
- tests and smoke checks are declared
- final answer cites real artifacts
- "done" without evidence is rejectable

Status: mostly present in `docs/fresh-repo-feature-protocol.md`, `AGENTS.md`, and the acceptance-gate fixtures.

## M1: Task Compiler

Turn a vague request into a frozen task packet.

Input:

```text
build a chrome extension that asks before opening pages
```

Output:

- requirements
- non-requirements
- risk list
- user flows
- files allowed
- required tests
- manual smoke scenario
- proof obligations

This is the first real milestone. Without it, the harness cannot know what "correct" means.

## M2: Repo Adapter

Automatically understand the repo.

It should detect:

- stack: Next, Node, Python, extension, mobile, etc.
- package manager
- test commands
- lint/build commands
- dev server command
- likely app entrypoints
- existing test style
- risky files, env, and deploy surfaces

Done means it can enter an unknown repo and produce a useful `repo-profile.json`.

## M3: Run Envelope

Every task gets a controlled working directory and artifact folder.

Example:

```text
.task-runs/2026-06-24-site-gate/
  task.md
  repo-profile.json
  spec.json
  proof-plan.json
  allowed-files.json
  events.jsonl
  diff.patch
  verification.json
  final-report.json
```

This is where unsupported "trust me" completion claims start dying. The run has a paper trail.

## M4: Codex Runner

Wrap Codex CLI instead of just telling Codex to behave.

The runner should:

- start Codex with the task packet
- inject the protocol
- capture transcript/events
- capture commands run
- capture file diffs
- prevent forbidden actions where possible
- force final report schema

Done means this works:

```bash
meta run --repo /path/to/repo --task "build X"
```

and produces a structured run folder.

Status: real wrapper exists for local Codex CLI runs and dry runs. It captures transcript, process output, command logs, diffs, changed files, runner state, and rejected overclaims. Full `meta run` orchestration is still future work.

## M5: Verification Executor

Run the declared proof, not just generic tests.

This includes:

- unit tests
- integration tests
- build/lint/typecheck
- browser smoke via Playwright/CDP
- API smoke
- CLI smoke
- generated fixture tests
- negative tests for invalid input

Done means the harness can say:

```text
Requirement R3 was tested by command C2 and artifact A5.
Requirement R4 has no proof. Reject.
```

This is the core of the system.

Status: command proof executor exists for `proof-plan.json` plus `spec.requiredTests`. It records command evidence, blocks missing or unsafe commands, preserves failed evidence on rerun, and updates `verification.json` by requirement and proof-obligation ID. Surface proof executor exists for browser and extension smoke artifacts, API request/response proof, direct CLI binary invocation, data/generated-artifact validation, visual artifacts, and manual evidence artifacts. Dev-server lifecycle and full browser automation remain future hardening work.

## M6: Independent Verifier

A second pass tries to disprove the run.

It should check:

- did edits happen before inspection?
- did final claim cite real evidence?
- did tests actually pass?
- were failures hidden?
- do proof artifacts match requirements?
- was only a happy path tested?
- did the user-facing flow actually run?

Done means the verifier can reject a plausible-looking Codex completion.

Status: M6 v1 exists in `meta-harness/lib/verifier.mjs` with CLI `npm run meta:verifier`. It writes `verifier-report.json`, rejects invalid or internally inconsistent run folders, checks artifact/schema/state/traceability/command/diff/final-claim evidence, and classifies findings as blocking, major, minor, or info. The adversarial mutation suite now covers deleted evidence, wrong exit codes, missing browser smoke, forbidden `.env` edits, proof timing before edits, unknown evidence citations, missing residual risk, and pass-after-failure claims. Deeper task-class heuristics remain M10 work.

## M7: Failure Corpus

Collect real tasks where Codex commonly lies, skips, or breaks things.

Categories:

- UI says done but button crashes
- build passes but user flow fails
- test only checks implementation detail
- wrong repo assumptions
- fake/manual verification claim
- deploy not actually verified
- edge case ignored
- broad refactor breaks unrelated path

Done means every harness improvement is tested against real past failures.

This is what makes the harness serious.

Status: M7 v1 exists in `corpus/meta-harness` with replay CLI `npm run meta:corpus` and private-staging promotion CLI `npm run meta:promote-failure`. The committed corpus format requires case metadata, minimized input, expected policy outcome, mutation file, expected-pass or expected-fail label, and explicit privacy fields. Replay currently proves five known false-pass patterns still reject and one valid command-proof case still accepts. Promotion creates a metadata skeleton from rejected or blocked runs without copying raw artifacts; automatic minimization and sanitization remain future hardening.

## M8: Product Surface

Make it usable.

Possible surfaces:

- CLI first
- local dashboard later
- per-run HTML report
- diff plus proof matrix
- rerun verifier
- rerun smoke
- promote this task into regression corpus

Done means it can be used daily without fighting it.

Status: M8 v1 exists as `npm run meta -- <command>` backed by `meta-harness/scripts/meta.mjs` and `meta-harness/lib/report-ux.mjs`. It exposes `init`, `run`, `verify`, `report`, `rerun`, `promote-failure`, and `cleanup` around repo-local run folders. Text reports lead with findings, then show policy decision, active rules, commands, missing proof, evidence paths, residual risk, and next actions. HTML reports write evidence-linked `html-report/index.html`. CLI tests cover accepted, rejected, blocked, missing-artifact, evidence-link, rerun, cleanup, and command-path behavior. Dashboard UX remains future work.

## M9: Policy And Enforcement

Move from suggested discipline to hard gates.

Examples:

- no final report without proof artifacts
- no pass if user smoke is missing for UI work
- no pass if tests fail
- no pass if modified forbidden files
- no pass if final cites nonexistent evidence
- no pass if requirements lack verification mapping

This is where it becomes a harness, not a document.

Status: M9 v1 exists in `meta-harness/lib/policy-engine.mjs` with CLI `npm run meta:policy`. It writes `policy-decision.json`, consumes verification/verifier/task-class/corpus/override inputs, distinguishes accepted/rejected/blocked, records fired rule IDs, supports explicit override records without erasing evidence, and has deterministic recomputation tests.

## M10: Generalization

Only after the previous milestones work on 10-30 real tasks.

Then expand to:

- web apps
- browser extensions
- CLIs
- APIs
- data scripts
- mobile
- deploy workflows

Do not start universal. Start with three task classes and make them hard to fake.

## Order

```text
1. Task compiler
2. Repo adapter
3. Run envelope
4. Codex runner
5. Verification executor
6. Independent verifier
7. Failure corpus
8. Daily CLI/report UX
9. Hard enforcement
10. More task classes
```

The next concrete milestone should be M1 plus M3 together: given a repo and task, generate a frozen task packet and run folder before any implementation begins. That becomes the root object every later verifier can inspect.
