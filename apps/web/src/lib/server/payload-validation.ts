import type { Note, Notebook, SyncStatus } from '@author/schema';

const SYNC_STATUSES = new Set<SyncStatus>([
  'synced',
  'pending',
  'conflict',
  'deleted'
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function hasNoteRecord(record: unknown): record is Note {
  if (!record || typeof record !== 'object') return false;
  const note = record as Partial<Note>;
  return (
    nonEmptyString(note.id) &&
    typeof note.title === 'string' &&
    typeof note.body === 'string' &&
    isNullableString(note.titleHash ?? null) &&
    isNullableString(note.bodyHash ?? null) &&
    isStringArray(note.notebookIds) &&
    isNullableString(note.notebookId) &&
    isIsoDate(note.createdAt) &&
    isIsoDate(note.updatedAt) &&
    isNullableIsoDate(note.deletedAt) &&
    isNullableIsoDate(note.trashedAt) &&
    typeof (note.isFavorite ?? false) === 'boolean' &&
    nonEmptyString(note.deviceId) &&
    isPositiveInteger(note.version) &&
    Boolean(note.syncStatus && SYNC_STATUSES.has(note.syncStatus))
  );
}

export function hasNotebookRecord(record: unknown): record is Notebook {
  if (!record || typeof record !== 'object') return false;
  const notebook = record as Partial<Notebook>;
  return (
    nonEmptyString(notebook.id) &&
    typeof notebook.name === 'string' &&
    isNullableString(notebook.nameHash ?? null) &&
    isIsoDate(notebook.createdAt) &&
    isIsoDate(notebook.updatedAt) &&
    isNullableIsoDate(notebook.deletedAt) &&
    nonEmptyString(notebook.deviceId) &&
    isPositiveInteger(notebook.version) &&
    Boolean(notebook.syncStatus && SYNC_STATUSES.has(notebook.syncStatus))
  );
}

export function hasEntityChanges<T>(
  value: unknown,
  hasRecord: (record: unknown) => record is T
): value is Array<{ record: T; baseVersion: number }> {
  return (
    Array.isArray(value) &&
    value.every((change) => {
      if (!change || typeof change !== 'object') return false;
      const candidate = change as { baseVersion?: unknown; record?: unknown };
      return (
        isNonNegativeInteger(candidate.baseVersion) &&
        hasRecord(candidate.record)
      );
    })
  );
}

export function hasUniqueEntityChangeIds<T extends { id: string }>(
  changes: Array<{ record: T }>
): boolean {
  const ids = new Set<string>();
  for (const change of changes) {
    if (ids.has(change.record.id)) return false;
    ids.add(change.record.id);
  }
  return true;
}
