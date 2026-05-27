import type { LocalNote } from '$lib/client/db';
import { countWords } from '$lib/client/view-model';
import type { SyncProgress } from '$lib/client/sync';
import type { MetadataRow } from './models';

export function formatSyncPassTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatSyncCount(value: number, label: string): string {
  const count = Number.isFinite(value) ? value : 0;
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

export function formatSyncPassDetail(pass: {
  completedAt: string | null;
  pushed: number;
  pulled: number;
  conflicts: number;
}): string {
  if (!pass.completedAt) return 'No sync pass has completed in this browser.';
  return [
    formatSyncCount(pass.pushed, 'pushed change'),
    formatSyncCount(pass.pulled, 'pulled change'),
    formatSyncCount(pass.conflicts, 'conflict')
  ].join(', ');
}

export function formatSyncDebugLog(debug: {
  lastErrorAt: string | null;
  lastErrorMessage: string;
  lastErrorStack: string;
}): string {
  if (!debug.lastErrorAt && !debug.lastErrorMessage) {
    return 'No sync errors recorded in this browser.';
  }

  return [
    `Time: ${debug.lastErrorAt ? formatSyncPassTime(debug.lastErrorAt) : 'Unknown'}`,
    `Message: ${debug.lastErrorMessage || 'Sync failed'}`,
    debug.lastErrorStack ? `\n${debug.lastErrorStack}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function pluralizeSyncCount(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

export function syncProgressCopy(progress: SyncProgress): {
  label: string;
  detail: string;
} {
  if (progress.phase === 'preparing') {
    return {
      label: 'Preparing sync',
      detail: 'Checking local changes before the network pass'
    };
  }

  if (progress.phase === 'pushing') {
    return {
      label: 'Pushing local changes',
      detail:
        progress.total === 0
          ? 'No local changes to push'
          : progress.pushed === 0
            ? `Sending ${pluralizeSyncCount(progress.total, 'local change')}`
            : `${progress.pushed} of ${progress.total} local changes pushed`
    };
  }

  return {
    label: 'Pulling remote changes',
    detail:
      progress.pulled === 0
        ? 'Checking for remote changes'
        : `${pluralizeSyncCount(progress.pulled, 'remote change')} pulled${
            progress.hasMore ? ', checking for more' : ''
          }`
  };
}

function formatMetadataDate(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function noteSyncStatusLabel(note: LocalNote): string {
  if (note.syncStatus === 'synced') return 'Synced';
  if (note.syncStatus === 'conflict') return 'Conflict';
  if (note.syncStatus === 'deleted') return 'Deleted';
  return 'Pending sync';
}

function formatLastSynced(iso: string | null, deviceName: string): string {
  if (!iso) return 'Not synced yet';
  return `${formatMetadataDate(iso)} by ${deviceName}`;
}

export function metadataRowsForNote(
  note: LocalNote,
  wordCount = countWords(`${note.title} ${note.body}`),
  deviceName = 'Unknown device'
): MetadataRow[] {
  return [
    { label: 'Status', value: noteSyncStatusLabel(note) },
    {
      label: 'Last synced',
      value: formatLastSynced(note.lastSyncedAt, deviceName)
    },
    { label: 'Last updated', value: formatMetadataDate(note.updatedAt) },
    { label: 'Created', value: formatMetadataDate(note.createdAt) },
    {
      label: 'Words',
      value: `${wordCount} ${wordCount === 1 ? 'word' : 'words'}`
    }
  ];
}

export function editorMetadataRowsForNote(
  note: LocalNote,
  deviceName: string
): MetadataRow[] {
  return [
    { label: 'Status', value: noteSyncStatusLabel(note) },
    {
      label: 'Last synced',
      value:
        note.lastSyncedAt === null
          ? 'Not synced yet'
          : `Synced ${formatLastSynced(note.lastSyncedAt, deviceName)}`
    },
    {
      label: 'Last updated',
      value: `Updated ${formatMetadataDate(note.updatedAt)}`
    },
    { label: 'Created', value: `Created ${formatMetadataDate(note.createdAt)}` }
  ];
}
