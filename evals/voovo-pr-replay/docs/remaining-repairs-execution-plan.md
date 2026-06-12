# VOOVO PR Replay Remaining Repairs Execution Plan

Date: 2026-06-11.

This is the execution plan for the VOOVO PR replay repairs that remain after the first repair batch. It is public-safe by design. It describes harness behavior and synthetic/scrubbed validation work only. Private source truth, private patches, private logs, exact private SHAs, screenshots, and generated private case contents must stay out of this file and out of the public repository.

## Context

The first repair batch made the harness benchmark-valid at the import and run boundary. It did not finish the full evaluation system. That was intentional: a PR replay benchmark has to be correct about the starting commit, source truth, leakage, and checks before it can make meaningful claims about which implementation is better.

The remaining work turns the harness from "can run two agents and collect patches" into "can produce a defensible, reproducible, evidence-cited result across safe smoke cases, then medium cases, then stress cases."

The central risk now is not only agent quality. The central risk is evaluation quality. A weak evaluator, missing manual proof, missing fixtures, unsafe private commands, or an unstructured suite can produce confident but false conclusions.

## Current Repaired Baseline

Already implemented in the first repair batch:

- Code: private git-worktree imports record explicit replay snapshot metadata: `preSha`, `headSha`, optional `mergeSha`, `preMethod`, and PR-head ref.
- Code: open PR import is supported behind explicit opt-in and marked snapshot-sensitive.
- Code: selected-base source truth is generated from `git diff <preSha>..<headSha>`.
- Code: GitHub PR stats are stored separately from selected replay stats, with mismatch tracking.
- Code: generated goals get leakage reports and runner-side blocking for obvious source-truth leaks.
- Code: imported checks are planned from broad changed-file domains such as Flutter/Dart and Firebase Functions.
- Code: runner-created worktrees are verified for exact HEAD and clean status before an agent starts.
- Tests: repair tests cover selected diff stats, check planning, leakage blocking, open PR merge-base, merged PR first-parent, selected source truth generation, and worktree SHA enforcement.
- Docs: README, status, and repair roadmap describe the repaired import/run boundary and the remaining evaluator/manual-proof boundary.

This baseline is enough to import safer private cases and run controlled smoke experiments. It is not enough to claim robust agent-vs-merged-PR superiority.

## Remaining Failure Modes

### R-01: Comparison Is Still A Scaffold

Current state: `compare-case.mjs` produces evidence files and a draft report, but the verdict fields are still effectively manual.

Why it matters: the benchmark cannot answer whether merged, baseline, or resilient output was better unless verdicts are structured, evidence-cited, and reproducible.

Repair type: code, tests, docs.

### R-02: Evaluator Prompts Need Stronger Evidence Discipline

Current state: evaluator instructions warn not to reward diff similarity alone, but there is no enforced evaluator output schema or citation requirement.

Why it matters: an evaluator can overfit to the merged diff, ignore missing checks, or give a verdict based on narrative confidence rather than evidence.

Repair type: code, tests, docs.

### R-03: Manual Proof Is Not First-Class

Current state: manual/device/browser/account-state/cloud-adjacent evidence is discussed in docs, but not represented as a structured artifact.

Why it matters: UI layout, device codec behavior, account-specific state, and cloud-adjacent integrations can pass unit checks while failing real behavior.

Repair type: schema, code, docs, future manual/private evidence.

### R-04: Stateful Fixtures Are Missing

Current state: synthetic smoke fixtures exist, but there are no deterministic VOOVO-like fixtures for provider state, persisted chat reload, streaming UI, migration semantics, or cloud-adjacent payloads.

Why it matters: without fixtures, medium and stress cases rely on expensive human review and cannot produce repeatable pass/fail signals.

Repair type: code, tests, fixtures.

### R-05: Private-Run Guardrails Are Not Deep Enough

Current state: output path and leakage safeguards exist, but command execution still needs stronger denylist/allowlist controls.

