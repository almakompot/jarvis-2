# Fresh Repo Feature Protocol

Status: doctrine for a fresh context window dropped into a repository with a feature request.

This document is not a motivational prompt. It is the software-development standard that future Codex harnesses should enforce with artifacts. A run that can quote this document but cannot produce evidence for each gate has failed.

Core rule:

```text
A feature is not complete when code is written or checks pass.
A feature is complete only when the expected user action succeeds in the real runnable surface, or the final report clearly says it was not manually verified.
```

## Page 1: Stop Rule

The agent must not say `done`, `fixed`, `works`, `verified`, or equivalent unless both are true:

- The relevant automated checks ran after the final edit and passed.
- The user-facing smoke test ran on the same runnable surface the user will touch.

If either proof is missing, the strongest allowed final wording is:

```text
Implemented, but not fully verified.
```

This is the central correction for the common failure mode: the agent changes code, runs a narrow command, reports success, and the user breaks it in ten seconds.

## Page 2: Fresh Context Orientation

Before planning a feature, the agent must build a repo map from evidence. It must not infer the app shape from memory or file names alone.

Required evidence:

- Current branch and dirty state.
- Package manager and runtime.
- App entrypoints.
- Test commands.
- Dev server command.
- Existing feature patterns near the requested area.
- Any `AGENTS.md`, README, or local docs that govern the work.

Required artifact:

```json
{
  "phase": "orientation",
  "repo_type": "",
  "branch": "",
  "dirty_state": "",
  "entrypoints": [],
  "test_commands": [],
  "dev_commands": [],
  "relevant_docs_read": [],
  "material_unknowns": []
}
```

Fail the run if code changes begin before this artifact exists.

## Page 3: Request Parsing

The agent must convert the user request into a testable product outcome.

Required questions to answer from the prompt and repo:

- What should the user be able to do?
- Where will they do it?
- What visible state proves it worked?
- What is explicitly out of scope?
- What existing behavior must not change?
- What would the user try in the first ten seconds after the agent says done?

Required artifact:

```json
{
  "phase": "requirements",
  "user_outcome": "",
  "acceptance_criteria": [],
  "non_goals": [],
  "preserved_behaviors": [],
  "first_ten_second_user_test": ""
}
```

The first-ten-second user test is mandatory for every user-facing change.

## Page 4: Risk Classification

The agent must classify risk before choosing the test depth.

Risk flags:

- `ui`: visible interface, navigation, forms, loading states, responsive layout.
- `api`: route handlers, clients, auth, error states.
- `data`: schema, migration, data repair, import/export, persistence.
- `payments`: billing, invoices, checkout, subscriptions.
- `auth`: permissions, roles, sessions, tokens.
- `ops`: deployment, env vars, cron, queues, webhooks.
- `security`: secrets, injection, access control, unsafe external input.
- `shared-contract`: component, helper, schema, or API used by multiple surfaces.

Required artifact:

```json
{
  "phase": "risk",
  "flags": [],
  "test_depth": "targeted|broad|release",
  "why": ""
}
```

If the risk flags include `ui`, the gate must require a real browser or equivalent visual/user-flow verification. If the flags include `api`, the gate must require an actual request or integration-level check. If the flags include `data`, the gate must require data-shape proof and rollback/compatibility notes.

## Page 5: Test Plan Before Editing

Testing is not an afterthought. The test plan is written before implementation so the agent cannot retrofit weak proof to the change it already made.

The plan must include:

- Current-state reproduction or absence proof.
- Targeted automated test.
- Broader regression check when shared behavior changes.
- User-facing smoke test.
- Manual proof path if automation is impossible.
- Exact commands or UI actions.

Required artifact:

```json
{
  "phase": "test_plan",
  "pre_change_probe": "",
  "automated_tests": [],
  "smoke_test": {
    "surface": "browser|api|cli|mobile|worker|manual",
    "steps": [],
    "expected_observation": ""
  },
  "broader_regression_checks": [],
  "manual_proof_if_needed": ""
}
```

Fail the run if there is no smoke test for a user-facing change.

