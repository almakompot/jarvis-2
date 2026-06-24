# Jarvis 2

Jarvis 2 is a Codex resilience lab: a small repo for turning "do not take the easy shortcut" into concrete Codex App and Codex CLI workflows.

The repo contains:

- `AGENTS.md`: always-on execution protocol for this repo.
- `.agents/skills/resilient-execution/SKILL.md`: reusable Codex skill.
- `prompts/resilience-levels.md`: copyable task contracts.
- `docs/fresh-repo-feature-protocol.md`: testing-first doctrine for a fresh context feature request.
- `docs/meta-harness-roadmap.md`: milestone roadmap for turning the doctrine into a real meta-harness.
- `meta-harness`: task compiler, run-envelope generator, Codex runner wrapper, proof executors, completed-run verifier, and policy engine.
- `corpus/meta-harness`: sanitized failure-corpus replay cases for known false-pass patterns.
- `apps/site-gate-extension`: Chrome extension example with a real browser smoke test.
- `evals/shortcut-trap`: a tiny bug fixture designed to punish shallow fixes.
- `evals/acceptance-gate`: an artifact-based independent verifier for disciplined Codex runs.
- `evals/voovo-pr-replay`: phase-two counterfactual PR replay benchmark scaffold.
- `scripts/run-codex-eval.mjs`: runs baseline and resilient Codex CLI attempts.
- `scripts/score-transcript.mjs`: scores the final Codex messages for resilience markers.

## Quick Start

```bash
npm run check
npm run meta:check
npm run doctrine:validate
npm run site-gate:check
npm run eval:score -- --input docs/sample-resilient-output.md
npm run acceptance:verify
```

`npm run check` expects the bundled shortcut-trap fixture to fail before Codex touches it. The live eval copies that broken fixture to `tmp/` and asks Codex to fix the copy.

## Fresh Session Contract

Start Codex in this repo and give the new session this exact contract:

```text
Use docs/fresh-repo-feature-protocol.md as the operating protocol.
Before final, run npm run check.
Done means the changed surface was exercised the way a user will try it, and the final answer must separate verified facts from remaining risk.
```

For smaller runs, replace `npm run check` with the narrow command for the touched surface, but only when you name why the narrower proof is enough.

## Meta-Harness M1/M3

Create a frozen task packet and run envelope before implementation:

```bash
npm run meta:init -- --repo /path/to/repo --task "build the requested feature"
```

That creates:

```text
/path/to/repo/.task-runs/<id>/
  task.md
  repo-profile.json
  spec.json
  proof-plan.json
  allowed-files.json
  events.jsonl
  verification.json
  final-report.json
```

Validate a generated packet:

```bash
npm run meta:validate -- --run-dir /path/to/repo/.task-runs/<id>
npm run meta:check
```

Current enforcement: required artifacts must exist, requirements must map to proof obligations, proof obligations must map back to known requirements, secret paths must be forbidden, verification cannot claim passed without evidence, and final reports cannot claim passed without passed verification and cited evidence.

Still unenforced: deep repo adapter inference, automatic corpus minimization/sanitization, and dashboard UX.

## Meta-Harness M4/M5

Run the real Codex wrapper against an existing task packet:

```bash
npm run meta:codex-runner -- --run-dir /path/to/repo/.task-runs/<id>
```

Run the command proof executor against `proof-plan.json` and `spec.requiredTests`:

```bash
npm run meta:verify-commands -- --run-dir /path/to/repo/.task-runs/<id>
```

The command proof executor runs allowed local proof commands in the profiled target repo, captures stdout/stderr/exit/timing into `evidence/commands/`, appends executed commands to `command-log.jsonl`, appends verification events to `events.jsonl`, and updates `verification.json` by requirement and proof-obligation ID. Missing or unsafe commands are blocked before execution, and failed or timed-out commands cannot satisfy proof obligations. Reruns append new evidence instead of overwriting old failures.

Run non-shell surface proof from `proof-plan.json` `surfaceProofs`:

```bash
npm run meta:verify-surfaces -- --run-dir /path/to/repo/.task-runs/<id>
```

