import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import type { LocalNote, LocalNotebook } from './db';
import {
  absorbSameDevicePushConflict,
  applyRemoteDeletes,
  markAcceptedChanges,
  mergeRemoteChanges,
  resolveConflict
} from './sync-store';
import { localDb, type LocalConflict } from './db';
import {
  encryptNoteFields,
  encryptNotebookFields,
  isCurrentEncryptedText,
  isEncryptedText,
  isUnsupportedEncryptedText
} from './encryption';

vi.mock('./db', () => ({
  localDb: {
    transaction: vi.fn(async (_mode, _tables, operation) => operation()),
    notes: {
      get: vi.fn(),
      put: vi.fn(),
      bulkPut: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn()
    },
    notebooks: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn()
    },
    devices: {
      bulkPut: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    },
    conflicts: {
      get: vi.fn(),
      put: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE:
    'This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version.',
  decryptNoteFields: vi.fn(async (note) => note),
  decryptNotebookFields: vi.fn(async (notebook) => notebook),
  encryptNoteFields: vi.fn(async (note) => note),
  encryptNotebookFields: vi.fn(async (notebook) => notebook),
  isCurrentEncryptedText: vi.fn(() => true),
  isEncryptedText: vi.fn(() => true),
  isUnsupportedEncryptedText: vi.fn(() => false)
}));

vi.mock('./local-state', () => ({
  getOrCreateDevice: vi.fn(async () => ({
    id: 'browser-device',
    name: 'Browser'
  })),
  newId: vi.fn(() => 'conflict-generated-id'),
  nowIso: vi.fn(() => '2026-05-02T12:00:00.000Z')
}));

const syncedAt = '2026-05-02T12:05:00.000Z';
const baseNote: LocalNote = {
  id: 'note-1',
  title: 'Local title',
  body: 'Local body',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: 'browser-device',
  version: 2,
  syncStatus: 'pending',
  lastSyncedVersion: 1,
  lastSyncedAt: null
};

const baseNotebook: LocalNotebook = {
  id: 'notebook-1',
  name: 'Local notebook',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  deletedAt: null,
  deviceId: 'browser-device',
  version: 2,
  syncStatus: 'pending',
  lastSyncedVersion: 1,
  lastSyncedAt: null
};

function remoteNote(overrides: Partial<Note> = {}): Note {
  return {
    id: baseNote.id,
    title: baseNote.title,
    body: 'Remote body',
    notebookIds: baseNote.notebookIds,
    notebookId: baseNote.notebookId,
    createdAt: baseNote.createdAt,
    deletedAt: baseNote.deletedAt,
    trashedAt: baseNote.trashedAt,
    deviceId: 'phone-device',
    version: 3,
    updatedAt: '2026-05-01T10:10:00.000Z',
    syncStatus: 'synced',
    ...overrides
  };
}

function remoteNotebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: baseNotebook.id,
    name: 'Remote notebook',
    createdAt: baseNotebook.createdAt,
    updatedAt: '2026-05-01T10:10:00.000Z',
    deletedAt: null,
    deviceId: 'phone-device',
    version: 3,
    syncStatus: 'synced',
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(localDb.notes.get).mockResolvedValue(null);
  vi.mocked(localDb.notebooks.get).mockResolvedValue(null);
  vi.mocked(localDb.notes.toArray).mockResolvedValue([]);
  vi.mocked(localDb.notebooks.toArray).mockResolvedValue([]);
  vi.mocked(localDb.conflicts.get).mockResolvedValue(undefined);
  vi.mocked(localDb.devices.get).mockResolvedValue(null);
  vi.mocked(encryptNoteFields).mockImplementation(async (note) => note);
  vi.mocked(encryptNotebookFields).mockImplementation(
    async (notebook) => notebook
  );
  vi.mocked(isCurrentEncryptedText).mockReturnValue(true);
  vi.mocked(isEncryptedText).mockReturnValue(true);
  vi.mocked(isUnsupportedEncryptedText).mockReturnValue(false);
});

