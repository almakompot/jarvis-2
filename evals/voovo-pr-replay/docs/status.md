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
- Explicit replay snapshot metadata for private git-worktree imports:
  `preSha`, `headSha`, optional `mergeSha`, `preMethod`, and `prHeadRef`
- Open PR import support via `--allow-open`
- Selected-base source truth generated from `git diff <preSha>..<headSha>`
- Goal leakage reports and runner-side blocking for obvious source-truth leaks
- Focused check planning for Flutter/Dart and Firebase Functions paths
- Worktree HEAD/clean-status verification before agent execution

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
- PR replay repair tests pass

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
- new private imports should use selected-base source truth and explicit replay snapshot metadata instead of loose base refs

## What This Can Prove Now

- Whether the harness mechanics work.
- Whether goal prompts leak obvious implementation evidence such as PR URLs or changed file paths.
- Whether baseline and resilient agents can produce patches from the same outcome-only brief.
- Whether checks pass for both produced implementations.
- Whether an evaluator has enough evidence to compare merged, baseline, and resilient outputs.
- Whether a private git-worktree run starts from the recorded pre-PR SHA.
- Whether selected-base LOC differs from GitHub-visible PR LOC.
- Whether imported checks are at least matched to broad code domains such as Flutter or Firebase Functions.

## What This Cannot Prove Yet

- Whether resilient prompting improves real VOOVO engineering outcomes.
- Whether the evaluator judgment is reliable.
- Whether agents avoid non-obvious leakage from generated goals.
- Whether UI behavior is actually correct without browser or visual checks.
- Whether manual/device/cloud-adjacent behavior is correct when no deterministic fixture or manual-proof artifact is attached.

## Next Phase

- Turn `compare-case.mjs` into structured evaluator output instead of a scaffold.
- Add manual-proof artifact slots for device, browser, account-state, and cloud-adjacent checks.
- Add deterministic fixtures for stateful VOOVO cases before running stress cases.
- Keep the first live repair-validation run to focused smoke cases before broad native/migration/cloud-adjacent cases.
