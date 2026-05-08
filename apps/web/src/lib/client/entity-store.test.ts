import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalConflict, LocalNote } from './db';
import {
  adoptLocalWorkspaceForAccount,
  assertLocalWorkspaceCanUseAccount,
  ensureLocalNotesEncrypted,
  reencryptLocalNotes
} from './entity-store';
import { localDb } from './db';
import {
  encryptNoteFields,
  isEncryptedText,
  reencryptNoteFields
} from './encryption';
import { getOrCreateDevice } from './local-state';

vi.mock('./db', () => ({
  localDb: {
    notes: {
      count: vi.fn(),
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    notebooks: {
      count: vi.fn()
    },
    conflicts: {
      count: vi.fn(),
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    syncMeta: {
      get: vi.fn(),
      put: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  decryptNoteFields: vi.fn(async (note) => note),
  encryptNoteFields: vi.fn(async (note) => note),
  isEncryptedText: vi.fn(() => true),
  reencryptNoteFields: vi.fn(async (note) => ({
    ...note,
    title: 'reencrypted-title'
  }))
}));

vi.mock('./local-state', () => ({
  getOrCreateDevice: vi.fn(),
  newId: vi.fn(() => 'test-id'),
  nowIso: vi.fn(() => '2026-05-06T12:00:00.000Z')
}));

const note: LocalNote = {
  id: 'note-1',
  title: 'Local draft',
  body: 'Body',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-05-06T10:00:00.000Z',
  updatedAt: '2026-05-06T10:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: 'browser',
  version: 1,
  syncStatus: 'pending',
  lastSyncedVersion: 0,
  lastSyncedAt: null
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(encryptNoteFields).mockImplementation(
    async (storedNote) => storedNote
  );
  vi.mocked(isEncryptedText).mockReturnValue(true);
  vi.mocked(reencryptNoteFields).mockImplementation(async (storedNote) => ({
    ...storedNote,
    title: 'reencrypted-title'
  }));
  vi.mocked(getOrCreateDevice).mockResolvedValue({
    id: 'browser',
    name: 'Browser'
  });
  vi.mocked(localDb.notes.count).mockResolvedValue(1);
  vi.mocked(localDb.notebooks.count).mockResolvedValue(0);
  vi.mocked(localDb.conflicts.count).mockResolvedValue(0);
  vi.mocked(localDb.conflicts.toArray).mockResolvedValue([]);
  vi.mocked(localDb.conflicts.bulkPut).mockResolvedValue('conflict-1');
  vi.mocked(localDb.notes.toArray).mockResolvedValue([note]);
  vi.mocked(localDb.notes.bulkPut).mockResolvedValue('note-1');
  vi.mocked(localDb.syncMeta.get).mockResolvedValue(undefined);
  vi.mocked(localDb.syncMeta.put).mockResolvedValue('localWorkspaceOwner');
});

describe('local workspace account adoption', () => {
  it('adopts unowned local notes without clearing the workspace', async () => {
    await adoptLocalWorkspaceForAccount({
      username: 'Owner',
      previousMaterial: 'local-key',
      nextMaterial: 'account-key'
    });

    expect(reencryptNoteFields).toHaveBeenCalledWith(
      note,
      'local-key',
      'account-key'
    );
    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'reencrypted-title' })
    ]);
    expect(localDb.syncMeta.put).toHaveBeenCalledWith({
      key: 'localWorkspaceOwner',
      value: 'owner'
    });
  });

  it('blocks switching accounts when local user data belongs to another account', async () => {
    vi.mocked(localDb.syncMeta.get).mockResolvedValue({
      key: 'localWorkspaceOwner',
      value: 'alice'
    });

    await expect(assertLocalWorkspaceCanUseAccount('bob')).rejects.toThrow(
      'This browser has local notes for alice'
    );
    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
  });
});

