import { randomUUID } from 'node:crypto';
import type {
  AcceptedChange,
  CleanupResponse,
  ConflictVersion,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncConflict
} from '@author/api-types';
import {
  NOTE_RETENTION_DAYS,
  type Device,
  type Note,
  type Notebook
} from '@author/schema';
import {
  previewText,
  recordsDiffer,
  retentionCutoff,
  shouldConflict
} from '@author/sync-spec';
import {
  all as queryAll,
  get as queryOne,
  run as runSql,
  withWriteTransaction,
  type NotesDb,
  type NotesExecutor
} from './db';

type Row = Record<string, unknown>;
type EntityType = 'device' | 'note' | 'notebook';
type EntityOperation = 'upsert' | 'delete';
export const LEGACY_OWNER_USERNAME = 'legacy-token';

type PullOptions = {
  ownerUsername?: string;
  limit?: number | null;
};

const DEFAULT_PULL_LIMIT = 500;
const MAX_PULL_LIMIT = 1000;

function pullLimit(limit: number | null | undefined): number {
  if (!Number.isSafeInteger(limit) || Number(limit) <= 0) {
    return DEFAULT_PULL_LIMIT;
  }
  return Math.min(Number(limit), MAX_PULL_LIMIT);
}

export interface MirrorChanges extends PullResponse {
  deletedNoteIds: string[];
  deletedNotebookIds: string[];
  deletedDeviceIds: string[];
}

function asString(value: unknown): string {
  return String(value ?? '');
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function noteNotebookIdsFromRow(row: Row): string[] {
  const raw = asNullableString(row.notebook_ids);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return [
          ...new Set(
            parsed.filter(
              (id): id is string => typeof id === 'string' && Boolean(id)
            )
          )
        ];
      }
    } catch {
      // Fall through to legacy notebook_id.
    }
  }

  const legacyId = asNullableString(row.notebook_id);
  return legacyId ? [legacyId] : [];
}

function noteNotebookIds(note: Note): string[] {
  return [
    ...new Set(
      note.notebookIds?.length
        ? note.notebookIds
        : note.notebookId
          ? [note.notebookId]
          : []
    )
  ];
}

