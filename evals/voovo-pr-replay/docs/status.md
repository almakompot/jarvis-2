# VOOVO PR Replay Status

Date: 2026-06-11.

## Built

- Public benchmark docs: `evals/voovo-pr-replay/README.md`
- Case schema: `evals/voovo-pr-replay/schema/case.schema.json`
- Public synthetic smoke case: `evals/voovo-pr-replay/cases/smoke-discount`
- Private-case ignore boundary: `evals/voovo-pr-replay/private-cases/`
- PR import script: `evals/voovo-pr-replay/scripts/prepare-case-from-pr.mjs`
- Case validator and leakage checks: `evals/voovo-pr-replay/scripts/validate-cases.mjs`
- Baseline/resilient runner: `evals/voovo-pr-replay/scripts/run-case.mjs`
- Check runner: `evals/voovo-pr-replay/scripts/run-checks.mjs`
- Comparison scaffold generator: `evals/voovo-pr-replay/scripts/compare-case.mjs`

## Verified

Local validation:

```bash
npm run check
```

This currently checks:

- shortcut-trap fixture is intentionally armed
- transcript scorer rejects fake verification claims
- sample resilient output scores as passing
- PR replay cases validate

Smoke PR replay:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/cases/smoke-discount
npm run voovo:compare -- --case evals/voovo-pr-replay/cases/smoke-discount --run-dir tmp/voovo-pr-replay/smoke-discount/2026-06-11T10-25-56-943Z
```

Result:

- baseline Codex run exited `0`
- resilient Codex run exited `0`
- baseline checks passed
- resilient checks passed
- comparison scaffold generated under the run directory
- current runner summary recorded both Codex statuses and check status, and exits nonzero if any Codex run fails

The smoke case proves the harness can copy a base workspace, run both agent variants, collect patches, run checks, and generate evaluator evidence. It does not prove superiority on real VOOVO work.

## Real VOOVO Case Started

Generated locally and intentionally ignored by git:

```text
evals/voovo-pr-replay/private-cases/voovo-checkout-pr20-fix-course-checkout-sidebar-flow
```

Source:

- repo: `VoovoStudy/voovo-checkout`
- PR: `#20`, "Fix course checkout sidebar flow"
- base commit: `06519b4b4f7ff34a2a47292b2f12fb70203a172b`
- merge commit: `6f5adb608a5ff8b52d340f9463bea8b59e74676d`

Status:

- private PR metadata and patch imported locally
- generated goal prompt validates against path/URL leakage checks
- `goal.humanReviewed` remains `false`
- runner refuses to launch agents for that case until the goal is reviewed or explicitly overridden

## What This Can Prove Now

- Whether the harness mechanics work.
- Whether goal prompts leak obvious implementation evidence such as PR URLs or changed file paths.
- Whether baseline and resilient agents can produce patches from the same outcome-only brief.
- Whether checks pass for both produced implementations.
- Whether an evaluator has enough evidence to compare merged, baseline, and resilient outputs.

## What This Cannot Prove Yet

- Whether resilient prompting improves real VOOVO engineering outcomes.
- Whether the evaluator judgment is reliable.
- Whether agents avoid non-obvious leakage from generated goals.
- Whether UI behavior is actually correct without browser or visual checks.

## Next Best Cases

- `VoovoStudy/voovo-checkout` PR #20 after manual goal rewrite/review.
- `VoovoStudy/voovo-checkout` PR #14 for a compact UI behavior fix.
- `VoovoStudy/voovo-content-platform` PR #558 only after careful review, because grade sync/webhook work has higher data-shape and backend risk.
