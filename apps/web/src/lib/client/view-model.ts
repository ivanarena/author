import type { LocalNote } from './db';
import { noteDisplayTitle, noteNotebookIds } from './note-utils';
import type { RemoteSyncState } from '@author/api-types';

export type NoteSort = 'date-desc' | 'az' | 'za';
export type NoteGroupBy = 'smart' | 'month' | 'year' | 'none';
export type NoteGroup = { label: string; notes: LocalNote[] };

export type SyncIndicatorKind =
  | 'synced'
  | 'pending'
  | 'conflict'
  | 'offline'
  | 'local-only'
  | 'syncing';

export type SyncIndicatorTone = 'ok' | 'info' | 'warn' | 'error' | 'muted';

export interface SyncIndicatorState {
  isSyncing: boolean;
  conflictCount: number;
  isBrowserOnline: boolean;
  hasSession: boolean;
  pendingSyncCount: number;
  syncMessage: string;
  syncActivityLabel?: string;
  syncActivityDetail?: string;
  remoteSyncEnabled?: boolean;
  remoteSyncState?: RemoteSyncState | 'unknown';
  remoteSyncError?: string;
}

export interface SyncIndicator {
  kind: SyncIndicatorKind;
  tone: SyncIndicatorTone;
  label: string;
  detail: string;
}

const DAY_MS = 86_400_000;
const HEALTHY_SYNC_MESSAGES = new Set([
  'Online',
  'Saving',
  'Syncing',
  'Synced',
  'All changes saved',
  'All changes synced',
  'Local changes saved',
  'Signed in',
  'Preparing sync',
  'Pushing local changes',
  'Pulling remote changes',
  'Waiting to sync',
  'Remote worker queued',
  'Syncing remote worker'
]);

export function filterNotesForView(
  notes: LocalNote[],
  trash: LocalNote[],
  filterId: 'all' | 'unfiled' | 'trash' | string
): LocalNote[] {
  if (filterId === 'trash') return trash;

  return notes.filter((note) => {
    const notebookIds = noteNotebookIds(note);
    if (filterId === 'all') return true;
    if (filterId === 'unfiled') return notebookIds.length === 0;
    return notebookIds.includes(filterId);
  });
}

export function filterNotesBySearch(
  items: LocalNote[],
  query: string
): LocalNote[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;

  return items.filter((note) =>
    `${note.title}\n${note.body}`.toLocaleLowerCase().includes(normalized)
  );
}

