import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fixtureDevice,
  fixtureNote,
  fixtureNotebook
} from '@author/test-fixtures';
import {
  authenticateUser,
  createAuthSession,
  listTrustedAuthDevices,
  setUserPassword,
  sessionFromToken,
  trustAuthDevice
} from './auth';
import { all as queryAll, openMemoryDatabase, run as runSql } from './db';
import {
  cleanupTrash as cleanupTrashRepository,
  compactEntityChanges,
  currentRevision,
  deleteDevicesByIds,
  deleteNotebooksByIds,
  deleteNotesByIds,
  getDevicesByIds,
  getEntityTombstonesByIds,
  getNote,
  getNotebook,
  getSyncMeta,
  LEGACY_OWNER_USERNAME,
  listNotebooks,
  pullChangesSince,
  pushChanges,
  setSyncMeta,
  upsertDevice
} from './repository';
import { syncDatabases, syncRemoteDatabase } from './remote-sync';

async function cleanupTrash(
  db: Awaited<ReturnType<typeof openMemoryDatabase>>,
  now: Date,
  ownerUsername?: string
) {
  const ownerFilter = ownerUsername ? ' AND owner_username = ?' : '';
  const ownerArgs = ownerUsername ? [ownerUsername] : [];
  await runSql(
    db,
    `UPDATE notes SET retention_started_at = trashed_at
     WHERE trashed_at IS NOT NULL${ownerFilter}`,
    ownerArgs
  );
  await runSql(
    db,
    `UPDATE notebooks SET retention_started_at = deleted_at
     WHERE deleted_at IS NOT NULL${ownerFilter}`,
    ownerArgs
  );
  return await cleanupTrashRepository(db, now, ownerUsername);
}

async function insertNoteSnapshot(
  db: Awaited<ReturnType<typeof openMemoryDatabase>>,
  {
    noteId,
    ownerUsername,
    savedAt
  }: { noteId: string; ownerUsername: string; savedAt: string }
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO note_versions (
       note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
       deleted_at, trashed_at, is_favorite, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      noteId,
      ownerUsername,
      fixtureNote.title,
      fixtureNote.body,
      fixtureNote.titleHash ?? null,
      fixtureNote.bodyHash ?? null,
      JSON.stringify(fixtureNote.notebookIds),
      fixtureNote.notebookId,
      fixtureNote.createdAt,
      fixtureNote.updatedAt,
      fixtureNote.deletedAt,
      fixtureNote.trashedAt,
      fixtureNote.isFavorite ? 1 : 0,
      fixtureNote.deviceId,
      fixtureNote.version,
      savedAt,
      'push'
    ]
  );
}

async function insertNotebookSnapshot(
  db: Awaited<ReturnType<typeof openMemoryDatabase>>,
  {
    notebookId,
    ownerUsername,
    savedAt
  }: { notebookId: string; ownerUsername: string; savedAt: string }
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO notebook_versions (
       notebook_id, owner_username, name, name_hash, created_at, updated_at, deleted_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notebookId,
      ownerUsername,
      fixtureNotebook.name,
      fixtureNotebook.nameHash ?? null,
      fixtureNotebook.createdAt,
      fixtureNotebook.updatedAt,
      fixtureNotebook.deletedAt,
      fixtureNotebook.deviceId,
      fixtureNotebook.version,
      savedAt,
      'push'
    ]
  );
}

