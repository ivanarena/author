import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDevice, fixtureNote } from '@author/test-fixtures';
import { runScheduledTrashCleanup } from './cleanup-scheduler';
import { get, openConfiguredDatabase, run } from './db';
import { getNote, pushChanges } from './repository';
import type { RuntimeEnv } from './config';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'author-cleanup-scheduler-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  globalThis.__authorCleanupRunning = false;
});

describe('trash cleanup scheduler', () => {
  it('can run cleanup directly against a Turso primary database', async () => {
    const primaryPath = join(tempDir, 'primary.sqlite');
    const env: RuntimeEnv = {
      NOTES_DB_PROVIDER: 'turso',
      TURSO_DATABASE_URL: `file:${primaryPath}`,
      TURSO_AUTH_TOKEN: 'test-token',
      NOTES_CLEANUP_ENABLED: 'true'
    };
    const db = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${primaryPath}`, authToken: 'test-token' }
    });

    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...fixtureNote,
              trashedAt: '2020-01-01T00:00:00.000Z'
            },
            baseVersion: 0
          }
        ]
      });
      expect(await getNote(db, fixtureNote.id)).not.toBeNull();
      await run(
        db,
        'UPDATE notes SET retention_started_at = ? WHERE owner_username = ? AND id = ?',
        ['2020-01-01T00:00:00.000Z', 'legacy-token', fixtureNote.id]
      );
    } finally {
      db.close();
    }

    await runScheduledTrashCleanup(env);

    const checked = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${primaryPath}`, authToken: 'test-token' }
    });
    try {
      expect(await getNote(checked, fixtureNote.id)).toBeNull();
      await expect(
        get(
          checked,
          'SELECT entity_type FROM entity_tombstones WHERE entity_id = ?',
          [fixtureNote.id]
        )
      ).resolves.toMatchObject({ entity_type: 'note' });
    } finally {
      checked.close();
    }
  });
});
