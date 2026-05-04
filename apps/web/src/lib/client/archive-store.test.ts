import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNote, LocalNotebook } from './db';
import { exportNotesJson, importNotesJson } from './archive-store';
import { localDb } from './db';

vi.mock('./db', () => ({
  localDb: {
    notes: {
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    notebooks: {
      toArray: vi.fn(),
      put: vi.fn()
    },
    transaction: vi.fn(async (_mode, _tables, operation) => operation())
  }
}));

vi.mock('./encryption', () => ({
  decryptNoteFields: vi.fn(async (note) => note),
  encryptNoteFields: vi.fn(async (note) => note)
}));

vi.mock('./local-state', () => ({
  getOrCreateDevice: vi.fn(async () => ({
    id: 'browser-device',
    name: 'This browser'
  })),
  newId: vi
    .fn()
    .mockReturnValueOnce('imported-notebook-id')
    .mockReturnValueOnce('imported-note-id'),
  nowIso: vi.fn(() => '2026-05-04T09:00:00.000Z')
}));

const notebook: LocalNotebook = {
  id: 'notebook-1',
  name: 'Ideas',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  deletedAt: null,
  deviceId: 'browser-device',
  version: 1,
  syncStatus: 'synced',
  lastSyncedVersion: 1,
  lastSyncedAt: '2026-05-01T10:00:00.000Z'
};

const note: LocalNote = {
  id: 'note-1',
  title: 'Roadmap',
  body: 'Launch plan',
  notebookIds: ['notebook-1'],
  notebookId: 'notebook-1',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-02T10:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: 'browser-device',
  version: 2,
  syncStatus: 'synced',
  lastSyncedVersion: 2,
  lastSyncedAt: '2026-05-02T10:00:00.000Z'
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(localDb.notes.toArray).mockResolvedValue([note]);
  vi.mocked(localDb.notebooks.toArray).mockResolvedValue([notebook]);
  vi.mocked(localDb.notes.bulkPut).mockResolvedValue('imported-note-id');
  vi.mocked(localDb.notebooks.put).mockResolvedValue('notebook-1');
});

describe('archive store import and export', () => {
  it('exports JSON archives with notebook names and note links', async () => {
    await expect(exportNotesJson()).resolves.toMatchObject({
      app: 'author-notes',
      format: 'author-notes-json',
      version: 1,
      notebooks: [
        {
          id: 'notebook-1',
          name: 'Ideas'
        }
      ],
      notes: [
        {
          id: 'note-1',
          title: 'Roadmap',
          body: 'Launch plan',
          notebookIds: ['notebook-1'],
          notebookNames: ['Ideas'],
          notebookId: 'notebook-1',
          notebookName: 'Ideas'
        }
      ]
    });
  });

  it('imports JSON archives into pending local notebook and note records', async () => {
    vi.mocked(localDb.notebooks.toArray).mockResolvedValue([]);

    await expect(
      importNotesJson({
        notebooks: [{ id: 'source-notebook', name: 'Ideas' }],
        notes: [
          {
            title: 'Roadmap',
            body: 'Launch plan',
            notebookIds: ['source-notebook'],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-02T10:00:00.000Z',
            trashedAt: null
          }
        ]
      })
    ).resolves.toEqual({
      importedNotes: 1,
      importedNotebooks: 1,
      reusedNotebooks: 1,
      skippedNotes: 0,
      noteIds: ['imported-note-id']
    });

    expect(localDb.notebooks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'imported-notebook-id',
        name: 'Ideas',
        syncStatus: 'pending'
      })
    );
    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'imported-note-id',
        title: 'Roadmap',
        body: 'Launch plan',
        notebookIds: ['imported-notebook-id'],
        notebookId: 'imported-notebook-id',
        syncStatus: 'pending'
      })
    ]);
  });
});
