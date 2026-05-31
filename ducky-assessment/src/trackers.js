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

// Phrases that AI-generated commit messages tend to overuse.
const AI_PHRASE = /\b(comprehensive|robust|seamless(ly)?|efficient(ly)?|leverage|enhance(d|ment)?|streamline|best practices|production[- ]ready|gracefully|ensure that|implement(ing|ed)? (a |the )?(robust|comprehensive|proper)|improve(d|ment)? (the )?(overall|code))\b/i;
// Bot co-author trailers some AI tools inject automatically (ground truth).
const BOT_TRAILER = /co-authored-by:.*(\[bot\]|copilot|cursor|claude|noreply@github)/i;

// Commits between two SHAs with per-commit AI signals.
export function gitCommitsBetween(dir, from, to) {
  const range = from && from !== to ? `${from}..${to}` : to;
  const raw = sh('git', ['-C', dir, 'log', range, '--pretty=%H%x1f%s%x1f%b%x1e', '--no-merges']);
  return raw.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
    const [hash, subject, body = ''] = c.split('\x1f');
    const signals = [];
    if (BOT_TRAILER.test(body)) signals.push('bot-trailer');
    if (AI.test(subject) || AI.test(body)) signals.push('tool-mention');
    if (AI_PHRASE.test(subject) || AI_PHRASE.test(body)) signals.push('ai-phrasing');
    return { hash: hash.slice(0, 8), subject, signals, aiAssisted: signals.length > 0 };
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

// AI extensions reported by the VS Code CLI (catches idle tools). Zero overhead.
export function listCodeExtensions() {
  for (const bin of ['code', 'code-insiders', 'cursor']) {
    const out = sh(bin, ['--list-extensions']);
    if (out) return out.split('\n').map((s) => s.trim()).filter((s) => AI.test(s));
  }
  return [];
}

// Plaintext AI session logs + language-server logs. Existence/size/mtime are
// exact invocation evidence; growth across a session ties usage to the window.
export function snapshotAiArtifacts(dir) {
  const home = os.homedir();
  const targets = [
    ['aider-history', path.join(dir, '.aider.chat.history.md')],
    ['aider-input', path.join(dir, '.aider.input.history')],
    ['claude-code', path.join(home, '.claude', 'projects')],
    ['shell-gpt', path.join(home, '.config', 'shell_gpt', 'chat_cache')],
    ['copilot-logs', path.join(home, '.config', 'GitHub Copilot')],
    ['copilot-logs-mac', path.join(home, 'Library', 'Application Support', 'GitHub Copilot')],
  ];
  const out = [];
  for (const [label, p] of targets) {
    try {
      const st = fs.statSync(p);
      out.push({ label, path: p, exists: true, size: dirSize(p, st), mtime: st.mtimeMs });
    } catch { /* absent */ }
  }
  return out;
}

// Total size of a file, or recursive size of a directory (bounded, best-effort).
function dirSize(p, st) {
  if (!st.isDirectory()) return st.size;
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      try {
        const s = fs.statSync(full);
        total += s.isDirectory() ? dirSize(full, s) : s.size;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return total;
}
