import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, run } from './db';

const ENV_KEYS = [
  'NOTES_DB_PROVIDER',
  'NOTES_DB_PATH',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN'
] as const;

function restoreEnv(previous: Map<(typeof ENV_KEYS)[number], string | undefined>): void {
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
    const tempDir = mkdtempSync(join(tmpdir(), 'author-notes-db-config-'));
    const dbPath = join(tempDir, 'notes.sqlite');

    process.env.NOTES_DB_PROVIDER = 'turso';
    process.env.NOTES_DB_PATH = dbPath;
    process.env.TURSO_DATABASE_URL = 'libsql://not-used.invalid';
    process.env.TURSO_AUTH_TOKEN = 'not-used';

    try {
      const db = await openDatabase();
      try {
        await run(db, 'INSERT INTO devices (id, name, last_seen_at) VALUES (?, ?, ?)', [
          'local-device',
          'Local device',
          new Date().toISOString()
        ]);
      } finally {
        db.close();
      }

      expect(existsSync(dbPath)).toBe(true);
    } finally {
      restoreEnv(previous);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