The surface proof executor handles browser and browser-extension smoke artifacts, API request/response proof, direct CLI binary invocation, data/generated-artifact validation, visual artifacts, and manual evidence artifacts. Surface evidence only satisfies proof obligations that explicitly accept that evidence type; manual and visual proof must cite concrete artifact paths.

Run the completed-run verifier after runner and proof artifacts exist:

```bash
npm run meta:verifier -- --run-dir /path/to/repo/.task-runs/<id>
```

The verifier writes `verifier-report.json` and rejects invalid run folders, missing artifacts, schema failures, bad run-state/order evidence, requirement/proof/evidence mismatches, failed commands claimed as passed, unaccepted evidence types, forbidden changed files, missing surface evidence, and final-report citations to unknown or non-passing evidence. Findings are classified as `blocking`, `major`, `minor`, or `info`; any blocking or major finding makes the verifier recommendation `reject`.

Run the deterministic policy engine after verification and verifier review:

```bash
npm run meta:policy -- --run-dir /path/to/repo/.task-runs/<id>
```

The policy engine writes `policy-decision.json` with `accepted`, `rejected`, or `blocked`. It consumes `verification.json`, `verifier-report.json`, task-class surface policy, optional `corpus-replay.json`, and optional `policy-overrides.json`; reject/block rules remain recorded even when an explicit override is accepted.

Use the M8 CLI facade for daily runs:

```bash
npm run meta -- init --repo /path/to/repo --task "build the requested feature"
npm run meta -- run --run /path/to/repo/.task-runs/<id>
npm run meta -- verify --run /path/to/repo/.task-runs/<id>
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format text
npm run meta -- report --run /path/to/repo/.task-runs/<id> --format html
npm run meta -- rerun --from /path/to/repo/.task-runs/<id>
npm run meta -- cleanup --repo /path/to/repo --dry-run
```

`meta report` renders findings first, then policy decision, command status, missing proof, evidence paths, residual risk, and next actions. HTML reports write to `html-report/index.html` unless `--output` is provided.

Replay the M7 failure corpus:

```bash
npm run meta:corpus
```

The committed corpus contains sanitized synthetic expected-fail and expected-pass cases. Expected-fail cases must continue to reject under the current verifier and policy engine; expected-pass cases prove the harness is still satisfiable.

Promote a rejected or blocked local run into a private-staging corpus skeleton:

```bash
npm run meta:promote-failure -- --run-dir /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset
```

Promotion intentionally does not copy raw run artifacts. Minimize and sanitize the case before committing it.

To run live Codex CLI evals:

```bash
npm run eval:codex
```

That command copies the fixture into `tmp/eval-runs/`, runs `codex exec` twice, and scores the results:

- baseline prompt: direct fix request
- resilient prompt: explicit shortcut detection, proof, verification, and final risk report

The command exits nonzero unless both copied fixtures are repaired and the resilient run beats baseline on the behavior score.

To validate the VOOVO PR replay case schema and leakage checks:

```bash
npm run voovo:validate-cases
```

See `evals/voovo-pr-replay/README.md` for private VOOVO PR imports and counterfactual replay runs.

To validate the independent acceptance gate:

```bash
npm run acceptance:test
npm run acceptance:verify
```

The acceptance gate rejects runs that claim discipline without artifacts: missing prompt input, edits before inspection, forbidden paths, missing or failed verification, and final reports that cite nonexistent evidence.

## How To Use In Codex App

Start a new Codex thread in this repo and prompt:

```text
Use $resilient-execution at Level 3.

Fix the bug in evals/shortcut-trap.
Done means tests pass and your final answer names:
- the tempting shortcut
- the hidden hard part
- the proof used
- remaining risk
```

For important work, add:

```text
After implementing, spawn three subagents:
1. Bug skeptic
2. Test skeptic
3. Maintainability skeptic

Wait for all of them, address valid findings, then final.
```

## Design Principle

This repo does not try to make an AI "mentally tough." It designs a task environment where resilient behavior is the path of least resistance:

1. name the shortcut
2. define proof
3. execute
4. verify
5. self-review
6. report uncertainty
