import {
  SYNC_LIMITS,
  type ConflictVersion,
  type SyncConflict
} from '@author/api-types';
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
      a.trashedAt !== b.trashedAt ||
      Boolean(a.isFavorite) !== Boolean(b.isFavorite)
    );
  }

  if (!('body' in a) && !('body' in b)) {
    const nameDiffers =
      a.nameHash || b.nameHash
        ? (a.nameHash ?? null) !== (b.nameHash ?? null)
        : a.name !== b.name;
    return nameDiffers || a.deletedAt !== b.deletedAt;
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

const utf8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

/** Serialized UTF-8 size of a value as it is sent in a JSON request body. */
export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

/**
 * True when a record has a field the server rejects as too large. Such a
 * record can never be pushed; it must stay pending locally until it shrinks.
 */
export function recordExceedsSyncFieldLimits(record: SyncEntity): boolean {
  if ('body' in record) {
    return (
      utf8ByteLength(record.title) > SYNC_LIMITS.titleBytes ||
      utf8ByteLength(record.body) > SYNC_LIMITS.bodyBytes
    );
  }
  return utf8ByteLength(record.name) > SYNC_LIMITS.notebookNameBytes;
}

export interface PushBatchPlan<T> {
  batches: T[][];
  /** Items that cannot fit in any request and were left out of `batches`. */
  oversized: T[];
}

/**
 * Splits push changes into requests bounded by change count and serialized
 * size. `baseBytes` is the size of a request with no changes; `sizeOf` returns
 * the serialized size of one change. Order is preserved.
 */
export function planPushBatches<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  {
    baseBytes,
    maxChanges = SYNC_LIMITS.pushChanges,
    maxBytes = SYNC_LIMITS.pushRequestBytes
  }: { baseBytes: number; maxChanges?: number; maxBytes?: number }
): PushBatchPlan<T> {
  const batches: T[][] = [];
  const oversized: T[] = [];
  let current: T[] = [];
  let currentBytes = baseBytes;
  for (const item of items) {
    // One extra byte per change covers the separating comma.
    const itemBytes = sizeOf(item) + 1;
    if (baseBytes + itemBytes > maxBytes) {
      oversized.push(item);
      continue;
    }
    if (
      current.length > 0 &&
      (current.length >= maxChanges || currentBytes + itemBytes > maxBytes)
    ) {
      batches.push(current);
      current = [];
      currentBytes = baseBytes;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversized };
}

export interface PlannedPushChange {
  entityType: 'note' | 'notebook';
  change: { record: SyncEntity };
}

export interface SyncPushPlan<T> {
  batches: T[][];
  /** Changes that cannot be pushed now; they must stay pending locally. */
  unsyncable: T[];
}

/**
 * Plans the push requests for a set of pending changes.
 *
 * - A record with a field the server rejects as too large cannot be pushed,
 *   and neither can a live note assigned to such a notebook: the server would
 *   accept the note without that assignment.
 * - Deletions go first, in batches of their own. The server accepts a push
 *   made only of deletions even when the account is over its storage limit,
 *   so deleting data can always free space.
 * - Other changes keep their order, so notebooks are pushed before the notes
 *   that reference them.
 */
export function planSyncPushChanges<T extends PlannedPushChange>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  options: { baseBytes: number; maxChanges?: number; maxBytes?: number }
): SyncPushPlan<T> {
  const blockedNotebookIds = new Set(
    items
      .filter(
        (item) =>
          item.entityType === 'notebook' &&
          recordExceedsSyncFieldLimits(item.change.record)
      )
      .map((item) => item.change.record.id)
  );
  const cannotSync = (item: T): boolean => {
    const record = item.change.record;
    if (recordExceedsSyncFieldLimits(record)) return true;
    return (
      item.entityType === 'note' &&
      'body' in record &&
      !record.deletedAt &&
      noteNotebookIds(record).some((id) => blockedNotebookIds.has(id))
    );
  };
  const syncable = items.filter((item) => !cannotSync(item));
  const deletions = planPushBatches(
    syncable.filter((item) => item.change.record.deletedAt),
    sizeOf,
    options
  );
  const others = planPushBatches(
    syncable.filter((item) => !item.change.record.deletedAt),
    sizeOf,
    options
  );
  return {
    batches: [...deletions.batches, ...others.batches],
    unsyncable: [
      ...items.filter(cannotSync),
      ...deletions.oversized,
      ...others.oversized
    ]
  };
}
