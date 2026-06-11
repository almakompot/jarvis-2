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

Synthetic smoke result:

- baseline Codex run exited `0`
- resilient Codex run exited `0`
- baseline checks passed
- resilient checks passed
- comparison scaffold generated under the run directory
- current runner summary recorded both Codex statuses and check status, and exits nonzero if any Codex run fails

Private VOOVO first replay:

```bash
npm run voovo:run-case -- --case evals/voovo-pr-replay/private-cases/<case-id>
```

Run directory shape:

```text
tmp/voovo-pr-replay/<case-id>/<timestamp>
```

Result:

- baseline Codex run exited `0`
- resilient Codex run exited `0`
- both changed one intended UI page file
- `npm test` and `npm run build` both failed with missing local dependencies (`vitest` and `next` not installed)
- because those checks were optional for the imported case, this run proves agent execution and patch capture, not verified product correctness
- harness was updated afterward so prompts include allowed checks and check summaries report optional failures separately instead of saying all checks passed
- a local evaluator verdict judged resilient as a narrow process/reporting winner, while the actual implementation patches were a code tie

The smoke case proves the harness can copy a base workspace, run both agent variants, collect patches, run checks, and generate evaluator evidence. It does not prove superiority on real VOOVO work.

## Real VOOVO Case Started

Generated locally and intentionally ignored by git:

```text
evals/voovo-pr-replay/private-cases/<case-id>
```

Status:

- private PR metadata and patch imported locally
- generated goal prompt validates against path/URL leakage checks
- first private goal was manually reviewed locally before agent execution
- runner refuses to launch agents for future unreviewed cases unless explicitly overridden

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

- One small checkout UI/layout PR with browser-verifiable behavior.
- One compact UI behavior fix that can run without external services.
- One backend sync/webhook PR only after careful review, because data-shape and backend risk are higher.
