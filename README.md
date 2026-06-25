# Jarvis 2

Jarvis 2 is a Codex resilience lab: a small repo for turning "do not take the easy shortcut" into concrete Codex App and Codex CLI workflows.

The repo contains:

- `AGENTS.md`: always-on execution protocol for this repo.
- `.agents/skills/resilient-execution/SKILL.md`: reusable Codex skill.
- `prompts/resilience-levels.md`: copyable task contracts.
- `docs/fresh-repo-feature-protocol.md`: testing-first doctrine for a fresh context feature request.
- `docs/meta-harness-roadmap.md`: milestone roadmap for turning the doctrine into a real meta-harness.
- `docs/meta-harness-new-session-usage.md`: operator checklist for using the harness from a fresh Codex session.
- `docs/meta-harness-final-report-format.md`: final report contract and section order.
- `docs/meta-harness-dashboard-spec.md`: desktop-only file-backed dashboard target spec.
- `docs/meta-harness-webapp-spec.md`: local minimalist webapp spec for starting and finding harness runs.
- `meta-harness`: task compiler, run-envelope generator, Codex runner wrapper, proof executors, completed-run verifier, and policy engine.
- `corpus/meta-harness`: sanitized failure-corpus replay cases for known false-pass patterns.
- `apps/site-gate-extension`: Chrome extension example with a real browser smoke test.
- `evals/shortcut-trap`: a tiny bug fixture designed to punish shallow fixes.
- `evals/acceptance-gate`: an artifact-based independent verifier for disciplined Codex runs.
- `evals/web-ui-replay`: first full meta-harness web UI replay from raw task through policy and report.
- `evals/browser-extension-replay`: full Site Gate browser-extension replay plus syntax-only false-pass rejection.
- `evals/non-web-replay`: full data-pipeline replay plus weak generated-artifact rejection.
- `evals/ab-harness`: deterministic A/B dry-run harness for comparing baseline Codex against meta-harnessed Codex.
- `evals/voovo-pr-replay`: phase-two counterfactual PR replay benchmark scaffold.
- `scripts/run-codex-eval.mjs`: runs baseline and resilient Codex CLI attempts.
- `scripts/score-transcript.mjs`: scores the final Codex messages for resilience markers.

## Current Harness Status

The meta-harness is usable today as a locally installable global CLI named `jarvis-harness`.

Current requirements:

- `codex --version` succeeds on `PATH`
- target any local repo with `--repo /path/to/repo`
- install the private local package from this checkout

Install or refresh the global command:

```bash
cd /Users/levente/Documents/jarvis-2
npm install -g .
jarvis-harness doctor
```

Current invocation shape:

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature"
jarvis-harness web
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
jarvis-harness verify --run /path/to/repo/.task-runs/<id>
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format text
```

Implementation runs have no default wall-clock timeout. Add `--timeout-ms <ms>` only when an operator deliberately wants a maximum elapsed-time guard; verification proof commands still use finite command/surface timeouts.

Development fallback from this repo still works:

```bash
npm run meta -- run --repo /path/to/repo --task "build the requested feature"
```

Not available yet: public npm publishing. `package.json` remains `private: true`; use local global install from this checkout. The local web app is implemented from `docs/meta-harness-webapp-spec.md`; the per-run dashboard command is implemented from `docs/meta-harness-dashboard-spec.md`.

`jarvis-harness web` opens a minimalist local app in the default browser. The main page can start a run, initialize a packet, list discovered active/recent `.task-runs`, and open each run on its own dashboard page.

`jarvis-harness dashboard --run <run-dir>` opens the local dashboard URL in the default browser. Add `--no-open` to print the URL without opening a browser tab.

## Quick Start

```bash
npm run check
npm run meta:check
npm run doctrine:validate
npm run site-gate:check
npm run web-ui:replay
npm run browser-extension:replay
npm run non-web:replay
npm run ab-harness:dry-run
npm run meta:final-audit
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

For meta-harness work specifically, use `docs/meta-harness-new-session-usage.md`. The final report contract is `docs/meta-harness-final-report-format.md`.

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

Still unenforced: deep repo adapter inference and automatic corpus minimization/sanitization. Dashboard v1 exists as a read-only file-backed local surface over one run folder.

## Meta-Harness M4/M5

Run the real Codex wrapper against an existing task packet:

```bash
npm run meta:codex-runner -- --run-dir /path/to/repo/.task-runs/<id>
```

The Codex wrapper has no default wall-clock timeout. `--timeout-ms` is opt-in and records the configured limit in `runner-config.json`.

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

Use the `jarvis-harness` CLI facade for daily runs:

```bash
jarvis-harness run --repo /path/to/repo --task "build the requested feature"
jarvis-harness init --repo /path/to/repo --task "build the requested feature"
jarvis-harness run --run /path/to/repo/.task-runs/<id>
jarvis-harness dashboard --run /path/to/repo/.task-runs/<id>
jarvis-harness verify --run /path/to/repo/.task-runs/<id>
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format text
jarvis-harness report --run /path/to/repo/.task-runs/<id> --format html
jarvis-harness rerun --from /path/to/repo/.task-runs/<id>
jarvis-harness cleanup --repo /path/to/repo --dry-run
```

The repo-local development facade is equivalent:

```bash
npm run meta -- run --repo /path/to/repo --task "build the requested feature"
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

To replay the first full web UI task-class case:

```bash
npm run web-ui:replay
npm run web-ui:test-replay
```

The replay creates a public synthetic VOOVO-style browse fixture, starts from the raw feature request, runs the task packet through the harness, proves the no-results and reset flow, verifies the completed run, accepts it through policy, and renders text/HTML reports under `tmp/web-ui-replay/`.

To replay the browser-extension task class:

```bash
npm run browser-extension:replay
npm run browser-extension:test-replay
```

The replay copies the public Site Gate extension into an isolated repo, validates the manifest/source, runs unpacked-extension CDP smoke, verifies invalid custom minutes, one-minute allow, five-minute allow, custom allow, same-origin reuse, and decline-to-blocked behavior, then proves a syntax-only false pass is rejected.

To replay the non-web data-pipeline task class:

```bash
npm run non-web:replay
npm run non-web:test-replay
```

The replay creates a synthetic Hungarian old-doc OCR fixture, invokes the actual local pipeline CLI, verifies missing-text-layer invalid input, validates generated manifest/searchable-text/search-index artifacts beyond existence, records zero external OCR cost and no approval requirement, then proves weak placeholder artifacts are rejected.

To run the A/B evaluation dry run:

```bash
npm run ab-harness:dry-run
npm run ab-harness:test
```

The committed dry run is small and deterministic. It defines task sets, variants, repeats, scoring, artifact collection, failure classifications, and report output. Use 200-500 total runs only for a later validation campaign, not as implementation steps.

To audit final packaging, docs, scripts, CI wiring, and new-session surfaces:

```bash
npm run meta:final-audit
```

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
