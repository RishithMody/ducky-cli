# Ducky — Writeup

`ducky` is a Node.js CLI that passively tracks signals of AI coding-tool usage in a
project. `ducky start` snapshots the project's git state and spawns a detached
background daemon; the daemon samples the environment on an interval and watches
the file tree live. `ducky stop` signals the daemon to flush, aggregates everything
into `ducky-report.json`, and cleans up after itself (no zombie processes, no
orphaned PID files). All data stays local — nothing is ever sent off the machine.

```
ducky start    # begin tracking the current directory
ducky status   # is a session active?
ducky stop     # stop, write ducky-report.json, print a summary
```

## 1. Tracking approach

AI tools don't announce themselves, so instead of looking for one definitive
"AI was used" flag, ducky correlates several independent, hard-to-fake traces.
No single signal is conclusive; together they paint a confident picture.

- **Processes** (`ps`, sampled every 15s). AI assistants run as identifiable
  processes or editor child processes — Copilot's language server, Cursor, Claude
  Code, `aider`, `ollama`, Amazon Q, etc. A keyword-matched scan of the process
  table is the most direct evidence a tool is *running*. Sampling (vs. a one-shot
  check) catches tools that come and go mid-session.

- **Network** (`ss`, established TCP + best-effort reverse DNS). Cloud assistants
  hold persistent connections to inference endpoints. ducky records connections
  that either belong to an AI process or whose reverse-DNS host matches a known AI
  provider. This catches a browser-based ChatGPT/Claude tab that the process scan
  would miss.

- **File edits** (`fs.watch`, recursive, with per-event size deltas). This is the
  behavioral signal. Humans type incrementally; AI tools insert large blocks at
  once. ducky records every code-file change with its byte delta and flags any
  single change above an 800-byte threshold as a **burst edit** — a strong proxy
  for an AI paste/accept. The per-file breakdown shows *where* AI-shaped edits
  landed.

- **Git** (diff of HEAD between start and stop). ducky captures the commits made
  *during* the session and flags those that look AI-assisted (subject/body
  keywords, `Co-authored-by` trailers that some tools add). This ties activity to
  durable version-control history.

- **Environment** (config + editor extensions). Presence of `.cursor`, `.continue`,
  `CLAUDE.md`, `copilot-instructions.md`, etc., and AI extensions installed under
  `~/.vscode*/extensions` / `~/.cursor/extensions` reveal *intent and setup* even
  when no tool is active during the window.

Design choices: matching is keyword-driven through one shared regex so adding a
new tool is a one-line change; every external command is wrapped with a timeout
and fails soft (a missing `ss` or non-git directory degrades gracefully rather
than crashing); raw samples are appended to `events.jsonl` and only aggregated at
`stop`, so the daemon stays cheap and the heavy logic is testable in isolation.

## 2. Signal value

Traditional assessments measure the *artifact* — does the code pass tests, is it
clean. They're blind to *how* it was produced. AI-usage signal captures the
process, which is increasingly the thing worth evaluating:

- **AI fluency is now a core skill.** The valuable question is no longer "can you
  write this unaided" but "how effectively do you orchestrate AI to move faster."
  Burst-edit density, the mix of AI-shaped vs. hand-authored changes, and how that
  ratio evolves across a session reveal whether someone *drives* AI deliberately
  or just dumps generations in.

- **It separates leverage from dependence.** Two candidates can ship the same
  feature; the signal distinguishes the one who used AI to scaffold and then
  refined by hand from the one who blind-pasted. The per-file edit breakdown plus
  commit cadence exposes review-and-iterate behavior versus accept-everything.

- **It contextualizes speed.** A feature finished in 20 minutes means something
  very different with heavy AI assistance than without. Pairing duration with the
  AI-usage profile makes throughput interpretable instead of just impressive.

In short, it surfaces *workflow* and *judgment under AI* — exactly the dimension
that take-home output and live coding miss, and exactly what predicts real-world
productivity now that AI tooling is ambient.

## 3. Limitations & extensions

**Current limitations.** Signals are heuristic: a burst edit could be a
copy-paste from Stack Overflow or a code-generator; network rDNS misses providers
behind generic CDNs; the process/keyword list needs maintenance as tools appear.
ducky observes *that* AI was likely used and roughly *where*, not the exact
prompts or accepted suggestions.

**What I'd add with no constraints:**

- **Editor/IDE telemetry via extension APIs.** A companion VS Code/JetBrains
  extension could hook Copilot/inline-completion accept events directly — exact
  accepted-suggestion counts, characters accepted vs. typed, and prompt/response
  pairs. This turns the burst-edit *proxy* into ground truth. I'd ship it as an
  optional extension that writes to the same local `.ducky/events.jsonl`, keeping
  the CLI the single aggregation point.

- **Clipboard + keystroke dynamics.** Distinguishing typed code from pasted code,
  and measuring inter-keystroke timing, would sharply separate human authoring
  from AI insertion. Done locally and opt-in for privacy, this would replace the
  byte-delta heuristic with a direct paste/type classifier.

- **TLS/SNI-level network inspection.** A local proxy or eBPF probe reading SNI
  (not payloads) would reliably identify AI endpoints even behind shared CDNs,
  fixing the rDNS blind spot without decrypting anything.

- **Shell history + LLM CLI logs.** Parsing `aider`/`llm`/`claude` CLI session
  logs and shell history for AI invocations would add a precise, timestamped
  command-level signal.

- **Semantic diff analysis.** Running edits through a model (or AST diffing) to
  score how "AI-stylistic" a change is — boilerplate completeness, comment density,
  idiom uniformity — would let ducky estimate AI involvement on code that arrived
  without an observable burst (e.g., typed out from another window).

Each of these layers onto the existing architecture cleanly: every source just
appends timestamped events to the local log, and `report.js` already aggregates a
multi-signal verdict. The framework is designed to get more confident as more
signal sources are plugged in.
