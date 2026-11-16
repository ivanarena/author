import { describe, expect, it } from 'vitest';
import type { PushRequest } from '@author/api-types';
import { MAX_HISTORY_SNAPSHOTS_PER_RECORD, type Note } from '@author/schema';
import { fixtureDevice, fixtureNote } from '@author/test-fixtures';
import { all as queryAll, openMemoryDatabase, run as runSql } from './db';
import { pushChanges, RecordLimitExceededError } from './repository';

type MemoryDb = Awaited<ReturnType<typeof openMemoryDatabase>>;

const owner = 'alice';
const otherDevice = { id: 'other-device', name: 'Other phone' };

function encryptedNote(overrides: Partial<Note> = {}): Note {
  return {
    ...fixtureNote,
    id: 'snapshot-note',
    title: 'enc:v4:key:iv:title',
    body: 'enc:v4:key:iv:body',
    titleHash: 'hash:v3:title',
    bodyHash: 'hash:v3:body-1',
    notebookIds: [],
    notebookId: null,
    deviceId: fixtureDevice.id,
    ...overrides
  };
}

async function push(
  db: MemoryDb,
  notes: PushRequest['notes'],
  device = fixtureDevice,
  options: Parameters<typeof pushChanges>[3] = {}
) {
  return await pushChanges(
    db,
    { device, notebooks: [], notes },
    owner,
    options
  );
}

async function snapshots(db: MemoryDb, noteId = 'snapshot-note') {
  return (await queryAll(
    db,
    `SELECT id, reason, version, device_id, body_hash, saved_at
     FROM note_versions
     WHERE owner_username = ? AND note_id = ?
     ORDER BY id`,
    [owner, noteId]
  )) as unknown as Array<{
    id: number;
    reason: string;
    version: number;
    device_id: string;
    body_hash: string | null;
    saved_at: string;
  }>;
}

async function ageSnapshots(db: MemoryDb, minutes: number): Promise<void> {
  const rows = await queryAll(
    db,
    'SELECT id, saved_at FROM note_versions WHERE owner_username = ?',
    [owner]
  );
  for (const row of rows) {
    const aged = new Date(
      Date.parse(String(row.saved_at)) - minutes * 60_000
    ).toISOString();
    await runSql(db, 'UPDATE note_versions SET saved_at = ? WHERE id = ?', [
      aged,
      Number(row.id)
    ]);
  }
}

