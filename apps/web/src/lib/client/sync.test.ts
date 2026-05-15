import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import {
  AuthError,
  login,
  runSync,
  SyncHttpError,
  type SyncProgress,
  validateSession
} from './sync';
import {
  applyRemoteDeletes,
  ensureLocalNotesEncrypted,
  getOrCreateDevice,
  markAcceptedChanges,
  mergeRemoteChanges,
  saveConflict,
  saveDevices
} from './store';
import { hasStoredEncryptionKeyMaterial } from './encryption';
import { localDb } from './db';

vi.mock('./encryption', () => ({
  hasStoredEncryptionKeyMaterial: vi.fn()
}));

vi.mock('./store', () => ({
  applyRemoteDeletes: vi.fn(),
  ensureLocalNotesEncrypted: vi.fn(),
  getOrCreateDevice: vi.fn(),
  markAcceptedChanges: vi.fn(),
  mergeRemoteChanges: vi.fn(),
  saveConflict: vi.fn(),
  saveDevices: vi.fn()
}));

vi.mock('./db', () => ({
  localDb: {
    notes: {
      where: vi.fn(),
      bulkPut: vi.fn()
    },
    notebooks: {
      where: vi.fn(),
      bulkPut: vi.fn()
    },
    syncMeta: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    }
  }
}));

const device = { id: 'device-local', name: 'Browser' };
const pushedDeviceSignature = `${device.id}\0${device.name}`;
const note: Note = {
  id: 'note-1',
  title: 'Draft',
  body: 'Body',
  notebookIds: ['notebook-1'],
  notebookId: 'notebook-1',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:05:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: device.id,
  version: 2,
  syncStatus: 'pending'
};
const notebook: Notebook = {
  id: 'notebook-1',
  name: 'Ideas',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:05:00.000Z',
  deletedAt: null,
  deviceId: device.id,
  version: 3,
  syncStatus: 'pending'
};

function pendingRows<T>(records: T[]) {
  return {
    equals: vi.fn(() => ({
      toArray: vi.fn(async () => records)
    }))
  };
}

function mockPendingNotes(records: unknown[]) {
  vi.mocked(localDb.notes.where).mockReturnValue(pendingRows(records) as never);
}

