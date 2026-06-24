# Browser Extension Replay

This eval is the first full browser-extension task-class replay for the meta-harness.

It copies the public Site Gate extension into an isolated temporary repo, initializes real `.task-runs/<id>/` folders from the raw task, simulates the implementation handoff through the fake Codex runner, runs manifest validation and unpacked-extension CDP smoke, validates the smoke scenario through the surface executor, runs the independent verifier, runs policy, and renders text/HTML reports.

The runner also creates a syntax-only false-pass replay. That run intentionally claims completion after `node --check` style proof without extension smoke; policy must reject it.

Run it directly:

```bash
npm run browser-extension:replay
```

Run the regression test:

```bash
npm run browser-extension:test-replay
```

Artifacts are written under `tmp/browser-extension-replay/site-gate-extension/` by default.