Why it matters: autonomous replay should not deploy, push, create PRs, post messages, mutate cloud state, or inspect secret files by accident.

Repair type: code, tests, docs.

### R-06: Suite Orchestration Does Not Exist

Current state: cases can be run one at a time.

Why it matters: a real benchmark needs smoke, medium, and stress tiers, predictable ordering, resumability, summary output, and a way to stop before expensive or manual-proof-dependent cases.

Repair type: code, tests, docs.

### R-07: Worktree Cleanup Is Manual

Current state: worktree verification exists, but cleanup is still mostly documented/manual.

Why it matters: repeated runs can leave disposable worktrees behind, increasing confusion and risk around stale state.

Repair type: code, docs.

### R-08: Public Docs Need A Private-Case Operator Guide

Current state: the README explains privacy boundaries and commands, but not enough operational discipline for a future operator importing many private cases.

Why it matters: bad operator habits can leak source truth or produce invalid cases even when scripts are safer.

Repair type: docs.

## Non-Goals

- Do not publish private VOOVO source truth, patches, logs, SHAs, screenshots, or generated private case contents.
- Do not replace human review for cases that truly require device, browser, account-state, or cloud-adjacent evidence.
- Do not build a generic CI system. This remains a focused PR replay harness.
- Do not claim resilient prompting improves real VOOVO outcomes until structured evaluator results exist across enough cases.
- Do not run live Firebase, Slack, cloud, deploy, push, or PR-creation operations as part of automated replay.
- Do not read `.env*` files.

## Success Criteria

The remaining repair effort succeeds when:

- `compare-case.mjs` writes a structured `comparison-result.json`.
- The human comparison report is generated from structured evaluator data.
- Evaluator output includes winner, confidence, per-criterion scores, evidence citations, missing evidence, and residual risk.
- Missing required checks or manual proof can force an `inconclusive` verdict.
- Manual-proof requirements can be declared, collected, validated, and surfaced in reports.
- Synthetic or scrubbed fixtures cover at least one stateful UI/data case and one cloud-adjacent payload case without private data.
- Private-run guardrails block dangerous commands before execution.
- A `run-suite` style command can run tiers in order and summarize results.
- Worktree cleanup tooling can remove only harness-created worktrees.
- Docs explain how to import and operate private cases safely.
- Full verification runs through `npm run check` plus new focused tests.

## Phase 1: Structured Evaluator Output

Goal: replace "comparison scaffold" with a real structured result format.

Code changes:

- Add a comparison result schema, either as a JSON schema file or a documented runtime validator.
- Extend `compare-case.mjs` to write:
  - `comparison/evidence-manifest.json`
  - `comparison/evaluator-prompt.md`
  - `comparison/comparison-result.json`
  - `comparison/comparison-report.md`
- Define result fields:
  - `caseId`
  - `winner`: `merged`, `baseline`, `resilient`, `tie`, or `inconclusive`
  - `confidence`: `low`, `medium`, or `high`
  - `summary`
  - `criteria`
  - `missingEvidence`
  - `blockingIssues`
  - `evidenceCitations`
  - `residualRisk`
  - `recommendedNextAction`
- Add a validator that rejects unknown winner/confidence values and missing criteria.

Tests:

- Unit test that a valid comparison result passes validation.
- Unit test that missing required checks can produce or force `inconclusive`.
- Unit test that malformed evaluator output fails validation.
- Snapshot-style test for generated report sections.

Docs:

- Update README comparison section.
- Add a small example `comparison-result.json` for the public synthetic case.

Definition of done for phase:

- `npm run voovo:compare` produces structured files even when no evaluator agent has been run yet, with `winner: inconclusive` and explicit missing evidence.

## Phase 2: Evaluator Prompt And Evidence Contract

Goal: make evaluator behavior harder to game and easier to audit.

Code changes:

