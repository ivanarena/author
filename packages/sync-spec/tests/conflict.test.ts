import { describe, expect, it } from 'vitest';
import type { SyncConflict } from '@author/api-types';
import type { Note } from '@author/schema';
import {
  chooseConflictVersion,
  previewText,
  recordsDiffer,
  retentionCutoff,
  shouldConflict
} from '../src/index';

const baseNote: Note = {
  id: 'note-1',
  title: 'Draft',
  body: 'Local body',
  notebookId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T01:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
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
  });

  it('creates short note previews and a 90 day cutoff', () => {
    expect(previewText(baseNote)).toBe('Local body');
    expect(retentionCutoff(new Date('2026-04-29T00:00:00.000Z'), 90)).toBe(
      '2026-01-29T00:00:00.000Z'
    );
  });
});
