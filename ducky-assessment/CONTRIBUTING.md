# Contributing

Contributions are welcome. This document covers how to get set up, what the codebase looks like, and what makes a good pull request.

---

## Getting started

```sh
git clone https://github.com/your-username/ducky.git
cd ducky
npm install
node src/index.js --help
```

No build step. The source runs directly with Node.js 18+.

---

## Project structure

```
src/
  index.js      CLI entry point, command definitions and handlers
  daemon.js     Detached background process, samples signals on an interval
  trackers.js   All signal collection: processes, network, git, extensions, artifacts
  report.js     Aggregates events into ducky-report.json
  live.js       Foreground real-time dashboard
  watcher.js    fs.watch wrapper with byte-delta tracking
  state.js      Path resolution, session/event I/O, runtime cleanup
  art.js        ASCII wordmark and terminal colour helpers
```

The daemon writes raw events to `.ducky/events.jsonl`. The report aggregates them at `stop` time. The live view reads the same signals independently without touching the event log.

---

## Adding a tool

All tool detection runs through one regex in `src/trackers.js`:

```js
const AI = /(copilot|cursor|claude|...)/i;
```

Add the tool name to the alternation. It is automatically picked up by process scanning, network host matching, and extension scanning.

Config file markers (`.cursor`, `CLAUDE.md`, etc.) live in the `CONFIG_MARKERS` array in the same file.

---

## Pull request guidelines

- Keep changes focused. One concern per PR.
- If you add a new signal source, add it to the `tracking` section of the report and document it in the README signals table.
- Do not introduce new runtime dependencies without discussion. The current dependency count is intentionally minimal (one: `commander`).
- Match the existing code style: ES modules, no semicolons at end of one-liners, section comments (`// ─── Section ───`).
- Test manually: `ducky start`, do some work, `ducky stop`, inspect the report.

---

## Reporting issues

Open an issue at https://github.com/your-username/ducky/issues. Include:

- OS and Node.js version
- The command you ran
- What you expected vs. what happened
- The contents of `.ducky/daemon.log` if the daemon is involved
