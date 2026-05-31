#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Command } from 'commander';
import {
  paths, ensureDir, readPid, isAlive, readSession, writeSession, clearRuntime,
} from './state.js';
import {
  snapshotGit, snapshotProcesses, snapshotNetwork, scanAiConfig, scanEditorExtensions,
} from './trackers.js';
import { buildReport } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Gemini-CLI-style block wordmark with a blue→purple→pink horizontal gradient.
const ART = [
  '██████╗ ██╗   ██╗ ██████╗██╗  ██╗██╗   ██╗',
  '██╔══██╗██║   ██║██╔════╝██║ ██╔╝╚██╗ ██╔╝',
  '██║  ██║██║   ██║██║     █████╔╝  ╚████╔╝ ',
  '██║  ██║██║   ██║██║     ██╔═██╗   ╚██╔╝  ',
  '██████╔╝╚██████╔╝╚██████╗██║  ██╗   ██║   ',
  '╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═╝   ',
];
const STOPS = [[66, 133, 244], [155, 114, 203], [217, 101, 112]]; // Gemini blue→purple→pink

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function gradientColor(t) {
  const seg = t * (STOPS.length - 1);
  const i = Math.min(Math.floor(seg), STOPS.length - 2);
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  const f = seg - i;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}
function renderArt() {
  const tty = process.stdout.isTTY;
  const width = Math.max(...ART.map((l) => [...l].length));
  return ART.map((line) => {
    if (!tty) return line;
    return [...line].map((ch, x) => {
      const [r, g, b] = gradientColor(width > 1 ? x / (width - 1) : 0);
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    }).join('') + '\x1b[0m';
  }).join('\n');
}

const program = new Command();
program.name('ducky').description('Passively track AI tool usage in a project').version('1.0.0');

program
  .command('start')
  .description('Begin tracking AI usage in the current directory')
  .action(async () => {
    const p = paths(process.cwd());
    const pid = readPid(p);
    if (isAlive(pid)) {
      console.log(`ducky is already tracking (pid ${pid}). Run "ducky stop" first.`);
      return;
    }
    ensureDir(p);
    clearRuntime(p); // wipe any stale state from a crashed session

    const git = snapshotGit(p.projectDir);
    writeSession(p, {
      startedAt: new Date().toISOString(),
      projectDir: p.projectDir,
      gitStart: git,
    });

    // Detach the daemon so it outlives this command.
    const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js'), p.projectDir], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Initial snapshot of what's being tracked this session.
    const procs = snapshotProcesses();
    const net = await snapshotNetwork();
    const configs = scanAiConfig(p.projectDir);
    const exts = scanEditorExtensions();

    console.log('\n' + renderArt() + '\n');
    console.log('  🦆 tracking started — passively watching for AI usage\n');
    console.log(`  project   ${p.projectDir}`);
    console.log(`  data      ${p.dir}`);
    console.log(`  daemon    pid ${child.pid}`);
    console.log('\n  watching');
    const procNames = [...new Set(procs.map((x) => x.name))];
    const hosts = [...new Set(net.map((c) => c.host || c.peer))];
    console.log(`    • processes      ${procNames.length ? procNames.join(', ') : 'none yet'}`);
    console.log(`    • ai endpoints   ${hosts.length ? hosts.join(', ') : 'none yet'}`);
    console.log(`    • file edits     recursive watch on code files`);
    console.log(`    • git            ${git ? `${git.branch} @ ${git.head.slice(0, 7)}` : 'not a git repo'}`);
    console.log(`    • ai config      ${configs.length ? configs.join(', ') : 'none'}`);
    console.log(`    • editor ext     ${exts.length ? exts.join(', ') : 'none'}`);
    console.log('\n  run "ducky stop" to end the session and write ducky-report.json\n');
  });

program
  .command('stop')
  .description('Stop tracking and write ducky-report.json')
  .action(async () => {
    const p = paths(process.cwd());
    const pid = readPid(p);
    if (!isAlive(pid)) {
      console.log('No active ducky session in this directory.');
      clearRuntime(p);
      return;
    }

    // Ask the daemon to flush its final state, then wait for it to exit.
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 30 && isAlive(pid); i++) await sleep(100);

    const session = readSession(p) || {};
    const report = buildReport(p, session);
    printSummary(report);
    clearRuntime(p);
  });

program
  .command('status')
  .description('Show whether tracking is active')
  .action(() => {
    const p = paths(process.cwd());
    const pid = readPid(p);
    if (isAlive(pid)) {
      const s = readSession(p) || {};
      console.log(`🦆 tracking active (pid ${pid}), started ${s.startedAt}`);
    } else {
      console.log('ducky is not tracking this directory.');
    }
  });

program
  .command('logs')
  .description('Print the daemon verification log for this session')
  .option('-n, --lines <n>', 'number of trailing lines', '40')
  .action((opts) => {
    const p = paths(process.cwd());
    let log;
    try { log = fs.readFileSync(p.log, 'utf8'); } catch { log = ''; }
    if (!log.trim()) { console.log('No ducky logs in this directory.'); return; }
    const lines = log.trimEnd().split('\n');
    console.log(lines.slice(-Number(opts.lines)).join('\n'));
  });

program.parse();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function printSummary(r) {
  const { metadata: m, summary: s } = r;
  console.log('\n🦆 ducky report written to ducky-report.json\n');
  console.log(`   duration:        ${m.durationHuman} (${m.samples} samples)`);
  console.log(`   AI usage likely: ${s.aiUsageLikely ? 'YES' : 'no'}`);
  console.log(`   AI processes:    ${s.signals.aiProcesses}`);
  console.log(`   AI net hosts:    ${s.signals.aiNetworkHosts}`);
  console.log(`   burst edits:     ${s.signals.burstEdits}`);
  console.log(`   AI-tagged commits: ${s.signals.aiAssistedCommits}\n`);
}
