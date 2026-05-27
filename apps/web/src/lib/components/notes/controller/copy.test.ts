import { describe, expect, it } from 'vitest';
import type { LocalNote } from '$lib/client/db';
import {
  editorMetadataRowsForNote,
  formatSyncDebugLog,
  formatSyncPassDetail,
  formatSyncPassTime,
  metadataRowsForNote,
  syncProgressCopy
} from './copy';

function note(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    title: 'Release notes',
    body: 'Ship carefully',
    notebookIds: [],
    notebookId: null,
    createdAt: '2026-05-10T09:00:00.000Z',
    updatedAt: '2026-05-11T09:00:00.000Z',
    deletedAt: null,
    trashedAt: null,
    deviceId: 'device-1',
    version: 3,
    syncStatus: 'pending',
    lastSyncedVersion: 2,
    lastSyncedAt: null,
    ...overrides
  };
}

describe('notes controller copy helpers', () => {
  it('formats sync pass summaries defensively', () => {
    expect(
      formatSyncPassDetail({
        completedAt: null,
        pushed: 0,
        pulled: 0,
        conflicts: 0
      })
    ).toBe('No sync pass has completed in this browser.');

    expect(
      formatSyncPassDetail({
        completedAt: '2026-05-12T10:30:00.000Z',
        pushed: 1,
        pulled: 2,
        conflicts: Number.NaN
      })
    ).toBe('1 pushed change, 2 pulled changes, 0 conflicts');
  });

  it('formats sync debug logs with a stable fallback', () => {
    expect(
      formatSyncDebugLog({
        lastErrorAt: null,
        lastErrorMessage: '',
        lastErrorStack: ''
      })
    ).toBe('No sync errors recorded in this browser.');

    const iso = '2026-05-12T10:30:00.000Z';
    expect(
      formatSyncDebugLog({
        lastErrorAt: iso,
        lastErrorMessage: 'Network failed',
        lastErrorStack: 'stack line'
      })
    ).toBe(
      [
        `Time: ${formatSyncPassTime(iso)}`,
        'Message: Network failed',
        '\nstack line'
      ].join('\n')
    );
  });

  it('returns human copy for each sync phase', () => {
    expect(syncProgressCopy({ phase: 'preparing' })).toEqual({
      label: 'Preparing sync',
      detail: 'Checking local changes before the network pass'
    });
    expect(
      syncProgressCopy({ phase: 'pushing', total: 3, pushed: 0, batchSize: 3 })
    ).toEqual({
      label: 'Pushing local changes',
      detail: 'Sending 3 local changes'
    });
    expect(
      syncProgressCopy({ phase: 'pushing', total: 3, pushed: 2, batchSize: 3 })
    ).toEqual({
      label: 'Pushing local changes',
      detail: '2 of 3 local changes pushed'
    });
    expect(
      syncProgressCopy({
        phase: 'pulling',
        pulled: 0,
        hasMore: true,
        pageSize: 10
      })
    ).toEqual({
      label: 'Pulling remote changes',
      detail: 'Checking for remote changes'
    });
    expect(
      syncProgressCopy({
        phase: 'pulling',
        pulled: 1,
        hasMore: true,
        pageSize: 10
      })
    ).toEqual({
      label: 'Pulling remote changes',
      detail: '1 remote change pulled, checking for more'
    });
  });

  it('formats note metadata rows for settings and editor surfaces', () => {
    expect(metadataRowsForNote(note(), 2, 'Laptop')).toEqual([
      { label: 'Status', value: 'Pending sync' },
      { label: 'Last synced', value: 'Not synced yet' },
      { label: 'Last updated', value: formatSyncPassTime(note().updatedAt) },
      { label: 'Created', value: formatSyncPassTime(note().createdAt) },
      { label: 'Words', value: '2 words' }
    ]);

    const syncedNote = note({
      syncStatus: 'synced',
      lastSyncedAt: '2026-05-12T10:30:00.000Z'
    });
    expect(editorMetadataRowsForNote(syncedNote, 'Phone')).toEqual([
      { label: 'Status', value: 'Synced' },
      {
        label: 'Last synced',
        value: `Synced ${formatSyncPassTime(syncedNote.lastSyncedAt!)} by Phone`
      },
      {
        label: 'Last updated',
        value: `Updated ${formatSyncPassTime(syncedNote.updatedAt)}`
      },
      {
        label: 'Created',
        value: `Created ${formatSyncPassTime(syncedNote.createdAt)}`
      }
    ]);
  });
});