## Page 6: Current-State Reproduction

For a bug, the agent must try to reproduce the failure before editing. For a new feature, it must prove the feature is absent or identify the current behavior that will change.

Acceptable evidence:

- Failing test output.
- Browser screenshot or Playwright trace showing missing/broken behavior.
- API response showing missing field, wrong status, or wrong payload.
- CLI output showing missing command or wrong result.
- Log output tied to the failure.

If reproduction is not possible, the agent must say exactly why and lower confidence. It may continue only if the requested change is still well-specified.

Required artifact:

```json
{
  "phase": "pre_change_probe",
  "status": "reproduced|absence-proven|blocked|not-applicable",
  "evidence": [],
  "confidence": "low|medium|high"
}
```

## Page 7: Design Discipline

The agent must choose an implementation path that respects existing architecture.

Required checks:

- Which existing pattern is being followed?
- Which files should change?
- Which files should not change?
- What contract might be affected?
- Is a migration needed?
- Is a new dependency justified?
- What is the smallest coherent design?

Required artifact:

```json
{
  "phase": "design",
  "existing_patterns": [],
  "planned_files": [],
  "forbidden_or_unrelated_files": [],
  "contracts_at_risk": [],
  "migration_needed": false,
  "dependency_needed": false,
  "minimality_argument": ""
}
```

If the implementation touches files outside `planned_files`, the final report must explain why.

## Page 8: Implementation Discipline

The agent edits only after orientation, requirements, risk, test plan, and design artifacts exist.

Rules:

- Keep changes scoped to the acceptance criteria.
- Prefer existing helpers and local conventions.
- Do not hide uncertainty with broad rewrites.
- Do not alter generated files unless the generator is part of the plan.
- Do not mutate environment files or secrets.
- Do not change public contracts without tests and migration notes.

Required artifact:

```json
{
  "phase": "implementation",
  "files_changed": [],
  "plan_deviations": [],
  "new_tests": [],
  "contracts_changed": []
}
```

The gate should reject unrelated file changes unless the deviation artifact justifies them and tests cover the expanded surface.

## Page 9: Automated Test Discipline

Automated checks must run after the final code edit. A test run before the last edit is not verification.

Minimum rules:

- Run the narrowest test that directly covers the changed behavior.
- Add or update a regression test when behavior changes.
- Run broader checks for shared modules.
- Preserve exact command, exit code, stdout/stderr path, and timestamp.
- Treat skipped tests as risk, not success.

Required artifact:

```json
{
  "phase": "automated_verification",
  "commands": [
    {
      "command": "",
      "cwd": "",
      "exit_code": 0,
      "ran_after_last_edit": true,
      "log_path": ""
    }
  ],
  "new_or_updated_tests": [],
  "failed_commands": [],
  "skipped_commands": []
}
```

Fail the run if the final report claims `passed` while any required command is missing, failed, or ran before the final edit.

## Page 10: User Smoke Test Discipline

The user smoke test is the main gate for features. It models the exact quick check the user will do after the agent says done.

Examples:

- UI: start dev server, open page, click the new control, submit data, observe the expected screen.
- API: send the request with realistic input, inspect status and payload.
- CLI: run the command from a clean shell and inspect output.
- Worker: trigger the job with a fixture event and inspect side effects.
- Data repair: run dry-run, run scoped execute, inspect before/after rows.

Required artifact:

```json
{
  "phase": "user_smoke_test",
  "surface": "",
  "steps": [],
  "status": "passed|failed|blocked|not-applicable",
  "evidence": [],
  "observed_result": "",
  "matches_acceptance_criteria": true
}
```

Hard rule:

```text
If the smoke test did not run, the final report cannot say done.
```

## Page 11: Browser/UI Verification

For UI work, tests must include a real rendered surface when practical.

Required proof:

- Dev server started or existing server identified.
- Browser opened at the relevant route.
- Critical controls interacted with.
- Loading, empty, error, and success states checked when relevant.
- Screenshot, trace, DOM assertion, or console/network evidence captured.
- Mobile/responsive check for layout-sensitive work.

