# Ducky - AI Usage Tracker CLI

## Overview

Modern developers increasingly use AI coding assistants (Copilot, Cursor, Claude Code, ChatGPT, etc.) as part of their workflow. Build a CLI tool called **ducky** that passively monitors a developer's local environment to capture signal about how they use AI tools during a coding session.

## Problem Statement

Build a Node.js CLI tool called `ducky` including but not limited to two core commands:

- `ducky start` — begin tracking AI usage in the current project directory
- `ducky stop` — stop tracking and save a summary report to the project root

The tool must be installable locally via `npm link` (it does not need to be published to npm). When linked, the `ducky` command should be globally available from any terminal.

## Requirements

### Functional Requirements

1. **`ducky start`**
   - Begins monitoring the current working directory for signals of AI tool usage.
   - Runs a background process or watcher that persists after the terminal command returns.
   - Prints confirmation that tracking has started and where data is being stored.
   - Handles the case where tracking is already active (do not start duplicate watchers).

2. **`ducky stop`**
   - Stops the background tracking process.
   - Generates a report file (`ducky-report.json`) in the project root summarizing the captured data.
   - Prints a summary to the terminal before exiting.
   - Handles the case where no active tracking session exists.

3. **Tracking**
   - The tool should capture as much signal as possible about a developer's AI usage. What you track and how you track it is open-ended, and a core part of this assessment. Consider: What traces do AI tools leave on a developer's machine? Think broadly — processes, files, network activity, editor state, version control patterns, and anything else you can find.
   - All tracking must be **local only** — no data should be sent to any external service. Note: The litmus CLI running alongside your session tracks your activity for assessment purposes. Your ducky tool should operate independently and not send data externally.
   - Tracking should be **passive** — it must not interfere with the developer's workflow.

4. **Report Format**
   - `ducky-report.json` must be valid JSON.
   - Include a `metadata` section with: session start time, session end time, duration, and project directory.
   - Include a `tracking` section with the captured signals and any derived metrics.
   - The structure of the `tracking` section is up to you — design it to be as informative as possible.

### Technical Requirements

1. The project must use Node.js (TypeScript or JavaScript).
2. The CLI must be executable via `npm link` — the `ducky` command must work globally after linking.
3. The tool must handle being started and stopped cleanly (no zombie processes, no orphaned PID files).
4. Include a `package.json` with a `bin` field pointing to the CLI entry point.
5. If using TypeScript, include a build step and ensure the compiled output is what `bin` points to.

### Deliverables

- A working `ducky` CLI tool with `start` and `stop` (and optionally any other fitting) commands.
- A `WRITEUP.md` (see below).

## WRITEUP.md

Include a `WRITEUP.md` in the project root that addresses:

1. **Tracking approach**: What signals did you choose to monitor and why? 
2. **Signal value**: Why do you think tracking AI usage is useful for evaluating a developer's coding ability or potential? What does it reveal that traditional assessments miss?
3. **Limitations & extensions**: What additional signals, tools, or third-party services (that you didn't employ in this assessment due to cost or special access) would you use if there were no constraints? Defend them and explain how you would incorporate them. If you don't have any, explain how you would expand on discovering AI usage signal further.

## Additional Notes

- You may use any packages, libraries, or tools you find useful.
- Focus on **depth of signal** over polish — a rough tool that captures meaningful data is more valuable than a polished tool that tracks nothing interesting.
