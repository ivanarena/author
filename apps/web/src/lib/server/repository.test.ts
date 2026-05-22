import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fixtureDevice,
  fixtureNote,
  fixtureNotebook
} from '@author/test-fixtures';
import { authenticateUser, setUserPassword } from './auth';
import { openMemoryDatabase, run as runSql } from './db';
import {
  cleanupTrash,
  currentRevision,
  deleteDevicesByIds,
  deleteNotebooksByIds,
  deleteNotesByIds,
  getDevicesByIds,
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

  it('rejects duplicate encrypted notebook name hashes without reading names', async () => {
    const db = await openMemoryDatabase();
    try {
      await pushChanges(db, {
        device: fixtureDevice,
        notebooks: [
          {
            record: {
              ...fixtureNotebook,
              name: 'enc:v3:first',
              nameHash: 'hash:v2:notebook-name'
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
              name: 'enc:v3:second',
              nameHash: 'hash:v2:notebook-name',
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

      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: localNotebook, baseVersion: 0 }],
        notes: [{ record: localNote, baseVersion: 0 }]
      });
      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [{ record: remoteNotebook, baseVersion: 0 }],
        notes: [{ record: remoteNote, baseVersion: 0 }]
      });

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

  it('lets newer remote edits win over older local mirror edits for the same records', async () => {
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

      await pushChanges(local, {
        device: fixtureDevice,
        notebooks: [{ record: localNotebook, baseVersion: 0 }],
        notes: [{ record: localNote, baseVersion: 0 }]
      });
      await pushChanges(remote, {
        device: { id: 'remote-device', name: 'Remote device' },
        notebooks: [{ record: remoteNotebook, baseVersion: 0 }],
        notes: [{ record: remoteNote, baseVersion: 0 }]
      });

      await syncDatabases(local, remote);

      await expect(
        getNotebook(local, fixtureNotebook.id)
      ).resolves.toMatchObject({
        name: remoteNotebook.name
      });
      await expect(
        getNotebook(remote, fixtureNotebook.id)
      ).resolves.toMatchObject({
        name: remoteNotebook.name
      });
      await expect(getNote(local, fixtureNote.id)).resolves.toMatchObject({
        body: remoteNote.body
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

  it('applies a newer remote hard delete over an older local note', async () => {
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

      await syncDatabases(local, remote);

      await expect(getNote(local, fixtureNote.id)).resolves.toBeNull();
      await expect(getNote(remote, fixtureNote.id)).resolves.toBeNull();
    } finally {
      local.close();
      remote.close();
    }
  });

  it('keeps globally referenced devices when applying one owner device delete', async () => {
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
      await pushChanges(
        db,
        {
          device: fixtureDevice,
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
        (await getDevicesByIds(db, [fixtureDevice.id])).has(fixtureDevice.id)
      ).toBe(true);
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
        (await getDevicesByIds(db, [fixtureDevice.id], 'bob')).has(
          fixtureDevice.id
        )
      ).toBe(false);
    } finally {
      db.close();
    }
  });

  it('treats remote DB-backed users as authoritative', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(local, 'local-user', 'local-password');
      await setUserPassword(remote, 'remote-user', 'remote-password');

      await syncDatabases(local, remote);

      await expect(
        authenticateUser(remote, 'local-user', 'local-password')
      ).resolves.toBeNull();
      await expect(
        authenticateUser(local, 'local-user', 'local-password')
      ).resolves.toBeNull();
      await expect(
        authenticateUser(local, 'remote-user', 'remote-password')
      ).resolves.toEqual({
        username: 'remote-user',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      });
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
      await setUserPassword(local, 'owner', 'local-password');
      await runSql(
        local,
        'UPDATE users SET updated_at = ? WHERE username = ?',
        ['2030-01-01T00:00:00.000Z', 'owner']
      );

      await syncDatabases(local, remote);

      await expect(
        authenticateUser(remote, 'owner', 'local-password')
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

  it('prunes remote data for missing DB-backed users before mirroring', async () => {
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

      await syncDatabases(local, remote);

      await expect(
        getNote(remote, fixtureNote.id, 'deleted-user')
      ).resolves.toBeNull();
      await expect(
        pullChangesSince(local, null, 0, { ownerUsername: 'deleted-user' })
      ).resolves.toMatchObject({
        notes: [],
        notebooks: []
      });
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
