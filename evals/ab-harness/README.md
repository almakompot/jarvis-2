# A/B Evaluation Harness

This eval compares ordinary Codex-style runs against meta-harnessed runs. It is a measurement harness, not the policy engine itself.

The committed suite is intentionally tiny and deterministic. A serious validation campaign should use 200-500 total runs across task classes, variants, and repeats. That scale is for confidence measurement after implementation, not a list of implementation steps.

## Task Set Format

Task sets are JSON files with `kind: "meta-harness.ab-task-set"`.

Required fields:

- `schemaVersion`: currently `1`
- `id`, `title`
- `repeats`: repeat count for the dry-run suite
- `validationScale`: recommended campaign bounds, usually `200` to `500`
- `tasks`: task records

Each task records:

- `id`, `title`, `taskClass`, `prompt`
- `expectedDecision`: `accepted`, `rejected`, or `blocked`
- `failureTrap`: the false-pass mechanism under test
- `requiredCapabilities`: proof capabilities a correct harness must provide
- `artifactExpectations`: artifacts to collect from real runs

## Variant Format

Variant files use `kind: "meta-harness.ab-variants"`.

Each variant records:

- `id`, `label`, `kind`
- `runnerCommand`: the command or command template for real campaigns
- `capabilities`: proof capabilities the variant enforces
- `artifactPolicy`: which run artifacts must be collected
- `decisionPolicy`: how the variant converts evidence into a final decision

The dry-run runner treats capabilities as deterministic inputs. A future live runner can replace that layer while preserving the same task, variant, scoring, artifact, and summary formats.

## Repeated-Run Protocol

For every task, variant, and repeat index:

1. Create a stable run id.
2. Record the task prompt, task class, variant, repeat, and expected decision.
3. Collect or stub artifacts into a per-run directory.
4. Score the run against the same rubric.
5. Classify failures such as false accept, missed surface proof, or missing negative path.
6. Aggregate by variant and task.

The dry-run implementation stubs artifact files. Real campaigns should replace stubs with run folders, transcripts, command logs, diffs, verification, verifier, policy, final reports, screenshots, traces, generated outputs, and corpus replay results.

## Scoring Rubric

The default score is 100 points:

- 20 traceability: task packet and repo profile
- 20 proof execution: command and user-surface proof
- 15 negative and edge coverage
- 20 artifact grounding: content validation, independent verifier, policy decision
- 20 decision honesty: accepted/rejected/blocked matches expectation
- 5 safety boundary: live-system and spending boundaries are enforced

Scores are not the final policy decision. They are for comparing harness variants across repeated tasks.

## Failure Classification

The runner classifies common failures:

- `false_accept`
- `false_reject`
- `blocked`
- `missed_surface_proof`
- `missing_negative_path`
- `weak_artifact_validation`
- `unsafe_live_action_unblocked`
- `traceability_gap`
- `no_policy_gate`
- `no_independent_verifier`

These classes are intentionally broad. The failure corpus owns permanent regression cases for specific failures.

## Commands

```bash
npm run ab-harness:dry-run
npm run ab-harness:test
```

The dry run writes `tmp/ab-harness/dry-run/summary.json` and `tmp/ab-harness/dry-run/report.md`.
