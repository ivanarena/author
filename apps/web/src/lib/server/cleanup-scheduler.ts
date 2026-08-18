import {
  getCleanupIntervalMs,
  getRemoteDatabaseConfig,
  isCleanupSchedulerEnabled,
  isTursoPrimaryDatabase,
  shouldSyncRemoteDatabase,
  shouldRunCleanupOnStart,
  type RuntimeEnv
} from './config';
import { openConfiguredDatabase, openDatabase, type NotesDb } from './db';
import { pruneExpiredAuthState } from './auth';
import {
  cleanupTrash,
  compactEntityChanges,
  pruneUnreferencedDevices
} from './repository';
import { syncRemoteDatabase } from './remote-sync';

declare global {
  var __authorCleanupScheduler: NodeJS.Timeout | undefined;
  var __authorCleanupRunning: boolean | undefined;
  var __authorCleanupLastSuccessAt: string | undefined;
  var __authorCleanupLastFailureAt: string | undefined;
  var __authorCleanupLastDeletedNotes: number | undefined;
  var __authorCleanupLastDeletedNotebooks: number | undefined;
  var __authorCleanupLastCompactedChanges: number | undefined;
}

async function openCleanupDatabase(
  env?: RuntimeEnv | null
): Promise<{ db: NotesDb; shouldMirrorRemote: boolean }> {
  if (!isTursoPrimaryDatabase(env)) {
    return {
      db: await openDatabase(),
      shouldMirrorRemote: shouldSyncRemoteDatabase(env)
    };
  }

  const config = getRemoteDatabaseConfig(env);
  if (!config) {
    throw new Error('Turso primary database is not configured');
  }
  return {
    db: await openConfiguredDatabase(config),
    shouldMirrorRemote: false
  };
}

export async function runScheduledTrashCleanup(
  env?: RuntimeEnv | null
): Promise<void> {
  if (globalThis.__authorCleanupRunning) return;

  globalThis.__authorCleanupRunning = true;
  let db: NotesDb | null = null;
  try {
    const cleanupDb = await openCleanupDatabase(env);
    db = cleanupDb.db;
    const result = await cleanupTrash(db);
    await pruneExpiredAuthState(db);
    await pruneUnreferencedDevices(db);
    const compactedChanges = await compactEntityChanges(db);
    globalThis.__authorCleanupLastSuccessAt = new Date().toISOString();
    globalThis.__authorCleanupLastDeletedNotes = result.deletedNotes;
    globalThis.__authorCleanupLastDeletedNotebooks = result.deletedNotebooks;
    globalThis.__authorCleanupLastCompactedChanges = compactedChanges;
    if (result.deletedNotes || result.deletedNotebooks) {
      console.info(
        `Trash cleanup deleted ${result.deletedNotes} notes and ${result.deletedNotebooks} notebooks older than ${result.cutoff}`
      );
      if (cleanupDb.shouldMirrorRemote) {
        await syncRemoteDatabase(db);
      }
    }
  } catch (error) {
    globalThis.__authorCleanupLastFailureAt = new Date().toISOString();
    console.error('Trash cleanup failed', error);
  } finally {
    db?.close();
    globalThis.__authorCleanupRunning = false;
  }
}

export function resetTrashCleanupStateForTests(): void {
  globalThis.__authorCleanupRunning = false;
  globalThis.__authorCleanupLastSuccessAt = undefined;
  globalThis.__authorCleanupLastFailureAt = undefined;
  globalThis.__authorCleanupLastDeletedNotes = undefined;
  globalThis.__authorCleanupLastDeletedNotebooks = undefined;
  globalThis.__authorCleanupLastCompactedChanges = undefined;
}

export function trashCleanupSnapshot(): {
  running: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDeletedNotes: number;
  lastDeletedNotebooks: number;
  lastCompactedChanges: number;
} {
  return {
    running: Boolean(globalThis.__authorCleanupRunning),
    lastSuccessAt: globalThis.__authorCleanupLastSuccessAt ?? null,
    lastFailureAt: globalThis.__authorCleanupLastFailureAt ?? null,
    lastDeletedNotes: globalThis.__authorCleanupLastDeletedNotes ?? 0,
    lastDeletedNotebooks: globalThis.__authorCleanupLastDeletedNotebooks ?? 0,
    lastCompactedChanges: globalThis.__authorCleanupLastCompactedChanges ?? 0
  };
}

export function startTrashCleanupScheduler(): void {
  if (
    !isCleanupSchedulerEnabled() ||
    isTursoPrimaryDatabase() ||
    globalThis.__authorCleanupScheduler
  )
    return;

  const intervalMs = getCleanupIntervalMs();
  if (shouldRunCleanupOnStart()) {
    setTimeout(() => {
      void runScheduledTrashCleanup();
    }, 1000);
  }

  globalThis.__authorCleanupScheduler = setInterval(() => {
    void runScheduledTrashCleanup();
  }, intervalMs);
  globalThis.__authorCleanupScheduler.unref?.();
}
