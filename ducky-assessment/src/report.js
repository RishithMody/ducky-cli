import fs from 'node:fs';
import { readEvents } from './state.js';
import { gitCommitsBetween, scanAiConfig, scanEditorExtensions } from './trackers.js';

// A file change is a "burst" (likely AI insertion) if a single event adds a
// lot of bytes at once.
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

  // File edit aggregation + burst detection.
  const byFile = {};
  let bursts = 0, totalAdded = 0;
  for (const f of fileEvents) {
    const e = (byFile[f.file] ||= { edits: 0, bytesAdded: 0, bursts: 0 });
    e.edits++;
    if (f.delta > 0) { e.bytesAdded += f.delta; totalAdded += f.delta; }
    if (f.delta >= BURST_BYTES) { e.bursts++; bursts++; }
  }

  const gitStart = session.gitStart;
  const gitEnd = session.gitEnd;
  let commits = [];
  if (gitStart && gitEnd) commits = gitCommitsBetween(p.projectDir, gitStart.head, gitEnd.head);

  const aiProcDetected = aiProcs.size > 0;
  const aiNetDetected = aiHosts.size > 0;

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
      processes: {
        aiToolsDetected: aiProcDetected,
        tools: Object.fromEntries(aiProcs),
      },
      network: {
        aiEndpointsDetected: aiNetDetected,
        hosts: Object.fromEntries(aiHosts),
      },
      files: {
        filesTouched: Object.keys(byFile).length,
        totalEdits: fileEvents.length,
        bytesAdded: totalAdded,
        burstEdits: bursts,
        perFile: byFile,
      },
      git: {
        start: gitStart || null,
        end: gitEnd || null,
        commitsDuringSession: commits.length,
        aiAssistedCommits: commits.filter((c) => c.aiAssisted).length,
        commits,
      },
      environment: {
        aiConfigFiles: scanAiConfig(p.projectDir),
        editorAiExtensions: scanEditorExtensions(),
      },
    },
    summary: {
      // High-level verdict combining the independent signals.
      aiUsageLikely: aiProcDetected || aiNetDetected || bursts > 0 || commits.some((c) => c.aiAssisted),
      signals: {
        aiProcesses: aiProcs.size,
        aiNetworkHosts: aiHosts.size,
        burstEdits: bursts,
        aiAssistedCommits: commits.filter((c) => c.aiAssisted).length,
      },
    },
  };

  fs.writeFileSync(p.report, JSON.stringify(report, null, 2));
  return report;
}

function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m ${s % 60}s`;
}