describe('client sync store', () => {
  it('leaves a note pending when it changed again after the pushed snapshot', async () => {
    const editedAgain = {
      ...baseNote,
      body: 'Typed after push started',
      updatedAt: '2026-05-01T10:03:00.000Z',
      version: 3
    };
    vi.mocked(localDb.notes.get).mockResolvedValue(editedAgain);

    await markAcceptedChanges(
      [
        {
          entityType: 'note',
          id: baseNote.id,
          version: 4,
          updatedAt: baseNote.updatedAt
        }
      ],
      syncedAt,
      [
        {
          entityType: 'note',
          id: baseNote.id,
          version: baseNote.version,
          updatedAt: baseNote.updatedAt
        }
      ]
    );

    expect(localDb.notes.put).toHaveBeenCalledWith({
      ...editedAgain,
      version: editedAgain.version,
      syncStatus: 'pending',
      lastSyncedVersion: 4,
      lastSyncedAt: syncedAt
    });
  });

  it('marks a note synced when the accepted server version still matches the pushed snapshot', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue(baseNote);

    await markAcceptedChanges(
      [
        {
          entityType: 'note',
          id: baseNote.id,
          version: 4,
          updatedAt: baseNote.updatedAt
        }
      ],
      syncedAt,
      [
        {
          entityType: 'note',
          id: baseNote.id,
          version: baseNote.version,
          updatedAt: baseNote.updatedAt
        }
      ]
    );

    expect(localDb.notes.put).toHaveBeenCalledWith({
      ...baseNote,
      version: 4,
      syncStatus: 'synced',
      lastSyncedVersion: 4,
      lastSyncedAt: syncedAt
    });
  });

  it('stores a conflict instead of overwriting a divergent pending local note', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue(baseNote);
    vi.mocked(localDb.devices.get).mockResolvedValue({
      id: 'phone-device',
      name: 'Phone'
    });
    vi.mocked(encryptNoteFields).mockImplementation(async (note) => ({
      ...note,
      title: `enc:${note.title}`,
      body: `enc:${note.body}`
    }));

    await mergeRemoteChanges([remoteNote()], [], syncedAt);

    expect(localDb.conflicts.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conflict-generated-id',
        entityType: 'note',
        entityId: baseNote.id,
        status: 'pending',
        conflict: expect.objectContaining({
          reason: 'remote_changed',
          local: expect.objectContaining({
            source: 'local',
            previewText: '',
            record: expect.objectContaining({
              title: `enc:${baseNote.title}`,
              body: `enc:${baseNote.body}`
            })
          }),
          remote: expect.objectContaining({
            source: 'remote',
            deviceName: 'Phone',
            previewText: '',
            record: expect.objectContaining({
              title: `enc:${baseNote.title}`,
              body: 'enc:Remote body',
              version: 3
            })
          })
        })
      })
    );
    expect(localDb.notes.put).toHaveBeenCalledWith({
      ...baseNote,
      syncStatus: 'conflict'
    });
  });

  it('absorbs same-device push conflicts by advancing the local base version', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue(baseNote);

    await expect(
      absorbSameDevicePushConflict(
        {
          id: 'same-device-conflict',
          entityType: 'note',
          entityId: baseNote.id,
          reason: 'remote_changed',
          local: {
            source: 'local',
            deviceId: 'browser-device',
            deviceName: 'Browser',
            updatedAt: baseNote.updatedAt,
            version: baseNote.version,
            previewText: 'Local body',
            record: baseNote
          },
          remote: {
            source: 'remote',
            deviceId: 'browser-device',
            deviceName: 'Browser',
            updatedAt: '2026-05-01T10:06:00.000Z',
            version: 4,
            previewText: 'Earlier local body',
            record: remoteNote({ deviceId: 'browser-device', version: 4 })
          }
        },
        syncedAt
      )
    ).resolves.toBe(true);

    expect(localDb.notes.put).toHaveBeenCalledWith({
      ...baseNote,
      syncStatus: 'pending',
      lastSyncedVersion: 4,
      lastSyncedAt: syncedAt
    });
    expect(localDb.conflicts.put).not.toHaveBeenCalled();
  });

  it('does not overwrite a pending local note when a pull replays its last synced remote version', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue({
      ...baseNote,
      body: 'Typed locally after the previous push was accepted',
      updatedAt: '2026-05-01T10:12:00.000Z',
      version: 3,
      lastSyncedVersion: 4
    });

    await mergeRemoteChanges(
      [
        remoteNote({
          body: 'Previous remote version from the pull feed',
          updatedAt: '2026-05-01T10:10:00.000Z',
          version: 4
        })
      ],
      [],
      syncedAt
    );

    expect(localDb.notes.put).not.toHaveBeenCalled();
    expect(localDb.conflicts.put).not.toHaveBeenCalled();
  });

  it('fails closed instead of republishing old remote ciphertext envelopes', async () => {
    vi.mocked(isUnsupportedEncryptedText).mockImplementation((value) =>
      value.startsWith('enc:v2:')
    );

    await expect(
      mergeRemoteChanges(
        [remoteNote({ title: 'enc:v2:old-title' })],
        [],
        syncedAt
      )
    ).rejects.toThrow('older encryption format');

    expect(localDb.notes.put).not.toHaveBeenCalled();
  });

  it('queues pulled plaintext notes for encrypted republish', async () => {
    vi.mocked(isCurrentEncryptedText).mockReturnValue(false);
    vi.mocked(isEncryptedText).mockReturnValue(false);
    vi.mocked(encryptNoteFields).mockImplementation(async (note) => ({
      ...note,
      title: `enc:${note.title}`,
      body: `enc:${note.body}`,
      titleHash: 'hash-title',
      bodyHash: 'hash-body'
    }));

    await mergeRemoteChanges([remoteNote()], [], syncedAt);

    expect(localDb.notes.put).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `enc:${baseNote.title}`,
        body: 'enc:Remote body',
        titleHash: 'hash-title',
        bodyHash: 'hash-body',
        deviceId: 'browser-device',
        version: 4,
        syncStatus: 'pending',
        lastSyncedVersion: 3,
        lastSyncedAt: syncedAt
      })
    );
  });

  it('does not conflict a pending note with a same-browser remote echo', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue({
      ...baseNote,
      body: 'Newer local typing',
      updatedAt: '2026-05-01T10:12:00.000Z',
      version: 3
    });

    await mergeRemoteChanges(
      [
        remoteNote({
          body: 'Earlier version from this browser',
          deviceId: 'browser-device',
          version: 4
        })
      ],
      [],
      syncedAt
    );

    expect(localDb.conflicts.put).not.toHaveBeenCalled();
    expect(localDb.notes.put).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Newer local typing',
        syncStatus: 'pending',
        lastSyncedVersion: 4,
        lastSyncedAt: syncedAt
      })
    );
  });

  it('does not conflict a pending notebook with a same-browser remote echo', async () => {
    vi.mocked(localDb.notebooks.get).mockResolvedValue({
      ...baseNotebook,
      name: 'Newer local notebook name',
      updatedAt: '2026-05-01T10:12:00.000Z',
      version: 3
    });

    await mergeRemoteChanges(
      [],
      [
        remoteNotebook({
          name: 'Earlier notebook name from this browser',
          deviceId: 'browser-device',
          version: 4
        })
      ],
      syncedAt
    );

    expect(localDb.conflicts.put).not.toHaveBeenCalled();
    expect(localDb.notebooks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Newer local notebook name',
        syncStatus: 'pending',
        lastSyncedVersion: 4,
        lastSyncedAt: syncedAt
      })
    );
  });

  it('applies hard remote deletes to clean local records and devices', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue({
      ...baseNote,
      syncStatus: 'synced'
    });
    vi.mocked(localDb.notebooks.get).mockResolvedValue({
      id: 'notebook-1',
      name: 'Ideas',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
      deletedAt: null,
      deviceId: 'browser-device',
      version: 1,
      syncStatus: 'synced',
      lastSyncedVersion: 1,
      lastSyncedAt: syncedAt
    });

    await applyRemoteDeletes(['note-1'], ['notebook-1'], ['phone-device']);

    expect(localDb.notes.delete).toHaveBeenCalledWith('note-1');
    expect(localDb.notebooks.delete).toHaveBeenCalledWith('notebook-1');
    expect(localDb.devices.delete).toHaveBeenCalledWith('phone-device');
  });

  it('does not hard-delete pending or conflicted local records', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue(baseNote);
    vi.mocked(localDb.notebooks.get).mockResolvedValue({
      id: 'notebook-1',
      name: 'Ideas',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
      deletedAt: null,
      deviceId: 'browser-device',
      version: 1,
      syncStatus: 'conflict',
      lastSyncedVersion: 1,
      lastSyncedAt: syncedAt
    });

    await applyRemoteDeletes(['note-1'], ['notebook-1']);

    expect(localDb.notes.delete).not.toHaveBeenCalled();
    expect(localDb.notebooks.delete).not.toHaveBeenCalled();
  });

  it('resolves duplicate notebook-name conflicts by keeping the existing remote notebook', async () => {
    const conflict = duplicateNotebookConflict();
    const assignedNote: LocalNote = {
      ...baseNote,
      notebookIds: ['local-book', 'other-book'],
      notebookId: 'local-book',
      syncStatus: 'synced',
      version: 2,
      lastSyncedVersion: 2
    };
    vi.mocked(localDb.conflicts.get).mockResolvedValue(
      localConflictRecord(conflict)
    );
    vi.mocked(localDb.notes.toArray).mockResolvedValue([assignedNote]);

    await resolveConflict('conflict-1', 'keep-remote');

    expect(localDb.notebooks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-book',
        syncStatus: 'synced',
        lastSyncedVersion: 4,
        lastSyncedAt: '2026-05-02T12:00:00.000Z'
      })
    );
    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: assignedNote.id,
        notebookIds: ['remote-book', 'other-book'],
        notebookId: 'remote-book',
        updatedAt: '2026-05-02T12:00:00.000Z',
        deviceId: 'browser-device',
        version: 3,
        syncStatus: 'pending',
        lastSyncedAt: null
      })
    ]);
    expect(localDb.notebooks.delete).toHaveBeenCalledWith('local-book');
    expect(localDb.conflicts.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conflict-1', status: 'resolved' })
    );
  });

  it('resolves duplicate notebook-name conflicts by keeping the local notebook as a renamed copy', async () => {
    const conflict = duplicateNotebookConflict();
    const assignedNote: LocalNote = {
      ...baseNote,
      notebookIds: ['local-book'],
      notebookId: 'local-book',
      syncStatus: 'pending',
      version: 5,
      lastSyncedVersion: 4
    };
    vi.mocked(localDb.conflicts.get).mockResolvedValue(
      localConflictRecord(conflict)
    );
    vi.mocked(localDb.notes.toArray).mockResolvedValue([assignedNote]);
    vi.mocked(localDb.notebooks.toArray).mockResolvedValue([
      {
        ...baseNotebook,
        id: 'copy-book',
        name: 'Ideas copy',
        syncStatus: 'synced'
      }
    ]);

    await resolveConflict('conflict-1', 'keep-local');

    expect(localDb.notebooks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-book',
        syncStatus: 'synced'
      })
    );
    expect(localDb.notebooks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conflict-generated-id',
        name: 'Ideas copy 2',
        nameHash: null,
        deviceId: 'browser-device',
        version: 1,
        syncStatus: 'pending',
        lastSyncedVersion: 0,
        lastSyncedAt: null
      })
    );
    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: assignedNote.id,
        notebookIds: ['conflict-generated-id'],
        notebookId: 'conflict-generated-id',
        version: 5,
        syncStatus: 'pending'
      })
    ]);
    expect(localDb.notebooks.delete).toHaveBeenCalledWith('local-book');
  });

  it('resolves remote-delete note conflicts by keeping the local note as pending over the tombstone', async () => {
    const conflict = deletedRemoteNoteConflict();
    vi.mocked(localDb.conflicts.get).mockResolvedValue(
      noteConflictRecord(conflict)
    );

    await resolveConflict('deleted-note-conflict', 'keep-local');

    expect(localDb.notes.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: baseNote.id,
        body: 'Local body',
        deletedAt: null,
        deviceId: 'browser-device',
        version: 3,
        syncStatus: 'pending',
        lastSyncedVersion: 2,
        lastSyncedAt: null
      })
    );
    expect(localDb.conflicts.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'deleted-note-conflict',
        status: 'resolved'
      })
    );
  });
});