describe('server repository', () => {
  it('accepts new notebook and note pushes, then pulls them', async () => {
    const db = await openMemoryDatabase();
    try {
      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });

      expect(result.conflicts).toHaveLength(0);
      expect(result.accepted).toHaveLength(2);

      const pulled = await pullChangesSince(db, null);
      expect(pulled.notes).toHaveLength(1);
      expect(pulled.notebooks).toHaveLength(1);
      expect(pulled.notes[0].body).toBe(fixtureNote.body);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate entity ids in a single push batch', async () => {
    const db = await openMemoryDatabase();
    try {
      const first = {
        ...fixtureNote,
        id: 'duplicate-batch-note',
        body: 'first body'
      };
      const second = {
        ...fixtureNote,
        id: first.id,
        body: 'second body',
        updatedAt: '2026-01-01T01:00:00.000Z'
      };

      await expect(
        pushChanges(db, {
          device: fixtureDevice,
          notebooks: [],
          notes: [
            { record: first, baseVersion: 0 },
            { record: second, baseVersion: 0 }
          ]
        })
      ).rejects.toThrow('Duplicate note id in sync push');
      expect(await getNote(db, first.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('assigns server-owned versions to new public push records', async () => {
    const db = await openMemoryDatabase();
    try {
      const inflatedNote = {
        ...fixtureNote,
        id: 'inflated-version-note',
        version: 12345
      };
      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [{ record: inflatedNote, baseVersion: 0 }]
      });

      expect(result.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: inflatedNote.id,
          version: 1
        })
      ]);
      await expect(getNote(db, inflatedNote.id)).resolves.toMatchObject({
        version: 1
      });
    } finally {
      db.close();
    }
  });

  it('can preserve new record versions for mirror replication', async () => {
    const db = await openMemoryDatabase();
    try {
      const mirroredNote = {
        ...fixtureNote,
        id: 'mirrored-version-note',
        version: 12345
      };
      const result = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [{ record: mirroredNote, baseVersion: 0 }]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );

      expect(result.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: mirroredNote.id,
          version: 12345
        })
      ]);
      await expect(getNote(db, mirroredNote.id)).resolves.toMatchObject({
        version: 12345
      });
    } finally {
      db.close();
    }
  });

  it('rejects a stale local note push with a conflict instead of overwriting remote data', async () => {
    const db = await openMemoryDatabase();
    try {
      await upsertDevice(db, { id: 'device-b', name: 'Phone' });
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });

      const remoteEdit = {
        ...fixtureNote,
        body: 'Remote edit',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deviceId: 'device-b',
        version: 2,
        syncStatus: 'pending' as const
      };
      await pushChanges(db, {
        device: { id: 'device-b', name: 'Phone' },
        notebooks: [],
        notes: [{ record: remoteEdit, baseVersion: 1 }]
      });

      const staleLocalEdit = {
        ...fixtureNote,
        body: 'Stale local edit',
        updatedAt: '2026-01-02T01:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [{ record: staleLocalEdit, baseVersion: 1 }]
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect((await getNote(db, fixtureNote.id))?.body).toBe('Remote edit');
    } finally {
      db.close();
    }
  });

  it('rejects duplicate active notebook names without overwriting the existing notebook', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: []
      });

      const duplicateNotebook = {
        ...fixtureNotebook,
        id: 'fixture-notebook-copy',
        name: 'inbox',
        updatedAt: '2026-01-01T01:00:00.000Z',
        deviceId: 'device-b',
        syncStatus: 'pending' as const
      };
      const result = await pushChanges(db, {
        device: { id: 'device-b', name: 'Phone' },
        notebooks: [{ record: duplicateNotebook, baseVersion: 0 }],
        notes: []
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe('duplicate_name');
      expect(await listNotebooks(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate plaintext notebook names even when hashes differ', async () => {
    const db = await openMemoryDatabase();
    try {
      const firstNotebook = {
        ...fixtureNotebook,
        id: 'hashed-plaintext-a',
        name: 'Inbox',
        nameHash: 'hash-one'
      };
      const secondNotebook = {
        ...fixtureNotebook,
        id: 'hashed-plaintext-b',
        name: 'inbox',
        nameHash: 'hash-two',
        updatedAt: '2026-01-01T01:00:00.000Z'
      };

      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [
          { record: firstNotebook, baseVersion: 0 },
          { record: secondNotebook, baseVersion: 0 }
        ],
        notes: []
      });

      expect(result.accepted).toEqual([
        expect.objectContaining({ id: firstNotebook.id })
      ]);
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          entityType: 'notebook',
          entityId: secondNotebook.id,
          reason: 'duplicate_name'
        })
      ]);
      expect(await getNotebook(db, firstNotebook.id)).not.toBeNull();
      expect(await getNotebook(db, secondNotebook.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rejects duplicate encrypted notebook name hashes without reading names', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              name: 'enc:v4:key-a:first',
              nameHash: 'hash:v3:notebook-name'
            },
            baseVersion: 0
          }
        ],
        notes: []
      });

      const result = await pushChanges(db, {
        device: { id: 'device-b', name: 'Phone' },
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              id: 'fixture-notebook-copy',
              name: 'enc:v4:key-a:second',
              nameHash: 'hash:v3:notebook-name',
              updatedAt: '2026-01-01T01:00:00.000Z',
              deviceId: 'device-b',
              syncStatus: 'pending'
            },
            baseVersion: 0
          }
        ],
        notes: []
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe('duplicate_name');
      expect(await listNotebooks(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('accepts notes from a batch whose notebook was rejected by removing the unsyncable assignment', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: []
      });

      const duplicateNotebook = {
        ...fixtureNotebook,
        id: 'duplicate-notebook',
        name: 'inbox',
        updatedAt: '2026-01-01T01:00:00.000Z',
        syncStatus: 'pending' as const
      };
      const assignedNote = {
        ...fixtureNote,
        id: 'note-assigned-to-rejected-notebook',
        notebookIds: [duplicateNotebook.id],
        notebookId: duplicateNotebook.id,
        syncStatus: 'pending' as const
      };

      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: duplicateNotebook, baseVersion: 0 }],
        notes: [{ record: assignedNote, baseVersion: 0 }]
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].entityType).toBe('notebook');
      expect(result.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: assignedNote.id
        })
      ]);
      await expect(getNote(db, assignedNote.id)).resolves.toMatchObject({
        notebookIds: [],
        notebookId: null
      });
    } finally {
      db.close();
    }
  });

  it('normalizes rejected notebook assignments before stale note conflict checks', async () => {
    const db = await openMemoryDatabase();
    try {
      const unassignedNote = {
        ...fixtureNote,
        notebookIds: [],
        notebookId: null
      };
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: unassignedNote, baseVersion: 0 }]
      });

      const duplicateNotebook = {
        ...fixtureNotebook,
        id: 'duplicate-notebook',
        name: 'inbox',
        updatedAt: '2026-01-01T01:00:00.000Z',
        syncStatus: 'pending' as const
      };
      const locallyAssignedNote = {
        ...unassignedNote,
        notebookIds: [duplicateNotebook.id],
        notebookId: duplicateNotebook.id,
        updatedAt: '2026-01-01T01:01:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };

      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: duplicateNotebook, baseVersion: 0 }],
        notes: [{ record: locallyAssignedNote, baseVersion: 0 }]
      });

      expect(result.conflicts).toEqual([
        expect.objectContaining({ entityType: 'notebook' })
      ]);
      expect(result.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: locallyAssignedNote.id
        })
      ]);
      await expect(getNote(db, locallyAssignedNote.id)).resolves.toMatchObject({
        notebookIds: [],
        notebookId: null,
        version: 2
      });
    } finally {
      db.close();
    }
  });

  it('accepts stale notes whose only changes are normalized notebook references', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });

      const paddedNote = {
        ...fixtureNote,
        notebookIds: [` ${fixtureNotebook.id} `, fixtureNotebook.id],
        notebookId: ` ${fixtureNotebook.id} `,
        version: 2,
        syncStatus: 'pending' as const
      };

      const result = await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [{ record: paddedNote, baseVersion: 0 }]
      });

      expect(result.conflicts).toHaveLength(0);
      expect(result.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: fixtureNote.id,
          version: 2
        })
      ]);
      await expect(getNote(db, fixtureNote.id)).resolves.toMatchObject({
        notebookIds: [fixtureNotebook.id],
        notebookId: fixtureNotebook.id
      });
    } finally {
      db.close();
    }
  });

  it('falls back to legacy note notebook ids when the array column is empty', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });
      await runSql(
        db,
        'UPDATE notes SET notebook_ids = ?, notebook_id = ? WHERE id = ?',
        ['[]', fixtureNotebook.id, fixtureNote.id]
      );

      await expect(getNote(db, fixtureNote.id)).resolves.toMatchObject({
        notebookIds: [fixtureNotebook.id],
        notebookId: fixtureNotebook.id
      });
    } finally {
      db.close();
    }
  });

  it('scopes synced notes and notebooks by authenticated owner', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: fixtureNote, baseVersion: 0 }]
        },
        'alice'
      );

      const bobPull = await pullChangesSince(db, null, 0, {
        ownerUsername: 'bob'
      });
      expect(bobPull.notes).toHaveLength(0);
      expect(bobPull.notebooks).toHaveLength(0);

      const alicePull = await pullChangesSince(db, null, 0, {
        ownerUsername: 'alice'
      });
      expect(alicePull.notes.map((note) => note.id)).toContain(fixtureNote.id);
      expect(alicePull.notebooks.map((notebook) => notebook.id)).toContain(
        fixtureNotebook.id
      );
    } finally {
      db.close();
    }
  });

  it('returns a conflict instead of resurrecting a hard-deleted remote note', async () => {
    const db = await openMemoryDatabase();
    try {
      const ownerUsername = 'alice';
      const oldTrashedNote = {
        ...fixtureNote,
        trashedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      };
      await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: oldTrashedNote, baseVersion: 0 }]
        },
        ownerUsername
      );
      await cleanupTrash(
        db,
        new Date('2026-04-29T00:00:00.000Z'),
        ownerUsername
      );

      const staleOfflineEdit = {
        ...fixtureNote,
        body: 'Offline edit after cleanup',
        updatedAt: '2026-04-30T00:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const result = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [{ record: staleOfflineEdit, baseVersion: 1 }]
        },
        ownerUsername
      );

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe('deleted_remotely');
      expect(await getNote(db, fixtureNote.id, ownerUsername)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('does not resurrect a hard-deleted note when the client lost its base version', async () => {
    const db = await openMemoryDatabase();
    try {
      const ownerUsername = 'alice';
      const oldTrashedNote = {
        ...fixtureNote,
        trashedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      };
      await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: oldTrashedNote, baseVersion: 0 }]
        },
        ownerUsername
      );
      await cleanupTrash(
        db,
        new Date('2026-04-29T00:00:00.000Z'),
        ownerUsername
      );

      const clientWithLostCursor = {
        ...fixtureNote,
        body: 'Client forgot its base version',
        updatedAt: '2026-04-30T00:00:00.000Z',
        version: 1,
        syncStatus: 'pending' as const
      };
      const result = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [{ record: clientWithLostCursor, baseVersion: 0 }]
        },
        ownerUsername
      );

      expect(result.accepted).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe('deleted_remotely');
      expect(await getNote(db, fixtureNote.id, ownerUsername)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('accepts a local note winner once it is explicitly based on the remote tombstone', async () => {
    const db = await openMemoryDatabase();
    try {
      const ownerUsername = 'alice';
      const oldTrashedNote = {
        ...fixtureNote,
        trashedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      };
      await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: oldTrashedNote, baseVersion: 0 }]
        },
        ownerUsername
      );
      await cleanupTrash(
        db,
        new Date('2026-04-29T00:00:00.000Z'),
        ownerUsername
      );

      const staleOfflineEdit = {
        ...fixtureNote,
        body: 'Offline edit after cleanup',
        updatedAt: '2026-04-30T00:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const conflictResult = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [{ record: staleOfflineEdit, baseVersion: 1 }]
        },
        ownerUsername
      );
      const conflict = conflictResult.conflicts[0];
      expect(conflict.reason).toBe('deleted_remotely');
      expect(conflict.remote.version).toBe(2);
      const localRecord = conflict.local.record as typeof fixtureNote;

      const resolvedLocal = {
        ...localRecord,
        deviceId: fixtureDevice.id,
        version: conflict.remote.version + 1,
        syncStatus: 'pending' as const
      };
      const acceptedResult = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [
            { record: resolvedLocal, baseVersion: conflict.remote.version }
          ]
        },
        ownerUsername
      );

      expect(acceptedResult.conflicts).toHaveLength(0);
      expect(acceptedResult.accepted).toEqual([
        expect.objectContaining({
          entityType: 'note',
          id: fixtureNote.id,
          version: conflict.remote.version + 1
        })
      ]);
      await expect(
        getNote(db, fixtureNote.id, ownerUsername)
      ).resolves.toMatchObject({
        body: 'Offline edit after cleanup',
        deletedAt: null,
        version: conflict.remote.version + 1
      });
    } finally {
      db.close();
    }
  });

  it('accepts a local notebook winner once it is explicitly based on the remote tombstone', async () => {
    const db = await openMemoryDatabase();
    try {
      const ownerUsername = 'alice';
      await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: []
        },
        ownerUsername
      );
      await deleteNotebooksByIds(db, [fixtureNotebook.id], ownerUsername);

      const staleOfflineEdit = {
        ...fixtureNotebook,
        name: 'Offline notebook after delete',
        updatedAt: '2026-04-30T00:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const conflictResult = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [{ record: staleOfflineEdit, baseVersion: 1 }],
          notes: []
        },
        ownerUsername
      );
      const conflict = conflictResult.conflicts[0];
      expect(conflict.reason).toBe('deleted_remotely');
      expect(conflict.remote.version).toBe(2);
      const localRecord = conflict.local.record as typeof fixtureNotebook;

      const resolvedLocal = {
        ...localRecord,
        deviceId: fixtureDevice.id,
        version: conflict.remote.version + 1,
        syncStatus: 'pending' as const
      };
      const acceptedResult = await pushChanges(
        db,
        {
          device: fixtureDevice,
          notebooks: [
            { record: resolvedLocal, baseVersion: conflict.remote.version }
          ],
          notes: []
        },
        ownerUsername
      );

      expect(acceptedResult.conflicts).toHaveLength(0);
      expect(acceptedResult.accepted).toEqual([
        expect.objectContaining({
          entityType: 'notebook',
          id: fixtureNotebook.id,
          version: conflict.remote.version + 1
        })
      ]);
      await expect(
        getNotebook(db, fixtureNotebook.id, ownerUsername)
      ).resolves.toMatchObject({
        name: 'Offline notebook after delete',
        deletedAt: null,
        version: conflict.remote.version + 1
      });
    } finally {
      db.close();
    }
  });

  it('paginates revision pulls without advancing past undispatched changes', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [
          { record: fixtureNote, baseVersion: 0 },
          {
            record: {
              ...fixtureNote,
              id: 'fixture-note-page-2',
              title: 'Second paged note'
            },
            baseVersion: 0
          }
        ]
      });

      const firstPage = await pullChangesSince(db, null, 0, { limit: 2 });
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.serverRevision).toBeGreaterThan(0);

      const secondPage = await pullChangesSince(
        db,
        null,
        firstPage.serverRevision,
        { limit: 2 }
      );
      expect(secondPage.serverRevision).toBeGreaterThanOrEqual(
        firstPage.serverRevision
      );
      expect(
        secondPage.notes.length +
          secondPage.notebooks.length +
          secondPage.deletedNoteIds.length +
          secondPage.deletedNotebookIds.length
      ).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('splits pull pages before their serialized byte ceiling', async () => {
    const db = await openMemoryDatabase();
    try {
      const largeBody = 'x'.repeat(3 * 1024 * 1024);
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: ['large-a', 'large-b'].map((id) => ({
          record: {
            ...fixtureNote,
            id,
            title: id,
            body: largeBody,
            notebookIds: [],
            notebookId: null
          },
          baseVersion: 0
        }))
      });

      let cursor = 0;
      let hasMore = true;
      let pages = 0;
      const noteIds: string[] = [];
      while (hasMore) {
        const page = await pullChangesSince(db, null, cursor);
        expect(
          new TextEncoder().encode(JSON.stringify(page)).byteLength
        ).toBeLessThanOrEqual(6 * 1024 * 1024);
        noteIds.push(...page.notes.map((note) => note.id));
        cursor = page.serverRevision;
        hasMore = Boolean(page.hasMore);
        pages += 1;
      }
      expect(pages).toBeGreaterThan(1);
      expect(new Set(noteIds)).toEqual(new Set(['large-a', 'large-b']));
    } finally {
      db.close();
    }
  });

  it('compacts superseded entity revisions without breaking a revision-zero pull', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: { ...fixtureNote, notebookIds: [], notebookId: null },
            baseVersion: 0
          }
        ]
      });
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...fixtureNote,
              notebookIds: [],
              notebookId: null,
              body: 'Latest body',
              version: 2,
              updatedAt: '2026-05-02T00:00:00.000Z'
            },
            baseVersion: 1
          }
        ]
      });

      expect(await compactEntityChanges(db)).toBeGreaterThan(0);
      const pulled = await pullChangesSince(db, null, 0);
      expect(pulled.notes).toEqual([
        expect.objectContaining({
          id: fixtureNote.id,
          body: 'Latest body',
          version: 2
        })
      ]);
    } finally {
      db.close();
    }
  });

  it('permanently deletes trashed notes older than 90 days after snapshotting them', async () => {
    const db = await openMemoryDatabase();
    try {
      const oldTrashedNote = {
        ...fixtureNote,
        trashedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      };
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: oldTrashedNote, baseVersion: 0 }]
      });

      const result = await cleanupTrash(
        db,
        new Date('2026-04-29T00:00:00.000Z')
      );

      expect(result.deletedNotes).toBe(1);
      expect(await getNote(db, fixtureNote.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('bases retention on the server-observed trash time instead of a skewed client clock', async () => {
    const db = await openMemoryDatabase();
    try {
      const acceptedAt = Date.now();
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...fixtureNote,
              notebookIds: [],
              notebookId: null,
              trashedAt: '2000-01-01T00:00:00.000Z'
            },
            baseVersion: 0
          }
        ]
      });

      const early = await cleanupTrashRepository(
        db,
        new Date(acceptedAt + 24 * 60 * 60_000)
      );
      expect(early.deletedNotes).toBe(0);
      await expect(getNote(db, fixtureNote.id)).resolves.not.toBeNull();

      const expired = await cleanupTrashRepository(
        db,
        new Date(acceptedAt + 91 * 24 * 60 * 60_000)
      );
      expect(expired.deletedNotes).toBe(1);
      await expect(getNote(db, fixtureNote.id)).resolves.toBeNull();
    } finally {
      db.close();
    }
  });

  it('includes hard deletes in revision pulls', async () => {
    const db = await openMemoryDatabase();
    try {
      const oldTrashedNote = {
        ...fixtureNote,
        trashedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      };
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: oldTrashedNote, baseVersion: 0 }]
      });
      const beforeCleanupRevision = await currentRevision(db);

      await cleanupTrash(db, new Date('2026-04-29T00:00:00.000Z'));
      const pulled = await pullChangesSince(db, null, beforeCleanupRevision);

      expect(pulled.deletedNoteIds).toEqual([fixtureNote.id]);
      expect(pulled.notes).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('prunes stale version snapshots during cleanup without crossing owners', async () => {
    const db = await openMemoryDatabase();
    try {
      await insertNoteSnapshot(db, {
        noteId: 'alice-old-note',
        ownerUsername: 'alice',
        savedAt: '2025-05-26T23:59:59.000Z'
      });
      await insertNoteSnapshot(db, {
        noteId: 'alice-recent-note',
        ownerUsername: 'alice',
        savedAt: '2025-05-27T00:00:00.000Z'
      });
      await insertNoteSnapshot(db, {
        noteId: 'bob-old-note',
        ownerUsername: 'bob',
        savedAt: '2025-05-26T23:59:59.000Z'
      });
      await insertNotebookSnapshot(db, {
        notebookId: 'alice-old-notebook',
        ownerUsername: 'alice',
        savedAt: '2025-05-26T23:59:59.000Z'
      });
      await insertNotebookSnapshot(db, {
        notebookId: 'alice-recent-notebook',
        ownerUsername: 'alice',
        savedAt: '2025-05-27T00:00:00.000Z'
      });
      await insertNotebookSnapshot(db, {
        notebookId: 'bob-old-notebook',
        ownerUsername: 'bob',
        savedAt: '2025-05-26T23:59:59.000Z'
      });

      await cleanupTrash(db, new Date('2026-05-27T00:00:00.000Z'), 'alice');

      const noteSnapshots = await queryAll(
        db,
        `SELECT owner_username, note_id
         FROM note_versions
         ORDER BY owner_username, note_id`
      );
      expect(noteSnapshots).toEqual([
        expect.objectContaining({
          owner_username: 'alice',
          note_id: 'alice-recent-note'
        }),
        expect.objectContaining({
          owner_username: 'bob',
          note_id: 'bob-old-note'
        })
      ]);

      const notebookSnapshots = await queryAll(
        db,
        `SELECT owner_username, notebook_id
         FROM notebook_versions
         ORDER BY owner_username, notebook_id`
      );
      expect(notebookSnapshots).toEqual([
        expect.objectContaining({
          owner_username: 'alice',
          notebook_id: 'alice-recent-notebook'
        }),
        expect.objectContaining({
          owner_username: 'bob',
          notebook_id: 'bob-old-notebook'
        })
      ]);
    } finally {
      db.close();
    }
  });

  it('mirrors local-only and remote-only records between databases', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });

      const remoteOnlyNote = {
        ...fixtureNote,
        id: 'remote-only-note',
        title: 'Remote only',
        body: 'Created directly on the remote database',
        notebookIds: [],
        notebookId: null,
        updatedAt: '2026-05-01T00:00:00.000Z',
        deviceId: 'remote-device',
        syncStatus: 'pending' as const
      };
      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [],
        notes: [{ record: remoteOnlyNote, baseVersion: 0 }]
      });

      await syncDatabases(local, remote);

      expect((await getNote(remote, fixtureNote.id))?.body).toBe(
        fixtureNote.body
      );
      expect((await getNote(local, remoteOnlyNote.id))?.body).toBe(
        remoteOnlyNote.body
      );
    } finally {
      local.close();
      remote.close();
    }
  });

  it('copies a proven one-sided mirror descendant without changing its version', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: { ...fixtureNote, notebookIds: [], notebookId: null },
            baseVersion: 0
          }
        ]
      });
      await syncDatabases(local, remote);

      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote' },
        notebooks: [],
        notes: [
          {
            record: {
              ...fixtureNote,
              notebookIds: [],
              notebookId: null,
              body: 'Remote descendant',
              deviceId: 'remote-device',
              version: 2,
              updatedAt: '2026-05-03T00:00:00.000Z'
            },
            baseVersion: 1
          }
        ]
      });

      await syncDatabases(local, remote);
      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: 'Remote descendant',
        version: 2
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toMatchObject({
        body: 'Remote descendant',
        version: 2
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('preserves a one-sided descendant version when content returns to its prior value', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      const original = {
        ...fixtureNote,
        notebookIds: [],
        notebookId: null
      };
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [{ record: original, baseVersion: 0 }]
      });
      await syncDatabases(local, remote);

      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...original,
              body: 'Temporary local edit',
              version: 2,
              updatedAt: '2026-05-03T00:00:00.000Z'
            },
            baseVersion: 1
          }
        ]
      });
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...original,
              version: 3,
              updatedAt: '2026-05-04T00:00:00.000Z'
            },
            baseVersion: 2
          }
        ]
      });

      await syncDatabases(local, remote);
      await expect(getNote(local, original.id)).resolves.toMatchObject({
        body: original.body,
        version: 3
      });
      await expect(getNote(remote, original.id)).resolves.toMatchObject({
        body: original.body,
        version: 3
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('propagates account deletion only through an explicit account tombstone', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(remote, 'owner', 'remote-password-2026');
      await syncDatabases(local, remote);
      await pushChanges(
        local,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [
            {
              record: { ...fixtureNote, notebookIds: [], notebookId: null },
              baseVersion: 0
            }
          ]
        },
        'owner'
      );
      await syncDatabases(local, remote);
      await runSql(
        remote,
        `INSERT INTO account_tombstones (username, deletion_id, deleted_at)
         VALUES (?, ?, ?)`,
        ['owner', 'delete-owner-1', '2026-05-04T00:00:00.000Z']
      );

      await syncDatabases(local, remote);

      await expect(
        authenticateUser(local, 'owner', 'remote-password-2026')
      ).resolves.toBeNull();
      await expect(
        authenticateUser(remote, 'owner', 'remote-password-2026')
      ).resolves.toBeNull();
      await expect(getNote(local, fixtureNote.id, 'owner')).resolves.toBeNull();
      await expect(
        getNote(remote, fixtureNote.id, 'owner')
      ).resolves.toBeNull();
      await expect(
        queryAll(
          local,
          'SELECT deletion_id FROM account_tombstones WHERE username = ?',
          ['owner']
        )
      ).resolves.toEqual([{ deletion_id: 'delete-owner-1' }]);
    } finally {
      local.close();
      remote.close();
    }
  });

  it('refuses to choose between divergent local and remote mirror edits for the same records', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      const localNotebook = {
        ...fixtureNotebook,
        name: 'Newer local notebook',
        updatedAt: '2026-05-03T00:00:00.000Z',
        version: 3,
        syncStatus: 'pending' as const
      };
      const localNote = {
        ...fixtureNote,
        body: 'Newer local body',
        updatedAt: '2026-05-03T00:00:00.000Z',
        version: 3,
        syncStatus: 'pending' as const
      };
      const remoteNotebook = {
        ...fixtureNotebook,
        name: 'Older remote notebook',
        updatedAt: '2026-05-02T00:00:00.000Z',
        deviceId: 'remote-device',
        version: 2,
        syncStatus: 'pending' as const
      };
      const remoteNote = {
        ...fixtureNote,
        body: 'Older remote body',
        updatedAt: '2026-05-02T00:00:00.000Z',
        deviceId: 'remote-device',
        version: 2,
        syncStatus: 'pending' as const
      };

      await pushChanges(
        local,
        {
          device: fixtureDevice,
          notebooks: [{ record: localNotebook, baseVersion: 0 }],
          notes: [{ record: localNote, baseVersion: 0 }]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );
      await pushChanges(
        remote,
        {
          device: { id: 'remote-device', name: 'Remote device' },
          notebooks: [{ record: remoteNotebook, baseVersion: 0 }],
          notes: [{ record: remoteNote, baseVersion: 0 }]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /Remote mirror divergent/
      );

      await expect(
        getNotebook(local, fixtureNotebook.id)
      ).resolves.toMatchObject({
        name: localNotebook.name
      });
      await expect(
        getNotebook(remote, fixtureNotebook.id)
      ).resolves.toMatchObject({
        name: remoteNotebook.name
      });
      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: localNote.body
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toMatchObject({
        body: remoteNote.body
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('refuses to choose a newer remote edit over an unmirrored local edit', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      const localNotebook = {
        ...fixtureNotebook,
        name: 'Older local notebook',
        updatedAt: '2026-05-02T00:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const localNote = {
        ...fixtureNote,
        body: 'Older local body',
        updatedAt: '2026-05-02T00:00:00.000Z',
        version: 2,
        syncStatus: 'pending' as const
      };
      const remoteNotebook = {
        ...fixtureNotebook,
        name: 'Newer remote notebook',
        updatedAt: '2026-05-03T00:00:00.000Z',
        deviceId: 'remote-device',
        version: 3,
        syncStatus: 'pending' as const
      };
      const remoteNote = {
        ...fixtureNote,
        body: 'Newer remote body',
        updatedAt: '2026-05-03T00:00:00.000Z',
        deviceId: 'remote-device',
        version: 3,
        syncStatus: 'pending' as const
      };

      await pushChanges(
        local,
        {
          device: fixtureDevice,
          notebooks: [{ record: localNotebook, baseVersion: 0 }],
          notes: [{ record: localNote, baseVersion: 0 }]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );
      await pushChanges(
        remote,
        {
          device: { id: 'remote-device', name: 'Remote device' },
          notebooks: [{ record: remoteNotebook, baseVersion: 0 }],
          notes: [{ record: remoteNote, baseVersion: 0 }]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /Remote mirror divergent/
      );

      await expect(
        getNotebook(local, fixtureNotebook.id)
      ).resolves.toMatchObject({ name: localNotebook.name });
      await expect(
        getNotebook(remote, fixtureNotebook.id)
      ).resolves.toMatchObject({ name: remoteNotebook.name });
      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: localNote.body
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toMatchObject({
        body: remoteNote.body
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('mirrors every page of a large revision backlog in one run', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      const noteCount = 505;
      const notes = Array.from({ length: noteCount }, (_, index) => ({
        ...fixtureNote,
        id: `bulk-note-${index}`,
        title: `Bulk note ${index}`,
        body: `Bulk body ${index}`,
        updatedAt: new Date(Date.UTC(2026, 4, 1, 0, 0, index)).toISOString()
      }));

      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: notes.map((record) => ({ record, baseVersion: 0 }))
      });

      await syncDatabases(local, remote);

      await expect(getNote(remote, 'bulk-note-504')).resolves.toMatchObject({
        body: 'Bulk body 504'
      });
      const mirrored = await pullChangesSince(remote, null, 0, { limit: 1000 });
      expect(mirrored.notes).toHaveLength(noteCount);
    } finally {
      local.close();
      remote.close();
    }
  });

  it('resets stale mirror cursors when the target cursor is ahead of the source', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });
      await setSyncMeta(
        remote,
        `mirror.local.revision.${LEGACY_OWNER_USERNAME}`,
        '9999'
      );
      const sourceRevision = await currentRevision(local);

      await syncDatabases(local, remote);

      await expect(getNote(remote, fixtureNote.id)).resolves.toMatchObject({
        body: fixtureNote.body
      });
      await expect(
        getSyncMeta(remote, `mirror.local.revision.${LEGACY_OWNER_USERNAME}`)
      ).resolves.toBe(String(sourceRevision));
    } finally {
      local.close();
      remote.close();
    }
  });

  it('does not emit new mirror revisions when databases are already aligned', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      });

      await syncDatabases(local, remote);
      const localRevision = await currentRevision(local);
      const remoteRevision = await currentRevision(remote);

      await syncDatabases(local, remote);

      expect(await currentRevision(local)).toBe(localRevision);
      expect(await currentRevision(remote)).toBe(remoteRevision);
    } finally {
      local.close();
      remote.close();
    }
  });

  it('mirrors hard deletes without repeated delete revisions', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [
          {
            record: {
              ...fixtureNote,
              trashedAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            },
            baseVersion: 0
          }
        ]
      });
      await cleanupTrash(local, new Date('2026-04-29T00:00:00.000Z'));

      await syncDatabases(local, remote);
      const localRevision = await currentRevision(local);
      const remoteRevision = await currentRevision(remote);

      await syncDatabases(local, remote);

      expect(await currentRevision(local)).toBe(localRevision);
      expect(await currentRevision(remote)).toBe(remoteRevision);
      expect(await getNote(remote, fixtureNote.id)).toBeNull();
    } finally {
      local.close();
      remote.close();
    }
  });

  it('converges deleted mirror notebook rows into tombstones', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              updatedAt: '2026-05-18T00:00:00.000Z',
              version: 2,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ],
        notes: []
      });
      await deleteNotebooksByIds(local, [fixtureNotebook.id]);
      await runSql(
        local,
        `UPDATE entity_tombstones
         SET deleted_at = ?, device_id = ?, version = ?
         WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
        [
          '2026-05-21T00:00:00.000Z',
          fixtureDevice.id,
          3,
          LEGACY_OWNER_USERNAME,
          'notebook',
          fixtureNotebook.id
        ]
      );

      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              deletedAt: '2026-05-19T00:00:00.000Z',
              updatedAt: '2026-05-19T00:00:00.000Z',
              deviceId: 'remote-device',
              version: 3,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ],
        notes: []
      });

      await syncDatabases(local, remote);

      await expect(getNotebook(local, fixtureNotebook.id)).resolves.toBeNull();
      await expect(getNotebook(remote, fixtureNotebook.id)).resolves.toBeNull();
      expect(
        (
          await getEntityTombstonesByIds(
            remote,
            LEGACY_OWNER_USERNAME,
            'notebook',
            [fixtureNotebook.id]
          )
        ).get(fixtureNotebook.id)
      ).toMatchObject({ entityId: fixtureNotebook.id });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('converges deleted mirror note rows into tombstones', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    const noteWithoutNotebook = {
      ...fixtureNote,
      notebookIds: [],
      notebookId: null
    };
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...noteWithoutNotebook,
              updatedAt: '2026-05-18T00:00:00.000Z',
              version: 2,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ]
      });
      await deleteNotesByIds(local, [fixtureNote.id]);
      await runSql(
        local,
        `UPDATE entity_tombstones
         SET deleted_at = ?, device_id = ?, version = ?
         WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
        [
          '2026-05-21T00:00:00.000Z',
          fixtureDevice.id,
          3,
          LEGACY_OWNER_USERNAME,
          'note',
          fixtureNote.id
        ]
      );

      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [],
        notes: [
          {
            record: {
              ...noteWithoutNotebook,
              deletedAt: '2026-05-19T00:00:00.000Z',
              updatedAt: '2026-05-19T00:00:00.000Z',
              deviceId: 'remote-device',
              version: 3,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ]
      });

      await syncDatabases(local, remote);

      await expect(getNote(local, fixtureNote.id)).resolves.toBeNull();
      await expect(getNote(remote, fixtureNote.id)).resolves.toBeNull();
      expect(
        (
          await getEntityTombstonesByIds(
            remote,
            LEGACY_OWNER_USERNAME,
            'note',
            [fixtureNote.id]
          )
        ).get(fixtureNote.id)
      ).toMatchObject({ entityId: fixtureNote.id });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('ignores stale mirror delete events when the source still has a note row', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    const noteWithoutNotebook = {
      ...fixtureNote,
      notebookIds: [],
      notebookId: null
    };
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [{ record: noteWithoutNotebook, baseVersion: 0 }]
      });
      await deleteNotesByIds(local, [fixtureNote.id]);
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: {
              ...noteWithoutNotebook,
              deletedAt: '2026-05-26T07:59:24.903Z',
              trashedAt: '2026-05-26T07:59:07.376Z',
              updatedAt: '2026-05-26T07:59:24.903Z',
              version: 3,
              syncStatus: 'pending' as const
            },
            baseVersion: 2
          }
        ]
      });

      await pushChanges(
        remote,
        {
          device: fixtureDevice,
          notebooks: [],
          notes: [
            {
              record: {
                ...noteWithoutNotebook,
                deletedAt: '2026-05-26T07:59:24.903Z',
                trashedAt: '2026-05-26T07:59:07.376Z',
                updatedAt: '2026-05-26T07:59:24.903Z',
                version: 4,
                syncStatus: 'pending' as const
              },
              baseVersion: 0
            }
          ]
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );

      await syncDatabases(local, remote);

      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        deletedAt: '2026-05-26T07:59:24.903Z'
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toMatchObject({
        deletedAt: '2026-05-26T07:59:24.903Z',
        version: 4
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('ignores stale mirror delete events when the source still has a notebook row', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: []
      });
      await deleteNotebooksByIds(local, [fixtureNotebook.id]);
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              deletedAt: '2026-05-26T07:59:24.903Z',
              updatedAt: '2026-05-26T07:59:24.903Z',
              version: 3,
              syncStatus: 'pending' as const
            },
            baseVersion: 2
          }
        ],
        notes: []
      });

      await pushChanges(
        remote,
        {
          device: fixtureDevice,
          notebooks: [
            {
              record: {
                ...fixtureNotebook,
                deletedAt: '2026-05-26T07:59:24.903Z',
                updatedAt: '2026-05-26T07:59:24.903Z',
                version: 4,
                syncStatus: 'pending' as const
              },
              baseVersion: 0
            }
          ],
          notes: []
        },
        LEGACY_OWNER_USERNAME,
        { preserveNewRecordVersions: true }
      );

      await syncDatabases(local, remote);

      await expect(
        getNotebook(local, fixtureNotebook.id)
      ).resolves.toMatchObject({
        deletedAt: '2026-05-26T07:59:24.903Z'
      });
      await expect(
        getNotebook(remote, fixtureNotebook.id)
      ).resolves.toMatchObject({
        deletedAt: '2026-05-26T07:59:24.903Z',
        version: 4
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('refuses to choose when the remote mirror has an older hard delete for a newer local note', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      const localNewerNote = {
        ...fixtureNote,
        body: 'Newer local body survives the remote delete',
        updatedAt: '2026-05-03T00:00:00.000Z',
        version: 3,
        syncStatus: 'pending' as const
      };
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: localNewerNote, baseVersion: 0 }]
      });

      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [
          {
            record: {
              ...fixtureNote,
              body: 'Older remote body',
              updatedAt: '2026-05-01T00:00:00.000Z',
              deviceId: 'remote-device',
              version: 2,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ]
      });
      await deleteNotesByIds(remote, [fixtureNote.id]);
      await runSql(
        remote,
        `UPDATE entity_tombstones
         SET deleted_at = ?, device_id = ?, version = ?
         WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
        [
          '2026-05-02T00:00:00.000Z',
          'remote-device',
          2,
          LEGACY_OWNER_USERNAME,
          'note',
          fixtureNote.id
        ]
      );

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /Remote mirror divergent note/
      );

      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: localNewerNote.body
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toBeNull();
    } finally {
      local.close();
      remote.close();
    }
  });

  it('refuses a newer remote hard delete over an unmirrored local note', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [
          {
            record: {
              ...fixtureNote,
              body: 'Older local body',
              updatedAt: '2026-05-01T00:00:00.000Z',
              version: 2,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ]
      });
      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [
          {
            record: {
              ...fixtureNote,
              body: 'Remote body before delete',
              updatedAt: '2026-05-02T00:00:00.000Z',
              deviceId: 'remote-device',
              version: 3,
              syncStatus: 'pending' as const
            },
            baseVersion: 0
          }
        ]
      });
      await deleteNotesByIds(remote, [fixtureNote.id]);
      await runSql(
        remote,
        `UPDATE entity_tombstones
         SET deleted_at = ?, device_id = ?, version = ?
         WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
        [
          '2026-05-03T00:00:00.000Z',
          'remote-device',
          4,
          LEGACY_OWNER_USERNAME,
          'note',
          fixtureNote.id
        ]
      );

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /Remote mirror divergent note/
      );

      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: 'Older local body'
      });
      await expect(getNote(remote, fixtureNote.id)).resolves.toBeNull();
    } finally {
      local.close();
      remote.close();
    }
  });

  it('keeps each owner device row isolated when accounts share a browser device id', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(
        db,
        {
          device: { ...fixtureDevice, name: 'Alice laptop' },
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: fixtureNote, baseVersion: 0 }]
        },
        'alice'
      );
      await pushChanges(
        db,
        {
          device: { ...fixtureDevice, name: 'Bob phone' },
          notebooks: [
            {
              record: { ...fixtureNotebook, id: 'bob-notebook' },
              baseVersion: 0
            }
          ],
          notes: [
            { record: { ...fixtureNote, id: 'bob-note' }, baseVersion: 0 }
          ]
        },
        'bob'
      );

      await deleteDevicesByIds(db, [fixtureDevice.id], 'alice');

      expect(
        (await getDevicesByIds(db, [fixtureDevice.id], 'alice')).get(
          fixtureDevice.id
        )?.name
      ).toBe('Alice laptop');
      expect(
        (await getDevicesByIds(db, [fixtureDevice.id], 'bob')).get(
          fixtureDevice.id
        )?.name
      ).toBe('Bob phone');
    } finally {
      db.close();
    }
  });

  it('does not let another owner overwrite an existing device label', async () => {
    const db = await openMemoryDatabase();
    try {
      await upsertDevice(
        db,
        { id: fixtureDevice.id, name: 'Alice laptop' },
        undefined,
        'alice'
      );
      await upsertDevice(
        db,
        { id: fixtureDevice.id, name: 'Bob phone' },
        undefined,
        'bob'
      );

      expect(
        (await getDevicesByIds(db, [fixtureDevice.id], 'alice')).get(
          fixtureDevice.id
        )?.name
      ).toBe('Alice laptop');
      expect(
        (await getDevicesByIds(db, [fixtureDevice.id], 'bob')).get(
          fixtureDevice.id
        )?.name
      ).toBe('Bob phone');
    } finally {
      db.close();
    }
  });

  it('caps registered devices per account', async () => {
    const db = await openMemoryDatabase();
    try {
      for (let index = 0; index < 50; index += 1) {
        await upsertDevice(
          db,
          { id: `device-${index}`, name: `Device ${index}` },
          undefined,
          'alice'
        );
      }
      await expect(
        upsertDevice(
          db,
          { id: 'device-50', name: 'One too many' },
          undefined,
          'alice'
        )
      ).rejects.toThrow('limited to 50 registered devices');
      await expect(
        upsertDevice(
          db,
          { id: 'device-0', name: 'Renamed existing device' },
          undefined,
          'alice'
        )
      ).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('allows different owners to use the same note and notebook ids', async () => {
    const db = await openMemoryDatabase();
    try {
      for (const owner of ['alice', 'bob']) {
        await pushChanges(
          db,
          {
            device: fixtureDevice,
            notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
            notes: [
              {
                record: {
                  ...fixtureNote,
                  body: `${owner} body`
                },
                baseVersion: 0
              }
            ]
          },
          owner
        );
      }

      await expect(getNote(db, fixtureNote.id, 'alice')).resolves.toMatchObject(
        {
          body: 'alice body'
        }
      );
      await expect(getNote(db, fixtureNote.id, 'bob')).resolves.toMatchObject({
        body: 'bob body'
      });
    } finally {
      db.close();
    }
  });

  it('does not revoke another account session or trusted device when one owner account deletes a shared device id', async () => {
    const db = await openMemoryDatabase();
    try {
      const alice = await setUserPassword(db, 'alice', 'alice-password-2026');
      const bob = await setUserPassword(db, 'bob', 'bob-password-2026');
      await upsertDevice(
        db,
        { id: fixtureDevice.id, name: 'Alice laptop' },
        undefined,
        'alice'
      );
      await upsertDevice(
        db,
        { id: fixtureDevice.id, name: 'Bob phone' },
        undefined,
        'bob'
      );
      await trustAuthDevice(
        db,
        'alice',
        fixtureDevice.id,
        'alice-device-trust-secret-0123456789'
      );
      await trustAuthDevice(
        db,
        'bob',
        fixtureDevice.id,
        'bob-device-trust-secret-0123456789'
      );
      const bobSession = await createAuthSession(db, bob, fixtureDevice.id);
      await createAuthSession(db, alice, fixtureDevice.id);

      await runSql(db, 'DELETE FROM auth_sessions WHERE username = ?', [
        'alice'
      ]);
      await runSql(db, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
        'alice'
      ]);
      await runSql(db, 'DELETE FROM devices WHERE owner_username = ?', [
        'alice'
      ]);

      await expect(sessionFromToken(db, bobSession.token)).resolves.toEqual(
        expect.objectContaining({
          user: expect.objectContaining({ username: 'bob' }),
          deviceId: fixtureDevice.id
        })
      );
      await expect(
        listTrustedAuthDevices(db, 'bob', fixtureDevice.id)
      ).resolves.toEqual([
        expect.objectContaining({
          deviceId: fixtureDevice.id,
          deviceName: 'Bob phone'
        })
      ]);
    } finally {
      db.close();
    }
  });

  it('refuses to infer account deletion from a missing remote user row', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(local, 'local-user', 'local-password-2026');
      await setUserPassword(remote, 'remote-user', 'remote-password');

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /missing account rows without explicit tombstones/
      );

      await expect(
        authenticateUser(local, 'local-user', 'local-password-2026')
      ).resolves.toMatchObject({ username: 'local-user' });
      await expect(
        authenticateUser(remote, 'remote-user', 'remote-password')
      ).resolves.toMatchObject({ username: 'remote-user' });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('mirrors remote DB-backed user keyrings', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(remote, 'owner', 'remote-password-2026');
      await runSql(
        remote,
        'UPDATE users SET e2ee_keyring = ?, updated_at = ? WHERE username = ?',
        ['wrapped-remote-keyring-v1', '2026-05-01T00:00:00.000Z', 'owner']
      );

      await syncDatabases(local, remote);

      await expect(
        queryAll(local, 'SELECT e2ee_keyring FROM users WHERE username = ?', [
          'owner'
        ])
      ).resolves.toEqual([{ e2ee_keyring: 'wrapped-remote-keyring-v1' }]);

      await runSql(
        remote,
        'UPDATE users SET e2ee_keyring = ?, updated_at = ? WHERE username = ?',
        ['wrapped-remote-keyring-v2', '2026-05-02T00:00:00.000Z', 'owner']
      );

      await syncDatabases(local, remote);

      await expect(
        queryAll(local, 'SELECT e2ee_keyring FROM users WHERE username = ?', [
          'owner'
        ])
      ).resolves.toEqual([{ e2ee_keyring: 'wrapped-remote-keyring-v2' }]);
    } finally {
      local.close();
      remote.close();
    }
  });

  it('does not let newer local account rows overwrite remote account state', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(remote, 'owner', 'remote-password');
      await setUserPassword(local, 'owner', 'local-password-2026');
      await runSql(
        local,
        'UPDATE users SET updated_at = ? WHERE username = ?',
        ['2030-01-01T00:00:00.000Z', 'owner']
      );

      await syncDatabases(local, remote);

      await expect(
        authenticateUser(remote, 'owner', 'local-password-2026')
      ).resolves.toBeNull();
      await expect(
        authenticateUser(remote, 'owner', 'remote-password')
      ).resolves.toEqual({
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      });
      await expect(
        authenticateUser(local, 'owner', 'remote-password')
      ).resolves.toEqual({
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('refuses to prune owner data without an explicit account tombstone', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await pushChanges(
        remote,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: fixtureNote, baseVersion: 0 }]
        },
        'deleted-user'
      );

      await expect(syncDatabases(local, remote)).rejects.toThrow(
        /owner data without an account row/
      );

      await expect(
        getNote(remote, fixtureNote.id, 'deleted-user')
      ).resolves.toMatchObject({ id: fixtureNote.id });
      await expect(
        pullChangesSince(local, null, 0, { ownerUsername: 'deleted-user' })
      ).resolves.toMatchObject({ notes: [], notebooks: [] });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('does not run remote mirror sync when another process holds the lease', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-remote-lock-'));
    const previousDbPath = process.env.NOTES_DB_PATH;
    const previousRemoteUrl = process.env.TURSO_DATABASE_URL;
    const previousRemoteToken = process.env.TURSO_AUTH_TOKEN;
    const previousRemoteEnabled = process.env.NOTES_REMOTE_SYNC_ENABLED;
    process.env.NOTES_DB_PATH = join(tempDir, 'local.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${join(tempDir, 'remote.sqlite')}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const local = await openMemoryDatabase();
    try {
      await setSyncMeta(
        local,
        'mirror.lock.v1',
        JSON.stringify({
          owner: 'other-process',
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        })
      );

      await expect(syncRemoteDatabase(local)).rejects.toThrow(
        'Remote mirror sync is already running'
      );
    } finally {
      local.close();
      rmSync(tempDir, { recursive: true, force: true });
      if (previousDbPath === undefined) {
        delete process.env.NOTES_DB_PATH;
      } else {
        process.env.NOTES_DB_PATH = previousDbPath;
      }
      if (previousRemoteUrl === undefined) {
        delete process.env.TURSO_DATABASE_URL;
      } else {
        process.env.TURSO_DATABASE_URL = previousRemoteUrl;
      }
      if (previousRemoteToken === undefined) {
        delete process.env.TURSO_AUTH_TOKEN;
      } else {
        process.env.TURSO_AUTH_TOKEN = previousRemoteToken;
      }
      if (previousRemoteEnabled === undefined) {
        delete process.env.NOTES_REMOTE_SYNC_ENABLED;
      } else {
        process.env.NOTES_REMOTE_SYNC_ENABLED = previousRemoteEnabled;
      }
    }
  });
});
