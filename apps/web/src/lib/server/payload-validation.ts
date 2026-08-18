import { SYNC_LIMITS } from '@author/api-types';
import type { Note, Notebook, SyncStatus } from '@author/schema';

const SYNC_STATUSES = new Set<SyncStatus>([
  'synced',
  'pending',
  'conflict',
  'deleted'
]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CURRENT_HASH_PATTERN = /^hash:v3:[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();

function textBytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function stringWithinBytes(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && textBytes(value) <= maxBytes;
}

function nonEmptyStringWithinBytes(
  value: unknown,
  maxBytes: number
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    textBytes(value) <= maxBytes
  );
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableStringWithinBytes(
  value: unknown,
  maxBytes: number
): value is string | null {
  return value === null || stringWithinBytes(value, maxBytes);
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    stringWithinBytes(value, SYNC_LIMITS.timestampBytes) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isIsoDate(value: unknown): value is string {
  return (
    stringWithinBytes(value, SYNC_LIMITS.timestampBytes) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= SYNC_LIMITS.notebookAssignments &&
    value.every((item) =>
      nonEmptyStringWithinBytes(item, SYNC_LIMITS.entityIdBytes)
    )
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isCurrentEncryptedEnvelope(value: string): boolean {
  const parts = value.split(':');
  if (
    parts.length !== 5 ||
    parts[0] !== 'enc' ||
    parts[1] !== 'v4' ||
    !parts[2] ||
    !BASE64URL_PATTERN.test(parts[2]) ||
    !BASE64URL_PATTERN.test(parts[3] ?? '') ||
    !BASE64URL_PATTERN.test(parts[4] ?? '')
  ) {
    return false;
  }

  // 12-byte IVs encode to 16 unpadded base64url characters. AES-GCM payloads
  // include at least the 16-byte authentication tag.
  return parts[3].length === 16 && parts[4].length >= 22;
}

function isCurrentFieldHash(value: string | null | undefined): boolean {
  return Boolean(value && CURRENT_HASH_PATTERN.test(value));
}

export function hasCurrentEncryptedNoteFields(note: Note): boolean {
  return (
    isCurrentEncryptedEnvelope(note.title) &&
    isCurrentEncryptedEnvelope(note.body) &&
    isCurrentFieldHash(note.titleHash) &&
    isCurrentFieldHash(note.bodyHash)
  );
}

export function hasCurrentEncryptedNotebookFields(notebook: Notebook): boolean {
  return (
    isCurrentEncryptedEnvelope(notebook.name) &&
    isCurrentFieldHash(notebook.nameHash)
  );
}

export function hasNoteRecord(record: unknown): record is Note {
  if (!record || typeof record !== 'object') return false;
  const note = record as Partial<Note>;
  return (
    nonEmptyStringWithinBytes(note.id, SYNC_LIMITS.entityIdBytes) &&
    stringWithinBytes(note.title, SYNC_LIMITS.titleBytes) &&
    stringWithinBytes(note.body, SYNC_LIMITS.bodyBytes) &&
    isNullableStringWithinBytes(
      note.titleHash ?? null,
      SYNC_LIMITS.fieldHashBytes
    ) &&
    isNullableStringWithinBytes(
      note.bodyHash ?? null,
      SYNC_LIMITS.fieldHashBytes
    ) &&
    isStringArray(note.notebookIds) &&
    isNullableStringWithinBytes(note.notebookId, SYNC_LIMITS.entityIdBytes) &&
    isIsoDate(note.createdAt) &&
    isIsoDate(note.updatedAt) &&
    isNullableIsoDate(note.deletedAt) &&
    isNullableIsoDate(note.trashedAt) &&
    typeof (note.isFavorite ?? false) === 'boolean' &&
    nonEmptyStringWithinBytes(note.deviceId, SYNC_LIMITS.deviceIdBytes) &&
    isPositiveInteger(note.version) &&
    Boolean(note.syncStatus && SYNC_STATUSES.has(note.syncStatus))
  );
}

export function hasNotebookRecord(record: unknown): record is Notebook {
  if (!record || typeof record !== 'object') return false;
  const notebook = record as Partial<Notebook>;
  return (
    nonEmptyStringWithinBytes(notebook.id, SYNC_LIMITS.entityIdBytes) &&
    stringWithinBytes(notebook.name, SYNC_LIMITS.notebookNameBytes) &&
    isNullableStringWithinBytes(
      notebook.nameHash ?? null,
      SYNC_LIMITS.fieldHashBytes
    ) &&
    isIsoDate(notebook.createdAt) &&
    isIsoDate(notebook.updatedAt) &&
    isNullableIsoDate(notebook.deletedAt) &&
    nonEmptyStringWithinBytes(notebook.deviceId, SYNC_LIMITS.deviceIdBytes) &&
    isPositiveInteger(notebook.version) &&
    Boolean(notebook.syncStatus && SYNC_STATUSES.has(notebook.syncStatus))
  );
}

export function hasDeviceRecord(
  value: unknown
): value is { id: string; name: string } {
  if (!value || typeof value !== 'object') return false;
  const device = value as { id?: unknown; name?: unknown };
  return (
    nonEmptyStringWithinBytes(device.id, SYNC_LIMITS.deviceIdBytes) &&
    nonEmptyStringWithinBytes(device.name, SYNC_LIMITS.deviceNameBytes)
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