function deletedRemoteNoteConflict() {
  return {
    id: 'deleted-note-conflict',
    entityType: 'note' as const,
    entityId: baseNote.id,
    reason: 'deleted_remotely' as const,
    local: {
      source: 'local' as const,
      deviceId: 'browser-device',
      deviceName: 'Browser',
      updatedAt: '2026-05-01T10:00:00.000Z',
      version: 2,
      previewText: 'Local body',
      record: baseNote
    },
    remote: {
      source: 'remote' as const,
      deviceId: 'phone-device',
      deviceName: 'Phone',
      updatedAt: '2026-05-02T10:00:00.000Z',
      version: 2,
      previewText: 'Local body',
      record: {
        ...baseNote,
        deletedAt: '2026-05-02T10:00:00.000Z',
        updatedAt: '2026-05-02T10:00:00.000Z',
        deviceId: 'phone-device',
        version: 2,
        syncStatus: 'synced' as const,
        lastSyncedVersion: 2
      }
    }
  };
}

function noteConflictRecord(
  conflict: ReturnType<typeof deletedRemoteNoteConflict>
): LocalConflict {
  return {
    id: conflict.id,
    entityType: 'note',
    entityId: conflict.entityId,
    status: 'pending',
    createdAt: '2026-05-02T10:06:00.000Z',
    conflict
  };
}