- Generate an evaluator prompt that instructs the evaluator to inspect only the evidence manifest.
- Require citations to specific evidence files or check logs for every major claim.
- Include selected replay patch, baseline patch, resilient patch, changed files, final answers, and check summaries.
- Add a rubric:
  - correctness against goal
  - regression risk
  - maintainability
  - minimality
  - test quality
  - product behavior
  - repo-pattern fit
  - review burden
- Explicitly state that diff similarity alone is not a win condition.
- Add a "missing proof beats confidence" rule: if required checks or manual proof are missing, confidence cannot be high.

Tests:

- Test generated prompt contains the anti-diff-similarity rule.
- Test generated prompt includes selected source truth, not only legacy merged patch.
- Test generated prompt includes missing-evidence instructions.

Docs:

- Document evaluator limitations and how to interpret `inconclusive`.

Definition of done for phase:

- A reviewer can open `evaluator-prompt.md` and see exactly what evidence the evaluator is allowed to use and what it must not over-credit.

## Phase 3: Manual-Proof Artifact System

Goal: make manual/device/browser/account-state/cloud-adjacent proof explicit instead of informal.

Schema/data changes:

- Extend `manualProofs` entries with optional fields:
  - `artifactPath`
  - `artifactType`: `screenshot`, `video`, `log`, `markdown-note`, `device-matrix`, `mock-transcript`, or `external-note`
  - `status`: `missing`, `provided`, `accepted`, or `rejected`
  - `blocksHighConfidence`
  - `reviewedBy`
  - `reviewedAt`
- Add a `manualProofsPath` or keep proof entries in `case.json` for public/synthetic cases.

Code changes:

- Add `validate-manual-proofs.mjs` or integrate proof validation into `validate-cases.mjs`.
- Teach `compare-case.mjs` to include manual proof status in `comparison-result.json`.
- Make missing blocking manual proof cap confidence or force `inconclusive`.

Tests:

- Case with required missing manual proof validates as runnable but comparison is capped/inconclusive.
- Case with accepted manual proof can produce higher confidence.
- Invalid proof type fails validation.

Docs:

- Add examples for browser screenshot, device matrix, account-state note, and cloud-adjacent mock proof.

Future manual/private evidence:

- Real screenshots, device observations, account-state notes, and cloud-adjacent manual checks must stay private unless explicitly scrubbed.

Definition of done for phase:

- Manual proof is visible in case manifests, validation, evaluator prompts, and comparison reports.

## Phase 4: Deterministic Fixture Pack

Goal: create safe fixtures that let medium cases be evaluated without private state.

Fixture targets:

- Stateful provider fixture:
  - hidden-ready item
  - ended custom item
  - started active plus ready item
- Persisted chat fixture:
  - backend-shaped saved messages
  - duplicate turn/order cases
  - references arriving after message text
- Streaming UI fixture:
  - mode switch while streaming
  - placeholder citation resolution
  - empty-state layout/keyboard state as a widget-level or model-level proxy
- Migration semantics fixture:
  - legacy scoped records
  - new aggregate records
  - no cross-option dedup unless explicitly requested
- Cloud-adjacent payload fixture:
  - mocked outbound message payload
  - no live send
  - no deploy

Code changes:

- Add synthetic fixture directories under public fixture paths.
- Add tests and case manifests that use these fixtures.
- Add check planning support for fixture-local commands when needed.

Tests:

- Each fixture has a failing-before/fixable behavior similar to the existing shortcut trap philosophy.
- Each fixture can be run without external services.
- Fixtures contain no private identifiers or private payloads.

Docs:

- Explain which real-case risk each fixture models.

Definition of done for phase:

- At least two nontrivial synthetic/scrubbed cases exercise stateful behavior and cloud-adjacent payload validation without private data.

## Phase 5: Private-Run Guardrails

Goal: prevent unsafe commands and unsafe output locations during automated replay.

Code changes:

- Add a guard module used by `run-case.mjs` and `run-checks.mjs`.
- Deny dangerous command patterns:
  - `firebase deploy`
  - `gcloud ... deploy`
  - `git push`
  - `gh pr create`
  - direct `.env*` reads
  - live Slack posting commands
  - known cloud write commands unless explicitly marked manual and disabled by default
