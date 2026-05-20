import {
  getCleanupIntervalMs,
  isCleanupSchedulerEnabled,
  shouldSyncRemoteDatabase,
  shouldRunCleanupOnStart
} from './config';
import { openDatabase } from './db';
import { cleanupTrash } from './repository';
import { syncRemoteDatabase } from './remote-sync';

declare global {
  var __authorCleanupScheduler: NodeJS.Timeout | undefined;
  var __authorCleanupRunning: boolean | undefined;
}

export async function runScheduledTrashCleanup(): Promise<void> {
  if (globalThis.__authorCleanupRunning) return;

  globalThis.__authorCleanupRunning = true;
  const db = await openDatabase();
  try {
    const result = await cleanupTrash(db);
    if (result.deletedNotes || result.deletedNotebooks) {
      console.info(
        `Trash cleanup deleted ${result.deletedNotes} notes and ${result.deletedNotebooks} notebooks older than ${result.cutoff}`
      );
      if (shouldSyncRemoteDatabase()) {
        await syncRemoteDatabase(db);
      }
    }
  } catch (error) {
    console.error('Trash cleanup failed', error);
  } finally {
    db.close();
    globalThis.__authorCleanupRunning = false;
  }
}

export function startTrashCleanupScheduler(): void {
  if (!isCleanupSchedulerEnabled() || globalThis.__authorCleanupScheduler)
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