describe('server version snapshot policy', () => {
  it('keeps one push snapshot per note per window', async () => {
    const db = await openMemoryDatabase();
    try {
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      for (let version = 2; version <= 6; version += 1) {
        const result = await push(db, [
          {
            record: encryptedNote({
              version,
              bodyHash: `hash:v3:body-${version}`,
              updatedAt: new Date(
                Date.UTC(2026, 4, 1, 10, version)
              ).toISOString()
            }),
            baseVersion: version - 1
          }
        ]);
        expect(result.accepted).toHaveLength(1);
      }
      expect((await snapshots(db)).map((row) => row.reason)).toEqual(['push']);

      await ageSnapshots(db, 11);
      await push(db, [
        {
          record: encryptedNote({ version: 7, bodyHash: 'hash:v3:body-7' }),
          baseVersion: 6
        }
      ]);
      const rows = await snapshots(db);
      expect(rows.map((row) => row.reason)).toEqual(['push', 'push']);
      expect(rows.at(-1)?.body_hash).toBe('hash:v3:body-7');
    } finally {
      db.close();
    }
  });

  it('keeps the last state from another device before overwriting it', async () => {
    const db = await openMemoryDatabase();
    try {
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      await push(db, [
        {
          record: encryptedNote({ version: 2, bodyHash: 'hash:v3:body-2' }),
          baseVersion: 1
        }
      ]);
      await push(
        db,
        [
          {
            record: encryptedNote({
              version: 3,
              bodyHash: 'hash:v3:body-3',
              deviceId: otherDevice.id
            }),
            baseVersion: 2
          }
        ],
        otherDevice
      );

      const rows = await snapshots(db);
      expect(
        rows.map((row) => [row.reason, row.version, row.body_hash])
      ).toEqual([
        ['push', 1, 'hash:v3:body-1'],
        ['handoff', 2, 'hash:v3:body-2']
      ]);
    } finally {
      db.close();
    }
  });

  it('does not store new conflict snapshots when a conflicting push is retried', async () => {
    const db = await openMemoryDatabase();
    try {
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      await push(db, [
        {
          record: encryptedNote({ version: 2, bodyHash: 'hash:v3:body-2' }),
          baseVersion: 1
        }
      ]);
      const stale = {
        record: encryptedNote({
          version: 2,
          bodyHash: 'hash:v3:stale',
          deviceId: otherDevice.id,
          updatedAt: '2026-05-01T09:00:00.000Z'
        }),
        baseVersion: 1
      };

      const first = await push(db, [stale], otherDevice);
      const retry = await push(db, [stale], otherDevice);

      expect(first.conflicts).toHaveLength(1);
      expect(retry.conflicts).toHaveLength(1);
      const conflictRows = (await snapshots(db)).filter(
        (row) => row.reason === 'conflict'
      );
      expect(conflictRows.map((row) => row.body_hash).sort()).toEqual([
        'hash:v3:body-2',
        'hash:v3:stale'
      ]);
    } finally {
      db.close();
    }
  });

  it('keeps only the newest history snapshots per note', async () => {
    const db = await openMemoryDatabase();
    try {
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      for (
        let version = 2;
        version <= MAX_HISTORY_SNAPSHOTS_PER_RECORD + 5;
        version += 1
      ) {
        await ageSnapshots(db, 11);
        await push(db, [
          {
            record: encryptedNote({
              version,
              bodyHash: `hash:v3:body-${version}`
            }),
            baseVersion: version - 1
          }
        ]);
      }

      const rows = await snapshots(db);
      expect(rows).toHaveLength(MAX_HISTORY_SNAPSHOTS_PER_RECORD);
      expect(rows.at(-1)?.version).toBe(MAX_HISTORY_SNAPSHOTS_PER_RECORD + 5);
      expect(rows[0]?.version).toBe(6);
    } finally {
      db.close();
    }
  });

  it('keeps one history snapshot per day once history is older than a day', async () => {
    const db = await openMemoryDatabase();
    try {
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      const now = Date.now();
      const day = 24 * 60 * 60_000;
      const inserted: Array<{ savedAt: string; reason: string }> = [];
      for (const daysAgo of [5, 4, 3]) {
        for (const hour of [1, 9, 17]) {
          const savedAt = new Date(now - daysAgo * day);
          savedAt.setUTCHours(hour, 0, 0, 0);
          inserted.push({ savedAt: savedAt.toISOString(), reason: 'push' });
        }
      }
      inserted.push({
        savedAt: new Date(now - 4 * day).toISOString(),
        reason: 'conflict'
      });
      const olderHandoff = new Date(now - 5 * day);
      olderHandoff.setUTCHours(3, 0, 0, 0);
      inserted.push({ savedAt: olderHandoff.toISOString(), reason: 'handoff' });
      inserted.push({
        savedAt: new Date(now - 60 * 60_000).toISOString(),
        reason: 'push'
      });
      inserted.push({
        savedAt: new Date(now - 30 * 60_000).toISOString(),
        reason: 'push'
      });
      for (const [index, row] of inserted.entries()) {
        await runSql(
          db,
          `INSERT INTO note_versions (
             note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id,
             created_at, updated_at, deleted_at, trashed_at, is_favorite, device_id, version,
             saved_at, reason
           ) VALUES (?, ?, 'title', 'body', 'hash:v3:title', ?, '[]', NULL, ?, ?, NULL, NULL, 0, ?, 1, ?, ?)`,
          [
            'snapshot-note',
            owner,
            `hash:v3:old-${index}`,
            fixtureNote.createdAt,
            fixtureNote.updatedAt,
            fixtureDevice.id,
            row.savedAt,
            row.reason
          ]
        );
      }
      await runSql(
        db,
        `DELETE FROM note_versions
         WHERE owner_username = ? AND body_hash = 'hash:v3:body-1'`,
        [owner]
      );

      await push(db, [
        {
          record: encryptedNote({ version: 2, bodyHash: 'hash:v3:body-2' }),
          baseVersion: 1
        }
      ]);

      const rows = await snapshots(db);
      const history = rows.filter((row) => row.reason === 'push');
      const olderDays = history
        .filter((row) => Date.parse(row.saved_at) < now - day)
        .map((row) => row.saved_at.slice(0, 10));
      // Older days keep only their newest snapshot (the 17:00 one).
      expect(olderDays).toHaveLength(3);
      expect(new Set(olderDays).size).toBe(3);
      expect(
        history
          .filter((row) => Date.parse(row.saved_at) < now - day)
          .every((row) => row.saved_at.slice(11, 13) === '17')
      ).toBe(true);
      // The last day stays dense, and conflict snapshots are untouched.
      expect(
        history.filter((row) => Date.parse(row.saved_at) >= now - day)
      ).toHaveLength(3);
      expect(rows.filter((row) => row.reason === 'conflict')).toHaveLength(1);
      // Handoff snapshots keep another device's last state; they are not
      // thinned by day.
      expect(rows.filter((row) => row.reason === 'handoff')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('defers conflicts beyond the response budget without storing them', async () => {
    const db = await openMemoryDatabase();
    try {
      const ids = ['conflict-a', 'conflict-b', 'conflict-c'];
      await push(
        db,
        ids.map((id) => ({
          record: encryptedNote({ id, version: 1 }),
          baseVersion: 0
        }))
      );
      await push(
        db,
        ids.map((id) => ({
          record: encryptedNote({
            id,
            version: 2,
            bodyHash: 'hash:v3:remote-2'
          }),
          baseVersion: 1
        }))
      );

      const result = await push(
        db,
        ids.map((id) => ({
          record: encryptedNote({
            id,
            version: 2,
            bodyHash: 'hash:v3:stale',
            deviceId: otherDevice.id
          }),
          baseVersion: 1
        })),
        otherDevice,
        { conflictResponseBytes: 1 }
      );

      expect(result.accepted).toEqual([]);
      expect(result.conflicts.map((conflict) => conflict.entityId)).toEqual([
        'conflict-a'
      ]);
      const conflictSnapshots = await queryAll(
        db,
        `SELECT note_id FROM note_versions
         WHERE owner_username = ? AND reason = 'conflict'`,
        [owner]
      );
      expect([
        ...new Set(conflictSnapshots.map((row) => String(row.note_id)))
      ]).toEqual(['conflict-a']);
    } finally {
      db.close();
    }
  });

  it('drops the oldest edit history instead of rejecting live edits at the storage limit', async () => {
    const db = await openMemoryDatabase();
    try {
      const recordLimitEnv = {
        NOTES_RECORD_LIMITS_ENABLED: 'true',
        NOTES_RECORD_LIMIT_STORAGE_BYTES: '200000',
        NOTES_RECORD_LIMIT_SAFETY_RATIO: '1',
        NOTES_RECORD_LIMIT_NOTE_BYTES: '1000',
        NOTES_RECORD_LIMIT_NOTEBOOK_BYTES: '1000'
      };
      await push(db, [
        { record: encryptedNote({ version: 1 }), baseVersion: 0 }
      ]);
      const bulkyBody = 'x'.repeat(20_000);
      for (let index = 0; index < 12; index += 1) {
        await runSql(
          db,
          `INSERT INTO note_versions (
             note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id,
             created_at, updated_at, deleted_at, trashed_at, is_favorite, device_id, version,
             saved_at, reason
           ) VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?, NULL, NULL, 0, ?, ?, ?, ?)`,
          [
            'snapshot-note',
            owner,
            'title',
            bulkyBody,
            'hash:v3:title',
            `hash:v3:old-${index}`,
            fixtureNote.createdAt,
            fixtureNote.updatedAt,
            fixtureDevice.id,
            1,
            new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
            index === 0 ? 'conflict' : 'push'
          ]
        );
      }

      const result = await push(
        db,
        [
          {
            record: encryptedNote({ version: 2, bodyHash: 'hash:v3:body-2' }),
            baseVersion: 1
          }
        ],
        fixtureDevice,
        { enforceRecordLimits: true, recordLimitEnv }
      );

      expect(result.accepted).toHaveLength(1);
      const rows = await snapshots(db);
      // The conflict snapshot is kept even though it is the oldest row.
      expect(rows.some((row) => row.body_hash === 'hash:v3:old-0')).toBe(true);
      expect(rows.some((row) => row.body_hash === 'hash:v3:old-1')).toBe(false);
      expect(rows.some((row) => row.body_hash === 'hash:v3:old-11')).toBe(true);

      // Live data that alone exceeds the budget is still rejected.
      await expect(
        push(
          db,
          [
            {
              record: encryptedNote({
                id: 'too-large-for-budget',
                version: 1,
                body: 'y'.repeat(250_000)
              }),
              baseVersion: 0
            }
          ],
          fixtureDevice,
          { enforceRecordLimits: true, recordLimitEnv }
        )
      ).rejects.toBeInstanceOf(RecordLimitExceededError);
      expect(
        (await snapshots(db)).some((row) => row.body_hash === 'hash:v3:old-11')
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});