- Add a safe allowlist mode for check commands where practical.
- Validate run output locations for private cases.
- Add explicit override flags only for debugging, not default flows.

Tests:

- Denylist blocks deploy commands.
- Denylist blocks push/PR creation commands.
- Denylist blocks direct secret-file read patterns.
- Safe commands such as `flutter test`, `flutter analyze`, `npm run build`, and `node --test` remain allowed.

Docs:

- Add a "Safe command policy" section.

Definition of done for phase:

- A private run refuses obvious side-effecting commands before they execute.

## Phase 6: Suite Tiers And Run Orchestration

Goal: run cases in controlled tiers instead of one-off manual loops.

Schema/data changes:

- Add optional case fields:
  - `tier`: `smoke`, `medium`, or `stress`
  - `automationConfidence`
  - `requiresManualProof`
  - `requiresExternalFixture`
  - `estimatedRuntime`

CLI/script changes:

- Add `run-suite.mjs`.
- Suggested command:
  - `npm run voovo:run-suite -- --tier smoke`
  - `npm run voovo:run-suite -- --tier medium`
  - `npm run voovo:run-suite -- --tier stress --include-stress`
- Suite runner should:
  - discover cases
  - filter by tier
  - skip stale snapshots
  - run selected variants
  - run checks
  - run comparison scaffolding/evaluation
  - write suite summary JSON and markdown
  - stop or continue based on configured failure policy

Tests:

- Suite discovery filters by tier.
- Stress tier refuses to run unless an explicit flag is passed.
- Suite summary includes skipped, passed, failed, inconclusive, and missing-evidence cases.

Docs:

- Add recommended progression: smoke first, medium second, stress last.

Definition of done for phase:

- A public synthetic smoke suite can run end to end and produce one suite summary.

## Phase 7: Worktree Cleanup Tooling

Goal: make cleanup safe, explicit, and limited to harness-created worktrees.

CLI/script changes:

- Add `cleanup-worktrees.mjs`.
- Read harness run manifests or worktree logs.
- Remove only paths created by the harness.
- Refuse to remove the source repo checkout or unknown paths.
- Support dry-run by default.

Tests:

- Dry-run lists cleanup candidates.
- Real cleanup removes a temporary test worktree.
- Cleanup refuses non-harness paths.

Docs:

- Add cleanup instructions to README.

Definition of done for phase:

- Operators can clean replay worktrees without risking the user's main checkout.

## Phase 8: Private Case Operator Guide

Goal: make safe private-case creation repeatable for future operators.

Docs:

- Add `docs/private-case-operator-guide.md`.
- Include:
  - privacy boundary
  - import commands
  - review checklist for generated goals
  - leakage report handling
  - manual proof collection
  - fixture preference
  - run tier policy
  - do-not-run command list
  - how to interpret `inconclusive`
  - when to refresh open PR snapshots

Tests:

- Documentation link check can be manual for now.
- README should link to the guide.

Definition of done for phase:

- A future operator can safely create a private case without rediscovering audit constraints.

## Test Strategy

Required tests by area:

- Evaluator schema:
  - valid result passes
  - invalid winner fails
  - missing criteria fails
  - missing required proof caps confidence
- Evaluator prompt:
  - includes selected replay patch
  - includes check summaries
  - includes anti-diff-similarity rule
  - includes citation requirement
- Manual proof:
  - missing required proof produces missing evidence
  - accepted proof unlocks confidence
  - invalid artifact type fails
- Fixtures:
  - stateful fixture tests run locally
  - cloud-adjacent fixture never sends live messages
  - migration fixture preserves legacy semantics
- Guardrails:
  - deny deploy/push/PR/secret-read commands
  - allow safe test/build commands
- Suite:
  - tier filtering
  - stress gate
  - summary output
