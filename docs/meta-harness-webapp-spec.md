# Meta-Harness Web App Spec

`jarvis-harness web` is the local operator surface for starting and finding harness runs. It is a minimalist wrapper around the same file-backed run artifacts used by the CLI.

## Scope

- Local-only HTTP server bound to `127.0.0.1` by default.
- No database, no queue service, and no remote auth.
- No mobile layout.
- Main page lists discovered `.task-runs` folders and starts new runs.
- Each run opens on its own `/runs/<token>` page using the existing dashboard detail view.
- JSON artifacts remain authoritative. The web app is a convenience surface, not a separate state store.

## Command

```bash
jarvis-harness web [--root /path/to/projects] [--port 4817] [--no-open]
```

`--root` can be repeated. When omitted, the app scans conservative local defaults, including the current working directory when useful and `~/Documents/Jarvis/Projects` when present.

## Main Page

The main page must stay operational and plain:

- doctor status
- scan roots
- start-run form with repo path, task, optional run id, and mode
- active/recent run table with operator status, run id, task, repo, and updated time
- links to per-run detail pages

Starting a run through the web app must create the normal target-repo folder:

```text
/path/to/repo/.task-runs/<id>/
```

Mode `run now` starts the same runner path as `jarvis-harness run`. Mode `init only` creates the packet and opens the run detail page without starting Codex.

## Routes

```text
GET  /
GET  /api/doctor
GET  /api/runs
POST /api/runs
GET  /runs/<token>
GET  /api/run/<token>/summary
GET  /api/run/<token>/events
GET  /api/run/<token>/output
GET  /api/run/<token>/artifact?path=<artifact>
```

Run tokens encode absolute run-directory paths, but the server must reject tokens that do not point at a real `.task-runs/<id>` directory. Artifact reads must reuse the dashboard artifact guard and reject path traversal, `.env*`, `.git`, private keys, service-account files, and secret transcript paths.

## Verification

Required focused checks:

```bash
node --test meta-harness/scripts/webapp.test.mjs meta-harness/scripts/dashboard.test.mjs meta-harness/scripts/meta-cli.test.mjs
npm run meta:final-audit
npm run doctrine:validate
git diff --check
npm run check
```
