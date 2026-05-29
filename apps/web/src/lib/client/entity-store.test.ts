import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalConflict, LocalNote } from './db';
import {
  adoptLocalWorkspaceForAccount,
  assertLocalWorkspaceCanUseAccount,
  deleteNotePermanently,
  ensureLocalNotesEncrypted,
  loadRepairDiagnostics,
  prepareLocalWorkspaceForAccount,
  reencryptLocalNotes,
  resetPullCursorRecovery
} from './entity-store';
import { clearLocalWorkspace, localDb } from './db';
import {
  assertSupportedEncryptionKeyMaterial,
  canDecryptEncryptedText,
  encryptNoteFields,
  hasStoredEncryptionKeyMaterial,
  isCurrentEncryptedText,
  isCurrentFieldHash,
  isEncryptedText,
  isUnsupportedEncryptedText,
  reencryptNoteFields
} from './encryption';
import { getOrCreateDevice, getStoredSession } from './local-state';
import { recordDebugLog } from './debug-log';

vi.mock('./db', () => ({
  clearLocalWorkspace: vi.fn(),
  localDb: {
    notes: {
      count: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    notebooks: {
      count: vi.fn(),
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    conflicts: {
      count: vi.fn(),
      toArray: vi.fn(),
      bulkPut: vi.fn()
    },
    syncMeta: {
      get: vi.fn(),
      put: vi.fn(),
      bulkPut: vi.fn(),
      delete: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE:
    'This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version.',
  assertSupportedEncryptionKeyMaterial: vi.fn(),
  canDecryptEncryptedText: vi.fn(async () => true),
  canDecryptEncryptedTextWithPrimaryMaterial: vi.fn(async () => true),
  decryptNoteFields: vi.fn(async (note) => note),
  decryptNotebookFields: vi.fn(async (notebook) => notebook),
  encryptNoteFields: vi.fn(async (note) => note),
  encryptNotebookFields: vi.fn(async (notebook) => notebook),
  hasStoredEncryptionKeyMaterial: vi.fn(() => true),
  isCurrentEncryptedText: vi.fn(() => true),
  isCurrentFieldHash: vi.fn(() => true),
  isEncryptedText: vi.fn(() => true),
  isUnsupportedEncryptedText: vi.fn(() => false),
  notebookNameContext: vi.fn(
    (notebook: { id: string }) => `notebook:${notebook.id}:name`
  ),
  reencryptNoteFields: vi.fn(async (note) => ({
    ...note,
    title: 'reencrypted-title'
  })),
  reencryptNotebookFields: vi.fn(async (notebook) => ({
    ...notebook,
    name: 'reencrypted-name'
  }))
}));

vi.mock('./local-state', () => ({
  getOrCreateDevice: vi.fn(),
  getStoredSession: vi.fn(() => null),
  newId: vi.fn(() => 'test-id'),
  nowIso: vi.fn(() => '2026-05-06T12:00:00.000Z')
}));

vi.mock('./debug-log', () => ({
  recordDebugLog: vi.fn()
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
  vi.mocked(assertSupportedEncryptionKeyMaterial).mockImplementation(
    () => undefined
  );
  vi.mocked(isCurrentEncryptedText).mockReturnValue(true);
  vi.mocked(isCurrentFieldHash).mockReturnValue(true);
  vi.mocked(isEncryptedText).mockReturnValue(true);
  vi.mocked(isUnsupportedEncryptedText).mockReturnValue(false);
  vi.mocked(canDecryptEncryptedText).mockResolvedValue(true);
  vi.mocked(hasStoredEncryptionKeyMaterial).mockReturnValue(true);
  vi.mocked(reencryptNoteFields).mockImplementation(async (storedNote) => ({
    ...storedNote,
    title: 'reencrypted-title'
  }));
  vi.mocked(localDb.notebooks.toArray).mockResolvedValue([]);
  vi.mocked(localDb.notebooks.bulkPut).mockResolvedValue('notebook-1');
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
  vi.mocked(localDb.notes.get).mockResolvedValue(note);
  vi.mocked(localDb.notes.put).mockResolvedValue('note-1');
  vi.mocked(localDb.notes.delete).mockResolvedValue(undefined);
  vi.mocked(localDb.syncMeta.get).mockResolvedValue(undefined);
  vi.mocked(localDb.syncMeta.put).mockResolvedValue('localWorkspaceOwner');
  vi.mocked(localDb.syncMeta.bulkPut).mockResolvedValue('lastPulledRevision');
  vi.mocked(localDb.syncMeta.delete).mockResolvedValue(undefined);
  vi.mocked(getStoredSession).mockReturnValue(null);
  vi.mocked(recordDebugLog).mockReturnValue(undefined);
  vi.mocked(clearLocalWorkspace).mockResolvedValue(undefined);
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
      'Local notes in this browser belong to alice'
    );
    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
  });

  it('clears synced local data when switching accounts', async () => {
    vi.mocked(localDb.syncMeta.get).mockResolvedValue({
      key: 'localWorkspaceOwner',
      value: 'alice'
    });
    vi.mocked(localDb.notes.toArray).mockResolvedValue([
      { ...note, syncStatus: 'synced', lastSyncedVersion: 1 }
    ]);

    await expect(prepareLocalWorkspaceForAccount('bob')).resolves.toMatchObject(
      {
        cleared: true,
        previousOwner: 'alice'
      }
    );

    expect(clearLocalWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe('local note encryption sync state', () => {
  it('fails closed when stored key material needs the migration build', async () => {
    vi.mocked(assertSupportedEncryptionKeyMaterial).mockImplementation(() => {
      throw new Error('migration build required');
    });

    await expect(ensureLocalNotesEncrypted()).rejects.toThrow(
      'migration build required'
    );

    expect(localDb.notes.toArray).not.toHaveBeenCalled();
    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
  });

  it('fails closed instead of re-encrypting old ciphertext envelopes as text', async () => {
    vi.mocked(localDb.notes.toArray).mockResolvedValue([
      { ...note, title: 'enc:v2:old-title', body: 'enc:v3:new-body' }
    ]);
    vi.mocked(isUnsupportedEncryptedText).mockImplementation((value) =>
      value.startsWith('enc:v2:')
    );

    await expect(ensureLocalNotesEncrypted()).rejects.toThrow(
      'older encryption format'
    );

    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
  });

  it('marks encryption upgrades as pending sync changes', async () => {
    const syncedNote: LocalNote = {
      ...note,
      syncStatus: 'synced',
      lastSyncedVersion: 1
    };
    vi.mocked(localDb.notes.toArray).mockResolvedValue([syncedNote]);
    vi.mocked(isCurrentEncryptedText).mockReturnValue(false);
    vi.mocked(isCurrentFieldHash).mockReturnValue(false);
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
      value: 'keyring-aes:v7'
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

  it('encrypts plaintext note conflicts for storage', async () => {
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

describe('repair diagnostics', () => {
  it('reports missing key material for a signed-in workspace', async () => {
    vi.mocked(getStoredSession).mockReturnValue({
      token: 'session-token',
      user: {
        username: 'alice',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null
    });
    vi.mocked(hasStoredEncryptionKeyMaterial).mockReturnValue(false);
    vi.mocked(localDb.syncMeta.get).mockImplementation((async (
      key: unknown
    ) => {
      const values: Record<string, string> = {
        lastPulledRevision: '41',
        lastPulledAt: '2026-05-06T10:00:00.000Z'
      };
      const value = values[String(key)];
      return value === undefined ? undefined : { key: String(key), value };
    }) as never);

    const diagnostics = await loadRepairDiagnostics();

    expect(diagnostics.canResetPullCursor).toBe(true);
    expect(diagnostics.issueCount).toBeGreaterThan(0);
    expect(diagnostics.entries).toContainEqual(
      expect.objectContaining({
        label: 'Encryption key material',
        status: 'error'
      })
    );
  });

  it('returns clean diagnostics for healthy local sync state', async () => {
    vi.mocked(localDb.notes.toArray).mockResolvedValue([
      { ...note, syncStatus: 'synced', lastSyncedVersion: 1 }
    ]);
    vi.mocked(localDb.syncMeta.get).mockImplementation((async (
      key: unknown
    ) => {
      const values: Record<string, string> = {
        localEncryptionAuditVersion: 'keyring-aes:v7',
        lastPulledRevision: '41',
        localWorkspaceOwner: 'alice'
      };
      const value = values[String(key)];
      return value === undefined ? undefined : { key: String(key), value };
    }) as never);

    await expect(loadRepairDiagnostics()).resolves.toMatchObject({
      issueCount: 0,
      canResetPullCursor: true
    });
  });

  it('resets pull cursor recovery metadata without touching notes', async () => {
    await resetPullCursorRecovery();

    expect(localDb.syncMeta.bulkPut).toHaveBeenCalledWith([
      { key: 'lastPulledRevision', value: '0' },
      { key: 'lastPullCursorResetAt', value: '2026-05-06T12:00:00.000Z' }
    ]);
    expect(localDb.syncMeta.delete).toHaveBeenCalledWith('lastPulledAt');
    expect(localDb.notes.bulkPut).not.toHaveBeenCalled();
    expect(recordDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        source: 'Sync',
        message: 'Pull cursor reset for recovery'
      })
    );
  });
});

describe('local-only deletes', () => {
  it('removes a never-synced note locally instead of queuing a server delete', async () => {
    await deleteNotePermanently(note.id);

    expect(localDb.notes.delete).toHaveBeenCalledWith(note.id);
    expect(localDb.notes.put).not.toHaveBeenCalled();
  });

  it('queues a delete when the note exists on the server', async () => {
    vi.mocked(localDb.notes.get).mockResolvedValue({
      ...note,
      syncStatus: 'synced',
      lastSyncedVersion: 2
    });

    await deleteNotePermanently(note.id);

    expect(localDb.notes.delete).not.toHaveBeenCalled();
    expect(localDb.notes.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: note.id,
        deletedAt: '2026-05-06T12:00:00.000Z',
        syncStatus: 'pending',
        lastSyncedVersion: 2
      })
    );
  });
});
