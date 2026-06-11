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

Run baseline and resilient agents:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/cases/smoke-discount
```

For auto-generated private VOOVO goals, review `goal.md` first and set `goal.humanReviewed` to `true` in `case.json`. A temporary override exists for harness debugging:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/private-cases/<case-id> --allow-unreviewed-goal
```

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

## Real Candidate Handling

A local VOOVO candidate was identified and imported on 2026-06-11, but exact PR metadata, commit SHAs, diffs, run directories, and generated goals are intentionally kept under ignored private-case/output paths.

Do not commit imported PR metadata or patches unless explicitly approved.
