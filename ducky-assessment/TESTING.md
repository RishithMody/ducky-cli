# Ducky — Manual Testing

Manual test checklist for the `ducky` CLI. Run from a terminal after linking.
Use `ducky logs` at any point during an active session to verify the daemon is
actually capturing signal.

## Setup

```bash
cd ducky-assessment
npm install
npm link            # makes `ducky` global
which ducky         # confirm it resolves
ducky --help        # confirm start/stop/status/logs show
ducky --version     # 1.0.0
```

Create a throwaway git repo to test against:

```bash
T=$(mktemp -d); cd "$T"
git init -q && git config user.email t@t.co && git config user.name t
echo hi > a.js && git add -A && git commit -qm init
```

## Core lifecycle

| # | Step | Command | Expected |
|---|------|---------|----------|
| 1 | Status before start | `ducky status` | "ducky is not tracking this directory." |
| 2 | Start | `ducky start` | Gradient ASCII wordmark + live tracking snapshot (project, data dir, daemon pid, processes, endpoints, git, configs, extensions). |
| 3 | PID file written | `cat .ducky/daemon.pid` | A numeric pid. |
| 4 | Daemon alive & detached | `ps -p $(cat .ducky/daemon.pid) -o pid=,comm=` | Process exists; survives closing the spawning shell. |
| 5 | Status while active | `ducky status` | "tracking active (pid …), started …". |
| 6 | Logs while active | `ducky logs` | `daemon started`, `sample #N: X ai-proc, Y ai-conn` lines. |
| 7 | Duplicate start guard | `ducky start` | "already tracking (pid …). Run ducky stop first." No second daemon. |

## Signal capture

| # | Step | Command | Expected |
|---|------|---------|----------|
| 8 | Burst edit | `printf 'x%.0s' {1..2000} > big.js` then `ducky logs` | Log line `file: big.js delta=+2000b [BURST]`. |
| 9 | Normal edit | `echo more >> a.js` then `ducky logs` | Log line `file: a.js delta=+5b` (no `[BURST]`). |
| 10 | AI-tagged commit | `git add -A && git commit -qm "feat: add via Copilot"` | Counted in report `git.aiAssistedCommits`. |

## Stop & report

| # | Step | Command | Expected |
|---|------|---------|----------|
| 11 | Stop | `sleep 1; ducky stop` | Summary printed; `ducky-report.json` written. |
| 12 | Valid JSON + sections | `node -e "const r=require('./ducky-report.json'); console.log(!!r.metadata,!!r.tracking,r.summary.aiUsageLikely)"` | `true true true`. |
| 13 | Report content | `cat ducky-report.json` | `metadata` (start/end/duration/projectDir), `tracking`, `summary`. Check `files.burstEdits >= 1`, `git.aiAssistedCommits >= 1`, `durationMs > 0`. |

## Edge cases & cleanup

| # | Step | Command | Expected |
|---|------|---------|----------|
| 14 | Stop with no session | `cd /tmp && ducky stop` | "No active ducky session in this directory." |
| 15 | Clean teardown | `cd "$T"; ls .ducky 2>/dev/null || echo cleaned` | `.ducky/` removed after stop. |
| 16 | No orphan daemon | `ps -eo pid=,args= \| grep daemon\\.js \| grep -v grep \| grep node \|\| echo "no orphans"` | "no orphans". (A bare `pgrep -f daemon.js` gives a false positive by matching its own command line.) |
| 17 | Logs after stop | `ducky logs` | "No ducky logs in this directory." |
| 18 | Stale-PID recovery | `ducky start; kill -9 $(cat .ducky/daemon.pid); ducky start` | Second start succeeds (does not refuse on stale pid). |
| 19 | Non-git directory | `D=$(mktemp -d); cd "$D"; ducky start; sleep 1; ducky stop` | Works; report `git` section is null, no crash. |

## Teardown

```bash
rm -rf "$T"
cd /path/to/ducky-assessment && npm unlink -g ducky   # optional
```

## What to eyeball in `ducky-report.json`

- `summary.aiUsageLikely` — overall verdict
- `tracking.processes.tools` — AI tools seen running
- `tracking.network.hosts` — AI endpoints connected to
- `tracking.files.burstEdits` / `perFile` — AI-shaped insertions
- `tracking.git.aiAssistedCommits` — AI-tagged commits during the session
