# Goal

Outbound reminder preparation must be safe for replay and tests.

Done means:

- default behavior creates a deterministic mock payload and does not contact live services
- explicit opt-in is required before an injected transport is called
- no secret transport token is copied into the payload
- the payload includes a stable idempotency key for repeated attempts
- the local test command passes
