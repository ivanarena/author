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
    return (
      a.title !== b.title ||
      a.body !== b.body ||
      noteNotebookIds(a).join('\0') !== noteNotebookIds(b).join('\0') ||
      a.notebookId !== b.notebookId ||
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
  return [...new Set(note.notebookIds?.length ? note.notebookIds : note.notebookId ? [note.notebookId] : [])].sort();
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

  const localTime = Date.parse(conflict.local.updatedAt);
  const remoteTime = Date.parse(conflict.remote.updatedAt);

  if (choice === 'keep-newer') {
    return localTime >= remoteTime ? conflict.local : conflict.remote;
  }

  return localTime <= remoteTime ? conflict.local : conflict.remote;
}

export function nextVersionAfter(remoteVersion: number): number {
  return remoteVersion + 1;
}

export function retentionCutoff(now: Date, retentionDays: number): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString();
}