function mockPendingNotebooks(records: unknown[]) {
  vi.mocked(localDb.notebooks.where).mockReturnValue(
    pendingRows(records) as never
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch call');
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockSyncMeta(values: Record<string, string | undefined>) {
  vi.mocked(localDb.syncMeta.get).mockImplementation((async (key: unknown) => {
    const value = values[String(key)];
    return value === undefined ? undefined : { key: String(key), value };
  }) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasStoredEncryptionKeyMaterial).mockReturnValue(true);
  vi.mocked(getOrCreateDevice).mockResolvedValue(device);
  vi.mocked(ensureLocalNotesEncrypted).mockResolvedValue(undefined);
  vi.mocked(applyRemoteDeletes).mockResolvedValue(undefined);
  vi.mocked(markAcceptedChanges).mockResolvedValue(undefined);
  vi.mocked(saveConflict).mockResolvedValue(undefined);
  vi.mocked(saveDevices).mockResolvedValue(undefined);
  vi.mocked(mergeRemoteChanges).mockResolvedValue(undefined);
  mockSyncMeta({ lastPushedDeviceSignature: pushedDeviceSignature });
  vi.mocked(localDb.syncMeta.put).mockResolvedValue('lastPulledAt');
  vi.mocked(localDb.syncMeta.delete).mockResolvedValue(undefined);
  vi.mocked(localDb.notes.bulkPut).mockResolvedValue(note.id);
  vi.mocked(localDb.notebooks.bulkPut).mockResolvedValue(notebook.id);
  mockPendingNotes([]);
  mockPendingNotebooks([]);
});

describe('client sync orchestration', () => {
  it('refuses to sync before the encryption key is available', async () => {
    vi.mocked(hasStoredEncryptionKeyMaterial).mockReturnValue(false);
    const fetchMock = mockFetch();

    await expect(runSync('session-token')).rejects.toThrow(
      'Sign in again to sync encrypted notes'
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureLocalNotesEncrypted).not.toHaveBeenCalled();
  });

  it('pushes pending local changes, stores conflicts, then merges a pull', async () => {
    const pendingNote = {
      ...note,
      lastSyncedVersion: 1,
      lastSyncedAt: null
    };
    const pendingNotebook = {
      ...notebook,
      lastSyncedVersion: 2,
      lastSyncedAt: null
    };
    mockPendingNotes([pendingNote]);
    mockPendingNotebooks([pendingNotebook]);
    const remoteNote = { ...note, id: 'note-remote', version: 1 };
    const remoteNotebook = { ...notebook, id: 'notebook-remote', version: 1 };
    const conflict = {
      id: 'conflict-1',
      entityType: 'note' as const,
      entityId: note.id,
      reason: 'remote_changed' as const,
      local: {
        source: 'local' as const,
        deviceId: device.id,
        deviceName: device.name,
        updatedAt: note.updatedAt,
        version: note.version,
        previewText: note.title,
        record: note
      },
      remote: {
        source: 'remote' as const,
        deviceId: 'phone',
        deviceName: 'Phone',
        updatedAt: note.updatedAt,
        version: 4,
        previewText: 'Remote draft',
        record: { ...note, title: 'Remote draft', version: 4 }
      }
    };
    const fetchMock = mockFetch(
      jsonResponse({
        accepted: [
          {
            entityType: 'note',
            id: note.id,
            version: 4,
            updatedAt: note.updatedAt
          },
          {
            entityType: 'notebook',
            id: notebook.id,
            version: 5,
            updatedAt: notebook.updatedAt
          }
        ],
        conflicts: [conflict],
        serverTime: '2026-05-01T10:10:00.000Z'
      }),
      jsonResponse({
        notes: [remoteNote],
        notebooks: [remoteNotebook],
        devices: [{ id: 'phone', name: 'Phone' }],
        deletedNoteIds: ['old-note'],
        deletedNotebookIds: ['old-notebook'],
        deletedDeviceIds: ['old-device'],
        serverTime: '2026-05-01T10:11:00.000Z',
        serverRevision: 42
      })
    );
    const progress: SyncProgress[] = [];

    await expect(
      runSync('session-token', (event) => progress.push(event))
    ).resolves.toEqual({
      pushed: 2,
      pulled: 4,
      conflicts: 1
    });

    expect(progress).toEqual([
      { phase: 'preparing' },
      { phase: 'pushing', pushed: 0, total: 2, batchSize: 2 },
      { phase: 'pushing', pushed: 2, total: 2, batchSize: 2 },
      { phase: 'pulling', pulled: 0, hasMore: true, pageSize: 0 },
      { phase: 'pulling', pulled: 4, hasMore: false, pageSize: 4 }
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sync/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer session-token',
          'content-type': 'application/json'
        }),
        body: JSON.stringify({
          device,
          notes: [{ record: pendingNote, baseVersion: 1 }],
          notebooks: [{ record: pendingNotebook, baseVersion: 2 }]
        })
      })
    );
    expect(markAcceptedChanges).toHaveBeenCalledWith(
      expect.any(Array),
      '2026-05-01T10:10:00.000Z',
      [
        {
          entityType: 'note',
          id: note.id,
          version: note.version,
          updatedAt: note.updatedAt
        },
        {
          entityType: 'notebook',
          id: notebook.id,
          version: notebook.version,
          updatedAt: notebook.updatedAt
        }
      ]
    );
    expect(saveConflict).toHaveBeenCalledWith(conflict);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({ since: null, sinceRevision: 0, limit: 1000 })
      })
    );
    expect(saveDevices).toHaveBeenCalledWith([{ id: 'phone', name: 'Phone' }]);
    expect(applyRemoteDeletes).toHaveBeenCalledWith(
      ['old-note'],
      ['old-notebook'],
      ['old-device']
    );
    expect(mergeRemoteChanges).toHaveBeenCalledWith(
      [remoteNote],
      [remoteNotebook],
      '2026-05-01T10:11:00.000Z'
    );
    expect(localDb.syncMeta.put).toHaveBeenCalledWith({
      key: 'lastPulledAt',
      value: '2026-05-01T10:11:00.000Z'
    });
    expect(localDb.syncMeta.put).toHaveBeenCalledWith({
      key: 'lastPulledRevision',
      value: '42'
    });
  });

  it('repairs stale pending records before pushing them', async () => {
    const staleNote = {
      ...note,
      deviceId: 'phone',
      version: 3,
      lastSyncedVersion: 3,
      lastSyncedAt: '2026-05-01T10:00:00.000Z'
    };
    const staleNotebook = {
      ...notebook,
      deviceId: 'phone',
      version: 5,
      lastSyncedVersion: 5,
      lastSyncedAt: '2026-05-01T10:00:00.000Z'
    };
    const repairedNote = {
      ...staleNote,
      deviceId: device.id,
      version: 4
    };
    const repairedNotebook = {
      ...staleNotebook,
      deviceId: device.id,
      version: 6
    };
    mockPendingNotes([staleNote]);
    mockPendingNotebooks([staleNotebook]);
    const fetchMock = mockFetch(
      jsonResponse({
        accepted: [],
        conflicts: [],
        serverTime: '2026-05-01T10:10:00.000Z'
      }),
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:11:00.000Z',
        serverRevision: 42
      })
    );

    await expect(runSync('session-token')).resolves.toEqual({
      pushed: 2,
      pulled: 0,
      conflicts: 0
    });

    expect(localDb.notes.bulkPut).toHaveBeenCalledWith([repairedNote]);
    expect(localDb.notebooks.bulkPut).toHaveBeenCalledWith([repairedNotebook]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sync/push',
      expect.objectContaining({
        body: JSON.stringify({
          device,
          notes: [{ record: repairedNote, baseVersion: 3 }],
          notebooks: [{ record: repairedNotebook, baseVersion: 5 }]
        })
      })
    );
    expect(markAcceptedChanges).toHaveBeenCalledWith(
      expect.any(Array),
      '2026-05-01T10:10:00.000Z',
      [
        {
          entityType: 'note',
          id: note.id,
          version: 4,
          updatedAt: note.updatedAt
        },
        {
          entityType: 'notebook',
          id: notebook.id,
          version: 6,
          updatedAt: notebook.updatedAt
        }
      ]
    );
  });

  it('skips push when there are no pending changes but still refreshes from pull', async () => {
    mockSyncMeta({
      lastPushedDeviceSignature: pushedDeviceSignature,
      lastPulledAt: '2026-05-01T10:00:00.000Z'
    });
    const fetchMock = mockFetch(
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 43
      })
    );

    await expect(runSync('session-token')).resolves.toEqual({
      pushed: 0,
      pulled: 0,
      conflicts: 0
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({
          since: '2026-05-01T10:00:00.000Z',
          sinceRevision: 0,
          limit: 1000
        })
      })
    );
    expect(markAcceptedChanges).not.toHaveBeenCalled();
    expect(saveConflict).not.toHaveBeenCalled();
  });

  it('pushes current device metadata when only the device name changed', async () => {
    mockSyncMeta({ lastPushedDeviceSignature: `${device.id}\0Old browser` });
    const fetchMock = mockFetch(
      jsonResponse({
        accepted: [],
        conflicts: [],
        serverTime: '2026-05-01T10:10:00.000Z'
      }),
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 43
      })
    );

    await expect(runSync('session-token')).resolves.toEqual({
      pushed: 0,
      pulled: 0,
      conflicts: 0
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sync/push',
      expect.objectContaining({
        body: JSON.stringify({ device, notes: [], notebooks: [] })
      })
    );
    expect(localDb.syncMeta.put).toHaveBeenCalledWith({
      key: 'lastPushedDeviceSignature',
      value: pushedDeviceSignature
    });
  });

  it('uses the stored revision cursor when one exists', async () => {
    mockSyncMeta({
      lastPushedDeviceSignature: pushedDeviceSignature,
      lastPulledAt: '2026-05-01T10:00:00.000Z',
      lastPulledRevision: '41'
    });
    const fetchMock = mockFetch(
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 43
      })
    );

    await runSync('session-token');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({
          since: '2026-05-01T10:00:00.000Z',
          sinceRevision: 41,
          limit: 1000
        })
      })
    );
  });

  it('resets the pull cursor once when the server revision moved backwards', async () => {
    mockSyncMeta({
      lastPushedDeviceSignature: pushedDeviceSignature,
      lastPulledAt: '2026-05-01T10:00:00.000Z',
      lastPulledRevision: '41'
    });
    const remoteNote = { ...note, id: 'note-after-reset', version: 1 };
    const fetchMock = mockFetch(
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 12
      }),
      jsonResponse({
        notes: [remoteNote],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:13:00.000Z',
        serverRevision: 12
      })
    );

    await expect(runSync('session-token')).resolves.toEqual({
      pushed: 0,
      pulled: 1,
      conflicts: 0
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({
          since: '2026-05-01T10:00:00.000Z',
          sinceRevision: 41,
          limit: 1000
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({ since: null, sinceRevision: 0, limit: 1000 })
      })
    );
    expect(localDb.syncMeta.put).toHaveBeenCalledWith({
      key: 'lastPulledRevision',
      value: '0'
    });
    expect(localDb.syncMeta.delete).toHaveBeenCalledWith('lastPulledAt');
    expect(mergeRemoteChanges).toHaveBeenCalledWith(
      [remoteNote],
      [],
      '2026-05-01T10:13:00.000Z'
    );
  });

  it('continues paged pulls until the server has no more changes', async () => {
    const firstRemoteNote = { ...note, id: 'note-page-1', version: 1 };
    const secondRemoteNote = { ...note, id: 'note-page-2', version: 1 };
    const fetchMock = mockFetch(
      jsonResponse({
        notes: [firstRemoteNote],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 42,
        hasMore: true
      }),
      jsonResponse({
        notes: [secondRemoteNote],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:13:00.000Z',
        serverRevision: 43,
        hasMore: false
      })
    );

    await expect(runSync('session-token')).resolves.toEqual({
      pushed: 0,
      pulled: 2,
      conflicts: 0
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({ since: null, sinceRevision: 0, limit: 1000 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/sync/pull',
      expect.objectContaining({
        body: JSON.stringify({ since: null, sinceRevision: 42, limit: 1000 })
      })
    );
    expect(mergeRemoteChanges).toHaveBeenNthCalledWith(
      1,
      [firstRemoteNote],
      [],
      '2026-05-01T10:12:00.000Z'
    );
    expect(mergeRemoteChanges).toHaveBeenNthCalledWith(
      2,
      [secondRemoteNote],
      [],
      '2026-05-01T10:13:00.000Z'
    );
  });

  it('fails instead of looping when a paged pull cursor does not advance', async () => {
    mockFetch(
      jsonResponse({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: '2026-05-01T10:12:00.000Z',
        serverRevision: 0,
        hasMore: true
      })
    );

    await expect(runSync('session-token')).rejects.toThrow(
      'Sync pull cursor did not advance'
    );
    expect(saveDevices).not.toHaveBeenCalled();
    expect(localDb.syncMeta.put).not.toHaveBeenCalled();
  });

  it('turns unauthorized responses into AuthError', async () => {
    mockFetch(jsonResponse({ error: 'Expired' }, { status: 401 }));

    await expect(validateSession('expired-token')).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it('preserves server error messages for failed login attempts', async () => {
    mockFetch(
      jsonResponse(
        { error: 'Invalid username or password' },
        {
          status: 401
        }
      )
    );

    await expect(login('owner', 'wrong-password')).rejects.toBeInstanceOf(
      AuthError
    );

    mockFetch(
      jsonResponse(
        { error: 'Database unavailable' },
        {
          status: 503
        }
      )
    );

    await expect(login('owner', 'password')).rejects.toMatchObject({
      name: 'SyncHttpError',
      status: 503,
      message: 'Database unavailable'
    } satisfies Partial<SyncHttpError>);
  });
});
