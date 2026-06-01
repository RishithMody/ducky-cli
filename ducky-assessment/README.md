# ducky

Passive AI usage tracker for software projects.

`ducky` runs a background daemon that watches your project for signals of AI coding-tool usage — running processes, network connections, file edit patterns, git commits, and local AI session logs. When you stop a session it writes a structured `ducky-report.json`. A live dashboard shows the same signals in real time.

All data stays local. No telemetry, no network calls, no accounts.

---

## Installation

```sh
npm install -g ducky
```

Requires Node.js 18 or later. Linux only (uses `ps` and `ss`).

---

## Usage

```
ducky start    begin tracking the current directory
ducky stop     stop tracking, write ducky-report.json, print summary
ducky status   check whether a session is active
ducky live     real-time dashboard (run in a separate terminal)
ducky logs     print the daemon log for the current session
ducky diff     show which files changed most (--ai filters to AI-shaped edits)
```

### Typical workflow

```sh
cd my-project
ducky start

# ... work normally ...

ducky stop
```

`ducky-report.json` is written to the project root. The `diff` command reads it:

```sh
ducky diff          # all changed files, sorted by bytes added
ducky diff --ai     # only files with burst edits or high burstiness
```

---

## How it works

No single trace proves AI usage. ducky correlates several independent signals:

**Processes** — AI assistants run as identifiable processes (Copilot LSP, Cursor, Claude, aider, ollama, etc.). Sampled every 15 seconds via `ps`.

**Network** — Persistent TCP connections to known AI inference endpoints, identified via reverse DNS. Catches browser-based assistants that the process scan misses.

**File edits** — Humans type incrementally; AI inserts large blocks at once. A single change above 800 bytes is flagged as a burst edit, a proxy for an AI paste or accept. Tracked via `fs.watch` with byte-delta accounting.

**Edit velocity** — Inter-save intervals per file yield a burstiness score: `(sd - mean) / (sd + mean)`. Clustered saves followed by long gaps trend toward 1; steady human cadence trends toward 0.

**Git** — Commits made during the session are scanned for AI signals: tool mentions in the message, overused AI phrasing (comprehensive, robust, seamless, ...), and `Co-authored-by` bot trailers. The bot trailer is ground truth, not heuristic.

**AI session artifacts** — Local plaintext logs that prove invocation: aider (`.aider.chat.history.md`), Claude Code (`~/.claude/projects`), Shell-GPT, and Copilot language-server logs. Growth across the session ties usage to the window.

**Environment** — AI config files (`.cursor`, `CLAUDE.md`, `.kiro`, etc.) and installed editor extensions, surfacing tools that are present but idle.

---

## Output

`ducky-report.json` structure:

```
metadata        session timing, sample count
tracking
  processes     AI tools seen and how often
  network       AI endpoints contacted
  files         per-file edit counts, bytes added, burst count, burstiness score
  git           commits during session with per-commit AI signals
  aiArtifacts   local AI log files and whether they grew
  environment   config files and editor extensions found
summary
  aiUsageLikely boolean verdict
  signals       counts for each signal type
```

---

## Signals reference

| Signal | Source | Notes |
|---|---|---|
| AI process detected | `ps` | matched against a keyword regex |
| AI network endpoint | `ss` + rDNS | reverse DNS on established TCP connections |
| Burst edit (>800 bytes) | `fs.watch` | proxy for AI paste/accept |
| Edit burstiness >= 0.6 | inter-save intervals | clustered saves pattern |
| AI-assisted commit | `git log` | bot trailer, tool mention, or AI phrasing |
| AI artifact grew | file stat | aider, Claude Code, Shell-GPT, Copilot logs |

`aiUsageLikely` is `true` if any signal fires.

---

## Adding a tool

All tool detection runs through a single regex in `src/trackers.js`:

```js
const AI = /(copilot|cursor|claude|codeium|...)/i;
```

Add the tool name to the alternation. It will be picked up by process scanning, network host matching, and extension scanning automatically.

AI config file markers live in the `CONFIG_MARKERS` array in the same file.

---

## Limitations

- Burst detection is a heuristic. A large non-AI paste will trigger it.
- Reverse DNS misses CDN-fronted providers.
- The keyword list requires upkeep as new tools emerge.
- `fs.watch` recursive mode is Linux/macOS only; Windows support is untested.
- The process and network scanners only see the current user's processes.

---

## License

MIT
