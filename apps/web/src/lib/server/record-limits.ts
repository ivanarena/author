import type { PushRequest } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import {
  getRecordLimitConfig,
  type RecordLimitConfig,
  type RuntimeEnv
} from './config';
import { SYNC_LIMITS } from '@author/api-types';
import { get, type NotesExecutor, type SqlArgs } from './db';

const NOTE_BUDGET_SHARE = 0.9;
const NOTEBOOK_BUDGET_SHARE = 1 - NOTE_BUDGET_SHARE;
const STORAGE_ROW_OVERHEAD_BYTES = 512;
const textEncoder = new TextEncoder();

export interface RecordLimitCheckResult {
  error: string;
  limits: {
    activeUsers: number;
    maxNotes: number;
    maxNotebooks: number;
    maxNoteBytes: number;
    maxNotebookBytes: number;
    estimatedNotes: number;
    estimatedNotebooks: number;
    projectedNoteBytes: number;
    projectedNotebookBytes: number;
    maxDevices: number;
    projectedDevices: number;
    maxTotalBytes: number;
    projectedTotalBytes: number;
  };
}

interface UsageProjection {
  current: number;
  projected: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue;
}

function textBytes(value: string | null | undefined): number {
  return value ? textEncoder.encode(value).byteLength : 0;
}

function sqlTextBytes(column: string): string {
  return `length(CAST(COALESCE(${column}, '') AS BLOB))`;
}

function recordBytesSql(table: 'notes' | 'notebooks'): string {
  if (table === 'notes') {
    return [
      STORAGE_ROW_OVERHEAD_BYTES,
      sqlTextBytes('id'),
      sqlTextBytes('owner_username'),
      sqlTextBytes('title'),
      sqlTextBytes('body'),
      sqlTextBytes('title_hash'),
      sqlTextBytes('body_hash'),
      sqlTextBytes('notebook_ids'),
      sqlTextBytes('notebook_id'),
      sqlTextBytes('created_at'),
      sqlTextBytes('updated_at'),
      sqlTextBytes('deleted_at'),
      sqlTextBytes('trashed_at'),
      sqlTextBytes('device_id'),
      sqlTextBytes('sync_status'),
      24
    ].join(' + ');
  }

  return [
    STORAGE_ROW_OVERHEAD_BYTES,
    sqlTextBytes('id'),
    sqlTextBytes('owner_username'),
    sqlTextBytes('name'),
    sqlTextBytes('name_hash'),
    sqlTextBytes('created_at'),
    sqlTextBytes('updated_at'),
    sqlTextBytes('deleted_at'),
    sqlTextBytes('device_id'),
    sqlTextBytes('sync_status'),
    16
  ].join(' + ');
}

