# Non-Web Replay

This eval proves the meta-harness beyond web and extension tasks with a local data-pipeline task class.

It creates a synthetic Hungarian old-doc OCR fixture repo, initializes real `.task-runs/<id>/` folders from the raw task, runs the fake Codex handoff, invokes the actual local pipeline CLI through npm scripts, validates invalid-input behavior, checks generated artifacts through manifest value and content assertions, runs the independent verifier, applies policy, and renders reports.

The runner also creates a weak-artifact false-pass replay. That run writes output files and a manifest, but the searchable text-layer content is wrong; the data surface executor must reject it rather than accepting file existence.

Run it directly:

```bash
npm run non-web:replay
```

Run the regression test:

```bash
npm run non-web:test-replay
```

Artifacts are written under `tmp/non-web-replay/hungarian-ocr-pipeline/` by default.
