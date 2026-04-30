import type { LocalNote } from './db';
import { noteDisplayTitle, noteNotebookIds } from './note-utils';

export type NoteSort = 'date-desc' | 'az' | 'za';
export type NoteGroup = { label: string; notes: LocalNote[] };

export type SyncIndicatorKind =
  | 'synced'
  | 'pending'
  | 'conflict'
  | 'deleted'
  | 'offline'
  | 'local-only'
  | 'syncing';

export interface SyncIndicatorState {
  isSyncing: boolean;
  conflictCount: number;
  isBrowserOnline: boolean;
  hasSession: boolean;
  pendingSyncCount: number;
  syncMessage: string;
}

export interface SyncIndicator {
  kind: SyncIndicatorKind;
  label: string;
  detail: string;
}

const DAY_MS = 86_400_000;
const HEALTHY_SYNC_MESSAGES = new Set([
  'Online',
  'Saving',
  'Syncing',
  'Synced',
  'All changes saved'
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

export function filterNotesBySearch(items: LocalNote[], query: string): LocalNote[] {
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
  if (sort !== 'date-desc') return [{ label: sort === 'az' ? 'A-Z' : 'Z-A', notes: items }];

  const groups = new Map<string, LocalNote[]>();
  for (const note of items) {
    const label = dateRangeLabel(note.updatedAt, now);
    groups.set(label, [...(groups.get(label) ?? []), note]);
  }

  return Array.from(groups, ([label, groupNotes]) => ({ label, notes: groupNotes }));
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
  const daysAgo = Math.max(0, Math.floor((today.getTime() - target.getTime()) / DAY_MS));

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

export function noteStatusLabel(note: LocalNote): string {
  if (note.syncStatus === 'pending') return 'Pending sync';
  if (note.syncStatus === 'conflict') return 'Conflict';
  if (note.syncStatus === 'deleted') return 'Deleted';
  return 'Synced';
}

export function syncIndicatorState(state: SyncIndicatorState): SyncIndicator {
  const { isSyncing, conflictCount, isBrowserOnline, hasSession, pendingSyncCount, syncMessage } =
    state;

  if (isSyncing) return { kind: 'syncing', label: 'Saving', detail: '' };
  if (conflictCount > 0) {
    return {
      kind: 'conflict',
      label: `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`,
      detail: ''
    };
  }
  if (!isBrowserOnline) return { kind: 'offline', label: 'Offline', detail: '' };
  if (!hasSession) return { kind: 'local-only', label: 'Local only', detail: 'Sign in to sync' };
  if (pendingSyncCount > 0) {
    const label = 'Saving';
    return { kind: 'pending', label, detail: syncDetail(syncMessage, label) };
  }

  const label = 'All changes saved';
  return { kind: 'synced', label, detail: syncDetail(syncMessage, label) };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function syncDetail(syncMessage: string, label: string): string {
  return syncMessage && !HEALTHY_SYNC_MESSAGES.has(syncMessage) && syncMessage !== label
    ? syncMessage
    : '';
}
