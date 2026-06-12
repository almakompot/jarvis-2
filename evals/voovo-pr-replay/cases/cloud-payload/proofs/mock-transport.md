# Mock Transport Proof

This is a synthetic proof artifact. The fixture has no live transport dependency.

Expected behavior:

- `queueReminder(input, fakeTransport)` does not call `fakeTransport.send` by default.
- `queueReminder({ ...input, allowSend: true }, fakeTransport)` calls the injected fake transport once.
- The payload marks default runs as `dryRun: true`.
- The payload does not include a secret transport token.
