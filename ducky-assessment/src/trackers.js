import { execFileSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keywords that identify AI coding tools by process/extension/host name.
const AI = /(copilot|cursor|claude|codeium|windsurf|tabnine|sourcegraph|\bcody\b|continue|aider|chatgpt|openai|anthropic|codewhisperer|amazon-?q|\bkiro\b|ollama|supermaven|pieces|codegpt)/i;

// AI assistant config files/dirs that may live in a project root.
const CONFIG_MARKERS = [
  '.github/copilot-instructions.md', '.cursor', '.cursorrules', '.continue',
  '.aider.conf.yml', '.aider.chat.history.md', 'CLAUDE.md', '.claude',
  '.codeium', '.windsurfrules', '.kiro', 'AGENTS.md', '.github/hooks',
];

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// Running AI tool processes (own user) matched by command line.
export function snapshotProcesses() {
  const out = sh('ps', ['-eo', 'pid=,comm=,args=']);
  const procs = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, comm, args] = m;
    if (AI.test(args) || AI.test(comm)) {
      procs.push({ pid: +pid, name: comm, cmd: args.slice(0, 200) });
    }
  }
  return procs;
}

const rdnsCache = new Map();
async function rdns(ip) {
  if (rdnsCache.has(ip)) return rdnsCache.get(ip);
  let host = null;
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise((_, r) => setTimeout(() => r(new Error('t')), 800)),
    ]);
    host = names[0] || null;
  } catch { /* unresolved */ }
  rdnsCache.set(ip, host);
  return host;
}

// Established TCP connections owned by AI processes, with best-effort rDNS.
export async function snapshotNetwork() {
  const out = sh('ss', ['-tnp', 'state', 'established']);
  const conns = [];
  for (const line of out.split('\n')) {
    if (!line.includes('users:')) continue;
    const proc = (line.match(/users:\(\("([^"]+)"/) || [])[1] || '';
    const peer = (line.match(/(\d+\.\d+\.\d+\.\d+):\d+\s+users:/) || [])[1];
    if (!peer) continue;
    const procAi = AI.test(proc);
    const host = await rdns(peer);
    const hostAi = host ? AI.test(host) : false;
    if (procAi || hostAi) conns.push({ peer, host, proc, ai: true });
  }
  return conns;
}

// Lightweight git snapshot; deltas are computed at report time.
export function snapshotGit(dir) {
  const head = sh('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
  if (!head) return null;
  const branch = sh('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const count = +sh('git', ['-C', dir, 'rev-list', '--count', 'HEAD']).trim() || 0;
  const dirty = sh('git', ['-C', dir, 'status', '--porcelain']).split('\n').filter(Boolean).length;
  return { head, branch, commitCount: count, dirtyCount: dirty };
}

// Commits between two SHAs, flagged if they look AI-assisted.
export function gitCommitsBetween(dir, from, to) {
  const range = from && from !== to ? `${from}..${to}` : to;
  const raw = sh('git', ['-C', dir, 'log', range, '--pretty=%H%x1f%s%x1f%b%x1e', '--no-merges']);
  return raw.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
    const [hash, subject, body = ''] = c.split('\x1f');
    return { hash, subject, aiAssisted: AI.test(subject) || AI.test(body) || /co-authored-by/i.test(body) };
  });
}

// AI assistant config files present in the project.
export function scanAiConfig(dir) {
  return CONFIG_MARKERS.filter((m) => fs.existsSync(path.join(dir, m)));
}

// Installed editor extensions whose folder name signals an AI tool.
export function scanEditorExtensions() {
  const home = os.homedir();
  const extDirs = ['.vscode/extensions', '.vscode-server/extensions', '.cursor/extensions', '.vscode-oss/extensions'];
  const found = new Set();
  for (const d of extDirs) {
    try {
      for (const name of fs.readdirSync(path.join(home, d))) {
        if (AI.test(name)) found.add(name.replace(/-\d+\.\d+\.\d+.*$/, ''));
      }
    } catch { /* dir absent */ }
  }
  return [...found];
}