async function countRows(
  db: NotesExecutor,
  sql: string,
  args: SqlArgs = []
): Promise<number> {
  const row = await get(db, sql, args);
  const count = Number(row?.count ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function readNonNegativeNumber(
  db: NotesExecutor,
  sql: string,
  key: string,
  args: SqlArgs = []
): Promise<number> {
  const row = await get(db, sql, args);
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function countActiveRecords(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string
): Promise<number> {
  return await countRows(
    db,
    `SELECT count(*) AS count
     FROM ${table}
     WHERE owner_username = ? AND deleted_at IS NULL`,
    [ownerUsername]
  );
}

async function sumActiveRecordBytes(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string
): Promise<number> {
  return await readNonNegativeNumber(
    db,
    `SELECT COALESCE(SUM(${recordBytesSql(table)}), 0) AS bytes
     FROM ${table}
     WHERE owner_username = ? AND deleted_at IS NULL`,
    'bytes',
    [ownerUsername]
  );
}

async function countActiveRecordIds(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  ids: string[]
): Promise<number> {
  const safeIds = uniqueIds(ids);
  if (!safeIds.length) return 0;
  return await countRows(
    db,
    `SELECT count(*) AS count
     FROM ${table}
     WHERE owner_username = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders(safeIds.length)})`,
    [ownerUsername, ...safeIds]
  );
}

async function sumActiveRecordIdsBytes(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  ids: string[]
): Promise<number> {
  const safeIds = uniqueIds(ids);
  if (!safeIds.length) return 0;
  return await readNonNegativeNumber(
    db,
    `SELECT COALESCE(SUM(${recordBytesSql(table)}), 0) AS bytes
     FROM ${table}
     WHERE owner_username = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders(safeIds.length)})`,
    'bytes',
    [ownerUsername, ...safeIds]
  );
}

async function activeUserCount(db: NotesExecutor): Promise<number> {
  return Math.max(
    1,
    await countRows(db, 'SELECT count(*) AS count FROM users')
  );
}

function perUserLimits(
  config: RecordLimitConfig,
  users: number
): {
  maxNotes: number;
  maxNotebooks: number;
  maxNoteBytes: number;
  maxNotebookBytes: number;
  maxTotalBytes: number;
} {
  const usableBytes = config.storageBudgetBytes * config.safetyRatio;
  const perUserBytes = usableBytes / Math.max(1, users);
  const maxNoteBytes = Math.max(
    1,
    Math.floor(perUserBytes * NOTE_BUDGET_SHARE)
  );
  const maxNotebookBytes = Math.max(
    1,
    Math.floor(perUserBytes * NOTEBOOK_BUDGET_SHARE)
  );
  return {
    maxNotes: Math.max(1, Math.floor(maxNoteBytes / config.estimatedNoteBytes)),
    maxNotebooks: Math.max(
      1,
      Math.floor(maxNotebookBytes / config.estimatedNotebookBytes)
    ),
    maxNoteBytes,
    maxNotebookBytes,
    maxTotalBytes: Math.max(1, Math.floor(perUserBytes))
  };
}

async function activeCountProjection(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  changes: Array<{ record: { id: string; deletedAt: string | null } }>
): Promise<UsageProjection> {
  const activeIds = uniqueIds(
    changes
      .filter((change) => !change.record.deletedAt)
      .map((change) => change.record.id)
  );
  const deletedIds = uniqueIds(
    changes
      .filter((change) => change.record.deletedAt)
      .map((change) => change.record.id)
  );
  const [current, alreadyActive, activeDeletes] = await Promise.all([
    countActiveRecords(db, table, ownerUsername),
    countActiveRecordIds(db, table, ownerUsername, activeIds),
    countActiveRecordIds(db, table, ownerUsername, deletedIds)
  ]);
  return {
    current,
    projected: Math.max(
      0,
      current + activeIds.length - alreadyActive - activeDeletes
    )
  };
}

function noteNotebookIds(note: Note): string[] {
  const ids = note.notebookIds?.length
    ? note.notebookIds
    : note.notebookId
      ? [note.notebookId]
      : [];
  return uniqueIds(ids);
}

function noteStorageBytes(note: Note, ownerUsername: string): number {
  const notebookIds = noteNotebookIds(note);
  return (
    STORAGE_ROW_OVERHEAD_BYTES +
    textBytes(note.id) +
    textBytes(ownerUsername) +
    textBytes(note.title) +
    textBytes(note.body) +
    textBytes(note.titleHash) +
    textBytes(note.bodyHash) +
    textBytes(JSON.stringify(notebookIds)) +
    textBytes(notebookIds[0] ?? null) +
    textBytes(note.createdAt) +
    textBytes(note.updatedAt) +
    textBytes(note.deletedAt) +
    textBytes(note.trashedAt) +
    textBytes(note.deviceId) +
    textBytes('synced') +
    24
  );
}

function notebookStorageBytes(
  notebook: Notebook,
  ownerUsername: string
): number {
  return (
    STORAGE_ROW_OVERHEAD_BYTES +
    textBytes(notebook.id) +
    textBytes(ownerUsername) +
    textBytes(notebook.name) +
    textBytes(notebook.nameHash) +
    textBytes(notebook.createdAt) +
    textBytes(notebook.updatedAt) +
    textBytes(notebook.deletedAt) +
    textBytes(notebook.deviceId) +
    textBytes('synced') +
    16
  );
}

async function projectedActiveBytes<
  T extends { id: string; deletedAt: string | null }
>(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  changes: Array<{ record: T }>,
  storageBytes: (record: T, ownerUsername: string) => number
): Promise<UsageProjection> {
  const changedIds = uniqueIds(changes.map((change) => change.record.id));
  const [current, replacedOrDeleted] = await Promise.all([
    sumActiveRecordBytes(db, table, ownerUsername),
    sumActiveRecordIdsBytes(db, table, ownerUsername, changedIds)
  ]);
  const incoming = changes
    .filter((change) => !change.record.deletedAt)
    .reduce(
      (total, change) => total + storageBytes(change.record, ownerUsername),
      0
    );
  return {
    current,
    projected: Math.max(0, current - replacedOrDeleted + incoming)
  };
}

async function auxiliaryStorageBytes(
  db: NotesExecutor,
  ownerUsername: string
): Promise<number> {
  return await readNonNegativeNumber(
    db,
    `SELECT
       (SELECT COALESCE(SUM(
          512 + length(CAST(COALESCE(title, '') AS BLOB)) +
          length(CAST(COALESCE(body, '') AS BLOB)) +
          length(CAST(COALESCE(notebook_ids, '') AS BLOB)) +
          length(CAST(COALESCE(device_id, '') AS BLOB))
        ), 0) FROM note_versions WHERE owner_username = ?) +
       (SELECT COALESCE(SUM(
          512 + length(CAST(COALESCE(name, '') AS BLOB)) +
          length(CAST(COALESCE(device_id, '') AS BLOB))
        ), 0) FROM notebook_versions WHERE owner_username = ?) +
       (SELECT COALESCE(SUM(
          256 + length(CAST(COALESCE(id, '') AS BLOB)) +
          length(CAST(COALESCE(name, '') AS BLOB))
        ), 0) FROM devices WHERE owner_username = ?) +
       (SELECT COALESCE(SUM(
          128 + length(CAST(COALESCE(entity_id, '') AS BLOB))
        ), 0) FROM entity_changes WHERE owner_username = ?) +
       (SELECT COALESCE(SUM(
          256 + length(CAST(COALESCE(entity_id, '') AS BLOB)) +
          length(CAST(COALESCE(device_id, '') AS BLOB))
        ), 0) FROM entity_tombstones WHERE owner_username = ?) +
       (SELECT COALESCE(SUM(${recordBytesSql('notes')}), 0)
        FROM notes WHERE owner_username = ? AND deleted_at IS NOT NULL) +
       (SELECT COALESCE(SUM(${recordBytesSql('notebooks')}), 0)
        FROM notebooks WHERE owner_username = ? AND deleted_at IS NOT NULL)
       AS bytes`,
    'bytes',
    Array.from({ length: 7 }, () => ownerUsername)
  );
}

async function projectedDeviceCount(
  db: NotesExecutor,
  ownerUsername: string,
  deviceId: string
): Promise<UsageProjection> {
  const [current, existing] = await Promise.all([
    countRows(
      db,
      'SELECT count(*) AS count FROM devices WHERE owner_username = ?',
      [ownerUsername]
    ),
    countRows(
      db,
      'SELECT count(*) AS count FROM devices WHERE owner_username = ? AND id = ?',
      [ownerUsername, deviceId]
    )
  ]);
  return { current, projected: current + (existing ? 0 : 1) };
}

function incomingAuxiliaryBytes(
  request: PushRequest,
  ownerUsername: string
): number {
  const noteBytes = request.notes.reduce(
    (total, change) => total + noteStorageBytes(change.record, ownerUsername),
    0
  );
  const notebookBytes = request.notebooks.reduce(
    (total, change) =>
      total + notebookStorageBytes(change.record, ownerUsername),
    0
  );
  const deviceBytes =
    256 + textBytes(request.device.id) + textBytes(request.device.name);
  // A stale push may save both incoming and remote snapshots. Include two full
  // snapshots plus an entity-change allowance for every incoming record.
  return (
    deviceBytes +
    2 * (noteBytes + notebookBytes) +
    128 * (request.notes.length + request.notebooks.length)
  );
}

function usageAllowed(
  usages: Array<UsageProjection & { limit: number }>
): boolean {
  if (usages.every((usage) => usage.projected <= usage.limit)) return true;
  return (
    usages.every((usage) => usage.projected <= usage.current) &&
    usages.some((usage) => usage.projected < usage.current)
  );
}

export async function checkRecordLimits(
  db: NotesExecutor,
  ownerUsername: string,
  request: PushRequest,
  env?: RuntimeEnv | null
): Promise<RecordLimitCheckResult | null> {
  const config = getRecordLimitConfig(env);
  const deviceCount = await projectedDeviceCount(
    db,
    ownerUsername,
    request.device.id
  );
  if (
    !config.enabled &&
    deviceCount.projected <= SYNC_LIMITS.devicesPerAccount
  ) {
    return null;
  }

  const [
    users,
    noteCount,
    notebookCount,
    noteBytes,
    notebookBytes,
    auxiliaryBytes
  ] = await Promise.all([
    activeUserCount(db),
    activeCountProjection(db, 'notes', ownerUsername, request.notes),
    activeCountProjection(db, 'notebooks', ownerUsername, request.notebooks),
    projectedActiveBytes(
      db,
      'notes',
      ownerUsername,
      request.notes,
      noteStorageBytes
    ),
    projectedActiveBytes(
      db,
      'notebooks',
      ownerUsername,
      request.notebooks,
      notebookStorageBytes
    ),
    auxiliaryStorageBytes(db, ownerUsername)
  ]);
  const limits = perUserLimits(config, users);
  const totalBytes = {
    current: noteBytes.current + notebookBytes.current + auxiliaryBytes,
    projected:
      noteBytes.projected +
      notebookBytes.projected +
      auxiliaryBytes +
      incomingAuxiliaryBytes(request, ownerUsername)
  };
  const activeUsages = [
    { ...noteCount, limit: limits.maxNotes },
    { ...notebookCount, limit: limits.maxNotebooks },
    { ...noteBytes, limit: limits.maxNoteBytes },
    { ...notebookBytes, limit: limits.maxNotebookBytes }
  ];
  const usages = [
    ...activeUsages,
    { ...deviceCount, limit: SYNC_LIMITS.devicesPerAccount },
    { ...totalBytes, limit: limits.maxTotalBytes }
  ];
  const reducesActiveStorage =
    activeUsages.every((usage) => usage.projected <= usage.current) &&
    activeUsages.some((usage) => usage.projected < usage.current);

  if (
    usageAllowed(usages) ||
    (reducesActiveStorage &&
      deviceCount.projected <= SYNC_LIMITS.devicesPerAccount)
  ) {
    return null;
  }

  const deviceLimitReached =
    deviceCount.projected > SYNC_LIMITS.devicesPerAccount;
  return {
    error: deviceLimitReached
      ? `This account is limited to ${SYNC_LIMITS.devicesPerAccount} registered devices.`
      : `Server storage limit estimate reached for this account. The current shared Turso budget allows about ${limits.maxNotes} active ${plural(limits.maxNotes, 'note')} and ${limits.maxNotebooks} active ${plural(limits.maxNotebooks, 'notebook')} per user with ${users} active ${plural(users, 'user')}.`,
    limits: {
      activeUsers: users,
      maxNotes: limits.maxNotes,
      maxNotebooks: limits.maxNotebooks,
      maxNoteBytes: limits.maxNoteBytes,
      maxNotebookBytes: limits.maxNotebookBytes,
      estimatedNotes: noteCount.projected,
      estimatedNotebooks: notebookCount.projected,
      projectedNoteBytes: noteBytes.projected,
      projectedNotebookBytes: notebookBytes.projected,
      maxDevices: SYNC_LIMITS.devicesPerAccount,
      projectedDevices: deviceCount.projected,
      maxTotalBytes: limits.maxTotalBytes,
      projectedTotalBytes: totalBytes.projected
    }
  };
}
