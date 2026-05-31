import fs from 'node:fs';
import { paths, ensureDir, appendEvent, readSession, writeSession } from './state.js';
import { snapshotProcesses, snapshotNetwork, snapshotGit } from './trackers.js';
import { watchFiles } from './watcher.js';

// Detached background process. Invoked as: node daemon.js <projectDir>
// Samples process/network/git on an interval and records file edits live.
const projectDir = process.argv[2] || process.cwd();
const p = paths(projectDir);
ensureDir(p);

const SAMPLE_MS = 15000;
fs.writeFileSync(p.pid, String(process.pid));

function log(msg) {
  fs.appendFileSync(p.log, `[${new Date().toISOString()}] ${msg}\n`);
}

let sampleCount = 0;
async function sample() {
  try {
    const procs = snapshotProcesses();
    const net = await snapshotNetwork();
    appendEvent(p, { type: 'sample', ts: Date.now(), processes: procs, network: net });
    sampleCount++;
    log(`sample #${sampleCount}: ${procs.length} ai-proc, ${net.length} ai-conn`);
  } catch (e) {
    log('sample error: ' + e.message);
  }
}

// Record every code-file change with its size delta for burst analysis.
const stopWatch = watchFiles(projectDir, (change) => {
  appendEvent(p, { type: 'file', ...change });
  const burst = change.delta >= 800 ? ' [BURST]' : '';
  log(`file: ${change.file} delta=${change.delta >= 0 ? '+' : ''}${change.delta}b${burst}`);
});

log(`daemon started pid=${process.pid} dir=${projectDir}`);
sample();
const timer = setInterval(sample, SAMPLE_MS);

function shutdown() {
  clearInterval(timer);
  stopWatch();
  // Persist git end-state so the report can compute commit/diff deltas.
  const session = readSession(p) || {};
  session.gitEnd = snapshotGit(projectDir);
  session.endedAt = new Date().toISOString();
  writeSession(p, session);
  appendEvent(p, { type: 'stop', ts: Date.now() });
  log('daemon stopped');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
