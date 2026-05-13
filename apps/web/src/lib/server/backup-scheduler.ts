import {
  getConfiguredDatabaseBackupDir,
  getDatabaseBackupIntervalMs,
  getDatabaseBackupRetentionCount,
  getDatabasePath,
  isDatabaseBackupSchedulerEnabled,
  isTursoPrimaryDatabase,
  resolveServerPath,
  shouldRunDatabaseBackupOnStart
} from './config';
import { openDatabase } from './db';

declare global {
  var __authorDatabaseBackupScheduler: NodeJS.Timeout | undefined;
  var __authorDatabaseBackupRunning: boolean | undefined;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupTimestamp(now: Date): string {
  return now
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.', '-');
}

async function defaultBackupDir(): Promise<string> {
  const { dirname, join } = await import('node:path');
  return resolveServerPath(join(dirname(getDatabasePath()), 'backups'));
}

async function backupPaths(now: Date): Promise<{
  backupDir: string;
  backupPath: string;
  backupPrefix: string;
}> {
  const { basename, join } = await import('node:path');
  const dbPath = getDatabasePath();
  const dbFile = basename(dbPath, '.sqlite');
  const backupPrefix = `${dbFile}-`;
  const backupDir =
    getConfiguredDatabaseBackupDir() ?? (await defaultBackupDir());
  return {
    backupDir,
    backupPath: join(
      backupDir,
      `${backupPrefix}${backupTimestamp(now)}.sqlite`
    ),
    backupPrefix
  };
}

async function pruneOldBackups(
  backupDir: string,
  backupPrefix: string,
  keepCount: number
): Promise<void> {
  const { readdir, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(backupPrefix) &&
        entry.name.endsWith('.sqlite')
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();

  await Promise.all(
    backups.slice(keepCount).map((name) => unlink(join(backupDir, name)))
  );
}

export async function runScheduledDatabaseBackup(
  now = new Date()
): Promise<string | null> {
  if (
    !isDatabaseBackupSchedulerEnabled() ||
    isTursoPrimaryDatabase() ||
    globalThis.__authorDatabaseBackupRunning
  ) {
    return null;
  }

  globalThis.__authorDatabaseBackupRunning = true;
  const { mkdir } = await import('node:fs/promises');
  const { backupDir, backupPath, backupPrefix } = await backupPaths(now);
  const db = await openDatabase();
  try {
    await mkdir(backupDir, { recursive: true });
    await db.execute(`VACUUM INTO ${sqlString(backupPath)}`);
    await pruneOldBackups(
      backupDir,
      backupPrefix,
      getDatabaseBackupRetentionCount()
    );
    console.info(`Database backup written to ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.error('Database backup failed', error);
    return null;
  } finally {
    db.close();
    globalThis.__authorDatabaseBackupRunning = false;
  }
}

export function startDatabaseBackupScheduler(): void {
  if (
    !isDatabaseBackupSchedulerEnabled() ||
    isTursoPrimaryDatabase() ||
    globalThis.__authorDatabaseBackupScheduler
  ) {
    return;
  }

  const intervalMs = getDatabaseBackupIntervalMs();
  if (shouldRunDatabaseBackupOnStart()) {
    setTimeout(() => {
      void runScheduledDatabaseBackup();
    }, 5000);
  }

  globalThis.__authorDatabaseBackupScheduler = setInterval(() => {
    void runScheduledDatabaseBackup();
  }, intervalMs);
  globalThis.__authorDatabaseBackupScheduler.unref?.();
}