function duplicateNotebookConflict() {
  return {
    id: 'conflict-1',
    entityType: 'notebook' as const,
    entityId: 'local-book',
    reason: 'duplicate_name' as const,
    local: {
      source: 'local' as const,
      deviceId: 'browser-device',
      deviceName: 'Browser',
      updatedAt: '2026-05-02T10:00:00.000Z',
      version: 1,
      previewText: 'Ideas',
      record: {
        ...baseNotebook,
        id: 'local-book',
        name: 'Ideas',
        version: 1,
        lastSyncedVersion: 0,
        syncStatus: 'conflict' as const
      }
    },
    remote: {
      source: 'remote' as const,
      deviceId: 'phone-device',
      deviceName: 'Phone',
      updatedAt: '2026-05-02T10:05:00.000Z',
      version: 4,
      previewText: 'Ideas',
      record: {
        ...baseNotebook,
        id: 'remote-book',
        name: 'Ideas',
        deviceId: 'phone-device',
        version: 4,
        lastSyncedVersion: 4,
        syncStatus: 'synced' as const
      }
    }
  };
}

function localConflictRecord(
  conflict: ReturnType<typeof duplicateNotebookConflict>
): LocalConflict {
  return {
    id: conflict.id,
    entityType: 'notebook',
    entityId: conflict.entityId,
    status: 'pending',
    createdAt: '2026-05-02T10:06:00.000Z',
    conflict
  };
}
