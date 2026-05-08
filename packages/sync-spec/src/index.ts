import type { ConflictVersion, SyncConflict } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';

export type SyncEntity = Note | Notebook;

export type ConflictChoice =
  | 'keep-newer'
  | 'keep-older'
  | 'keep-local'
  | 'keep-remote'
  | 'duplicate-both';

export function previewText(record: SyncEntity): string {
  if ('body' in record) {
    const body = record.body.trim().replace(/\s+/g, ' ');
    return body.slice(0, 160) || record.title || 'Empty note';
  }

  return record.name || 'Untitled notebook';
}

export function recordsDiffer<T extends SyncEntity>(a: T, b: T): boolean {
  if ('body' in a && 'body' in b) {
    const titleDiffers =
      a.titleHash || b.titleHash
        ? (a.titleHash ?? null) !== (b.titleHash ?? null)
        : a.title !== b.title;
    const bodyDiffers =
      a.bodyHash || b.bodyHash
        ? (a.bodyHash ?? null) !== (b.bodyHash ?? null)
        : a.body !== b.body;
    return (
      titleDiffers ||
      bodyDiffers ||
      noteNotebookIds(a).join('\0') !== noteNotebookIds(b).join('\0') ||
      normalizedNotebookId(a.notebookId) !==
        normalizedNotebookId(b.notebookId) ||
      a.deletedAt !== b.deletedAt ||
      a.trashedAt !== b.trashedAt
    );
  }

  if (!('body' in a) && !('body' in b)) {
    return a.name !== b.name || a.deletedAt !== b.deletedAt;
  }

  return true;
}

function noteNotebookIds(note: Note): string[] {
  const ids = note.notebookIds?.length
    ? note.notebookIds
    : note.notebookId
      ? [note.notebookId]
      : [];
  return normalizedNotebookIds(ids).sort();
}

function normalizedNotebookId(id: string | null): string | null {
  const trimmed = id?.trim() ?? '';
  return trimmed || null;
}

function normalizedNotebookIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function shouldConflict<T extends SyncEntity>(
  local: T,
  remote: T | null,
  baseVersion: number
): boolean {
  if (!remote) return false;
  if (!recordsDiffer(local, remote)) return false;
  return baseVersion !== remote.version;
}

export function chooseConflictVersion<T extends SyncEntity>(
  conflict: SyncConflict<T>,
  choice: Exclude<ConflictChoice, 'duplicate-both'>
): ConflictVersion<T> {
  if (choice === 'keep-local') return conflict.local;
  if (choice === 'keep-remote') return conflict.remote;

  const order = compareConflictVersions(conflict.local, conflict.remote);

  if (choice === 'keep-newer') {
    return order >= 0 ? conflict.local : conflict.remote;
  }

  return order <= 0 ? conflict.local : conflict.remote;
}

function compareConflictVersions<T extends SyncEntity>(
  local: ConflictVersion<T>,
  remote: ConflictVersion<T>
): number {
  const localTime = Date.parse(local.updatedAt);
  const remoteTime = Date.parse(remote.updatedAt);
  const localTimeValid = Number.isFinite(localTime);
  const remoteTimeValid = Number.isFinite(remoteTime);

  if (localTimeValid && remoteTimeValid && localTime !== remoteTime) {
    return localTime - remoteTime;
  }
  if (localTimeValid !== remoteTimeValid) return localTimeValid ? 1 : -1;
  if (local.version !== remote.version) return local.version - remote.version;
  return 0;
}

export function nextVersionAfter(remoteVersion: number): number {
  return remoteVersion + 1;
}

export function safeRevisionCursor(
  serverRevision: number,
  previousRevision: number,
  hasMore: boolean,
  context = 'Sync pull'
): number {
  if (!Number.isSafeInteger(previousRevision) || previousRevision < 0) {
    throw new Error(`Invalid ${context.toLowerCase()} previous revision`);
  }

  if (!Number.isSafeInteger(serverRevision) || serverRevision < 0) {
    throw new Error(`Invalid ${context.toLowerCase()} revision from server`);
  }

  if (
    serverRevision < previousRevision ||
    (hasMore && serverRevision === previousRevision)
  ) {
    throw new Error(
      `${context} cursor did not advance (previous ${previousRevision}, server ${serverRevision}, hasMore ${hasMore})`
    );
  }

  return serverRevision;
}

export function retentionCutoff(now: Date, retentionDays: number): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString();
}
