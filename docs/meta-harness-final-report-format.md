# Meta-Harness Final Report Format

The final report is the user-facing rendering of the run folder. It explains the result, but it is not the source of truth. `policy-decision.json`, `verification.json`, `verifier-report.json`, and evidence artifacts are authoritative.

## Required Inputs

`meta report` requires these artifacts:

```text
spec.json
proof-plan.json
verification.json
verifier-report.json
policy-decision.json
final-report.json
command-log.jsonl
changed-files.json
diff.patch
```

If any are missing, report rendering must fail rather than invent a summary.

## Text Report Sections

The text report must use this order:

```text
Findings:
Decision:
Blocking reason:
Run:
Task:
Policy rules:
Passed commands:
Failed commands:
Missing proof:
Evidence:
Residual risk:
Next action:
```

Findings come first so rejected and blocked runs are not buried below useful-looking summaries.

## Section Meaning

`Findings` lists active policy rules first. If no active policy rule exists, it lists blocking or major verifier findings. Accepted runs may show `none`.

`Decision` is copied from `policy-decision.json`. Valid values are `accepted`, `rejected`, or `blocked`.

`Blocking reason` is `none` only for accepted runs. Rejected and blocked runs use the policy decision reason.

`Policy rules` lists active non-overridden rules. Overridden rules remain in `policy-decision.json` but should not be presented as active blockers.

`Passed commands` and `Failed commands` come from `verification.json` command records and include command IDs, command text, status, exit code, and stdout path where available.

`Missing proof` lists non-passing proof obligations with accepted evidence types.

`Evidence` lists evidence IDs, type, status, and artifact paths. Evidence paths must point into the run folder or to normalized artifact references.

`Residual risk` comes from `final-report.json`. Accepted nontrivial runs must keep risk visible.

`Next action` names the next actor and action. For `accepted`, archive the artifacts and hand off residual risk. For `rejected`, the default actor is the agent/harness repair loop unless the report says otherwise. For `blocked`, the next actor is the user/operator because an external condition or approval is required.

Blocked CLI commands exit `3`. On macOS they show a timed error popup and write `blocked-notification.json` with the blocker and resume command.

Accepted `meta verify` commands exit `0`. On macOS they show a timed completion popup and write `completion-notification.json` with the report command.

## HTML Report

The HTML report is written by:

```bash
npm run meta -- report --run /path/to/.task-runs/<id> --format html
```

Default output:

```text
.task-runs/<id>/html-report/index.html
```

The HTML report must include evidence links and the text report content. It must not replace JSON artifacts.

## Accepted Example

```text
Findings:
- none
Decision: accepted
Blocking reason: none
Policy rules:
- none active
Passed commands:
- cmd.verify.0001 npm run test (passed, exit 0) stdout evidence/commands/cmd.verify.0001.stdout.txt
Failed commands:
- none
Missing proof:
- none
Evidence:
- E.cmd.verify.0001 test-command passed -> evidence/commands/cmd.verify.0001.stdout.txt
Residual risk:
- Local fixture data was used.
Next action:
- Archive the run artifacts and keep residual risk visible in handoff notes.
```

## Rejected Example

```text
Findings:
- [blocking] POL-UI-001: web-ui tasks require passing runnable-surface evidence.
Decision: rejected
Blocking reason: web-ui tasks require passing runnable-surface evidence.
Missing proof:
- P3 pending: Browser smoke proves the requested reset behavior. (browser-smoke)
Next action:
- Agent/harness repair: add the missing proof evidence, then run `meta verify --run <run-dir>` again.
```

## Blocked Example

```text
Findings:
- [blocking] POL-BLOCKED-001: Runner state is blocked.
Decision: blocked
Blocking reason: Runner state is blocked.
Next action:
- User/operator: resolve the blocking condition, then run `meta verify --run <run-dir>` again.
```

## Final Answer Contract

When reporting to a user after a meta-harness run:

- Say `accepted`, `rejected`, or `blocked`.
- Cite the run folder and the report path.
- Name failed commands or missing proof before describing useful work.
- For accepted runs, include residual risk.
- Do not claim completion if `policy-decision.json` is not accepted.
