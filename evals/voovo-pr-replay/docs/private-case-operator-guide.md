# Private Case Operator Guide

Date: 2026-06-12.

This guide is for private VOOVO PR replay operation. Keep private PR metadata,
patches, exact SHAs, generated private goals, screenshots, logs, and account
notes under ignored private paths unless the user explicitly approves a scrubbed
public artifact.

## Privacy Boundary

Private cases live under:

```text
evals/voovo-pr-replay/private-cases/
```

Run output lives under:

```text
tmp/voovo-pr-replay/
```

Do not copy private `source/`, run logs, screenshots, or generated goals into
tracked docs.

## Import Checklist

1. Import from a local checkout and GitHub PR metadata.
2. For open PRs, pass `--allow-open` and treat the case as snapshot-sensitive.
3. Confirm `preSha`, `headSha`, optional `mergeSha`, `preMethod`, and PR-head ref
   are recorded.
4. Prefer selected-base source truth from `git diff <preSha>..<headSha>`.
5. Review `goal.md` for leakage before setting `goal.humanReviewed` to `true`.
6. Read the leakage report and fix blocking findings instead of overriding them.

## Goal Review

The implementation agent should receive only the outcome, not the solution.

Reject a goal if it includes:

- PR URLs
- changed file paths
- exact function/component names revealed by the patch
- diff hunks
- review comments that reveal the implementation
- summaries of how the merged PR solved the problem

## Manual Proof

Use deterministic checks and fixtures first. Add manual proof only when behavior
is genuinely visual, device-specific, account-state-specific, or cloud-adjacent.

Accepted proof types:

- `screenshot`
- `video`
- `log`
- `markdown-note`
- `device-matrix`
- `mock-transcript`
- `external-note`

Missing required proof should make the comparison inconclusive or cap confidence
below high. Rejected proof is a blocking issue.

## Safe Commands

Replay checks must not mutate external systems or inspect secret files.

Do not run:

```text
firebase deploy
gcloud ... deploy
git push
gh pr create
npm run deploy
curl https://slack.com/api/chat.postMessage
cat .env
rg SECRET .env.local
```

Safe default examples:

```text
npm test
npm run build
node --test test/*.mjs
flutter test test/foo_test.dart
flutter analyze lib/foo.dart
```

`--allow-unsafe-checks` is for harness debugging only.

## Tier Policy

Smoke:

- deterministic
- no external services
- no required manual proof
- cheap enough to run first

Medium:

- deterministic fixtures or carefully reviewed private cases
- manual proof allowed when attached
- no live cloud writes

Stress:

- broad native, migration, cloud-adjacent, or account-state behavior
- requires `--include-stress`
- should not run until smoke and medium cases are healthy

## Run Order

Dry-run discovery first:

```bash
npm run voovo:run-suite -- --tier smoke
```

Execute only when ready to launch agents:

```bash
npm run voovo:run-suite -- --tier smoke --execute
```

After a case run, generate comparison evidence:

```bash
npm run voovo:compare -- --case evals/voovo-pr-replay/private-cases/<case-id> --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp>
```

Validate an edited evaluator verdict:

```bash
npm run voovo:validate-comparison -- --case evals/voovo-pr-replay/private-cases/<case-id> --result tmp/voovo-pr-replay/<case-id>/<timestamp>/comparison/comparison-result.json
```

Cleanup workdirs after reviewing candidates:

```bash
npm run voovo:cleanup-worktrees -- --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp>
npm run voovo:cleanup-worktrees -- --run-dir tmp/voovo-pr-replay/<case-id>/<timestamp> --execute
```

## Interpreting Inconclusive

`inconclusive` is not a failure. It means the evidence does not justify a winner
yet. Common reasons:

- required checks are missing or failed
- manual proof is missing
- product behavior needs browser/device/account-state review
- source truth and selected replay stats disagree in a way that needs audit
- evaluator citations are too weak

Do not upgrade confidence by vibe. Add evidence or keep the case inconclusive.

## Open PR Snapshot Refresh

For open PRs, refresh or re-import when:

- the PR head changes
- the base branch moves in a relevant area
- generated selected stats no longer match the intended replay window
- a previous run reports snapshot drift

Never silently reuse stale open-PR snapshots for benchmark claims.
