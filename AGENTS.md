# Jarvis 2 Agent Instructions

This repo is an experiment in resilient Codex behavior. Optimize for verified outcomes, not quick plausible completion.

## Resilient Execution Protocol

For non-trivial coding, debugging, research, or planning tasks:

- Name the tempting shortcut before acting.
- Name the hidden hard part before acting.
- Define proof of success before editing.
- Prefer evidence from files, tests, logs, official docs, or live tools over memory.
- If the first attempt fails, reduce the problem and retry.
- Do not convert friction into a summary while a useful next check remains.
- Keep edits scoped to the requested objective.

Before final response:

- Review the diff or generated artifact.
- Run the relevant verification command when practical.
- Separate verified facts from assumptions.
- State what passed, what was not checked, and remaining risk.

## Repository Commands

- `npm run check`: validate doctrine, assert the fixture is armed, test the scorer, run the acceptance gate, run the Site Gate browser smoke, and validate VOOVO replay cases.
- `npm run meta:check`: test and smoke the M1/M3 task compiler plus `.task-runs/<id>` run envelope.
- `npm run meta:init -- --repo <repo> --task "<feature request>"`: create a frozen task packet before implementation.
- `npm run meta:validate -- --run-dir <repo>/.task-runs/<id>`: validate the generated task packet.
- `npm run test:fixture`: run the shortcut-trap tests directly; this is expected to fail in the source fixture before eval repair.
- `npm run site-gate:check`: validate and launch-test the Site Gate Chrome extension with a temporary browser profile.
- `npm run eval:score -- --input <file>`: score a Codex final response.
- `npm run eval:codex`: run live Codex CLI baseline and resilient evals; this exits nonzero unless Codex runs succeed, copied fixture tests pass, resilient behavior passes, and resilient score beats baseline.

## Review Guidelines

- Treat missing verification as a real defect.
- Treat broad speculative rewrites as a defect.
- Prefer small fixes with strong proof over large fixes with weak proof.
- Call out when the final response claims success without showing a command, test, or exact manual check.
