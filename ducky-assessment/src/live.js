import { snapshotProcesses, snapshotNetwork, snapshotGit } from './trackers.js';
import { watchFiles } from './watcher.js';
import { renderArt, rgb } from './art.js';

const BURST_BYTES = 800;
const POLL_MS = 3000;
const FEED_MAX = 12;

// Foreground real-time dashboard. Runs until Ctrl-C. Independent of the
// `start`/`stop` daemon; it observes the same signals live without writing a report.
export async function runLive(projectDir) {
  const startedAt = Date.now();
  const gitStart = snapshotGit(projectDir);
  const state = {
    procs: new Map(),      // name -> last seen ts
    hosts: new Map(),      // host -> hits
    files: new Map(),      // file -> { edits, bytes, bursts }
    bursts: 0,
    edits: 0,
    feed: [],              // recent activity lines
  };

  const push = (tag, msg) => {
    const t = new Date().toLocaleTimeString();
    state.feed.unshift(`${rgb(120, 120, 120, t)}  ${tag.padEnd(7)}  ${msg}`);
    if (state.feed.length > FEED_MAX) state.feed.pop();
  };

  push('start', 'live monitor started');

  const stopWatch = watchFiles(projectDir, (c) => {
    state.edits++;
    const f = state.files.get(c.file) || { edits: 0, bytes: 0, bursts: 0 };
    f.edits++;
    if (c.delta > 0) f.bytes += c.delta;
    const burst = c.delta >= BURST_BYTES;
    if (burst) { f.bursts++; state.bursts++; }
    state.files.set(c.file, f);
    const d = `${c.delta >= 0 ? '+' : ''}${c.delta}b`;
    push(burst ? 'burst' : 'edit', `${c.file} ${d}${burst ? rgb(217, 101, 112, '  (likely AI paste)') : ''}`);
  });

  async function poll() {
    const procs = snapshotProcesses();
    for (const p of procs) {
      if (!state.procs.has(p.name)) push('proc', `AI process: ${rgb(155, 114, 203, p.name)}`);
      state.procs.set(p.name, Date.now());
    }
    const net = await snapshotNetwork();
    for (const c of net) {
      const key = c.host || c.peer;
      if (!state.hosts.has(key)) push('net', `AI endpoint: ${rgb(66, 133, 244, key)}`);
      state.hosts.set(key, (state.hosts.get(key) || 0) + 1);
    }
    render();
  }

  function render() {
    const out = process.stdout;
    if (out.isTTY) out.write('\x1b[2J\x1b[H'); // clear + home
    const up = humanDuration(Date.now() - startedAt);
    const git = snapshotGit(projectDir);
    const commitDelta = git && gitStart ? git.commitCount - gitStart.commitCount : 0;

    const lines = [
      renderArt(),
      '',
      `  ${rgb(155, 114, 203, 'LIVE')}  monitoring ${projectDir}`,
      `  uptime ${up}   |   poll ${POLL_MS / 1000}s   |   Ctrl-C to exit`,
      '',
      `  ${pad('AI processes')}${val(state.procs.size)}   ${[...state.procs.keys()].join(', ') || '-'}`,
      `  ${pad('AI endpoints')}${val(state.hosts.size)}   ${[...state.hosts.keys()].slice(0, 3).join(', ') || '-'}`,
      `  ${pad('files touched')}${val(state.files.size)}   (${state.edits} edits)`,
      `  ${pad('burst edits')}${val(state.bursts)}   ${rgb(217, 101, 112, state.bursts ? 'AI-shaped inserts' : '')}`,
      `  ${pad('git commits')}${val(commitDelta)}   since start${git ? ` | ${git.branch}@${git.head.slice(0, 7)}` : ''}`,
      '',
      `  ${rgb(120, 120, 120, 'Activity')}`,
      ...state.feed.map((l) => '  ' + l),
      '',
    ];
    out.write(lines.join('\n') + '\n');
  }

  await poll();
  const timer = setInterval(poll, POLL_MS);

  const shutdown = () => {
    clearInterval(timer);
    stopWatch();
    if (process.stdout.isTTY) process.stdout.write('\n');
    console.log('Live monitor stopped.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const pad = (s) => (s + ' ').padEnd(16, '.') + ' ';
const val = (n) => rgb(155, 114, 203, String(n).padStart(3));

function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
