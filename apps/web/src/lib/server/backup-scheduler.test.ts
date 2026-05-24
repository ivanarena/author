import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScheduledDatabaseBackup } from './backup-scheduler';
import { setRuntimeEnv } from './config';
import { get, openConfiguredDatabase, openDatabase, run } from './db';

const ENV_KEYS = [
  'NOTES_DB_PATH',
  'NOTES_BACKUP_ENABLED',
  'NOTES_BACKUP_DIR',
  'NOTES_BACKUP_RETENTION_COUNT',
  'NOTES_DB_PROVIDER'
] as const;

const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  setRuntimeEnv(null);
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.__authorDatabaseBackupRunning = false;
}

beforeEach(() => {
  restoreEnv();
});

afterEach(() => {
  restoreEnv();
});

describe('database backup scheduler', () => {
  it('writes a restorable SQLite snapshot', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-backup-'));
    const dbPath = join(tempDir, 'notes.sqlite');
    const backupDir = join(tempDir, 'backups');

    process.env.NOTES_DB_PATH = dbPath;
    process.env.NOTES_BACKUP_ENABLED = 'true';
    process.env.NOTES_BACKUP_DIR = backupDir;
    delete process.env.NOTES_DB_PROVIDER;

    try {
      const db = await openDatabase();
      try {
        await run(
          db,
          'INSERT INTO devices (id, name, last_seen_at) VALUES (?, ?, ?)',
          ['backup-device', 'Backup Device', '2026-05-13T10:00:00.000Z']
        );
      } finally {
        db.close();
      }

      const backupPath = await runScheduledDatabaseBackup(
        new Date('2026-05-13T10:30:00.000Z')
      );
      if (!backupPath) throw new Error('Expected backup path');

      expect(backupPath).toBe(
        join(backupDir, 'notes-20260513T103000-000Z.sqlite')
      );
      expect(existsSync(backupPath)).toBe(true);

      const restored = await openConfiguredDatabase({
        provider: 'local',
        filePath: backupPath,
        client: { url: `file:${backupPath}` }
      });
      try {
        await expect(
          get(restored, 'SELECT name FROM devices WHERE id = ?', [
            'backup-device'
          ])
        ).resolves.toMatchObject({ name: 'Backup Device' });
      } finally {
        restored.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps only the configured number of snapshots', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-backup-retention-'));
    const dbPath = join(tempDir, 'notes.sqlite');
    const backupDir = join(tempDir, 'backups');

    process.env.NOTES_DB_PATH = dbPath;
    process.env.NOTES_BACKUP_ENABLED = 'true';
    process.env.NOTES_BACKUP_DIR = backupDir;
    process.env.NOTES_BACKUP_RETENTION_COUNT = '2';
    delete process.env.NOTES_DB_PROVIDER;

    try {
      const db = await openDatabase();
      db.close();

      await runScheduledDatabaseBackup(new Date('2026-05-13T10:00:00.000Z'));
      await runScheduledDatabaseBackup(new Date('2026-05-13T11:00:00.000Z'));
      await runScheduledDatabaseBackup(new Date('2026-05-13T12:00:00.000Z'));

      expect(readdirSync(backupDir).sort()).toEqual([
        'notes-20260513T110000-000Z.sqlite',
        'notes-20260513T120000-000Z.sqlite'
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not run for Turso-primary deployments', async () => {
    process.env.NOTES_BACKUP_ENABLED = 'true';
    process.env.NOTES_DB_PROVIDER = 'turso';

    await expect(runScheduledDatabaseBackup()).resolves.toBeNull();
  });
});