- Cleanup:
  - dry-run
  - safe removal of known harness worktree
  - refusal of unknown/main checkout path

Global verification:

```bash
npm run check
```

Add new direct scripts as the phases land, then include them in `npm run check` once stable.

## Artifact And Privacy Guardrails

Public-safe:

- synthetic fixtures
- scrubbed examples
- schemas
- harness scripts
- docs that describe behavior without private identifiers
- generic sample comparison results

Private-only:

- real PR metadata
- real patches
- exact private SHAs
- private generated goals
- private run logs
- screenshots or videos from private apps/accounts
- account-state notes
- device observations tied to private cases

Rules:

- Never commit private source truth unless explicitly scrubbed and approved.
- Keep evaluator-only files out of implementation-agent prompts.
- Keep private case output ignored by git.
- Avoid exact private paths in public docs.
- Treat live cloud or messaging proof as manual/private evidence, not automated default behavior.

## Data Model And Schema Changes

Expected schema additions:

- `comparison` output schema:
  - winner
  - confidence
  - criteria scores
  - evidence citations
  - missing evidence
  - blocking issues
  - residual risk
- `manualProofs` extension:
  - artifact path
  - artifact type
  - status
  - confidence behavior
  - reviewer metadata
- suite metadata:
  - tier
  - automation confidence
  - manual proof requirement
  - estimated runtime
- run summary:
  - selected variants
  - checks status
  - comparison status
  - missing evidence summary
  - suite rollup fields

Keep backwards compatibility for public synthetic cases unless there is a deliberate migration with tests.

## CLI And Script Changes

Existing scripts to extend:

- `compare-case.mjs`
- `run-checks.mjs`
- `validate-cases.mjs`
- `run-case.mjs`

New scripts likely needed:

- `validate-comparison-result.mjs`
- `run-suite.mjs`
- `cleanup-worktrees.mjs`
- optional `validate-manual-proofs.mjs`

Package scripts to add:

- `voovo:validate-comparison`
- `voovo:run-suite`
- `voovo:cleanup-worktrees`
- possibly `voovo:test-fixtures`

## Evaluator Changes

Evaluator must:

- compare merged, baseline, and resilient outputs against the goal
- cite evidence from patches, final answers, changed files, check logs, and manual proof artifacts
- penalize missing required checks
- cap confidence when manual proof is missing
- avoid rewarding diff similarity alone
- explicitly identify regression risk
- choose `inconclusive` when evidence is insufficient
- output machine-readable JSON before markdown rendering

Evaluator must not:

- inspect implementation-agent-hidden source truth beyond evaluator evidence
- treat merged PR as automatically correct
- treat a passing check as sufficient for product behavior when manual proof is required
- hide missing evidence in prose

## Manual-Proof Strategy

Manual proof should be structured and scarce. Prefer deterministic fixtures first. Use manual proof when the behavior is genuinely visual, device-specific, account-state-specific, or cloud-adjacent.

Manual proof examples:

- browser screenshot for responsive layout
- short device note for native codec behavior
- account-state markdown note for provider state
- mock payload transcript for cloud-adjacent messaging
- reviewer note for Firestore rules or migration behavior when emulator coverage is unavailable

Manual proof statuses:

- missing
- provided
- accepted
- rejected

Comparison behavior:

- missing nonblocking proof becomes residual risk
- missing blocking proof forces `inconclusive` or caps confidence
- rejected proof is a blocking issue

## Fixture Strategy

Fixture principles:

- synthetic or scrubbed only
- small enough to understand
- captures the failure shape, not private business data
- runnable without external services
- clear failing-before or known expected behavior

Fixture priority:

1. Formatter/parser fixture for low-risk smoke validation.
2. Stateful provider fixture for medium complexity.
3. Persisted chat/streaming fixture for assistant-style cases.
4. Migration semantics fixture for data-shape cases.
5. Cloud-adjacent mocked payload fixture for integration-shaped cases.

Each fixture should document:

- behavior modeled
- checks to run
- what a pass means
- what it does not prove

