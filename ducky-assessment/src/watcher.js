import fs from 'node:fs';
import path from 'node:path';

const IGNORE = /(^|\/)(\.git|node_modules|\.ducky|dist|build|\.next|coverage)(\/|$)/;
const CODE = /\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|c|h|cpp|cs|swift|kt|scala|sh|sql|json|md|yml|yaml|html|css|vue|svelte)$/i;

// Recursively watch the project tree, recording per-file change events with
// size deltas. A large positive delta in a short window is a strong AI-paste
// signal; bursts are derived at report time.
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
