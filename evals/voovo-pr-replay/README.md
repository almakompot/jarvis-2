# VOOVO PR Replay Benchmark

This benchmark turns merged VOOVO pull requests into counterfactual implementation tasks:

1. Start from the pre-PR base commit.
2. Give an agent only an outcome-only goal brief.
3. Run a baseline implementation and a resilient implementation.
4. Compare both against the merged PR using evidence, not diff similarity alone.

The point is to test whether the resilient-execution protocol improves real engineering outcomes under VOOVO-like constraints.

## Privacy Boundary

This repo is public. Do not commit private VOOVO source, diffs, PR metadata, logs, screenshots, or generated run output unless the user explicitly decides those artifacts are safe to publish.

Private imported cases go here and are ignored by git:

```text
evals/voovo-pr-replay/private-cases/
```

Public committed cases should be synthetic or scrubbed.

## Case Shape

Each case directory contains:

```text
case.json              # case manifest
goal.md                # implementation-agent prompt, safe to show agent
source/pr.json         # evaluator-only source metadata
source/merged.patch    # evaluator-only merged implementation patch
proofs/                # optional manual-proof artifacts for visual/device/cloud-adjacent behavior
```

For private VOOVO cases, `source/` stays local and ignored.

## Leakage Rules

The implementation agent must not see:

- the source PR URL
- changed file paths from the merged PR
- function or component names revealed by the implementation
- exact diff hunks
- review comments that reveal the solution
- summaries of how the merged PR solved the problem
- test names added specifically by the merged PR, unless the task naturally exposes them

The goal brief should describe the desired user/business/developer outcome, not the implementation.

Bad:

```text
Move the course purchase panel from fixed positioning into the course detail flex layout.
```

Better:

```text
On desktop course detail pages, the purchase area should stay usable while scrolling without visually colliding with lower content or the marketplace footer. Mobile behavior should remain unchanged.
```

## Scripts

Validate public and private cases:

```bash
npm run voovo:validate-cases
```

Prepare a private VOOVO case from GitHub:

```bash
npm run voovo:prepare-pr -- \
  --github-repo OWNER/REPO \
  --pr 123 \
  --source-repo /absolute/path/to/local/repo
```

Open PRs are snapshot-sensitive and require an explicit opt-in:

```bash
npm run voovo:prepare-pr -- \
  --github-repo OWNER/REPO \
  --pr 123 \
  --source-repo /absolute/path/to/local/repo \
  --allow-open
```

Private imports now record explicit replay snapshot metadata (`preSha`, `headSha`,
optional `mergeSha`, `preMethod`, and the fetched PR-head ref). The evaluator
source truth is generated from the selected base with `git diff <preSha>..<headSha>`;
GitHub PR LOC/file stats are kept as context only because stacked branches and
lockfile churn can distort the visible PR diff.

Run baseline and resilient agents:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/cases/smoke-discount
```

For auto-generated private VOOVO goals, review `goal.md` first and set `goal.humanReviewed` to `true` in `case.json`. A temporary override exists for harness debugging:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/private-cases/<case-id> --allow-unreviewed-goal
```

Generated private goals also include a leakage report. The runner refuses to
launch agents when that report has blocking findings unless `--allow-leakage` is
passed for debugging.

Run checks for an existing run:

```bash
npm run voovo:run-checks -- \
  --case evals/voovo-pr-replay/cases/smoke-discount \
  --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp>
```

Create a comparison scaffold:

```bash
npm run voovo:compare -- \
  --case evals/voovo-pr-replay/cases/smoke-discount \
  --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp>
```

The comparison command now writes structured evidence:

```text
comparison/evidence-manifest.json
comparison/evaluator-prompt.md
comparison/comparison-result.json
comparison/comparison-report.md
```

`comparison-result.json` is intentionally `winner: inconclusive` until a human
or evaluator agent reviews the evidence. Validate edited evaluator output with:

```bash
npm run voovo:validate-comparison -- \
  --case evals/voovo-pr-replay/cases/smoke-discount \
  --result tmp/voovo-pr-replay/<case-id>/<timestamp>/comparison/comparison-result.json
```

Run a tiered suite in dry-run mode:

```bash
npm run voovo:run-suite -- --tier smoke --case-root evals/voovo-pr-replay/cases
```

Use `--execute` only when you intend to launch agents. Stress cases require
`--include-stress`.

Clean disposable harness workdirs after a run:

```bash
npm run voovo:cleanup-worktrees -- --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp>
```

Cleanup is dry-run by default. Add `--execute` only after reviewing the candidate
paths.

## Evaluation Criteria

The evaluator should compare the merged PR and new agent implementation on:

- correctness against the original goal
- regression risk
- maintainability
- minimality
- test quality
- product behavior
- repo-pattern fit
- review burden

The merged PR is not automatically better. The agent can win if it solves the same goal with less risk or clearer structure.

## Manual Proofs

Cases can declare `manualProofs` for behavior that deterministic checks cannot
prove, such as browser layout, device-specific native behavior, account-state
semantics, or cloud-adjacent mocked integrations.

Manual proof statuses are:

- `missing`
- `provided`
- `accepted`
- `rejected`

Required missing or rejected proof is surfaced in `comparison-result.json` and
prevents high-confidence claims. Public proof artifacts must be synthetic or
scrubbed; private screenshots, device notes, and account-state notes stay under
ignored private paths.

## Safe Command Policy

Replay check commands are blocked before execution when they obviously mutate
external state or inspect secrets. The default denylist includes deploys, pushes,
PR creation, live Slack posting, and direct `.env*` reads.

Blocked examples:

```text
firebase deploy
gcloud functions deploy
git push
gh pr create
curl https://slack.com/api/chat.postMessage
rg SECRET .env.local
```

Allowed examples:

```text
npm test
npm run build
node --test test/*.mjs
flutter test test/foo_test.dart
```

`--allow-unsafe-checks` exists only for harness debugging and should not be used
for private replay runs.

## Current Repair Boundary

The harness now supports explicit selected-base snapshots, open-PR snapshots,
selected replay patches/stats, goal leakage reports, focused check planning,
pre-run worktree verification, structured comparison output, manual-proof
artifact validation, unsafe check blocking, tiered suite dry-runs, and safe
cleanup dry-runs.

It still does not claim resilient prompting beats merged VOOVO PRs. Real claims
need evaluator-filled comparison results across enough private/scrubbed cases
with required checks and proof attached.

## Operator Guide

For private case import and operation, use:

```text
evals/voovo-pr-replay/docs/private-case-operator-guide.md
```

## Real Candidate Handling

A local VOOVO candidate was identified and imported on 2026-06-11, but exact PR metadata, commit SHAs, diffs, run directories, and generated goals are intentionally kept under ignored private-case/output paths.

Do not commit imported PR metadata or patches unless explicitly approved.
