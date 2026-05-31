# Ducky - Writeup

`ducky` is a Node.js CLI that passively tracks signals of AI coding-tool usage in
a project. `ducky start` snapshots git state and spawns a detached background
daemon; `ducky stop` flushes the daemon and writes `ducky-report.json`. A
foreground `ducky live` command shows the same signals in real time. All data
stays local.

```
ducky start    # begin tracking the current directory
ducky live     # real-time dashboard (run in a separate terminal)
ducky status   # is a session active?
ducky logs     # daemon verification log
ducky stop     # stop, write ducky-report.json, print summary
```

## 1. Tracking approach

No single trace proves AI usage, so ducky correlates several independent signals:

- **Processes** (`ps`, sampled): AI assistants run as identifiable processes
  (Copilot LSP, Cursor, Claude, aider, ollama, etc.). Direct evidence a tool is
  running.
- **Network** (`ss` + reverse DNS): persistent connections to known AI inference
  endpoints. Catches browser-based assistants the process scan misses.
- **File edits** (`fs.watch`, byte deltas): humans type incrementally; AI inserts
  large blocks at once. A single change above 800 bytes is flagged as a
  **burst edit** - a proxy for an AI paste/accept.
- **Git** (HEAD diff start vs. stop): commits made during the session, flagged
  AI-assisted via subject/body keywords and `Co-authored-by` trailers.
- **Environment**: AI config files (`.cursor`, `CLAUDE.md`, etc.) and installed
  editor AI extensions reveal intent and setup.

Design: one shared keyword regex makes adding a tool a one-line change; every
external command has a timeout and fails soft; raw samples append to
`events.jsonl` and are aggregated only at `stop`.

## 2. Signal value

Traditional assessments grade the artifact and ignore how it was produced.
AI-usage signal captures the process, which is what increasingly matters:

- **AI fluency is a core skill.** Burst-edit density and the AI-vs-hand-authored
  ratio show whether someone drives AI deliberately or blind-pastes.
- **Leverage vs. dependence.** Two people ship the same feature; edit and commit
  patterns separate scaffold-then-refine from accept-everything.
- **Context for speed.** Pairing duration with the AI-usage profile makes
  throughput interpretable instead of just fast.

## 3. Limitations & extensions

Signals are heuristic: a burst could be a non-AI paste, rDNS misses CDN-fronted
providers, and the keyword list needs upkeep. ducky shows *that* AI was likely
used and roughly *where*, not exact prompts.

With no constraints I would add:

- **Editor extension telemetry** - hook Copilot/inline-completion accept events
  for exact accepted-vs-typed character counts. Turns the burst proxy into ground
  truth.
- **Clipboard + keystroke timing** - directly classify pasted vs. typed code.
- **TLS SNI inspection** (local proxy/eBPF) - reliably identify AI endpoints
  behind shared CDNs without decrypting payloads.
- **Shell/CLI logs** - parse `aider`/`llm`/`claude` session logs for precise,
  timestamped invocations.
- **Semantic diff scoring** - estimate AI involvement on code that arrived without
  an observable burst.

Each layers cleanly onto the current design: every source appends timestamped
events to the local log, and `report.js` already aggregates a multi-signal
verdict.
