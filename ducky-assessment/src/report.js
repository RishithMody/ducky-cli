import fs from 'node:fs';
import { readEvents } from './state.js';
import {
  gitCommitsBetween, scanAiConfig, scanEditorExtensions, listCodeExtensions,
} from './trackers.js';

// A single change adding this many bytes at once looks like an AI paste.
const BURST_BYTES = 800;

// Aggregate raw events + session into the final report and write it to disk.
export function buildReport(p, session) {
  const events = readEvents(p);
  const samples = events.filter((e) => e.type === 'sample');
  const fileEvents = events.filter((e) => e.type === 'file');

  const start = session.startedAt ? new Date(session.startedAt) : null;
  const end = session.endedAt ? new Date(session.endedAt) : new Date();
  const durationMs = start ? end - start : 0;

  // Unique AI processes + network hosts seen across all samples.
  const aiProcs = new Map();
  const aiHosts = new Map();
  for (const s of samples) {
    for (const proc of s.processes || []) aiProcs.set(proc.name, (aiProcs.get(proc.name) || 0) + 1);
    for (const c of s.network || []) {
      const key = c.host || c.peer;
      aiHosts.set(key, (aiHosts.get(key) || 0) + 1);
    }
  }

  // File edits: aggregate bytes/bursts and collect timestamps for velocity.
  const byFile = {};
  const times = {};
  let bursts = 0, totalAdded = 0;
  for (const f of fileEvents) {
    const e = (byFile[f.file] ||= { edits: 0, bytesAdded: 0, bursts: 0 });
    e.edits++;
    if (f.delta > 0) { e.bytesAdded += f.delta; totalAdded += f.delta; }
    if (f.delta >= BURST_BYTES) { e.bursts++; bursts++; }
    (times[f.file] ||= []).push(f.ts);
  }
  // Per-file edit-velocity fingerprint from inter-save intervals.
  for (const [file, ts] of Object.entries(times)) {
    byFile[file].velocity = velocity(ts);
  }
  const allIntervals = Object.values(times).flatMap((ts) => intervals(ts));
  const editVelocity = {
    ...velocity(fileEvents.map((f) => f.ts)),
    note: 'burstiness ~1 = clustered saves (AI-assisted), ~0 = steady human cadence',
  };

  const commits = (session.gitStart && session.gitEnd)
    ? gitCommitsBetween(p.projectDir, session.gitStart.head, session.gitEnd.head) : [];
  const aiCommits = commits.filter((c) => c.aiAssisted);

  const artifacts = diffArtifacts(session.aiArtifactsStart, session.aiArtifactsEnd);
  const grewArtifacts = artifacts.filter((a) => a.grew);

  const aiProcDetected = aiProcs.size > 0;
  const aiNetDetected = aiHosts.size > 0;
  const burstyEdits = (editVelocity.burstiness ?? 0) >= 0.6 && allIntervals.length >= 3;

  const report = {
    metadata: {
      tool: 'ducky',
      projectDir: p.projectDir,
      startTime: session.startedAt || null,
      endTime: session.endedAt || end.toISOString(),
      durationMs,
      durationHuman: humanDuration(durationMs),
      samples: samples.length,
    },
    tracking: {
      processes: { aiToolsDetected: aiProcDetected, tools: Object.fromEntries(aiProcs) },
      network: { aiEndpointsDetected: aiNetDetected, hosts: Object.fromEntries(aiHosts) },
      files: {
        filesTouched: Object.keys(byFile).length,
        totalEdits: fileEvents.length,
        bytesAdded: totalAdded,
        burstEdits: bursts,
        editVelocity,
        perFile: byFile,
      },
      git: {
        start: session.gitStart || null,
        end: session.gitEnd || null,
        commitsDuringSession: commits.length,
        aiAssistedCommits: aiCommits.length,
        commits,
      },
      aiArtifacts: {
        detected: artifacts.length,
        grewDuringSession: grewArtifacts.map((a) => a.label),
        items: artifacts,
      },
      environment: {
        aiConfigFiles: scanAiConfig(p.projectDir),
        editorAiExtensions: scanEditorExtensions(),
        installedAiExtensions: listCodeExtensions(),
      },
    },
    summary: {
      aiUsageLikely: aiProcDetected || aiNetDetected || bursts > 0
        || aiCommits.length > 0 || grewArtifacts.length > 0 || burstyEdits,
      signals: {
        aiProcesses: aiProcs.size,
        aiNetworkHosts: aiHosts.size,
        burstEdits: bursts,
        editBurstiness: editVelocity.burstiness,
        aiAssistedCommits: aiCommits.length,
        aiArtifactsGrew: grewArtifacts.length,
      },
    },
  };

  fs.writeFileSync(p.report, JSON.stringify(report, null, 2));
  return report;
}

// Gaps (seconds) between successive sorted timestamps.
function intervals(ts) {
  const s = [...ts].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < s.length; i++) out.push((s[i] - s[i - 1]) / 1000);
  return out;
}

// Burstiness coefficient B = (sd - mean) / (sd + mean), range -1..1.
// Clustered saves (bursts then long gaps) push B toward 1.
function velocity(ts) {
  const iv = intervals(ts);
  if (iv.length < 2) return { saves: ts.length, intervals: iv.length, burstiness: null };
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  const b = sd + mean === 0 ? 0 : (sd - mean) / (sd + mean);
  return {
    saves: ts.length,
    intervals: iv.length,
    medianGapSec: round(median(iv)),
    meanGapSec: round(mean),
    burstiness: round(b),
  };
}

// Compare start/end artifact snapshots; flag any that grew or appeared.
function diffArtifacts(startArr = [], endArr = []) {
  const startMap = new Map((startArr || []).map((a) => [a.label, a]));
  return (endArr || []).map((a) => {
    const before = startMap.get(a.label);
    const grewBy = a.size - (before?.size ?? 0);
    return {
      label: a.label,
      path: a.path,
      sizeBytes: a.size,
      grewBytes: before ? grewBy : a.size,
      grew: !before || grewBy > 0 || a.mtime > (before?.mtime ?? 0),
    };
  });
}

const round = (n) => Math.round(n * 100) / 100;
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
