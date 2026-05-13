import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDatabasePath } from './config';
import {
  appliedMigrationVersions,
  get,
  openConfiguredDatabase,
  openDatabase,
  openMemoryDatabase,
  run,
  runPendingMigrations,
  SERVER_MIGRATIONS
} from './db';

const ENV_KEYS = [
  'NOTES_DB_PROVIDER',
  'NOTES_DB_PATH',
  'NODE_ENV',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN'
] as const;

function restoreEnv(
  previous: Map<(typeof ENV_KEYS)[number], string | undefined>
): void {
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('server database config', () => {
  it('keeps openDatabase on local SQLite even with the legacy Turso provider env set', async () => {
    const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    const tempDir = mkdtempSync(join(tmpdir(), 'author-db-config-'));
    const dbPath = join(tempDir, 'notes.sqlite');

    process.env.NOTES_DB_PROVIDER = 'turso';
    process.env.NOTES_DB_PATH = dbPath;
    process.env.TURSO_DATABASE_URL = 'libsql://not-used.invalid';
    process.env.TURSO_AUTH_TOKEN = 'not-used';

    try {
      const db = await openDatabase();
      try {
        await run(
          db,
          'INSERT INTO devices (id, name, last_seen_at) VALUES (?, ?, ?)',
          ['local-device', 'Local device', new Date().toISOString()]
        );
      } finally {
        db.close();
      }

      expect(existsSync(dbPath)).toBe(true);
    } finally {
      restoreEnv(previous);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the local workspace data directory when /data is not writable', () => {
    expect(resolveDatabasePath('/data/notes.sqlite', false)).toBe(
      resolve('.data/notes.sqlite')
    );
  });

  it('keeps the container data directory when it is writable', () => {
    expect(resolveDatabasePath('/data/notes.sqlite', true)).toBe(
      resolve('/data/notes.sqlite')
    );
  });
});

describe('server database migrations', () => {
  it('records all versioned migrations and remains idempotent', async () => {
    const db = await openMemoryDatabase();
    try {
      expect(await appliedMigrationVersions(db)).toEqual(
        new Set(SERVER_MIGRATIONS.map((migration) => migration.version))
      );

      const before = await get(
        db,
        'SELECT count(*) AS count FROM schema_migrations'
      );
      await runPendingMigrations(db);
      const after = await get(
        db,
        'SELECT count(*) AS count FROM schema_migrations'
      );

      expect(Number(after?.count)).toBe(Number(before?.count));
    } finally {
      db.close();
    }
  });

  it('restores a copied SQLite backup into a fresh database path', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-restore-'));
    const sourcePath = join(tempDir, 'source.sqlite');
    const backupPath = join(tempDir, 'backup.sqlite');
    const restoredPath = join(tempDir, 'restored.sqlite');

    try {
      const source = await openConfiguredDatabase({
        provider: 'local',
        filePath: sourcePath,
        client: { url: `file:${sourcePath}` }
      });
      try {
        await run(
          source,
          'INSERT INTO devices (id, name, last_seen_at) VALUES (?, ?, ?)',
          ['backup-device', 'Backup Device', '2026-05-10T10:00:00.000Z']
        );
      } finally {
        source.close();
      }

      copyFileSync(sourcePath, backupPath);
      copyFileSync(backupPath, restoredPath);

      const restored = await openConfiguredDatabase({
        provider: 'local',
        filePath: restoredPath,
        client: { url: `file:${restoredPath}` }
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
});
