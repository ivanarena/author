import { describe, expect, it } from 'vitest';
import type { SyncConflict } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import {
  chooseConflictVersion,
  previewText,
  recordsDiffer,
  retentionCutoff,
  safeRevisionCursor,
  type SyncEntity,
  shouldConflict
} from '../src/index';

const baseNote: Note = {
  id: 'note-1',
  title: 'Draft',
  body: 'Local body',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T01:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: 'device-a',
  version: 2,
  syncStatus: 'pending'
};

const baseNotebook: Notebook = {
  id: 'notebook-1',
  name: 'Inbox',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T01:00:00.000Z',
  deletedAt: null,
  deviceId: 'device-a',
  version: 2,
  syncStatus: 'pending'
};

describe('sync conflict rules', () => {
  it('detects version conflicts when remote changed after the local base version', () => {
    const remote: Note = {
      ...baseNote,
      body: 'Remote body',
      deviceId: 'device-b',
      version: 3,
      syncStatus: 'synced'
    };

    expect(shouldConflict(baseNote, remote, 2)).toBe(true);
    expect(shouldConflict(baseNote, remote, 3)).toBe(false);
  });

  it('does not flag identical content as a conflict', () => {
    const remote: Note = { ...baseNote, syncStatus: 'synced' };

    expect(recordsDiffer(baseNote, remote)).toBe(false);
    expect(shouldConflict(baseNote, remote, 1)).toBe(false);
  });

  it('selects newer and older versions deterministically', () => {
    const conflict: SyncConflict<Note> = {
      id: 'conflict-1',
      entityType: 'note',
      entityId: 'note-1',
      reason: 'remote_changed',
      local: {
        source: 'local',
        deviceId: 'device-a',
        deviceName: 'Laptop',
        updatedAt: '2026-01-01T02:00:00.000Z',
        version: 2,
        previewText: 'Local body',
        record: baseNote
      },
      remote: {
        source: 'remote',
        deviceId: 'device-b',
        deviceName: 'Phone',
        updatedAt: '2026-01-01T03:00:00.000Z',
        version: 3,
        previewText: 'Remote body',
        record: { ...baseNote, body: 'Remote body', version: 3 }
      }
    };

    expect(chooseConflictVersion(conflict, 'keep-newer').source).toBe('remote');
    expect(chooseConflictVersion(conflict, 'keep-older').source).toBe('local');
    expect(chooseConflictVersion(conflict, 'keep-local').source).toBe('local');
    expect(chooseConflictVersion(conflict, 'keep-remote').source).toBe(
      'remote'
    );

    const sameTimestampConflict: SyncConflict<Note> = {
      ...conflict,
      local: { ...conflict.local, updatedAt: 'not-a-date', version: 2 },
      remote: { ...conflict.remote, updatedAt: 'not-a-date', version: 3 }
    };
    expect(
      chooseConflictVersion(sameTimestampConflict, 'keep-newer').source
    ).toBe('remote');
    expect(
      chooseConflictVersion(sameTimestampConflict, 'keep-older').source
    ).toBe('local');
  });

  it('compares encrypted note hashes and notebook id fallbacks', () => {
    const encryptedLocal: Note = {
      ...baseNote,
      title: 'enc:v1:local-title',
      body: 'enc:v1:local-body',
      titleHash: 'title-hash',
      bodyHash: 'body-hash',
      notebookIds: [],
      notebookId: ' notebook-1 '
    };
    const sameEncryptedRemote: Note = {
      ...encryptedLocal,
      title: 'enc:v1:remote-title',
      body: 'enc:v1:remote-body',
      notebookIds: ['notebook-1'],
      notebookId: 'notebook-1'
    };

    expect(recordsDiffer(encryptedLocal, sameEncryptedRemote)).toBe(false);
    expect(
      recordsDiffer(encryptedLocal, {
        ...sameEncryptedRemote,
        bodyHash: 'other-body-hash'
      })
    ).toBe(true);
    expect(
      recordsDiffer(encryptedLocal, {
        ...sameEncryptedRemote,
        notebookIds: ['notebook-2'],
        notebookId: 'notebook-2'
      })
    ).toBe(true);
  });

  it('compares notebook records and treats mismatched entity kinds as different', () => {
    expect(previewText({ ...baseNotebook, name: '' })).toBe(
      'Untitled notebook'
    );
    expect(
      recordsDiffer(baseNotebook, { ...baseNotebook, name: 'Archive' })
    ).toBe(true);
    expect(
      recordsDiffer(baseNotebook, {
        ...baseNotebook,
        deletedAt: '2026-01-02T00:00:00.000Z'
      })
    ).toBe(true);
    expect(
      recordsDiffer(baseNotebook as SyncEntity, baseNote as SyncEntity)
    ).toBe(true);
  });

  it('creates short note previews and a 90 day cutoff', () => {
    expect(previewText(baseNote)).toBe('Local body');
    expect(retentionCutoff(new Date('2026-04-29T00:00:00.000Z'), 90)).toBe(
      '2026-01-29T00:00:00.000Z'
    );
  });

  it('validates paged revision cursors', () => {
    expect(safeRevisionCursor(42, 41, true)).toBe(42);
    expect(safeRevisionCursor(42, 42, false)).toBe(42);
    expect(() => safeRevisionCursor(42, Number.NaN, false)).toThrow(
      'Invalid sync pull previous revision'
    );
    expect(() => safeRevisionCursor(-1, 0, false)).toThrow(
      'Invalid sync pull revision from server'
    );
    expect(() => safeRevisionCursor(41, 42, false)).toThrow(
      'Sync pull cursor did not advance'
    );
    expect(() => safeRevisionCursor(42, 42, true, 'Remote mirror')).toThrow(
      'Remote mirror cursor did not advance'
    );
  });
});
