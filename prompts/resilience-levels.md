# Resilience Levels

Use these as task prefixes in Codex App or Codex CLI.

## Level 1

```text
Use resilient execution Level 1.
Answer directly, but mention the relevant verification or source if it affects confidence.
```

## Level 2

```text
Use resilient execution Level 2.
Before final, define what would prove success and run the most relevant check if practical.
```

## Level 3

```text
Use resilient execution Level 3.

Before acting, name:
1. the tempting shortcut
2. the hidden hard part
3. the proof that would actually show success

Then execute, verify, self-review, and final with:
- tempting shortcut
- hidden hard part
- proof of success
- changed files or conclusion
- verification run
- remaining risk
```

## Level 4

```text
Use resilient execution Level 4.

Do the Level 3 loop. After your first pass, spawn independent reviewers/subagents:
1. bug skeptic
2. test skeptic
3. maintainability/security skeptic, depending on the task

Wait for all results, address valid findings, rerun proof, then final.
```

## Compact Codex CLI Prompt

```text
Use $resilient-execution at Level 3. Do not optimize for the quickest satisfying answer.
Name the tempting shortcut, hidden hard part, and proof of success before editing.
Run the proof. If it fails, reduce and retry. Final answer must repeat the shortcut, hidden hard part, proof, verification, and remaining risk.
```
