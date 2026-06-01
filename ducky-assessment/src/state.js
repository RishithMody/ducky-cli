import fs from 'node:fs';
import path from 'node:path';

// ─── Path Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve all runtime paths for a given project directory.
 * @param {string} [projectDir] - Absolute path to the project root. Defaults to cwd.
 * @returns {{ projectDir: string, dir: string, pid: string, session: string, events: string, log: string, report: string }}
 */
export function paths(projectDir = process.cwd()) {
  const dir = path.join(projectDir, '.ducky');
  return {
    projectDir,
    dir,
    pid: path.join(dir, 'daemon.pid'),
    session: path.join(dir, 'session.json'),
    events: path.join(dir, 'events.jsonl'),
    log: path.join(dir, 'daemon.log'),
    report: path.join(projectDir, 'ducky-report.json'),
  };
}

// ─── Directory ────────────────────────────────────────────────────────────────

/**
 * Create the .ducky runtime directory if it does not exist.
 * @param {{ dir: string }} p - Paths object from {@link paths}.
 */
export function ensureDir(p) {
  fs.mkdirSync(p.dir, { recursive: true });
}

// ─── PID / Process ────────────────────────────────────────────────────────────

/**
 * Read the daemon PID from disk.
 * @param {{ pid: string }} p - Paths object from {@link paths}.
 * @returns {number|null} The PID, or null if the file is absent or invalid.
 */
export function readPid(p) {
  try {
    const pid = parseInt(fs.readFileSync(p.pid, 'utf8').trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a process is alive by sending signal 0.
 * @param {number|null} pid
 * @returns {boolean}
 */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Read the session metadata written by `ducky start`.
 * @param {{ session: string }} p - Paths object from {@link paths}.
 * @returns {object|null} Parsed session object, or null if absent.
 */
export function readSession(p) {
  try {
    return JSON.parse(fs.readFileSync(p.session, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write session metadata to disk.
 * @param {{ session: string }} p - Paths object from {@link paths}.
 * @param {object} data - Session data to persist.
 */
export function writeSession(p, data) {
  fs.writeFileSync(p.session, JSON.stringify(data, null, 2));
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Append a single event to the JSONL event log.
 * @param {{ events: string }} p - Paths object from {@link paths}.
 * @param {object} event - Event object. Must be JSON-serialisable.
 */
export function appendEvent(p, event) {
  fs.appendFileSync(p.events, JSON.stringify(event) + '\n');
}

/**
 * Read and parse all events from the JSONL event log.
 * @param {{ events: string }} p - Paths object from {@link paths}.
 * @returns {object[]} Array of parsed event objects.
 */
export function readEvents(p) {
  try {
    return fs.readFileSync(p.events, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove all runtime files (pid, events, session, log) so a fresh session starts clean.
 * @param {{ pid: string, events: string, session: string, log: string }} p - Paths object from {@link paths}.
 */
export function clearRuntime(p) {
  for (const f of [p.pid, p.events, p.session, p.log]) {
    try { fs.rmSync(f); } catch { /* ignore */ }
  }
}
