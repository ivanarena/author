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
  SERVER_MIGRATIONS,
  withWriteTransaction
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

  it('keeps local SQLite writes serialized in process', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-local-queue-'));
    const dbPath = join(tempDir, 'local.sqlite');
    const config = {
      provider: 'local' as const,
      filePath: dbPath,
      client: { url: `file:${dbPath}` }
    };
    const first = await openConfiguredDatabase(config);
    const second = await openConfiguredDatabase(config);
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    try {
      const firstWrite = withWriteTransaction(first, async () => {
        markFirstStarted();
        await holdFirst;
      });
      await firstStarted;

      let secondCompleted = false;
      const secondWrite = run(second, 'SELECT 1').then(() => {
        secondCompleted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const secondWasBlocked = !secondCompleted;

      releaseFirst();
      await Promise.all([firstWrite, secondWrite]);
      expect(secondWasBlocked).toBe(true);
      expect(secondCompleted).toBe(true);
    } finally {
      releaseFirst();
      first.close();
      second.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
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

  it('creates account-scoped device constraints in fresh databases', async () => {
    const db = await openMemoryDatabase();
    try {
      await expect(
        get(
          db,
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'invitation_codes'`
        )
      ).resolves.toBeNull();

      const deviceColumns = await all(db, 'PRAGMA table_info(devices)');
      const primaryKeyColumns = deviceColumns
        .filter((row) => Number(row.pk ?? 0) > 0)
        .sort((left, right) => Number(left.pk) - Number(right.pk))
        .map((row) => row.name);
      expect(primaryKeyColumns).toEqual(['owner_username', 'id']);

      const trustedDeviceKeys = await all(
        db,
        'PRAGMA foreign_key_list(trusted_auth_devices)'
      );
      expect(trustedDeviceKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'devices',
            from: 'username',
            to: 'owner_username'
          }),
          expect.objectContaining({
            table: 'devices',
            from: 'device_id',
            to: 'id',
            on_delete: 'CASCADE'
          })
        ])
      );
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

  it('migrates globally keyed devices into account-scoped rows', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-device-migration-'));
    const dbPath = join(tempDir, 'old-devices.sqlite');
    const { createClient } = await import('@libsql/client');
    const legacy = createClient({ url: `file:${dbPath}` });
    let legacyClosed = false;
    const now = '2026-05-10T10:00:00.000Z';

    try {
      await legacy.executeMultiple(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE invitation_codes (
          code TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          disabled_at TEXT
        );
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES
          (1, 'applied', '${now}'),
          (2, 'applied', '${now}'),
          (3, 'applied', '${now}'),
          (4, 'applied', '${now}'),
          (5, 'applied', '${now}'),
          (6, 'applied', '${now}'),
          (7, 'applied', '${now}'),
          (8, 'applied', '${now}'),
          (9, 'applied', '${now}'),
          (10, 'applied', '${now}'),
          (11, 'applied', '${now}'),
          (12, 'applied', '${now}'),
          (13, 'applied', '${now}'),
          (14, 'applied', '${now}'),
          (15, 'applied', '${now}');
        CREATE TABLE users (
          username TEXT PRIMARY KEY,
          email TEXT,
          display_name TEXT,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          totp_secret TEXT,
          totp_enabled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          owner_username TEXT NOT NULL DEFAULT 'legacy-token',
          name TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE TABLE auth_sessions (
          token_hash TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          device_id TEXT,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        );
        CREATE TABLE trusted_auth_devices (
          username TEXT NOT NULL,
          device_id TEXT NOT NULL,
          secret_hash TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT NOT NULL,
          PRIMARY KEY (username, device_id),
          FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        INSERT INTO users (
          username, password_hash, password_salt, created_at, updated_at
        )
        VALUES
          ('alice', 'argon2id-scram-sha256:v1:test', 'salt', '${now}', '${now}'),
          ('bob', 'argon2id-scram-sha256:v1:test', 'salt', '${now}', '${now}');
        INSERT INTO devices (id, owner_username, name, last_seen_at)
        VALUES ('shared-device', 'alice', 'Alice laptop', '${now}');
        INSERT INTO auth_sessions (
          token_hash, username, device_id, created_at, last_seen_at, expires_at
        )
        VALUES
          ('alice-token', 'alice', 'shared-device', '${now}', '${now}', '2026-06-10T10:00:00.000Z'),
          ('bob-token', 'bob', 'shared-device', '${now}', '${now}', '2026-06-10T10:00:00.000Z');
        INSERT INTO trusted_auth_devices (
          username, device_id, secret_hash, created_at, last_used_at
        )
        VALUES
          ('alice', 'shared-device', 'alice-secret', '${now}', '${now}'),
          ('bob', 'shared-device', 'bob-secret', '${now}', '${now}');
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
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'invitation_codes'`
          )
        ).resolves.toBeNull();

        await expect(
          get(
            upgraded,
            `SELECT count(*) AS count
             FROM devices
             WHERE id = ?`,
            ['shared-device']
          )
        ).resolves.toMatchObject({ count: 2 });
        await expect(
          get(
            upgraded,
            `SELECT name FROM devices
             WHERE owner_username = ? AND id = ?`,
            ['bob', 'shared-device']
          )
        ).resolves.toMatchObject({ name: 'shared-device' });

        await run(upgraded, 'DELETE FROM devices WHERE owner_username = ?', [
          'alice'
        ]);

        await expect(
          get(
            upgraded,
            `SELECT device_id
             FROM auth_sessions
             WHERE username = ?`,
            ['bob']
          )
        ).resolves.toMatchObject({ device_id: 'shared-device' });
        await expect(
          get(
            upgraded,
            `SELECT secret_hash
             FROM trusted_auth_devices
             WHERE username = ? AND device_id = ?`,
            ['bob', 'shared-device']
          )
        ).resolves.toMatchObject({ secret_hash: 'bob-secret' });
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

  it('refuses server databases with non-current password verifiers', async () => {
    const db = await openMemoryDatabase();
    const migration = currentOnlyMigration();
    const now = new Date().toISOString();
    try {
      await run(
        db,
        `INSERT INTO users (
           username, password_hash, password_salt, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          'old-user',
          'argon2id:v1:m=19456,t=2,p=1:old-hash',
          'old-salt',
          now,
          now
        ]
      );

      await expect(migration.up(db)).rejects.toThrow(/non-current/);
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
