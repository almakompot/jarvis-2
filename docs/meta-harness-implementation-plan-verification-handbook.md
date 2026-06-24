# Meta-Harness Implementation Plan Verification Handbook

## Purpose

Use this handbook after a writer claims `docs/meta-harness-implementation-plan.md` is complete.

The verifier's job is not to judge whether the prose sounds impressive. The verifier's job is to decide whether the implementation plan is specific, complete, traceable, and useful enough to guide building the M0-M10 meta-harness.

Treat completion as unproven until every required check below has evidence.

## Verification Inputs

Required target:

```text
docs/meta-harness-implementation-plan.md
```

Required source references:

```text
docs/meta-harness-implementation-plan-authoring-plan.md
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

Optional cross-check references:

```text
evals/voovo-pr-replay/README.md
apps/site-gate-extension/README.md
```

## Verifier Output

Write a verification report with this shape:

```text
Decision: ACCEPTED | REJECTED | BLOCKED

Summary:
- ...

Blocking Findings:
- [ID] file:line - issue

Major Findings:
- [ID] file:line - issue

Minor Findings:
- [ID] file:line - issue

Evidence Checked:
- command/output/path

Residual Risk:
- ...
```

If there is any blocking finding, the decision is `REJECTED`.

Use `BLOCKED` only when the target file is missing or cannot be read.

## Severity Model

### Blocking

The plan cannot be accepted.

Examples:

- target file missing
- under hard word-count floor
- missing M0-M10 coverage
- no state machine
- no artifact model
- no traceability model
- no verification executor mechanics
- no independent verifier mechanics
- no policy enforcement mechanics
- no worked examples
- no acceptance tests
- generic prose without concrete schemas/artifacts/gates

### Major

The plan is mostly present but has serious gaps.

Examples:

- weak repo adapter details
- JSON examples too shallow
- security boundaries underspecified
- no negative testing examples for a task class
- unclear current-vs-target distinction

### Minor

The plan is acceptable but could be clearer.

Examples:

- uneven section depth
- wording ambiguity
- table formatting issue
- example could be more concrete

## Fast Triage Commands

Run these first:

```bash
test -f docs/meta-harness-implementation-plan.md
wc -w docs/meta-harness-implementation-plan.md
rg -n "^#|^##|^###" docs/meta-harness-implementation-plan.md
git diff --check
```

Hard reject if:

```text
word count < 16,000
```

Target expectation:

```text
18,000-25,000 words
30-45 page-equivalent sections
```

Do not accept a short plan because it "covers the idea." The point of this artifact is to reduce creative interpretation by future implementation agents.

## Structural Checklist

The implementation plan must contain these sections or close equivalents:

- Executive Summary
- Product Goal And Non-Goals
- End-To-End User Workflow
- Current State
- Target Architecture
- Run State Machine
- Artifact Model
- Requirement And Proof Traceability
- Task Compiler Mechanics
- Repo Adapter Mechanics
- Run Envelope Mechanics
- Codex Runner Mechanics
- Verification Executor Mechanics
- Independent Verifier Mechanics
- Failure Corpus Mechanics
- Policy Enforcement Mechanics
- Product Surface And Reports
- Security And Safety Boundaries
- Task-Class Generalization
- Incremental Build Plan
- Worked Examples
- Acceptance Tests For The Harness Itself
- Open Questions And Deferred Choices
- Final Definition Of Done

Reject if any of these are absent and there is no clearly equivalent section.

## Roadmap Coverage Check

Verify every roadmap milestone is covered:

```text
M0 Doctrine And Contract
M1 Task Compiler
M2 Repo Adapter
M3 Run Envelope
M4 Codex Runner
M5 Verification Executor
M6 Independent Verifier
M7 Failure Corpus
M8 Product Surface
M9 Policy And Enforcement
M10 Generalization
```

For each milestone, the plan must define:

- purpose
- target artifacts
- implementation mechanics
- acceptance tests
- relationship to other milestones
- current status or future work

Reject if a milestone is only named but not mechanically specified.

## Mechanics Coverage Check

Search for these mechanics:

```bash
rg -n "state machine|state transition|created|specified|verified|accepted|rejected|blocked" docs/meta-harness-implementation-plan.md
rg -n "artifact|schema|events.jsonl|command-log|diff.patch|verification.json|verifier-report|policy-decision" docs/meta-harness-implementation-plan.md
rg -n "requirement|proof obligation|evidence|traceability|claim" docs/meta-harness-implementation-plan.md
rg -n "unit|integration|lint|typecheck|build|browser smoke|API smoke|CLI smoke|negative" docs/meta-harness-implementation-plan.md
rg -n "failure corpus|mutation|regression|replay" docs/meta-harness-implementation-plan.md
rg -n "policy|enforcement|reject|blocking|severity" docs/meta-harness-implementation-plan.md
```

Reject if any core mechanic appears only once or only as a heading without detail.

## Required Tables Check

The plan must include these tables:

1. Milestone-to-component matrix.
2. Artifact ownership matrix.
3. Run state transition table.
4. Requirement/proof/evidence traceability example.
5. Test taxonomy table.
6. Failure category to policy rule table.
7. Phase implementation table.
8. Current-vs-target capability table.

Manual verification:

- Find each table by heading or nearby text.
- Confirm the table has real rows, not placeholders.
- Confirm entries mention concrete artifacts, commands, or states.

Reject if more than one required table is missing.

Major finding if exactly one required table is missing but the content exists in prose.

## Required JSON Examples Check

The plan must include examples for:

- `spec.json`
- `repo-profile.json`
- `proof-plan.json`
- `command-log.jsonl`
- `verification.json`
- `verifier-report.json`
- `policy-decision.json`
- `final-report.json`

For each example, verify:

- it is inside a fenced code block
- it includes `schemaVersion` or clear schema versioning guidance
- it includes stable IDs where relevant
- it shows links between requirements, proof, evidence, or policy

Reject if `verification.json`, `verifier-report.json`, or `policy-decision.json` examples are missing.

## Rejection Example Check

The plan must include at least five rejection examples.

At least these categories should appear:

- tests not run
- browser smoke missing
- final report cites nonexistent evidence
- verification failed but final says passed
- forbidden file edited
- requirement has no proof obligation
- happy path only when negative path is required

Accept five or more if they are concrete.

Reject if fewer than five concrete rejection examples exist.

## Worked Example Check

The plan must include at least three worked examples.

Required examples:

1. `voovo-checkout` browse empty-state/reset task.
2. Site Gate browser extension task.
3. A local non-web task such as `jarvis-voice-codex` parser behavior or `hungarian-old-docs-ocr` pipeline validation.

For each example, verify it includes:

- input task
- generated requirements
- proof obligations
- expected commands
- expected evidence
- possible verifier rejection
- possible accepted final report

Reject if fewer than three examples exist.

Major finding if three examples exist but one lacks evidence or rejection detail.

## Current-vs-Target Honesty Check

The plan must distinguish what exists now from what is future work.

Required current-state facts:

- M1/M3 v0 exists in `meta-harness`
- `npm run meta:init` exists
- `npm run meta:validate` exists
- `npm run meta:check` exists
- acceptance gate exists
- Site Gate smoke exists
- VOOVO replay harness exists

Required future-state facts:

- deep repo adapter is not complete
- Codex runner is not complete
- verification executor is not complete
- independent completed-run verifier is not complete
- policy engine is not complete
- failure corpus is not complete
- product dashboard/report UX is not complete

Reject if the plan falsely implies the current harness already does the future work.

## M9 Relationship Check

The plan must correctly explain the relationship:

```text
M5 produces evidence.
M6 audits evidence.
M7 supplies real failure patterns and regression cases.
M9 turns those outputs into hard pass/reject/block policy.
```

Reject if M9 is described as just more testing, or if it is disconnected from M5-M7.

## Build-Sequence Check

The implementation plan must include a phased build sequence.

Minimum phases:

- harden current M1/M3
- M2 repo adapter
- M4 Codex runner
- M5 verification executor
- M6 independent verifier
- M7 failure corpus
- M9 policy engine
- M8 CLI/report UX
- M10 task-class adapters

For each phase, verify:

- deliverables
- files/modules likely touched
- tests
- acceptance gate
- residual risk

Reject if the plan gives only a milestone list without an implementation sequence.

## Specificity Check

Look for vague verbs:

```bash
rg -n "intelligently|robustly|automatically|seamlessly|properly|smart|AI will|LLM will" docs/meta-harness-implementation-plan.md
```

These words are not automatically wrong, but every occurrence should be backed by a mechanism.

For each vague claim, ask:

- What artifact is produced?
- What command runs?
- What schema field stores the result?
- What verifier checks it?
- What policy rejects failure?

Major finding if vague language hides implementation details.

Blocking finding if vague language replaces an entire required component.

## Security And Safety Check

The plan must cover:

- `.env*` handling
- secret redaction
- forbidden path policy
- deploy/push/send restrictions
- production data restrictions
- external API cost restrictions
- human approval boundaries
- evidence artifact redaction

Reject if `.env*`/secret handling is absent.

Major finding if deploy/push/send boundaries are absent.

## Testability Check

The plan must define tests for the harness itself.

Required test categories:

- schema tests
- mutation tests
- fake verification rejection
- missing user smoke rejection
- forbidden path rejection
- dirty repo handling
- command failure handling
- final overclaim rejection
- corpus replay

Reject if there is no harness test strategy.

Major finding if tests are listed but not tied to artifacts or commands.

## Traceability Audit Procedure

Pick three requirements from the plan's own examples.

For each, trace:

```text
Requirement ID
-> proof obligation ID
-> verification command or scenario
-> evidence artifact
-> verifier finding
-> policy decision
```

Reject if the plan does not make this chain possible.

Major finding if the chain exists but IDs are inconsistent.

## Anti-Toy Harness Audit

Ask whether the plan would prevent the following failures:

1. Codex edits files before inspecting the repo.
2. Codex runs `npm test`, but the UI button still crashes.
3. Codex claims browser smoke passed but no screenshot/log/trace exists.
4. Codex changes `.env`.
5. Codex says "done" after a failed command.
6. Codex tests only the happy path while the task required invalid-input behavior.
7. Codex modifies unrelated files.
8. Codex ignores existing repo scripts.
9. Codex produces a final report that cites nonexistent evidence.
10. Codex passes one real task but regresses on a known failure case.

The plan does not need finished code for all ten, but it must explain which milestone/component/artifact/policy will catch each one.

Reject if most of these are not addressed.

## Command Evidence To Collect

The verifier should run:

```bash
wc -w docs/meta-harness-implementation-plan.md
rg -n "^## " docs/meta-harness-implementation-plan.md
rg -n "M0|M1|M2|M3|M4|M5|M6|M7|M8|M9|M10" docs/meta-harness-implementation-plan.md
rg -n "spec.json|repo-profile.json|proof-plan.json|command-log.jsonl|verification.json|verifier-report.json|policy-decision.json|final-report.json" docs/meta-harness-implementation-plan.md
rg -n "voovo-checkout|Site Gate|jarvis-voice-codex|hungarian-old-docs-ocr" docs/meta-harness-implementation-plan.md
git diff --check
```

The verifier may use additional searches, but must not accept the plan without checking the target file directly.

## Acceptance Decision Rules

### Accept

Accept only if:

- target file exists
- word count is at least 16,000
- all core sections exist
- all M0-M10 milestones are mechanically covered
- artifact model is concrete
- state machine is concrete
- traceability model is concrete
- M5-M7-M9 relationship is correct
- required examples and tables are present
- at least three worked examples exist
- at least five rejection examples exist
- current-vs-target status is honest
- no blocking findings remain

### Reject

Reject if any blocking finding exists.

The most common rejection should be:

```text
The plan is structurally impressive but not specific enough to build or verify.
```

### Blocked

Use blocked only if:

- target file is absent
- target file cannot be read
- repository state prevents inspection

## Verifier Report Template

Use this final report:

```text
Decision: ACCEPTED | REJECTED | BLOCKED

Word Count:
- observed:
- threshold:

Structural Coverage:
- present:
- missing:

Milestone Coverage:
- M0:
- M1:
- M2:
- M3:
- M4:
- M5:
- M6:
- M7:
- M8:
- M9:
- M10:

Artifact/Schema Coverage:
- present:
- missing:

Worked Examples:
- present:
- missing:

Rejection Examples:
- count:
- missing categories:

Blocking Findings:
- ...

Major Findings:
- ...

Minor Findings:
- ...

Commands Run:
- ...

Final Notes:
- ...
```

The verifier must lead with findings, not praise.
