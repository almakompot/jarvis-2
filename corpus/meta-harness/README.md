# Meta-Harness Failure Corpus

This corpus stores minimized, replayable cases for the meta-harness verifier and policy engine.

Case layout:

```text
corpus/meta-harness/<category>/<case-id>/
  README.md
  case.json
  input/task.md
  expected/policy-decision.json
  mutation.json
```

Committed cases must be `public-synthetic`, `sanitized: true`, `containsPrivateData: false`, and `allowedForCommit: true`.

Replay:

```bash
npm run meta:corpus
```

Promotion from a rejected local run creates a private-staging skeleton:

```bash
npm run meta:promote-failure -- --run-dir /path/to/.task-runs/<id> --category missing-smoke --case-id browse-reset
```

Promotion intentionally does not copy full run artifacts. Minimize and sanitize before committing a promoted case.
