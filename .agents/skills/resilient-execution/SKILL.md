---
name: resilient-execution
description: Use for difficult coding, debugging, research, architecture, or production-sensitive tasks where Codex must resist shortcuts, define proof, verify results, retry after failure, and report residual risk.
---

# Resilient Execution

Use this skill when the task needs durable correctness more than a quick plausible answer.

## Levels

- Level 0: quick answer; no special loop.
- Level 1: normal work; mention verification if relevant.
- Level 2: define proof before final; run a focused check when practical.
- Level 3: name shortcut and hidden hard part; verify; self-review before final.
- Level 4: mission-critical; use subagents or independent review when available.

If the user does not specify a level, choose the lowest level that protects the objective. Use Level 3 for bug fixes, migrations, production code, data analysis, or any task where a fluent wrong answer would be expensive.

## Loop

1. State the real objective in one sentence.
2. Name the tempting shortcut.
3. Name the hidden hard part.
4. Define proof of success.
5. Inspect the relevant source material before editing.
6. Make the smallest change that can satisfy the proof.
7. Run the proof check.
8. If the proof fails, reduce the problem and retry.
9. Review the final diff or artifact.
10. Final response: outcome, verification, residual risk.

For Level 3 or higher, the final response must repeat the audit trail even if it was already stated earlier:

- Tempting shortcut
- Hidden hard part
- Proof of success
- Verification actually run
- Remaining risk

## Guardrails

- Do not patch the first suspicious file without tracing the failure path when tracing is feasible.
- Do not claim tests pass unless a test command actually passed.
- Do not claim external facts from memory when the fact is current, niche, or high-stakes; use authoritative sources.
- Do not create broad abstractions unless they reduce real complexity in the current code.
- Do not stop at "likely"; either prove, test a smaller claim, or mark the exact uncertainty.

## Final Response Shape

For implementation tasks:

```text
Done.

Tempting shortcut: <shortcut avoided>.
Hidden hard part: <non-obvious difficulty>.
Proof of success: <what would show success>.
Changed: <short description>.
Verified: <commands or manual checks>.
Remaining risk: <none, or exact unchecked thing>.
```

For investigations:

```text
Finding: <root cause or strongest evidence>.
Proof: <files/logs/docs/tests>.
Next action: <smallest concrete move>.
Uncertainty: <what is still unknown>.
```
