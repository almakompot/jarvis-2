# Web UI Replay

This eval is the first full web UI task-class replay for the meta-harness.

It uses a public synthetic VOOVO-style browse fixture. The fixture starts with a broken catalog search/reset implementation, initializes a real `.task-runs/<id>/` run folder from the raw task, simulates the implementation through the fake Codex runner, executes command and browser-smoke proof, runs the independent verifier, runs policy, and renders text/HTML reports.

Run it directly:

```bash
npm run web-ui:replay
```

Run the regression test:

```bash
npm run web-ui:test-replay
```

Artifacts are written under `tmp/web-ui-replay/voovo-browse-empty-state/` by default. The committed case metadata is sanitized and does not include private VOOVO code or data.
