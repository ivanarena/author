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
import { openMemoryDatabase } from './db';
import {
  cleanupTrash,
  currentRevision,
  deleteDevicesByIds,
  getDevicesByIds,
  getNote,
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

  it('mirrors DB-backed users between databases', async () => {
    const local = await openMemoryDatabase();
    const remote = await openMemoryDatabase();
    try {
      await setUserPassword(local, 'local-user', 'local-password');
      await setUserPassword(remote, 'remote-user', 'remote-password');

      await syncDatabases(local, remote);

      await expect(
        authenticateUser(remote, 'local-user', 'local-password')
      ).resolves.toEqual({
        username: 'local-user',
        displayName: null
      });
      await expect(
        authenticateUser(local, 'remote-user', 'remote-password')
      ).resolves.toEqual({
        username: 'remote-user',
        displayName: null
      });
    } finally {
      local.close();
      remote.close();
    }
  });

  it('does not run remote mirror sync when another process holds the lease', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'author-notes-remote-lock-'));
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
