import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@author/schema';
import type { LocalNote } from './db';
import { markAcceptedChanges, mergeRemoteChanges } from './sync-store';
import { localDb } from './db';

vi.mock('./db', () => ({
  localDb: {
    transaction: vi.fn(async (_mode, _tables, operation) => operation()),
    notes: {
      get: vi.fn(),
      put: vi.fn()
    },
    notebooks: {
      get: vi.fn(),
      put: vi.fn()
    },
    devices: {
      bulkPut: vi.fn()
    },
    conflicts: {
      put: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  decryptNoteFields: vi.fn(async (note) => note),
  encryptNoteFields: vi.fn(async (note) => note)
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

beforeEach(() => {
  vi.clearAllMocks();
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
            previewText: baseNote.body,
            record: baseNote
          }),
          remote: expect.objectContaining({
            source: 'remote',
            previewText: 'Remote body',
            record: expect.objectContaining({
              body: 'Remote body',
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
});