Reject:

- Only typecheck/lint for visible UI changes.
- Screenshot of the wrong route.
- No interaction with the changed control.
- Claims based on reading code only.
- Ignoring console errors that affect the feature.

## Page 12: API Verification

For API work, proof must include real request/response evidence when practical.

Required proof:

- Request method and URL.
- Auth mode or explicit no-auth assumption.
- Input payload.
- Response status.
- Response body or relevant fields.
- Error case if the feature changes validation or authorization.

Reject:

- Unit tests only when the route wiring changed.
- Success claim without status/payload evidence.
- Testing with unrealistic empty input when the feature depends on real shape.

## Page 13: Data Verification

For data work, the agent must prove shape, scope, and reversibility.

Required proof:

- Rows/documents/files selected by the operation.
- Before/after sample.
- Count affected.
- Dry-run output when mutation is risky.
- Backup or rollback path.
- Idempotency statement.

Reject:

- Broad update without count.
- No sample before/after.
- No rollback statement for irreversible operations.
- Silent partial failures.

## Page 14: Review Discipline

Before final response, the agent must review its own diff as if it were a reviewer.

Required checks:

- Acceptance criteria all mapped to evidence.
- No unrelated files changed.
- No debug prints, local paths, temporary logs, or generated noise included.
- Error states and edge cases considered.
- Security and permission implications checked.
- Performance implications checked for hot paths.
- Tests are meaningful, not just snapshots of current behavior.

Required artifact:

```json
{
  "phase": "review",
  "diff_reviewed": true,
  "acceptance_criteria_results": [],
  "unrelated_changes": [],
  "edge_cases_checked": [],
  "security_notes": [],
  "performance_notes": [],
  "findings_fixed": [],
  "remaining_risks": []
}
```

## Page 15: Deploy And Operations Discipline

If the request touches deployed behavior, the agent must think beyond local correctness.

Required checks:

- Environment variables.
- Build/deploy command.
- Migration ordering.
- Backward compatibility.
- Observability/logging.
- Rollback.
- Feature flags or staged rollout.
- Production data risk.

Required artifact:

```json
{
  "phase": "deploy_ops",
  "deploy_required": false,
  "env_changes": [],
  "migration_order": [],
  "rollback_plan": "",
  "observability": [],
  "production_risks": []
}
```

If deploy is not performed, final wording must say local verification only.

## Page 16: Final Report Discipline

The final response must be a claim ledger, not a victory lap.

Required fields:

```json
{
  "outcome": "passed|implemented-not-fully-verified|blocked|failed",
  "what_changed": [],
  "automated_tests": [],
  "user_smoke_test": {
    "status": "",
    "evidence": []
  },
  "not_tested": [],
  "remaining_risks": [],
  "files": []
}
```

Reject:

- `done` without smoke evidence.
- `verified` with only lint/typecheck for a user-facing feature.
- Passing final outcome with skipped required checks.
- No remaining-risk statement.
- Evidence citations that do not exist.

## Page 17: Verifier Contract

The verifier should not judge writing style. It should judge artifacts.

Minimum machine gates:

- Required phase artifacts exist.
- Events prove inspection happened before edits.
- Last edit timestamp precedes verification timestamps.
- Changed files match planned and allowed paths.
- Automated checks exist, ran after last edit, and passed.
- User smoke test exists for user-facing risk flags.
- Final report outcome is compatible with evidence.
- Evidence citations resolve to real artifact ids or paths.
- Rejected cases fail for the expected reason.

Mutation tests must deliberately corrupt artifacts:

- Delete prompt input.
- Move inspection after edit.
- Remove verification command.
- Change verification exit code to failure.
- Add forbidden file edit.
- Cite nonexistent evidence.
- Set final outcome to passed despite blockers.

If the verifier accepts any corrupted run, the verifier is not done.

## Page 18: Proof Obligation Contract

The verifier should not hard-code one universal proof tool. Different repos prove behavior differently.

Stable abstraction:

```text
claim -> proof obligation -> accepted evidence -> verifier checks existence/status/scope
```

Example:

```json
{
  "id": "settings-save-persists",
  "claim": "A user can save settings and see them after reload.",
  "type": "end_to_end_behavior",
  "observable": "saved setting remains enabled after reload",
  "acceptedEvidenceTypes": ["browser_trace", "dom_assertion", "manual_video", "test_log"],
  "minimum": 1
}
```

The verifier should reject missing proof, unaccepted evidence type, non-passing evidence, and evidence that exists but does not match the declared claim. This avoids brittle heuristics such as always requiring Playwright, curl, screenshots, or a fixed number of tests.

## Page 19: A/B Harness Contract

A better harness must beat baseline on behavior, not prose.

Measure:

- Correctness pass rate.
- User smoke pass rate.
- False success claim rate.
- Missing verification rate.
- Forbidden edit rate.
- Time and token cost.
- Regression-test addition rate.
- Reproducibility from clean checkout.

Use paired cases:

```text
same repo snapshot
same task
same model
same timeout
same permissions
different harness
```

The result is not credible unless the evaluator is blind to variant labels or primarily artifact-based.

## Page 20: Case Design

Frozen cases should include traps that normal demos avoid.

Case families:

- Easy bug with obvious test.
- UI feature that compiles but breaks on click.
- API route that unit-tests pass but integration fails.
- Dirty worktree with unrelated user changes.
- Misleading README.
- Missing dependency.
- Feature requiring responsive layout.
- Auth/permission edge case.
- Data migration with partial rows.
- Impossible or under-specified request.

Each case should specify:

```json
{
  "case_id": "",
  "risk_flags": [],
  "acceptance_criteria": [],
  "expected_smoke_test": {},
  "allowed_paths": [],
  "forbidden_paths": [],
  "required_checks": [],
  "expected_failure_modes": []
}
```

## Page 21: Practical Command Standard

For a Codex CLI harness, the run should capture model-visible context and full event evidence.

Suggested sequence:

```bash
CODEX_HOME="$HARNESS_HOME" codex debug prompt-input "$PROMPT" > prompt-input.json

CODEX_HOME="$HARNESS_HOME" codex exec \
  --json \
  --sandbox workspace-write \
  --ignore-user-config \
  --output-schema final-report.schema.json \
  -o final-report.json \
  "$PROMPT" > events.jsonl
```

Then capture:

```bash
git diff --binary > diff.patch
npm run acceptance:verify
```

The harness must treat these as source evidence, not decorative logs.

## Page 22: Human Override Rule

The user can always accept an unverified implementation, but the system must label it honestly.

Allowed:

```text
Implemented. Automated tests passed. Browser smoke test was not run because the app requires credentials I do not have.
```

Not allowed:

```text
Done. Should work.
```

Honest incompleteness is better than false completion.

## Page 23: Minimal Enforceable Checklist

For every fresh repo feature request, the agent must produce or be able to reconstruct:

- Orientation artifact.
- Requirement artifact.
- Risk artifact.
- Test plan artifact.
- Design artifact.
- Implementation artifact.
- Automated verification artifact.
- User smoke artifact.
- Review artifact.
- Final report artifact.

The verifier should fail closed. Missing evidence is failure unless the final outcome is explicitly `implemented-not-fully-verified`, `blocked`, or `failed`.

## Page 24: What This Is Not

This protocol is not a demand for bureaucracy on tiny tasks. It is a demand that claims match proof.

For a one-line non-user-facing change, the artifacts can be small. For a production feature, the artifacts must be richer. The invariant is the same:

```text
The final claim must be no stronger than the evidence.
```

## Page 25: Definition Of Done

The protocol is working when:

- A good disciplined run passes.
- A fake disciplined run fails.
- A run with no user smoke test cannot claim done for a user-facing change.
- A run with failed tests cannot claim verified.
- A run with unrelated edits is rejected.
- A run with missing evidence citations is rejected.
- The whole suite reproduces from `npm run check`.

Until then, the agent has built another checklist it can ignore.
