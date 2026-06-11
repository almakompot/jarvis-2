# VOOVO PR Replay Repair Roadmap

Date: 2026-06-11.

This roadmap summarizes the actionable failures found while auditing private VOOVO PR replay cases. It is intentionally scrubbed for the public repository: private PR metadata, patches, SHAs, logs, and generated audit files stay under `evals/voovo-pr-replay/private-cases/`.

## Diagnosis

The replay harness has the right mechanical foundation: private cases, worktree-based execution, baseline/resilient variants, patch capture, check logs, and comparison scaffolds. The current risk is benchmark hygiene. Without repairs, a run can start from the wrong commit, leak implementation hints into the goal, run irrelevant checks, compare against the wrong patch, or treat weak manual evidence as a real verdict.

## Priority Repairs

1. Make base selection explicit.
   - Store `preSha`, `headSha`, `mergeSha`, `preMethod`, and the fetched PR-head ref in each private case.
   - Use merge-commit first parent for merged PRs when available.
   - Use merge-base for open PRs or fallback cases.
   - Assert every run worktree starts at the recorded `preSha`.

2. Support open PR snapshots safely.
   - Allow private case import for open PRs.
   - Pin the observed head SHA.
   - Fail with a snapshot-drift error if the open PR head changes before execution unless the case is refreshed.

3. Harden goal generation against leakage.
   - Keep PR metadata, patches, changed file paths, root-cause notes, and exact implementation symbols evaluator-only.
   - Generate outcome-only goals from user impact and acceptance behavior.
   - Emit a leakage report and keep the `humanReviewed` gate mandatory.

4. Replace generic checks with case-specific checks.
   - Flutter cases should run targeted `flutter test` and focused `flutter analyze`.
   - Firebase Functions cases should run `cd firebase/functions && npm run build` and focused `node --test` commands.
   - Rules/migration cases need emulator or unit-test coverage where practical.
   - Manual or device proof should be represented explicitly when automation is insufficient.

5. Score against the selected replay diff.
   - Preserve GitHub PR file stats as context only.
   - Generate evaluator source truth from `git diff <preSha>..<headSha>`.
   - Warn when GitHub-visible LOC differs from selected-base replay LOC, because stacked branches and lockfile churn can distort scoring.

6. Turn comparison from scaffold into evaluator output.
   - Produce `comparison-result.json` with winner, confidence, criteria scores, missing evidence, and cited proof.
   - Keep the human markdown report, but make it a rendering of structured evaluation data.
   - Do not reward diff similarity by itself; evaluate correctness, risk, maintainability, minimality, tests, product behavior, repo fit, and review burden.

7. Enforce private-run guardrails in code.
   - Refuse output paths outside ignored private areas for private VOOVO cases.
   - Deny deploys, pushes, PR creation, live Slack/Firebase writes, and direct `.env*` reads during automated replay.
   - Keep source truth and evaluator-only files out of implementation-agent prompts.

8. Make worktree lifecycle first-class.
   - Create, verify, log, and clean worktrees through harness commands.
   - Reject dirty or wrong-HEAD worktrees before an agent starts.
   - Record cleanup commands for private audit runs.

9. Add fixtures for stateful cases.
   - Build deterministic fixtures for provider state, persisted chats, streaming UI states, and migration semantics.
   - If a case cannot be fully automated, require a manual-proof artifact before high-confidence scoring.

10. Add difficulty tiers.
    - Run focused smoke cases first.
    - Promote medium cases only after goal leakage, check planning, and evaluator output are stable.
    - Gate broad native, migration, cloud-adjacent, and device-dependent cases behind explicit stress-run flags.

## First Implementation Batch

Start with the repairs that protect benchmark validity:

1. Extend the case schema and importer with explicit SHA fields and open-PR snapshot support.
2. Update the runner to use `preSha` and verify worktree HEAD before launching agents.
3. Add selected-base patch/stat generation and mismatch warnings.
4. Add a stricter leakage report for generated goals.
5. Add case-specific check fields and remove generic root-level checks from imported VOOVO cases.

That batch gives the next smoke run a defensible starting point without needing to solve every evaluator and fixture problem at once.

## Proof Of Repair

A repaired pipeline should be able to:

- import a private merged PR and a private open PR without leaking source truth to the implementation prompt;
- prove the agent worktree starts at the recorded `preSha`;
- show selected-base LOC and GitHub PR LOC separately;
- refuse stale open PR snapshots;
- refuse private output paths that are not ignored by git;
- run focused checks appropriate to the changed code domain;
- generate structured comparison output with missing evidence called out explicitly.
