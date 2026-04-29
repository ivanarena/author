import { describe, expect, it } from 'vitest';
import { fixtureDevice, fixtureNote, fixtureNotebook } from '@author/test-fixtures';
import { openMemoryDatabase } from './db';
import {
  cleanupTrash,
  getNote,
  listNotebooks,
  pullChangesSince,
  pushChanges,
  upsertDevice
} from './repository';

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

      const result = await cleanupTrash(db, new Date('2026-04-29T00:00:00.000Z'));

      expect(result.deletedNotes).toBe(1);
      expect(await getNote(db, fixtureNote.id)).toBeNull();
    } finally {
      db.close();
    }
  });
});
