import fs from 'node:fs';
import path from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

const IGNORE = /(^|\/)(\.git|node_modules|\.ducky|dist|build|\.next|coverage)(\/|$)/;
const CODE = /\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|c|h|cpp|cs|swift|kt|scala|sh|sql|json|md|yml|yaml|html|css|vue|svelte)$/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeSize(f) {
  try { return fs.statSync(f).size; } catch { return 0; }
}

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (IGNORE.test(full)) continue;
    if (e.isDirectory()) yield* walk(full);
    else if (CODE.test(full)) yield full;
  }
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

/**
 * Recursively watch a project directory for changes to code files.
 * Emits a change event with the byte delta for each save. A large positive
 * delta is a proxy for an AI paste or accept action.
 * @param {string} dir - Absolute path to the directory to watch.
 * @param {(change: { file: string, delta: number, size: number, ts: number }) => void} onChange
 *   Called for each code file change with the relative file path and byte delta.
 * @returns {() => void} A stop function that closes the watcher.
 */
export function watchFiles(dir, onChange) {
  const sizes = new Map();
  try {
    for (const f of walk(dir)) sizes.set(f, safeSize(f));
  } catch { /* ignore */ }

  let watcher;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_event, rel) => {
      if (!rel) return;
      const full = path.join(dir, rel.toString());
      if (IGNORE.test(full) || !CODE.test(full)) return;
      const prev = sizes.get(full) ?? 0;
      const cur = safeSize(full);
      sizes.set(full, cur);
      onChange({ file: rel.toString(), delta: cur - prev, size: cur, ts: Date.now() });
    });
  } catch { /* recursive watch unsupported */ }

  return () => { try { watcher?.close(); } catch { /* ignore */ } };
}