function toNote(row: Row): Note {
  const notebookIds = noteNotebookIdsFromRow(row);
  return {
    id: asString(row.id),
    title: asString(row.title),
    body: asString(row.body),
    titleHash: asNullableString(row.title_hash),
    bodyHash: asNullableString(row.body_hash),
    notebookIds,
    notebookId: notebookIds[0] ?? asNullableString(row.notebook_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: asNullableString(row.deleted_at),
    trashedAt: asNullableString(row.trashed_at),
    deviceId: asString(row.device_id),
    version: Number(row.version),
    syncStatus: 'synced'
  };
}

function toNotebook(row: Row): Notebook {
  return {
    id: asString(row.id),
    name: asString(row.name),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: asNullableString(row.deleted_at),
    deviceId: asString(row.device_id),
    version: Number(row.version),
    syncStatus: 'synced'
  };
}

function toDevice(row: Row): Device {
  return {
    id: asString(row.id),
    name: asString(row.name)
  };
}

function asRevision(value: unknown): number {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export async function getSyncMeta(
  db: NotesExecutor,
  key: string
): Promise<string | null> {
  const row = await queryOne(db, 'SELECT value FROM sync_meta WHERE key = ?', [
    key
  ]);
  return row ? asString(row.value) : null;
}

export async function setSyncMeta(
  db: NotesExecutor,
  key: string,
  value: string
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO sync_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function currentRevision(
  db: NotesExecutor,
  ownerUsername?: string
): Promise<number> {
  if (ownerUsername) {
    const row = await queryOne(
      db,
      'SELECT COALESCE(max(revision), 0) AS revision FROM entity_changes WHERE owner_username = ?',
      [ownerUsername]
    );
    return asRevision(row?.revision);
  }

  const row = await queryOne(
    db,
    'SELECT COALESCE(max(revision), 0) AS revision FROM entity_changes'
  );
  return asRevision(row?.revision);
}

async function getEntityTombstone(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityId: string
): Promise<{
  deletedAt: string;
  deviceId: string;
  version: number;
} | null> {
  const row = (await queryOne(
    db,
    `SELECT deleted_at, device_id, version
     FROM entity_tombstones
     WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
    [ownerUsername, entityType, entityId]
  )) as Row | null;
  return row
    ? {
        deletedAt: asString(row.deleted_at),
        deviceId: asString(row.device_id),
        version: Number(row.version)
      }
    : null;
}

async function putEntityTombstone(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityId: string,
  deletedAt: string,
  deviceId: string,
  version: number
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO entity_tombstones (
       owner_username, entity_type, entity_id, deleted_at, device_id, version
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_username, entity_type, entity_id) DO UPDATE SET
       deleted_at = excluded.deleted_at,
       device_id = excluded.device_id,
       version = excluded.version`,
    [ownerUsername, entityType, entityId, deletedAt, deviceId, version]
  );
}

async function clearEntityTombstone(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityId: string
): Promise<void> {
  await runSql(
    db,
    `DELETE FROM entity_tombstones
     WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
    [ownerUsername, entityType, entityId]
  );
}

async function recordEntityChange(
  db: NotesExecutor,
  entityType: EntityType,
  entityId: string,
  operation: EntityOperation,
  updatedAt = new Date().toISOString(),
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerUsername, entityType, entityId, operation, updatedAt]
  );
}

async function latestEntityOperation(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: EntityType,
  entityId: string
): Promise<EntityOperation | null> {
  const row = (await queryOne(
    db,
    `SELECT operation
     FROM entity_changes
     WHERE owner_username = ?
       AND entity_type = ?
       AND entity_id = ?
     ORDER BY revision DESC
     LIMIT 1`,
    [ownerUsername, entityType, entityId]
  )) as Row | null;
  const operation = asNullableString(row?.operation);
  return operation === 'upsert' || operation === 'delete' ? operation : null;
}

export async function upsertDevice(
  db: NotesExecutor,
  device: Device,
  seenAt = new Date().toISOString(),
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const existing = (await queryOne(
    db,
    'SELECT name FROM devices WHERE id = ?',
    [device.id]
  )) as Row | null;
  const latestOperation = await latestEntityOperation(
    db,
    ownerUsername,
    'device',
    device.id
  );

  await runSql(
    db,
    `INSERT INTO devices (id, name, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
    [device.id, device.name, seenAt]
  );

  if (
    !existing ||
    asString(existing.name) !== device.name ||
    latestOperation !== 'upsert'
  ) {
    await recordEntityChange(
      db,
      'device',
      device.id,
      'upsert',
      seenAt,
      ownerUsername
    );
  }
}

async function getDeviceName(
  db: NotesExecutor,
  deviceId: string
): Promise<string> {
  const row = (await queryOne(db, 'SELECT name FROM devices WHERE id = ?', [
    deviceId
  ])) as Row | null;
  return row ? asString(row.name) : deviceId;
}

export async function getNote(
  db: NotesExecutor,
  id: string,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Note | null> {
  const row = (await queryOne(
    db,
    'SELECT * FROM notes WHERE id = ? AND owner_username = ?',
    [id, ownerUsername]
  )) as Row | null;
  return row ? toNote(row) : null;
}

export async function getNotebook(
  db: NotesExecutor,
  id: string,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook | null> {
  const row = (await queryOne(
    db,
    'SELECT * FROM notebooks WHERE id = ? AND owner_username = ?',
    [id, ownerUsername]
  )) as Row | null;
  return row ? toNotebook(row) : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export async function getNotesByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Map<string, Note>> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const notes = new Map<string, Note>();
  for (const chunk of chunks(uniqueIds, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT * FROM notes WHERE owner_username = ? AND id IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    )) as Row[];
    for (const row of rows) {
      const note = toNote(row);
      notes.set(note.id, note);
    }
  }
  return notes;
}

export async function getNotebooksByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Map<string, Notebook>> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const notebooks = new Map<string, Notebook>();
  for (const chunk of chunks(uniqueIds, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT * FROM notebooks WHERE owner_username = ? AND id IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    )) as Row[];
    for (const row of rows) {
      const notebook = toNotebook(row);
      notebooks.set(notebook.id, notebook);
    }
  }
  return notebooks;
}

export async function getDevicesByIds(
  db: NotesExecutor,
  ids: string[]
): Promise<Map<string, Device>> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const devices = new Map<string, Device>();
  for (const chunk of chunks(uniqueIds, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT id, name FROM devices WHERE id IN (${placeholders(chunk.length)})`,
      chunk
    )) as Row[];
    for (const row of rows) {
      const device = toDevice(row);
      devices.set(device.id, device);
    }
  }
  return devices;
}

export async function deleteNotesByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const existing = await getNotesByIds(db, uniqueIds, ownerUsername);
  for (const chunk of chunks(uniqueIds, 200)) {
    await runSql(
      db,
      `DELETE FROM notes WHERE owner_username = ? AND id IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    );
  }
  for (const id of uniqueIds) {
    const note = existing.get(id);
    const tombstone = await getEntityTombstone(db, ownerUsername, 'note', id);
    if (note || !tombstone) {
      await putEntityTombstone(
        db,
        ownerUsername,
        'note',
        id,
        note
          ? new Date().toISOString()
          : (tombstone?.deletedAt ?? new Date().toISOString()),
        note?.deviceId ?? tombstone?.deviceId ?? 'server',
        note?.version ?? tombstone?.version ?? 1
      );
    }
    if (
      (await latestEntityOperation(db, ownerUsername, 'note', id)) !== 'delete'
    ) {
      await recordEntityChange(
        db,
        'note',
        id,
        'delete',
        undefined,
        ownerUsername
      );
    }
  }
}

export async function deleteNotebooksByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const existing = await getNotebooksByIds(db, uniqueIds, ownerUsername);
  for (const chunk of chunks(uniqueIds, 200)) {
    await runSql(
      db,
      `DELETE FROM notebooks WHERE owner_username = ? AND id IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    );
  }
  for (const id of uniqueIds) {
    const notebook = existing.get(id);
    const tombstone = await getEntityTombstone(
      db,
      ownerUsername,
      'notebook',
      id
    );
    if (notebook || !tombstone) {
      await putEntityTombstone(
        db,
        ownerUsername,
        'notebook',
        id,
        notebook
          ? new Date().toISOString()
          : (tombstone?.deletedAt ?? new Date().toISOString()),
        notebook?.deviceId ?? tombstone?.deviceId ?? 'server',
        notebook?.version ?? tombstone?.version ?? 1
      );
    }
    if (
      (await latestEntityOperation(db, ownerUsername, 'notebook', id)) !==
      'delete'
    ) {
      await recordEntityChange(
        db,
        'notebook',
        id,
        'delete',
        undefined,
        ownerUsername
      );
    }
  }
}

async function deviceIsReferenced(
  db: NotesExecutor,
  deviceId: string
): Promise<boolean> {
  const row = await queryOne(
    db,
    `SELECT
       (SELECT count(*) FROM notes WHERE device_id = ?) +
       (SELECT count(*) FROM notebooks WHERE device_id = ?) +
       (SELECT count(*) FROM auth_sessions WHERE device_id = ?) AS references_count`,
    [deviceId, deviceId, deviceId]
  );
  return Number(row?.references_count ?? 0) > 0;
}

export async function deleteDevicesByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  for (const id of uniqueIds) {
    if (!(await deviceIsReferenced(db, id))) {
      await runSql(db, 'DELETE FROM devices WHERE id = ?', [id]);
    }
    if (
      (await latestEntityOperation(db, ownerUsername, 'device', id)) !==
      'delete'
    ) {
      await recordEntityChange(
        db,
        'device',
        id,
        'delete',
        undefined,
        ownerUsername
      );
    }
  }
}

async function getActiveNotebookByName(
  db: NotesExecutor,
  name: string,
  excludeId: string,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook | null> {
  const row = (await queryOne(
    db,
    `SELECT * FROM notebooks
     WHERE owner_username = ?
       AND deleted_at IS NULL
       AND id <> ?
       AND lower(trim(name)) = lower(?)
     LIMIT 1`,
    [ownerUsername, excludeId, name.trim()]
  )) as Row | null;

  return row ? toNotebook(row) : null;
}

export async function listNotes(
  db: NotesExecutor,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Note[]> {
  const rows = (await queryAll(
    db,
    'SELECT * FROM notes WHERE owner_username = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
    [ownerUsername]
  )) as Row[];
  return rows.map(toNote);
}

export async function listNotebooks(
  db: NotesExecutor,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook[]> {
  const rows = (await queryAll(
    db,
    'SELECT * FROM notebooks WHERE owner_username = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC',
    [ownerUsername]
  )) as Row[];
  return rows.map(toNotebook);
}

export async function pullChangesSince(
  db: NotesExecutor,
  since: string | null | undefined,
  sinceRevision?: number | null,
  options: PullOptions = {}
): Promise<PullResponse> {
  const ownerUsername = options.ownerUsername ?? LEGACY_OWNER_USERNAME;
  const revision =
    Number.isSafeInteger(sinceRevision) && Number(sinceRevision) >= 0
      ? Number(sinceRevision)
      : 0;
  void since;
  return await pullMirrorChangesSinceRevision(db, revision, {
    ownerUsername,
    limit: options.limit
  });
}

export async function pullMirrorChangesSinceRevision(
  db: NotesExecutor,
  sinceRevision: number,
  options: PullOptions = {}
): Promise<MirrorChanges> {
  const ownerUsername = options.ownerUsername ?? LEGACY_OWNER_USERNAME;
  const currentServerRevision = await currentRevision(db, ownerUsername);
  const limit = pullLimit(options.limit);
  const pageRows = (await queryAll(
    db,
    `SELECT revision
     FROM entity_changes
     WHERE owner_username = ?
       AND revision > ?
       AND revision <= ?
     ORDER BY revision ASC
     LIMIT ?`,
    [ownerUsername, sinceRevision, currentServerRevision, limit + 1]
  )) as Row[];
  const hasMore = pageRows.length > limit;
  const visibleRows = hasMore ? pageRows.slice(0, limit) : pageRows;
  const serverRevision = visibleRows.length
    ? asRevision(visibleRows[visibleRows.length - 1].revision)
    : currentServerRevision;

  if (!visibleRows.length) {
    return {
      serverTime: new Date().toISOString(),
      serverRevision,
      devices: [],
      notes: [],
      notebooks: [],
      deletedDeviceIds: [],
      deletedNoteIds: [],
      deletedNotebookIds: [],
      hasMore: false
    };
  }

  const rows = (await queryAll(
    db,
    `SELECT changes.revision, changes.entity_type, changes.entity_id, changes.operation
     FROM entity_changes AS changes
     INNER JOIN (
       SELECT entity_type, entity_id, max(revision) AS revision
       FROM entity_changes
       WHERE owner_username = ?
         AND revision > ?
         AND revision <= ?
       GROUP BY entity_type, entity_id
     ) AS latest
       ON latest.entity_type = changes.entity_type
      AND latest.entity_id = changes.entity_id
      AND latest.revision = changes.revision
     ORDER BY changes.revision ASC`,
    [ownerUsername, sinceRevision, serverRevision]
  )) as Row[];

  const latestChanges = new Map<
    string,
    { entityType: EntityType; entityId: string; operation: EntityOperation }
  >();
  for (const row of rows) {
    const entityType = asString(row.entity_type) as EntityType;
    const operation = asString(row.operation) as EntityOperation;
    if (
      !['device', 'note', 'notebook'].includes(entityType) ||
      !['upsert', 'delete'].includes(operation)
    )
      continue;
    const entityId = asString(row.entity_id);
    latestChanges.set(`${entityType}:${entityId}`, {
      entityType,
      entityId,
      operation
    });
  }

  const deviceIds: string[] = [];
  const noteIds: string[] = [];
  const notebookIds: string[] = [];
  const deletedDeviceIds: string[] = [];
  const deletedNoteIds: string[] = [];
  const deletedNotebookIds: string[] = [];

  for (const change of latestChanges.values()) {
    if (change.operation === 'delete') {
      if (change.entityType === 'device')
        deletedDeviceIds.push(change.entityId);
      if (change.entityType === 'note') deletedNoteIds.push(change.entityId);
      if (change.entityType === 'notebook')
        deletedNotebookIds.push(change.entityId);
      continue;
    }

    if (change.entityType === 'device') deviceIds.push(change.entityId);
    if (change.entityType === 'note') noteIds.push(change.entityId);
    if (change.entityType === 'notebook') notebookIds.push(change.entityId);
  }

  const [devices, notes, notebooks] = await Promise.all([
    getDevicesByIds(db, deviceIds),
    getNotesByIds(db, noteIds, ownerUsername),
    getNotebooksByIds(db, notebookIds, ownerUsername)
  ]);

  return {
    serverTime: new Date().toISOString(),
    serverRevision,
    devices: [...devices.values()],
    notes: [...notes.values()],
    notebooks: [...notebooks.values()],
    deletedDeviceIds,
    deletedNoteIds,
    deletedNotebookIds,
    hasMore
  };
}

async function saveNoteSnapshot(
  db: NotesExecutor,
  note: Note,
  reason: string,
  savedAt = new Date().toISOString(),
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO note_versions (
       note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
       deleted_at, trashed_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      ownerUsername,
      note.title,
      note.body,
      note.titleHash ?? null,
      note.bodyHash ?? null,
      JSON.stringify(noteNotebookIds(note)),
      noteNotebookIds(note)[0] ?? null,
      note.createdAt,
      note.updatedAt,
      note.deletedAt,
      note.trashedAt,
      note.deviceId,
      note.version,
      savedAt,
      reason
    ]
  );
}

async function saveNotebookSnapshot(
  db: NotesExecutor,
  notebook: Notebook,
  reason: string,
  savedAt = new Date().toISOString(),
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO notebook_versions (
       notebook_id, owner_username, name, created_at, updated_at, deleted_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notebook.id,
      ownerUsername,
      notebook.name,
      notebook.createdAt,
      notebook.updatedAt,
      notebook.deletedAt,
      notebook.deviceId,
      notebook.version,
      savedAt,
      reason
    ]
  );
}

async function putNote(
  db: NotesExecutor,
  note: Note,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Note> {
  await runSql(
    db,
    `INSERT INTO notes (
       id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
       deleted_at, trashed_at, device_id, version, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       title_hash = excluded.title_hash,
       body_hash = excluded.body_hash,
       notebook_ids = excluded.notebook_ids,
       notebook_id = excluded.notebook_id,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       trashed_at = excluded.trashed_at,
       device_id = excluded.device_id,
       version = excluded.version,
       sync_status = excluded.sync_status
       WHERE notes.owner_username = excluded.owner_username`,
    [
      note.id,
      ownerUsername,
      note.title,
      note.body,
      note.titleHash ?? null,
      note.bodyHash ?? null,
      JSON.stringify(noteNotebookIds(note)),
      noteNotebookIds(note)[0] ?? null,
      note.createdAt,
      note.updatedAt,
      note.deletedAt,
      note.trashedAt,
      note.deviceId,
      note.version,
      'synced'
    ]
  );
  await clearEntityTombstone(db, ownerUsername, 'note', note.id);
  if (!(await getNote(db, note.id, ownerUsername))) {
    throw new Error('Record id belongs to another owner');
  }
  await recordEntityChange(
    db,
    'note',
    note.id,
    'upsert',
    note.updatedAt,
    ownerUsername
  );

  return { ...note, syncStatus: 'synced' };
}

async function putNotebook(
  db: NotesExecutor,
  notebook: Notebook,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook> {
  await runSql(
    db,
    `INSERT INTO notebooks (
       id, owner_username, name, created_at, updated_at, deleted_at, device_id, version, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       device_id = excluded.device_id,
       version = excluded.version,
       sync_status = excluded.sync_status
       WHERE notebooks.owner_username = excluded.owner_username`,
    [
      notebook.id,
      ownerUsername,
      notebook.name,
      notebook.createdAt,
      notebook.updatedAt,
      notebook.deletedAt,
      notebook.deviceId,
      notebook.version,
      'synced'
    ]
  );
  await clearEntityTombstone(db, ownerUsername, 'notebook', notebook.id);
  if (!(await getNotebook(db, notebook.id, ownerUsername))) {
    throw new Error('Record id belongs to another owner');
  }
  await recordEntityChange(
    db,
    'notebook',
    notebook.id,
    'upsert',
    notebook.updatedAt,
    ownerUsername
  );

  return { ...notebook, syncStatus: 'synced' };
}

function accepted(
  entityType: 'note' | 'notebook',
  record: Note | Notebook
): AcceptedChange {
  return {
    entityType,
    id: record.id,
    version: record.version,
    updatedAt: record.updatedAt
  };
}

async function conflictVersion<T extends Note | Notebook>(
  db: NotesExecutor,
  source: 'local' | 'remote',
  record: T,
  deviceName?: string
): Promise<ConflictVersion<T>> {
  return {
    source,
    deviceId: record.deviceId,
    deviceName: deviceName ?? (await getDeviceName(db, record.deviceId)),
    updatedAt: record.updatedAt,
    version: record.version,
    previewText: previewText(record),
    record
  };
}

async function makeConflict<T extends Note | Notebook>(
  db: NotesExecutor,
  entityType: 'note' | 'notebook',
  local: T,
  remote: T,
  localDeviceName: string,
  reason?: SyncConflict<T>['reason']
): Promise<SyncConflict<T>> {
  return {
    id: randomUUID(),
    entityType,
    entityId: local.id,
    reason:
      reason ?? (remote.deletedAt ? 'deleted_remotely' : 'remote_changed'),
    local: await conflictVersion(db, 'local', local, localDeviceName),
    remote: await conflictVersion(db, 'remote', remote)
  };
}

async function acceptNoteChange(
  db: NotesExecutor,
  local: Note,
  remote: Note | null,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Note> {
  if (remote && !recordsDiffer(local, remote)) {
    return remote;
  }

  const version = remote ? remote.version + 1 : Math.max(local.version, 1);
  const acceptedNote = await putNote(
    db,
    {
      ...local,
      version,
      syncStatus: 'synced'
    },
    ownerUsername
  );
  await saveNoteSnapshot(db, acceptedNote, 'push', undefined, ownerUsername);
  return acceptedNote;
}

async function acceptNotebookChange(
  db: NotesExecutor,
  local: Notebook,
  remote: Notebook | null,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook> {
  if (remote && !recordsDiffer(local, remote)) {
    return remote;
  }

  const version = remote ? remote.version + 1 : Math.max(local.version, 1);
  const acceptedNotebook = await putNotebook(
    db,
    {
      ...local,
      version,
      syncStatus: 'synced'
    },
    ownerUsername
  );
  await saveNotebookSnapshot(
    db,
    acceptedNotebook,
    'push',
    undefined,
    ownerUsername
  );
  return acceptedNotebook;
}

function deletedRemoteNote(
  local: Note,
  tombstone: { deletedAt: string; deviceId: string; version: number }
): Note {
  return {
    ...local,
    deletedAt: tombstone.deletedAt,
    updatedAt: tombstone.deletedAt,
    deviceId: tombstone.deviceId,
    version: tombstone.version,
    syncStatus: 'synced'
  };
}

function deletedRemoteNotebook(
  local: Notebook,
  tombstone: { deletedAt: string; deviceId: string; version: number }
): Notebook {
  return {
    ...local,
    deletedAt: tombstone.deletedAt,
    updatedAt: tombstone.deletedAt,
    deviceId: tombstone.deviceId,
    version: tombstone.version,
    syncStatus: 'synced'
  };
}

export async function pushChanges(
  db: NotesDb,
  request: PushRequest,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<PushResponse> {
  const now = new Date().toISOString();
  const acceptedChanges: AcceptedChange[] = [];
  const conflicts: PushResponse['conflicts'] = [];

  await withWriteTransaction(db, async (tx) => {
    await upsertDevice(tx, request.device, now, ownerUsername);

    for (const change of request.notebooks) {
      const remote = await getNotebook(tx, change.record.id, ownerUsername);
      const tombstone = remote
        ? null
        : await getEntityTombstone(
            tx,
            ownerUsername,
            'notebook',
            change.record.id
          );
      if (tombstone && change.baseVersion > 0) {
        const deletedRemote = deletedRemoteNotebook(change.record, tombstone);
        await saveNotebookSnapshot(
          tx,
          change.record,
          'conflict',
          undefined,
          ownerUsername
        );
        await saveNotebookSnapshot(
          tx,
          deletedRemote,
          'conflict',
          undefined,
          ownerUsername
        );
        conflicts.push(
          await makeConflict<Notebook>(
            tx,
            'notebook',
            change.record,
            deletedRemote,
            request.device.name,
            'deleted_remotely'
          )
        );
        continue;
      }
      if (remote && shouldConflict(change.record, remote, change.baseVersion)) {
        await saveNotebookSnapshot(
          tx,
          change.record,
          'conflict',
          undefined,
          ownerUsername
        );
        await saveNotebookSnapshot(
          tx,
          remote,
          'conflict',
          undefined,
          ownerUsername
        );
        conflicts.push(
          await makeConflict<Notebook>(
            tx,
            'notebook',
            change.record,
            remote,
            request.device.name
          )
        );
        continue;
      }

      const duplicate = change.record.deletedAt
        ? null
        : await getActiveNotebookByName(
            tx,
            change.record.name,
            change.record.id,
            ownerUsername
          );
      if (duplicate) {
        await saveNotebookSnapshot(
          tx,
          change.record,
          'conflict',
          undefined,
          ownerUsername
        );
        await saveNotebookSnapshot(
          tx,
          duplicate,
          'conflict',
          undefined,
          ownerUsername
        );
        conflicts.push(
          await makeConflict<Notebook>(
            tx,
            'notebook',
            change.record,
            duplicate,
            request.device.name,
            'duplicate_name'
          )
        );
        continue;
      }

      acceptedChanges.push(
        accepted(
          'notebook',
          await acceptNotebookChange(tx, change.record, remote, ownerUsername)
        )
      );
    }

    for (const change of request.notes) {
      const remote = await getNote(tx, change.record.id, ownerUsername);
      const tombstone = remote
        ? null
        : await getEntityTombstone(tx, ownerUsername, 'note', change.record.id);
      if (tombstone && change.baseVersion > 0) {
        const deletedRemote = deletedRemoteNote(change.record, tombstone);
        await saveNoteSnapshot(
          tx,
          change.record,
          'conflict',
          undefined,
          ownerUsername
        );
        await saveNoteSnapshot(
          tx,
          deletedRemote,
          'conflict',
          undefined,
          ownerUsername
        );
        conflicts.push(
          await makeConflict<Note>(
            tx,
            'note',
            change.record,
            deletedRemote,
            request.device.name,
            'deleted_remotely'
          )
        );
        continue;
      }
      if (remote && shouldConflict(change.record, remote, change.baseVersion)) {
        await saveNoteSnapshot(
          tx,
          change.record,
          'conflict',
          undefined,
          ownerUsername
        );
        await saveNoteSnapshot(
          tx,
          remote,
          'conflict',
          undefined,
          ownerUsername
        );
        conflicts.push(
          await makeConflict<Note>(
            tx,
            'note',
            change.record,
            remote,
            request.device.name
          )
        );
        continue;
      }

      acceptedChanges.push(
        accepted(
          'note',
          await acceptNoteChange(tx, change.record, remote, ownerUsername)
        )
      );
    }
  });

  return {
    serverTime: now,
    accepted: acceptedChanges,
    conflicts
  };
}

export async function cleanupTrash(
  db: NotesDb,
  now = new Date(),
  ownerUsername?: string
): Promise<CleanupResponse> {
  const cutoff = retentionCutoff(now, NOTE_RETENTION_DAYS);
  const ownerFilter = ownerUsername ? ' AND owner_username = ?' : '';
  const ownerArgs = ownerUsername ? [ownerUsername] : [];
  const oldNoteRows = (await queryAll(
    db,
    `SELECT * FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?${ownerFilter}`,
    [cutoff, ...ownerArgs]
  )) as Row[];
  const oldNotes = oldNoteRows.map((row) => ({
    ownerUsername: asString(row.owner_username) || LEGACY_OWNER_USERNAME,
    note: toNote(row)
  }));
  const oldNotebookRows = (await queryAll(
    db,
    `SELECT * FROM notebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?${ownerFilter}`,
    [cutoff, ...ownerArgs]
  )) as Row[];
  const oldNotebooks = oldNotebookRows.map((row) => ({
    ownerUsername: asString(row.owner_username) || LEGACY_OWNER_USERNAME,
    notebook: toNotebook(row)
  }));

  await withWriteTransaction(db, async (tx) => {
    for (const { note, ownerUsername: owner } of oldNotes) {
      await saveNoteSnapshot(tx, note, 'cleanup', undefined, owner);
    }
    for (const { notebook, ownerUsername: owner } of oldNotebooks) {
      await saveNotebookSnapshot(tx, notebook, 'cleanup', undefined, owner);
    }

    await runSql(
      tx,
      `DELETE FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?${ownerFilter}`,
      [cutoff, ...ownerArgs]
    );
    for (const { note, ownerUsername: owner } of oldNotes) {
      await putEntityTombstone(
        tx,
        owner,
        'note',
        note.id,
        new Date().toISOString(),
        note.deviceId,
        note.version
      );
      await recordEntityChange(tx, 'note', note.id, 'delete', undefined, owner);
    }
    await runSql(
      tx,
      `DELETE FROM notebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?${ownerFilter}`,
      [cutoff, ...ownerArgs]
    );
    for (const { notebook, ownerUsername: owner } of oldNotebooks) {
      await putEntityTombstone(
        tx,
        owner,
        'notebook',
        notebook.id,
        new Date().toISOString(),
        notebook.deviceId,
        notebook.version
      );
      await recordEntityChange(
        tx,
        'notebook',
        notebook.id,
        'delete',
        undefined,
        owner
      );
    }
  });

  return {
    deletedNotes: oldNotes.length,
    deletedNotebooks: oldNotebooks.length,
    cutoff
  };
}