## Smoke, Medium, And Stress Suite Policy

Smoke tier:

- focused
- deterministic
- no manual proof required
- no external services
- fast enough for routine validation

Medium tier:

- may include stateful fixtures
- may include manual proof as optional or confidence-limiting
- should still avoid external writes

Stress tier:

- broad native/media/migration/cloud-adjacent cases
- may require manual proof
- may take longer
- must require explicit opt-in

Policy:

- Never run stress cases by default.
- Do not promote a case to medium until its checks or manual-proof requirements are explicit.
- Do not use private cases to validate new harness logic until synthetic/scrubbed cases pass first.

## Rollout Order

Recommended sequence:

1. Structured comparison schema and default inconclusive result.
2. Evaluator prompt evidence contract.
3. Manual-proof schema and validation.
4. Guardrail denylist for dangerous commands.
5. Synthetic fixtures for stateful and cloud-adjacent shapes.
6. Suite tier metadata and `run-suite`.
7. Worktree cleanup tooling.
8. Private-case operator guide.
9. End-to-end validation on public synthetic/scrubbed suite.
10. Only then run selected private smoke cases.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Evaluator gives confident verdict with missing proof | False benchmark claims | Force missing evidence into structured result and cap confidence |
| Manual proof becomes vague prose | Review quality drops | Require artifact type, status, reviewer, and blocking behavior |
| Fixtures drift away from real failures | Benchmark becomes toy-like | Tie each fixture to a documented failure shape |
| Guardrails block legitimate checks | Friction and skipped verification | Support explicit safe allowlist and clear error messages |
| Guardrails miss dangerous command | Side effects or privacy leak | Add denylist tests and conservative defaults |
| Suite runner hides per-case detail | Hard to debug failures | Always write per-case and suite-level summaries |
| Stress cases run too early | Confusing results | Require explicit stress flag |
| Public docs accidentally expose private detail | Privacy breach | Keep docs generic and review for private path/metadata leakage |

## Verification Gates

Gate 1: Static and unit verification.

- `node --check` over scripts
- helper/unit tests pass
- schema validation tests pass

Gate 2: Public synthetic case verification.

- smoke case still validates
- smoke case can run
- compare writes structured output

Gate 3: New fixture verification.

- stateful fixture runs without external services
- cloud-adjacent fixture proves no live send/deploy

Gate 4: Suite verification.

- smoke suite runs end to end
- medium suite dry-run works
- stress suite refuses without explicit flag

Gate 5: Private readiness verification.

- private output path is ignored
- generated goal has no blocking leakage report
- selected-base source truth exists
- manual proof requirements are explicit
- no dangerous commands are planned

## Commit And Checkpoint Strategy

Use small commits by phase:

1. `Add structured comparison result schema`
2. `Harden evaluator evidence contract`
3. `Add manual proof artifacts`
4. `Add private run command guardrails`
5. `Add VOOVO replay fixture pack`
6. `Add PR replay suite runner`
7. `Add replay worktree cleanup tooling`
8. `Document private case operations`

Each commit should include tests for that phase where practical. Do not combine broad fixture work with evaluator schema changes unless the diff is still easy to review.

## Final Definition Of Done

The remaining repair work is done when:

- public docs describe the full safe workflow
- public synthetic/scrubbed cases validate and run
- comparison outputs structured JSON and markdown
- evaluator prompts enforce evidence citations and anti-diff-similarity rules
- missing evidence is machine-readable
- manual proof is represented and affects confidence
- fixtures cover at least one stateful case and one cloud-adjacent case
- private-run guardrails block dangerous commands
- suite runner supports smoke/medium/stress tiers
- cleanup tooling safely removes harness-created worktrees
- `npm run check` passes
- no private VOOVO source truth is committed
- final status doc clearly separates what is proven from what still requires private/manual evidence

## Execution Command

/goal execute evals/voovo-pr-replay/docs/remaining-repairs-execution-plan.md