describe('local note encryption sync state', () => {
  it('marks legacy encrypted migrations as pending sync changes', async () => {
    const syncedNote: LocalNote = {
      ...note,
      syncStatus: 'synced',
      lastSyncedVersion: 1
    };
    vi.mocked(localDb.notes.toArray).mockResolvedValue([syncedNote]);
    vi.mocked(isEncryptedText).mockReturnValue(false);
    vi.mocked(encryptNoteFields).mockImplementation(async (storedNote) => ({
      ...storedNote,
      title: 'encrypted-title',
      body: 'encrypted-body',
      titleHash: 'hash-title',
      bodyHash: 'hash-body'
    }));

    await ensureLocalNotesEncrypted();

    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'encrypted-title',
        body: 'encrypted-body',
        titleHash: 'hash-title',
        bodyHash: 'hash-body',
        updatedAt: syncedNote.updatedAt,
        deviceId: 'browser',
        version: syncedNote.version + 1,
        syncStatus: 'pending',
        lastSyncedVersion: syncedNote.lastSyncedVersion
      })
    ]);
  });

  it('skips the local encryption scan after a clean audit', async () => {
    vi.mocked(localDb.syncMeta.get).mockResolvedValue({
      key: 'localEncryptionAuditVersion',
      value: 'notes-conflicts:v1'
    });

    await ensureLocalNotesEncrypted();

    expect(localDb.notes.toArray).not.toHaveBeenCalled();
    expect(localDb.conflicts.toArray).not.toHaveBeenCalled();
    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
    expect(localDb.conflicts.bulkPut).not.toHaveBeenCalled();
  });

  it('marks key rotation writes as pending sync changes', async () => {
    const syncedNote: LocalNote = {
      ...note,
      syncStatus: 'synced',
      lastSyncedVersion: 1
    };
    vi.mocked(localDb.notes.toArray).mockResolvedValue([syncedNote]);

    await reencryptLocalNotes('old-key', 'new-key');

    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'reencrypted-title',
        updatedAt: syncedNote.updatedAt,
        deviceId: 'browser',
        version: syncedNote.version + 1,
        syncStatus: 'pending',
        lastSyncedVersion: syncedNote.lastSyncedVersion
      })
    ]);
  });

  it('skips encryption sync writes when encrypted fields do not change', async () => {
    vi.mocked(reencryptNoteFields).mockImplementation(
      async (storedNote) => storedNote
    );

    await reencryptLocalNotes('old-key', 'new-key');

    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
  });

  it('encrypts legacy plaintext note conflicts for storage', async () => {
    const conflict: LocalConflict = {
      id: 'conflict-1',
      entityType: 'note',
      entityId: 'note-1',
      status: 'pending',
      createdAt: '2026-05-06T11:00:00.000Z',
      conflict: {
        id: 'conflict-1',
        entityType: 'note',
        entityId: 'note-1',
        reason: 'remote_changed',
        local: {
          source: 'local',
          deviceId: 'browser',
          deviceName: 'Browser',
          updatedAt: note.updatedAt,
          version: 1,
          previewText: 'Local body',
          record: { ...note, title: 'Local title', body: 'Local body' }
        },
        remote: {
          source: 'remote',
          deviceId: 'phone',
          deviceName: 'Phone',
          updatedAt: note.updatedAt,
          version: 2,
          previewText: 'Remote body',
          record: {
            ...note,
            deviceId: 'phone',
            title: 'Remote title',
            body: 'Remote body',
            version: 2
          }
        }
      }
    };
    vi.mocked(localDb.notes.toArray).mockResolvedValue([]);
    vi.mocked(localDb.conflicts.toArray).mockResolvedValue([conflict]);
    vi.mocked(encryptNoteFields).mockImplementation(async (storedNote) => ({
      ...storedNote,
      title: `encrypted:${storedNote.title}`,
      body: `encrypted:${storedNote.body}`,
      titleHash: `hash:${storedNote.title}`,
      bodyHash: `hash:${storedNote.body}`
    }));

    await ensureLocalNotesEncrypted();

    expect(localDb.conflicts.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'conflict-1',
        conflict: expect.objectContaining({
          local: expect.objectContaining({
            previewText: '',
            record: expect.objectContaining({
              title: 'encrypted:Local title',
              body: 'encrypted:Local body',
              titleHash: 'hash:Local title',
              bodyHash: 'hash:Local body'
            })
          }),
          remote: expect.objectContaining({
            previewText: '',
            record: expect.objectContaining({
              title: 'encrypted:Remote title',
              body: 'encrypted:Remote body',
              titleHash: 'hash:Remote title',
              bodyHash: 'hash:Remote body'
            })
          })
        })
      })
    ]);
  });

  it('reencrypts stored note conflicts during key rotation', async () => {
    const conflict: LocalConflict = {
      id: 'conflict-1',
      entityType: 'note',
      entityId: 'note-1',
      status: 'pending',
      createdAt: '2026-05-06T11:00:00.000Z',
      conflict: {
        id: 'conflict-1',
        entityType: 'note',
        entityId: 'note-1',
        reason: 'remote_changed',
        local: {
          source: 'local',
          deviceId: 'browser',
          deviceName: 'Browser',
          updatedAt: note.updatedAt,
          version: 1,
          previewText: '',
          record: {
            ...note,
            title: 'old-local-title',
            body: 'old-local-body',
            titleHash: 'old-local-title-hash',
            bodyHash: 'old-local-body-hash'
          }
        },
        remote: {
          source: 'remote',
          deviceId: 'phone',
          deviceName: 'Phone',
          updatedAt: note.updatedAt,
          version: 2,
          previewText: '',
          record: {
            ...note,
            deviceId: 'phone',
            title: 'old-remote-title',
            body: 'old-remote-body',
            titleHash: 'old-remote-title-hash',
            bodyHash: 'old-remote-body-hash',
            version: 2
          }
        }
      }
    };
    vi.mocked(localDb.notes.toArray).mockResolvedValue([]);
    vi.mocked(localDb.conflicts.toArray).mockResolvedValue([conflict]);
    vi.mocked(encryptNoteFields).mockImplementation(
      async (storedNote, keyMaterial = 'default-key') => ({
        ...storedNote,
        title: `${keyMaterial}:${storedNote.title}`,
        body: `${keyMaterial}:${storedNote.body}`,
        titleHash: `${keyMaterial}:title-hash`,
        bodyHash: `${keyMaterial}:body-hash`
      })
    );

    await reencryptLocalNotes('old-key', 'new-key');

    expect(localDb.conflicts.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'conflict-1',
        conflict: expect.objectContaining({
          local: expect.objectContaining({
            previewText: '',
            record: expect.objectContaining({
              title: 'new-key:old-local-title',
              body: 'new-key:old-local-body',
              titleHash: 'new-key:title-hash',
              bodyHash: 'new-key:body-hash'
            })
          }),
          remote: expect.objectContaining({
            previewText: '',
            record: expect.objectContaining({
              title: 'new-key:old-remote-title',
              body: 'new-key:old-remote-body',
              titleHash: 'new-key:title-hash',
              bodyHash: 'new-key:body-hash'
            })
          })
        })
      })
    ]);
  });
});
