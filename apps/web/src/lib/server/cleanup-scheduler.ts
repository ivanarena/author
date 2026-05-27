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
import { cleanupTrash } from './repository';
import { syncRemoteDatabase } from './remote-sync';

declare global {
  var __authorCleanupScheduler: NodeJS.Timeout | undefined;
  var __authorCleanupRunning: boolean | undefined;
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
    if (result.deletedNotes || result.deletedNotebooks) {
      console.info(
        `Trash cleanup deleted ${result.deletedNotes} notes and ${result.deletedNotebooks} notebooks older than ${result.cutoff}`
      );
      if (cleanupDb.shouldMirrorRemote) {
        await syncRemoteDatabase(db);
      }
    }
  } catch (error) {
    console.error('Trash cleanup failed', error);
  } finally {
    db?.close();
    globalThis.__authorCleanupRunning = false;
  }
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
