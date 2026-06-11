# Codex CLI And App Research

Research date: 2026-06-11.

Sources checked:

- OpenAI Codex manual fetched with `openai-docs/scripts/fetch-codex-manual.mjs`.
- Official Codex CLI command reference: `https://developers.openai.com/codex/cli/reference`
- Official AGENTS.md guide: `https://developers.openai.com/codex/guides/agents-md`
- Official Agent Skills guide: `https://developers.openai.com/codex/skills`
- Official Non-interactive mode guide: `https://developers.openai.com/codex/noninteractive`
- Official Subagents guide: `https://developers.openai.com/codex/subagents`
- Official Best practices guide: `https://developers.openai.com/codex/learn/best-practices`

## Findings

Codex has the right primitives for "resilient behavior" without pretending the model has human psychology.

1. `AGENTS.md` is the durable repo instruction surface. Codex loads global and project guidance before work, with closer files taking precedence.
2. Skills package reusable workflows. A repo-scoped skill under `.agents/skills` can make the resilience loop discoverable in CLI, IDE, and app surfaces.
3. `codex exec` is the right test harness because it runs non-interactively, can be scripted, and can emit final messages or JSONL.
4. Subagents are useful for Level 4 review loops, but should be explicitly requested because they cost more tokens and can create coordination overhead.
5. Good Codex practice is to test, verify, and review changes instead of stopping after generation.

Local CLI note: this machine has `codex-cli 0.128.0`. Its `codex exec --help` accepts `--sandbox`, `--cd`, `--skip-git-repo-check`, `--ignore-user-config`, `-m`, and `--output-last-message`, but rejected `--ask-for-approval` when passed after `exec`. A user config issue with `service_tier = "default"` also prevented execution, and the ignored-config default model `gpt-5.3-codex` was rejected for this ChatGPT account. A probe confirmed `gpt-5.5` works, so the eval harness pins `-m gpt-5.5` and uses `--ignore-user-config`.

## Excellence Hypothesis

The prompt should not say "act like David Goggins" or "act like Tesla." It should reshape the local incentive landscape:

- shortest acceptable final answer requires proof
- missing verification becomes a visible defect
- shortcut detection happens before editing
- final response must expose uncertainty
- hard tasks get independent review

## Measurement

This repo measures behavioral improvement with a tiny fixture:

- baseline prompt asks Codex to fix a bug
- resilient prompt requires shortcut detection, hidden-hard-part detection, proof, verification, and residual risk in the final message
- scorer checks the final message for those markers
- fixture tests check whether the code is actually fixed

This is not a scientific benchmark yet. It is a practical smoke test for whether the workflow nudges Codex toward better engineering behavior.

## Live Eval Results

Initial successful run timestamp: `2026-06-11T09-43-47-027Z`.
Hardened run timestamp: `2026-06-11T09-49-49-361Z`.

Command:

```bash
npm run eval:codex
```

Harness shape:

- model pinned to `gpt-5.5`
- user config ignored because local config had an incompatible `service_tier`
- fixture copied into `tmp/eval-runs/<timestamp>/`
- baseline run received only the direct fix prompt
- resilient run received repo `AGENTS.md` plus `$resilient-execution`

Initial results:

| Run | Codex exit | Tests | Behavior score |
| --- | ---: | ---: | ---: |
| baseline | 0 | 4/4 passing | 30/100 |
| resilient | 0 | 4/4 passing | 90/100 |

After a read-only Codex CLI skeptic review, the scorer and runner were hardened:

- `scripts/run-codex-eval.mjs` now exits nonzero if Codex fails, tests fail, resilient behavior does not pass, or resilient score does not beat baseline.
- `scripts/score-transcript.mjs` now rejects fake verification claims such as `Verified: I did not run npm test`.
- `scripts/test-scorer.mjs` locks that false-positive regression test into `npm run check`.

Hardened results:

| Run | Codex exit | Tests | Behavior score | Behavior passed |
| --- | ---: | ---: | ---: | --- |
| baseline | 0 | 4/4 passing | 20/100 | no |
| resilient | 0 | 4/4 passing | 90/100 | yes |

Interpretation:

- Both prompts got the code right on this small fixture.
- The baseline final answer was useful but did not expose shortcut pressure, hidden difficulty, proof, positive verification, or residual risk in a consistent way.
- The resilient final answer named the shortcut, hidden hard part, proof, verification, and remaining risk.
- The first version of this eval accidentally scored only the final message while the prompt allowed some audit material to appear before final. The protocol was tightened so Level 3+ final answers must repeat the audit trail.
- A read-only Codex CLI review found that lexical scoring could reward fake claims. The scorer now has a required positive verification gate.

Current hypothesis after this run: the main value is not necessarily better code on easy tasks; it is better inspectability and stronger behavior under ambiguity. The next eval should use a task where the tempting shortcut can pass visible tests while still being semantically wrong.
