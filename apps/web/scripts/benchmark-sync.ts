import { performance } from 'node:perf_hooks';
import type { Device, Note, Notebook } from '@author/schema';
import { openMemoryDatabase, type NotesDb } from '../src/lib/server/db';
import { pullChangesSince, pushChanges } from '../src/lib/server/repository';

const DEFAULT_PUSH_BATCH_SIZE = 250;
const DEFAULT_PULL_BATCH_SIZE = 1000;
const DEFAULT_SCENARIOS = [100, 1000, 5000];
const DEFAULT_NOTEBOOKS = 25;
const DEFAULT_BODY_BYTES = 512;

type BenchmarkResult = {
  notes: number;
  notebooks: number;
  pushRequests: number;
  pushMs: number;
  pullPages: number;
  pullMs: number;
  emptyPullMs: number;
  accepted: number;
  pulled: number;
};

const device: Device = {
  id: 'sync-benchmark-device',
  name: 'Sync benchmark'
};

function numberListFromEnv(name: string, fallback: number[]): number[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;

  const parsed = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isSafeInteger(entry) && entry > 0);
  return parsed.length ? parsed : fallback;
}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nowIso(offset: number): string {
  return new Date(Date.UTC(2026, 4, 8, 12, 0, offset)).toISOString();
}

function makeNotebook(index: number): Notebook {
  const createdAt = nowIso(index % 60);
  return {
    id: `bench-notebook-${index}`,
    name: `Benchmark notebook ${index}`,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending'
  };
}

function makeNote(
  index: number,
  notebooks: Notebook[],
  bodyBytes: number
): Note {
  const notebook = notebooks[index % notebooks.length];
  const createdAt = nowIso(index % 60);
  return {
    id: `bench-note-${index}`,
    title: `Benchmark note ${index}`,
    body: `Benchmark body ${index}\n${'x'.repeat(bodyBytes)}`,
    titleHash: `hash:title:${index}`,
    bodyHash: `hash:body:${index}`,
    notebookIds: [notebook.id],
    notebookId: notebook.id,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending'
  };
}

function countPullItems(
  response: Awaited<ReturnType<typeof pullChangesSince>>
) {
  return (
    response.notes.length +
    response.notebooks.length +
    response.deletedNoteIds.length +
    response.deletedNotebookIds.length
  );
}

async function pushAll(
  db: NotesDb,
  notebooks: Notebook[],
  notes: Note[]
): Promise<{ requests: number; accepted: number; ms: number }> {
  let notebookIndex = 0;
  let noteIndex = 0;
  let requests = 0;
  let accepted = 0;
  const start = performance.now();

  while (notebookIndex < notebooks.length || noteIndex < notes.length) {
    const notebookBatch = notebooks
      .slice(notebookIndex, notebookIndex + pushBatchSize)
      .map((record) => ({ record, baseVersion: 0 }));
    const noteBatch = notes
      .slice(noteIndex, noteIndex + pushBatchSize)
      .map((record) => ({ record, baseVersion: 0 }));

    const result = await pushChanges(db, {
      device,
      notebooks: notebookBatch,
      notes: noteBatch
    });
    if (result.conflicts.length) {
      throw new Error(
        `Unexpected benchmark conflicts: ${result.conflicts.length}`
      );
    }

    notebookIndex += notebookBatch.length;
    noteIndex += noteBatch.length;
    accepted += result.accepted.length;
    requests += 1;
  }

  return {
    requests,
    accepted,
    ms: performance.now() - start
  };
}

async function pullAll(
  db: NotesDb
): Promise<{ pages: number; pulled: number; cursor: number; ms: number }> {
  let cursor = 0;
  let pages = 0;
  let pulled = 0;
  let hasMore = true;
  const start = performance.now();

  while (hasMore) {
    const response = await pullChangesSince(db, null, cursor, {
      limit: pullBatchSize
    });
    pages += 1;
    pulled += countPullItems(response);
    cursor = response.serverRevision;
    hasMore = Boolean(response.hasMore);
  }

  return {
    pages,
    pulled,
    cursor,
    ms: performance.now() - start
  };
}

async function timeEmptyPull(db: NotesDb, cursor: number): Promise<number> {
  const start = performance.now();
  await pullChangesSince(db, null, cursor, { limit: pullBatchSize });
  return performance.now() - start;
}

async function benchmarkScenario(
  noteCount: number,
  notebookCount: number,
  bodyBytes: number
): Promise<BenchmarkResult> {
  const db = await openMemoryDatabase();
  try {
    const notebooks = Array.from({ length: notebookCount }, (_, index) =>
      makeNotebook(index)
    );
    const notes = Array.from({ length: noteCount }, (_, index) =>
      makeNote(index, notebooks, bodyBytes)
    );

    const pushed = await pushAll(db, notebooks, notes);
    const pulled = await pullAll(db);
    const emptyPullMs = await timeEmptyPull(db, pulled.cursor);

    return {
      notes: noteCount,
      notebooks: notebookCount,
      pushRequests: pushed.requests,
      pushMs: pushed.ms,
      pullPages: pulled.pages,
      pullMs: pulled.ms,
      emptyPullMs,
      accepted: pushed.accepted,
      pulled: pulled.pulled
    };
  } finally {
    db.close();
  }
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function printResults(results: BenchmarkResult[]): void {
  console.log(
    [
      'notes',
      'notebooks',
      'push req',
      'push',
      'pull pages',
      'pull',
      'empty pull',
      'accepted',
      'pulled'
    ].join('\t')
  );

  for (const result of results) {
    console.log(
      [
        result.notes,
        result.notebooks,
        result.pushRequests,
        formatMs(result.pushMs),
        result.pullPages,
        formatMs(result.pullMs),
        formatMs(result.emptyPullMs),
        result.accepted,
        result.pulled
      ].join('\t')
    );
  }
}

const scenarios = numberListFromEnv('SYNC_BENCH_NOTES', DEFAULT_SCENARIOS);
const notebookCount = numberFromEnv('SYNC_BENCH_NOTEBOOKS', DEFAULT_NOTEBOOKS);
const bodyBytes = numberFromEnv('SYNC_BENCH_BODY_BYTES', DEFAULT_BODY_BYTES);
const pushBatchSize = numberFromEnv(
  'SYNC_BENCH_PUSH_BATCH',
  DEFAULT_PUSH_BATCH_SIZE
);
const pullBatchSize = numberFromEnv(
  'SYNC_BENCH_PULL_BATCH',
  DEFAULT_PULL_BATCH_SIZE
);
const results: BenchmarkResult[] = [];

for (const noteCount of scenarios) {
  results.push(await benchmarkScenario(noteCount, notebookCount, bodyBytes));
}

printResults(results);
console.log(
  `Scope: direct server repository benchmark, push batch ${pushBatchSize}, pull page ${pullBatchSize}, ${bodyBytes} body bytes per note.`
);
