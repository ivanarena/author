import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import type { LocalNote, LocalNotebook } from './db';
import {
  applyRemoteDeletes,
  markAcceptedChanges,
  mergeRemoteChanges
} from './sync-store';
import { localDb } from './db';
import { encryptNoteFields, isEncryptedText } from './encryption';

vi.mock('./db', () => ({
  localDb: {
    transaction: vi.fn(async (_mode, _tables, operation) => operation()),
    notes: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    },
    notebooks: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    },
    devices: {
      bulkPut: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    },
    conflicts: {
      put: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  decryptNoteFields: vi.fn(async (note) => note),
  encryptNoteFields: vi.fn(async (note) => note),
  isEncryptedText: vi.fn(() => true)
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
  vi.mocked(localDb.devices.get).mockResolvedValue(null);
  vi.mocked(encryptNoteFields).mockImplementation(async (note) => note);
  vi.mocked(isEncryptedText).mockReturnValue(true);
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

  it('queues pulled plaintext notes for encrypted republish', async () => {
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
});
