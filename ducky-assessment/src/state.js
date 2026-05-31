import fs from 'node:fs';
import path from 'node:path';

// Resolve all runtime paths relative to a project directory.
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

export function ensureDir(p) {
  fs.mkdirSync(p.dir, { recursive: true });
}

export function readPid(p) {
  try {
    const pid = parseInt(fs.readFileSync(p.pid, 'utf8').trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

// signal 0 probes existence without killing.
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readSession(p) {
  try {
    return JSON.parse(fs.readFileSync(p.session, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSession(p, data) {
  fs.writeFileSync(p.session, JSON.stringify(data, null, 2));
}

export function appendEvent(p, event) {
  fs.appendFileSync(p.events, JSON.stringify(event) + '\n');
}

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

// Remove pid + events so a fresh session starts clean. Keeps no orphans.
export function clearRuntime(p) {
  for (const f of [p.pid, p.events, p.session, p.log]) {
    try { fs.rmSync(f); } catch { /* ignore */ }
  }
}
