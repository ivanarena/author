import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNote } from './db';
import {
  adoptLocalWorkspaceForAccount,
  assertLocalWorkspaceCanUseAccount
} from './entity-store';
import { localDb } from './db';
import { reencryptNoteFields } from './encryption';

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
      count: vi.fn()
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
  vi.mocked(localDb.notes.count).mockResolvedValue(1);
  vi.mocked(localDb.notebooks.count).mockResolvedValue(0);
  vi.mocked(localDb.conflicts.count).mockResolvedValue(0);
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
