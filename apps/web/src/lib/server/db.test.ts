import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDatabasePath } from './config';
import {
  appliedMigrationVersions,
  all,
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

function currentOnlyMigration() {
  const migration = SERVER_MIGRATIONS.find(
    (candidate) => candidate.version === 13
  );
  if (!migration) throw new Error('Current-only cleanup migration is missing');
  return migration;
}

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

  it('upgrades older databases before creating indexes on new columns', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-old-schema-'));
    const dbPath = join(tempDir, 'old.sqlite');
    const { createClient } = await import('@libsql/client');
    const legacy = createClient({ url: `file:${dbPath}` });
    let legacyClosed = false;

    try {
      await legacy.executeMultiple(`
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE TABLE users (
          username TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE entity_changes (
          revision INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE notebooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          sync_status TEXT NOT NULL
        );
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          notebook_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          trashed_at TEXT,
          device_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          sync_status TEXT NOT NULL
        );
        CREATE TABLE note_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          notebook_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          trashed_at TEXT,
          device_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          saved_at TEXT NOT NULL,
          reason TEXT NOT NULL
        );
        CREATE TABLE notebook_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          notebook_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          saved_at TEXT NOT NULL,
          reason TEXT NOT NULL
        );
      `);
      legacy.close();
      legacyClosed = true;

      const upgraded = await openConfiguredDatabase({
        provider: 'local',
        filePath: dbPath,
        client: { url: `file:${dbPath}` }
      });
      try {
        await expect(
          get(
            upgraded,
            'SELECT email, display_name, totp_secret FROM users LIMIT 1'
          )
        ).resolves.toBeNull();
        const userColumns = await all(upgraded, 'PRAGMA table_info(users)');
        expect(userColumns.map((row) => row.name)).not.toContain(
          'password_iterations'
        );
        await expect(
          get(
            upgraded,
            'SELECT owner_username, name_hash FROM notebooks LIMIT 1'
          )
        ).resolves.toBeNull();
        await expect(
          get(
            upgraded,
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'users_email_unique_idx'`
          )
        ).resolves.toMatchObject({ name: 'users_email_unique_idx' });
        expect(await appliedMigrationVersions(upgraded)).toEqual(
          new Set(SERVER_MIGRATIONS.map((migration) => migration.version))
        );
      } finally {
        upgraded.close();
      }
    } finally {
      if (!legacyClosed) legacy.close();
      rmSync(tempDir, { recursive: true, force: true });
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

  it('refuses server databases with pre-Argon2 password verifiers', async () => {
    const db = await openMemoryDatabase();
    const migration = currentOnlyMigration();
    const now = new Date().toISOString();
    try {
      await run(
        db,
        `INSERT INTO users (
           username, password_hash, password_salt, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
        ['old-user', 'pbkdf2:v1:old-hash', 'old-salt', now, now]
      );

      await expect(migration.up(db)).rejects.toThrow(/pre-Argon2/);
    } finally {
      db.close();
    }
  });

  it('refuses server databases with unsupported encrypted note envelopes', async () => {
    const db = await openMemoryDatabase();
    const migration = currentOnlyMigration();
    const now = new Date().toISOString();
    try {
      await run(
        db,
        `INSERT INTO notes (
           id, title, body, notebook_ids, created_at, updated_at,
           device_id, version, sync_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'old-note',
          'enc:v2:old-title',
          'enc:v3:new-body',
          '[]',
          now,
          now,
          'device-1',
          1,
          'synced'
        ]
      );

      await expect(migration.up(db)).rejects.toThrow(/enc:v1 or enc:v2/);
    } finally {
      db.close();
    }
  });
});
