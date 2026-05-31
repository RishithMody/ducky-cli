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
  snapshotAiArtifacts,
} from './trackers.js';
import { buildReport } from './report.js';
import { renderArt } from './art.js';
import { runLive } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      aiArtifactsStart: snapshotAiArtifacts(p.projectDir),
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
    console.log('  Tracking started - passively watching for AI usage\n');
    console.log(`  project   ${p.projectDir}`);
    console.log(`  data      ${p.dir}`);
    console.log(`  daemon    pid ${child.pid}`);
    console.log('\n  Watching');
    const procNames = [...new Set(procs.map((x) => x.name))];
    const hosts = [...new Set(net.map((c) => c.host || c.peer))];
    console.log(`    processes      ${procNames.length ? procNames.join(', ') : 'none yet'}`);
    console.log(`    ai endpoints   ${hosts.length ? hosts.join(', ') : 'none yet'}`);
    console.log(`    file edits     recursive watch on code files`);
    console.log(`    git            ${git ? `${git.branch} @ ${git.head.slice(0, 7)}` : 'not a git repo'}`);
    console.log(`    ai config      ${configs.length ? configs.join(', ') : 'none'}`);
    console.log(`    editor ext     ${exts.length ? exts.join(', ') : 'none'}`);
    console.log('\n  Run "ducky stop" to end the session and write ducky-report.json\n');
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
      console.log(`Tracking active (pid ${pid}), started ${s.startedAt}`);
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

program
  .command('live')
  .description('Real-time dashboard - keep running in a separate terminal to watch activity live')
  .action(async () => {
    await runLive(process.cwd());
  });

program
  .command('diff')
  .description('Show which files changed most during the last session')
  .option('--ai', 'highlight files with AI-shaped edit patterns (bursts / high burstiness)')
  .action((opts) => {
    const p = paths(process.cwd());
    let report;
    try { report = JSON.parse(fs.readFileSync(p.report, 'utf8')); } catch {
      console.log('No ducky-report.json here. Run "ducky start" then "ducky stop" first.');
      return;
    }
    const perFile = report.tracking?.files?.perFile || {};
    let rows = Object.entries(perFile).map(([file, f]) => ({
      file,
      edits: f.edits,
      bytes: f.bytesAdded,
      bursts: f.bursts || 0,
      burstiness: f.velocity?.burstiness ?? null,
    }));
    if (opts.ai) rows = rows.filter((r) => r.bursts > 0 || (r.burstiness ?? 0) >= 0.6);
    rows.sort((a, b) => b.bytes - a.bytes || b.edits - a.edits);

    if (!rows.length) {
      console.log(opts.ai ? 'No files with AI-shaped edit patterns.' : 'No file changes recorded.');
      return;
    }
    console.log(`\n  ${'file'.padEnd(34)}${'edits'.padStart(6)}${'+bytes'.padStart(9)}${'bursts'.padStart(8)}${'burstiness'.padStart(12)}`);
    for (const r of rows) {
      const flag = r.bursts > 0 || (r.burstiness ?? 0) >= 0.6 ? '  <- AI-shaped' : '';
      const b = r.burstiness == null ? '-' : String(r.burstiness);
      console.log(`  ${r.file.slice(0, 33).padEnd(34)}${String(r.edits).padStart(6)}${String(r.bytes).padStart(9)}${String(r.bursts).padStart(8)}${b.padStart(12)}${flag}`);
    }
    console.log('');
  });

program.parse();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function printSummary(r) {
  const { metadata: m, summary: s } = r;
  console.log('\nReport written to ducky-report.json\n');
  console.log(`   duration:          ${m.durationHuman} (${m.samples} samples)`);
  console.log(`   AI usage likely:   ${s.aiUsageLikely ? 'yes' : 'no'}`);
  console.log(`   AI processes:      ${s.signals.aiProcesses}`);
  console.log(`   AI net hosts:      ${s.signals.aiNetworkHosts}`);
  console.log(`   burst edits:       ${s.signals.burstEdits}`);
  console.log(`   AI-tagged commits: ${s.signals.aiAssistedCommits}\n`);
}
