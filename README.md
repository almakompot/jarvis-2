# Jarvis 2

Jarvis 2 is a Codex resilience lab: a small repo for turning "do not take the easy shortcut" into concrete Codex App and Codex CLI workflows.

The repo contains:

- `AGENTS.md`: always-on execution protocol for this repo.
- `.agents/skills/resilient-execution/SKILL.md`: reusable Codex skill.
- `prompts/resilience-levels.md`: copyable task contracts.
- `evals/shortcut-trap`: a tiny bug fixture designed to punish shallow fixes.
- `scripts/run-codex-eval.mjs`: runs baseline and resilient Codex CLI attempts.
- `scripts/score-transcript.mjs`: scores the final Codex messages for resilience markers.

## Quick Start

```bash
npm run check
npm run eval:score -- --input docs/sample-resilient-output.md
```

`npm run check` expects the bundled shortcut-trap fixture to fail before Codex touches it. The live eval copies that broken fixture to `tmp/` and asks Codex to fix the copy.

To run live Codex CLI evals:

```bash
npm run eval:codex
```

That command copies the fixture into `tmp/eval-runs/`, runs `codex exec` twice, and scores the results:

- baseline prompt: direct fix request
- resilient prompt: explicit shortcut detection, proof, verification, and final risk report

The command exits nonzero unless both copied fixtures are repaired and the resilient run beats baseline on the behavior score.

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