export function sortNotes(items: LocalNote[], sort: NoteSort): LocalNote[] {
  const sorted = [...items];
  if (sort === 'az' || sort === 'za') {
    sorted.sort((a, b) =>
      noteDisplayTitle(a).localeCompare(noteDisplayTitle(b), undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    );
    return sort === 'az' ? sorted : sorted.reverse();
  }

  return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function groupNotesByDateRange(
  items: LocalNote[],
  sort: NoteSort,
  now = new Date()
): NoteGroup[] {
  if (!items.length) return [];
  if (sort !== 'date-desc')
    return [{ label: sort === 'az' ? 'A-Z' : 'Z-A', notes: items }];

  return groupNotesByLabel(items, (note) =>
    dateRangeLabel(note.updatedAt, now)
  );
}

export function groupNotes(
  items: LocalNote[],
  sort: NoteSort,
  groupBy: NoteGroupBy,
  now = new Date()
): NoteGroup[] {
  if (!items.length) return [];
  if (groupBy === 'none') return [{ label: '', notes: items }];
  if (groupBy === 'month')
    return groupNotesByLabel(items, (note) => monthLabel(note.updatedAt));
  if (groupBy === 'year')
    return groupNotesByLabel(items, (note) => yearLabel(note.updatedAt));
  return groupNotesByDateRange(items, sort, now);
}

function groupNotesByLabel(
  items: LocalNote[],
  getLabel: (note: LocalNote) => string
): NoteGroup[] {
  const groups = new Map<string, LocalNote[]>();
  for (const note of items) {
    const label = getLabel(note);
    groups.set(label, [...(groups.get(label) ?? []), note]);
  }

  return Array.from(groups, ([label, groupNotes]) => ({
    label,
    notes: groupNotes
  }));
}

export function dateRangeLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const today = startOfDay(now);
  const target = startOfDay(date);
  const daysAgo = Math.floor((today.getTime() - target.getTime()) / DAY_MS);

  if (daysAgo < 0) return 'Future';
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return 'Previous 7 days';
  if (daysAgo < 30) return 'Previous 30 days';
  if (daysAgo < 365) return date.toLocaleString(undefined, { month: 'long' });
  return String(date.getFullYear());
}

function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function yearLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return String(date.getFullYear());
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export function formatListDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function relativeAge(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const today = startOfDay(now);
  const target = startOfDay(date);
  const daysAgo = Math.max(
    0,
    Math.floor((today.getTime() - target.getTime()) / DAY_MS)
  );

  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return '1d ago';
  if (daysAgo < 30) return `${daysAgo}d ago`;

  const monthsAgo = Math.floor(daysAgo / 30);
  if (monthsAgo < 12) return `${monthsAgo}mo ago`;

  const yearsAgo = Math.floor(daysAgo / 365);
  return `${yearsAgo}y ago`;
}

export function formatClock(date: Date): string {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches?.length ?? 0;
}

export function notePreview(note: LocalNote): string {
  return note.body.replace(/\s+/g, ' ').trim().slice(0, 96);
}

export function countNotesByNotebook(items: LocalNote[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of items) {
    const notebookIds = noteNotebookIds(note);
    if (!notebookIds.length) {
      counts.set('', (counts.get('') ?? 0) + 1);
      continue;
    }

    for (const key of notebookIds) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function syncIndicatorState(state: SyncIndicatorState): SyncIndicator {
  const {
    isSyncing,
    conflictCount,
    isBrowserOnline,
    hasSession,
    pendingSyncCount,
    syncMessage,
    syncActivityLabel = '',
    syncActivityDetail = '',
    remoteSyncEnabled = false,
    remoteSyncState = 'disabled',
    remoteSyncError = ''
  } = state;

  if (isSyncing) {
    const label = syncActivityLabel || 'Syncing changes';
    return syncIndicator(
      'syncing',
      label,
      syncActivityDetail || (remoteSyncEnabled ? 'Remote not synced yet' : '')
    );
  }
  if (conflictCount > 0) {
    return syncIndicator(
      'conflict',
      `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`,
      ''
    );
  }
  if (!isBrowserOnline) return syncIndicator('offline', 'Offline', '');
  if (!hasSession)
    return syncIndicator('local-only', 'Local only', 'Sign in to sync');
  if (pendingSyncCount > 0) {
    const label = 'Waiting to sync';
    return syncIndicator(
      'pending',
      label,
      syncDetail(syncMessage, label) ||
        `${pendingSyncCount} local change${pendingSyncCount === 1 ? '' : 's'} queued`
    );
  }

  if (remoteSyncEnabled) {
    if (remoteSyncState === 'queued') {
      const label = 'Remote worker queued';
      return syncIndicator('pending', label, 'Local changes saved');
    }
    if (remoteSyncState === 'syncing' || remoteSyncState === 'unknown') {
      const label = 'Syncing remote worker';
      return syncIndicator('syncing', label, 'Local changes saved');
    }
    if (remoteSyncState === 'error') {
      return syncIndicator('conflict', 'Remote worker failed', remoteSyncError);
    }
  }

  const label = remoteSyncEnabled ? 'All changes synced' : 'All changes saved';
  return syncIndicator('synced', label, syncDetail(syncMessage, label));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function syncIndicator(
  kind: SyncIndicatorKind,
  label: string,
  detail: string
): SyncIndicator {
  return { kind, tone: syncIndicatorTone(kind), label, detail };
}

function syncIndicatorTone(kind: SyncIndicatorKind): SyncIndicatorTone {
  if (kind === 'synced') return 'ok';
  if (kind === 'pending' || kind === 'syncing') return 'info';
  if (kind === 'offline') return 'warn';
  if (kind === 'local-only') return 'muted';
  return 'error';
}

function syncDetail(syncMessage: string, label: string): string {
  return syncMessage &&
    !HEALTHY_SYNC_MESSAGES.has(syncMessage) &&
    syncMessage !== label
    ? syncMessage
    : '';
}
