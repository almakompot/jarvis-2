# VOOVO PR Replay Status

Date: 2026-06-12.

## Built

- Public benchmark docs: `evals/voovo-pr-replay/README.md`
- Case schema: `evals/voovo-pr-replay/schema/case.schema.json`
- Public synthetic smoke case: `evals/voovo-pr-replay/cases/smoke-discount`
- Private-case ignore boundary: `evals/voovo-pr-replay/private-cases/`
- PR import script: `evals/voovo-pr-replay/scripts/prepare-case-from-pr.mjs`
- Case validator and leakage checks: `evals/voovo-pr-replay/scripts/validate-cases.mjs`
- Baseline/resilient runner: `evals/voovo-pr-replay/scripts/run-case.mjs`
- Check runner: `evals/voovo-pr-replay/scripts/run-checks.mjs`
- Structured comparison generator: `evals/voovo-pr-replay/scripts/compare-case.mjs`
- Comparison result validator: `evals/voovo-pr-replay/scripts/validate-comparison-result.mjs`
- Tiered suite runner: `evals/voovo-pr-replay/scripts/run-suite.mjs`
- Harness worktree cleanup tool: `evals/voovo-pr-replay/scripts/cleanup-worktrees.mjs`
- Explicit replay snapshot metadata for private git-worktree imports:
  `preSha`, `headSha`, optional `mergeSha`, `preMethod`, and `prHeadRef`
- Open PR import support via `--allow-open`
- Selected-base source truth generated from `git diff <preSha>..<headSha>`
- Goal leakage reports and runner-side blocking for obvious source-truth leaks
- Focused check planning for Flutter/Dart and Firebase Functions paths
- Worktree HEAD/clean-status verification before agent execution
- Manual-proof artifact validation for screenshot, video, log, markdown-note,
  device-matrix, mock-transcript, and external-note proof types
- Unsafe check blocking for deploys, pushes, PR creation, live Slack posting, and
  direct `.env*` reads
- Public synthetic stateful and cloud-adjacent fixture cases
- Private case operator guide:
  `evals/voovo-pr-replay/docs/private-case-operator-guide.md`

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
- suite dry-run and cleanup dry-run behavior are covered by repair tests

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
- structured comparison files generated under the run directory
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
- Whether required manual proof is present, missing, or rejected.
- Whether obvious unsafe commands are blocked before execution.
- Whether public/scrubbed cases are organized by smoke, medium, and stress tiers.

## What This Cannot Prove Yet

- Whether resilient prompting improves real VOOVO engineering outcomes.
- Whether evaluator judgment is reliable before a human/evaluator fills
  `comparison-result.json` with citations.
- Whether agents avoid non-obvious leakage from generated goals.
- Whether UI behavior is actually correct without browser or visual checks.
- Whether manual/device/cloud-adjacent behavior is correct when no deterministic fixture or manual-proof artifact is attached.

## Next Phase

- Run the smoke suite with `--execute` only when ready to spend agent cycles.
- Promote more private cases into medium/stress tiers after their goals and proof
  requirements are reviewed.
- Fill `comparison-result.json` with evidence-cited evaluator verdicts and track
  whether resilient output actually wins across repeated private/scrubbed cases.
- Add more deterministic fixtures for persisted chat, streaming UI, and migration
  semantics before broad native/migration/cloud-adjacent stress runs.
