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

export interface EntityTombstone {
  entityType: 'note' | 'notebook';
  entityId: string;
  deletedAt: string;
  deviceId: string;
  version: number;
}

export interface PushChangesOptions {
  allowTombstoneOverwrite?: boolean;
}

type PullOptions = {
  ownerUsername?: string;
  limit?: number | null;
};

const DEFAULT_PULL_LIMIT = 1000;
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

function normalizedNotebookId(id: string | null): string | null {
  const trimmed = id?.trim() ?? '';
  return trimmed || null;
}

function normalizedNotebookIds(ids: unknown[]): string[] {
  return [
    ...new Set(
      ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    )
  ];
}

function noteNotebookIdsFromRow(row: Row): string[] {
  const raw = asNullableString(row.notebook_ids);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const ids = normalizedNotebookIds(parsed);
        if (ids.length) return ids;
      }
    } catch {
      // Fall through to legacy notebook_id.
    }
  }

  const legacyId = normalizedNotebookId(asNullableString(row.notebook_id));
  return legacyId ? [legacyId] : [];
}

function noteNotebookIds(note: Note): string[] {
  const ids = note.notebookIds?.length
    ? note.notebookIds
    : note.notebookId
      ? [note.notebookId]
      : [];
  return normalizedNotebookIds(ids);
}

function noteNotebookRefsChanged(original: Note, normalized: Note): boolean {
  const originalIds = original.notebookIds ?? [];
  return (
    original.notebookId !== normalized.notebookId ||
    originalIds.length !== normalized.notebookIds.length ||
    originalIds.some((id, index) => id !== normalized.notebookIds[index])
  );
}

function notebookDuplicateKey(notebook: Notebook): string {
  return notebook.nameHash
    ? `hash:${notebook.nameHash}`
    : `name:${notebookDuplicateNameKey(notebook.name)}`;
}

function notebookDuplicateNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
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
    notebookId:
      notebookIds[0] ?? normalizedNotebookId(asNullableString(row.notebook_id)),
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
    nameHash: asNullableString(row.name_hash),
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
): Promise<EntityTombstone | null> {
  const row = (await queryOne(
    db,
    `SELECT deleted_at, device_id, version
     FROM entity_tombstones
     WHERE owner_username = ? AND entity_type = ? AND entity_id = ?`,
    [ownerUsername, entityType, entityId]
  )) as Row | null;
  return row
    ? {
        entityType,
        entityId,
        deletedAt: asString(row.deleted_at),
        deviceId: asString(row.device_id),
        version: Number(row.version)
      }
    : null;
}

export async function getEntityTombstonesByIds(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityIds: string[]
): Promise<Map<string, EntityTombstone>> {
  const uniqueIds = [...new Set(entityIds)].filter(Boolean);
  const tombstones = new Map<string, EntityTombstone>();

  for (const chunk of chunks(uniqueIds, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT entity_id, deleted_at, device_id, version
       FROM entity_tombstones
       WHERE owner_username = ?
         AND entity_type = ?
         AND entity_id IN (${placeholders(chunk.length)})`,
      [ownerUsername, entityType, ...chunk]
    )) as Row[];

    for (const row of rows) {
      const entityId = asString(row.entity_id);
      tombstones.set(entityId, {
        entityType,
        entityId,
        deletedAt: asString(row.deleted_at),
        deviceId: asString(row.device_id),
        version: Number(row.version)
      });
    }
  }

  return tombstones;
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

function valuesPlaceholders(rowWidth: number, rowCount: number): string {
  return Array.from(
    { length: rowCount },
    () => `(${placeholders(rowWidth)})`
  ).join(', ');
}

function uniqueEntityIds(ids: string[]): string[] {
  return [...new Set(ids)].filter(Boolean);
}

async function idsOwnedByAnotherUser(
  db: NotesExecutor,
  table: 'notes' | 'notebooks',
  ids: string[],
  ownerUsername: string
): Promise<Set<string>> {
  const ownedByAnotherUser = new Set<string>();
  for (const chunk of chunks(uniqueEntityIds(ids), 200)) {
    const rows = (await queryAll(
      db,
      `SELECT id FROM ${table}
       WHERE owner_username <> ?
         AND id IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    )) as Row[];
    for (const row of rows) {
      ownedByAnotherUser.add(asString(row.id));
    }
  }
  return ownedByAnotherUser;
}

export async function getNotesByIds(
  db: NotesExecutor,
  ids: string[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Map<string, Note>> {
  const uniqueIds = uniqueEntityIds(ids);
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
  const uniqueIds = uniqueEntityIds(ids);
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
  const uniqueIds = uniqueEntityIds(ids);
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

function addNotebookDuplicateCandidate(
  candidates: Map<string, Notebook[]>,
  key: string,
  notebook: Notebook
): void {
  const existing = candidates.get(key);
  if (existing) {
    existing.push(notebook);
    return;
  }
  candidates.set(key, [notebook]);
}

async function getActiveNotebookDuplicateCandidates(
  db: NotesExecutor,
  ownerUsername: string,
  notebooks: Notebook[]
): Promise<Map<string, Notebook[]>> {
  const candidates = new Map<string, Notebook[]>();
  const activeNotebooks = notebooks.filter((notebook) => !notebook.deletedAt);
  const nameHashes = [
    ...new Set(
      activeNotebooks
        .map((notebook) => notebook.nameHash?.trim() ?? '')
        .filter(Boolean)
    )
  ];
  const names = [
    ...new Set(
      activeNotebooks
        .filter((notebook) => !notebook.nameHash)
        .map((notebook) => notebookDuplicateNameKey(notebook.name))
        .filter(Boolean)
    )
  ];

  for (const chunk of chunks(nameHashes, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT * FROM notebooks
       WHERE owner_username = ?
         AND deleted_at IS NULL
         AND name_hash IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    )) as Row[];
    for (const row of rows) {
      const notebook = toNotebook(row);
      if (notebook.nameHash) {
        addNotebookDuplicateCandidate(
          candidates,
          `hash:${notebook.nameHash}`,
          notebook
        );
      }
    }
  }

  for (const chunk of chunks(names, 200)) {
    const rows = (await queryAll(
      db,
      `SELECT * FROM notebooks
       WHERE owner_username = ?
         AND deleted_at IS NULL
         AND lower(trim(name)) IN (${placeholders(chunk.length)})`,
      [ownerUsername, ...chunk]
    )) as Row[];
    for (const row of rows) {
      const notebook = toNotebook(row);
      addNotebookDuplicateCandidate(
        candidates,
        `name:${notebookDuplicateNameKey(notebook.name)}`,
        notebook
      );
    }
  }

  return candidates;
}

function firstNotebookDuplicate(
  notebook: Notebook,
  candidates: Map<string, Notebook[]>
): Notebook | null {
  const matches = candidates.get(notebookDuplicateKey(notebook)) ?? [];
  return matches.find((candidate) => candidate.id !== notebook.id) ?? null;
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
       notebook_id, owner_username, name, name_hash, created_at, updated_at, deleted_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notebook.id,
      ownerUsername,
      notebook.name,
      notebook.nameHash ?? null,
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

async function clearEntityTombstonesByIds(
  db: NotesExecutor,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityIds: string[]
): Promise<void> {
  for (const chunk of chunks(uniqueEntityIds(entityIds), 200)) {
    await runSql(
      db,
      `DELETE FROM entity_tombstones
       WHERE owner_username = ?
         AND entity_type = ?
         AND entity_id IN (${placeholders(chunk.length)})`,
      [ownerUsername, entityType, ...chunk]
    );
  }
}

async function recordEntityChanges(
  db: NotesExecutor,
  changes: Array<{
    entityType: EntityType;
    entityId: string;
    operation: EntityOperation;
    updatedAt: string;
  }>,
  ownerUsername: string
): Promise<void> {
  for (const chunk of chunks(changes, 200)) {
    await runSql(
      db,
      `INSERT INTO entity_changes (
         owner_username, entity_type, entity_id, operation, updated_at
       ) VALUES ${valuesPlaceholders(5, chunk.length)}`,
      chunk.flatMap((change) => [
        ownerUsername,
        change.entityType,
        change.entityId,
        change.operation,
        change.updatedAt
      ])
    );
  }
}

async function putNotes(
  db: NotesExecutor,
  notes: Note[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Note[]> {
  if (!notes.length) return [];

  const foreignIds = await idsOwnedByAnotherUser(
    db,
    'notes',
    notes.map((note) => note.id),
    ownerUsername
  );
  if (foreignIds.size) {
    throw new Error('Record id belongs to another owner');
  }

  const syncedNotes = notes.map((note) => ({
    ...note,
    syncStatus: 'synced' as const
  }));

  for (const chunk of chunks(syncedNotes, 100)) {
    await runSql(
      db,
      `INSERT INTO notes (
         id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, sync_status
       ) VALUES ${valuesPlaceholders(15, chunk.length)}
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
      chunk.flatMap((note) => [
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
      ])
    );
  }

  await clearEntityTombstonesByIds(
    db,
    ownerUsername,
    'note',
    syncedNotes.map((note) => note.id)
  );
  await recordEntityChanges(
    db,
    syncedNotes.map((note) => ({
      entityType: 'note' as const,
      entityId: note.id,
      operation: 'upsert' as const,
      updatedAt: note.updatedAt
    })),
    ownerUsername
  );

  return syncedNotes;
}

async function putNotebooks(
  db: NotesExecutor,
  notebooks: Notebook[],
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<Notebook[]> {
  if (!notebooks.length) return [];

  const foreignIds = await idsOwnedByAnotherUser(
    db,
    'notebooks',
    notebooks.map((notebook) => notebook.id),
    ownerUsername
  );
  if (foreignIds.size) {
    throw new Error('Record id belongs to another owner');
  }

  const syncedNotebooks = notebooks.map((notebook) => ({
    ...notebook,
    syncStatus: 'synced' as const
  }));

  for (const chunk of chunks(syncedNotebooks, 100)) {
    await runSql(
      db,
      `INSERT INTO notebooks (
         id, owner_username, name, name_hash, created_at, updated_at, deleted_at, device_id, version, sync_status
       ) VALUES ${valuesPlaceholders(10, chunk.length)}
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         name_hash = excluded.name_hash,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         device_id = excluded.device_id,
         version = excluded.version,
         sync_status = excluded.sync_status
         WHERE notebooks.owner_username = excluded.owner_username`,
      chunk.flatMap((notebook) => [
        notebook.id,
        ownerUsername,
        notebook.name,
        notebook.nameHash ?? null,
        notebook.createdAt,
        notebook.updatedAt,
        notebook.deletedAt,
        notebook.deviceId,
        notebook.version,
        'synced'
      ])
    );
  }

  await clearEntityTombstonesByIds(
    db,
    ownerUsername,
    'notebook',
    syncedNotebooks.map((notebook) => notebook.id)
  );
  await recordEntityChanges(
    db,
    syncedNotebooks.map((notebook) => ({
      entityType: 'notebook' as const,
      entityId: notebook.id,
      operation: 'upsert' as const,
      updatedAt: notebook.updatedAt
    })),
    ownerUsername
  );

  return syncedNotebooks;
}

async function saveNoteSnapshots(
  db: NotesExecutor,
  snapshots: Array<{ note: Note; reason: string }>,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const savedAt = new Date().toISOString();
  for (const chunk of chunks(snapshots, 100)) {
    await runSql(
      db,
      `INSERT INTO note_versions (
         note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, saved_at, reason
       ) VALUES ${valuesPlaceholders(16, chunk.length)}`,
      chunk.flatMap(({ note, reason }) => [
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
      ])
    );
  }
}

async function saveNotebookSnapshots(
  db: NotesExecutor,
  snapshots: Array<{ notebook: Notebook; reason: string }>,
  ownerUsername = LEGACY_OWNER_USERNAME
): Promise<void> {
  const savedAt = new Date().toISOString();
  for (const chunk of chunks(snapshots, 100)) {
    await runSql(
      db,
      `INSERT INTO notebook_versions (
         notebook_id, owner_username, name, name_hash, created_at, updated_at, deleted_at, device_id, version, saved_at, reason
       ) VALUES ${valuesPlaceholders(11, chunk.length)}`,
      chunk.flatMap(({ notebook, reason }) => [
        notebook.id,
        ownerUsername,
        notebook.name,
        notebook.nameHash ?? null,
        notebook.createdAt,
        notebook.updatedAt,
        notebook.deletedAt,
        notebook.deviceId,
        notebook.version,
        savedAt,
        reason
      ])
    );
  }
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

function tombstoneOverwriteAllowed(
  record: Note | Notebook,
  tombstone: EntityTombstone,
  options: PushChangesOptions
): boolean {
  if (!options.allowTombstoneOverwrite) return false;

  const recordTime = Date.parse(record.updatedAt);
  const tombstoneTime = Date.parse(tombstone.deletedAt);
  if (
    Number.isFinite(recordTime) &&
    Number.isFinite(tombstoneTime) &&
    recordTime !== tombstoneTime
  ) {
    return recordTime > tombstoneTime;
  }

  if (record.version !== tombstone.version) {
    return record.version > tombstone.version;
  }

  return record.deviceId.localeCompare(tombstone.deviceId) >= 0;
}

function noteWithSyncableNotebookRefsFromMap(
  note: Note,
  notebooks: Map<string, Notebook>
): { note: Note; changed: boolean } {
  const ids = noteNotebookIds(note);
  const syncableIds = ids.filter((id) => {
    const notebook = notebooks.get(id);
    return notebook && !notebook.deletedAt;
  });

  const normalized = {
    ...note,
    notebookIds: syncableIds,
    notebookId: syncableIds[0] ?? null
  };
  return {
    note: normalized,
    changed: noteNotebookRefsChanged(note, normalized)
  };
}

export async function pushChanges(
  db: NotesDb,
  request: PushRequest,
  ownerUsername = LEGACY_OWNER_USERNAME,
  options: PushChangesOptions = {}
): Promise<PushResponse> {
  const now = new Date().toISOString();
  const acceptedChanges: AcceptedChange[] = [];
  const conflicts: PushResponse['conflicts'] = [];

  await withWriteTransaction(db, async (tx) => {
    await upsertDevice(tx, request.device, now, ownerUsername);

    const remoteNotebooks = await getNotebooksByIds(
      tx,
      request.notebooks.map((change) => change.record.id),
      ownerUsername
    );
    const notebookTombstones = await getEntityTombstonesByIds(
      tx,
      ownerUsername,
      'notebook',
      request.notebooks
        .map((change) => change.record.id)
        .filter((id) => !remoteNotebooks.has(id))
    );
    const notebookDuplicateCandidates =
      await getActiveNotebookDuplicateCandidates(
        tx,
        ownerUsername,
        request.notebooks.map((change) => change.record)
      );
    const notebooksToWrite: Notebook[] = [];
    const notebookSnapshots: Array<{ notebook: Notebook; reason: string }> = [];
    const acceptedActiveNotebooks = new Map<string, Notebook>();
    const acceptedDeletedNotebookIds = new Set<string>();

    for (const change of request.notebooks) {
      const remote = remoteNotebooks.get(change.record.id) ?? null;
      const tombstone = remote
        ? null
        : (notebookTombstones.get(change.record.id) ?? null);
      if (
        tombstone &&
        !tombstoneOverwriteAllowed(change.record, tombstone, options)
      ) {
        const deletedRemote = deletedRemoteNotebook(change.record, tombstone);
        notebookSnapshots.push(
          { notebook: change.record, reason: 'conflict' },
          { notebook: deletedRemote, reason: 'conflict' }
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
        notebookSnapshots.push(
          { notebook: change.record, reason: 'conflict' },
          { notebook: remote, reason: 'conflict' }
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

      const inRequestDuplicate = acceptedActiveNotebooks.get(
        notebookDuplicateKey(change.record)
      );
      const duplicateCandidate = change.record.deletedAt
        ? null
        : inRequestDuplicate && inRequestDuplicate.id !== change.record.id
          ? inRequestDuplicate
          : firstNotebookDuplicate(change.record, notebookDuplicateCandidates);
      const duplicate =
        duplicateCandidate &&
        acceptedDeletedNotebookIds.has(duplicateCandidate.id)
          ? null
          : duplicateCandidate;
      if (duplicate) {
        notebookSnapshots.push(
          { notebook: change.record, reason: 'conflict' },
          { notebook: duplicate, reason: 'conflict' }
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

      const acceptedNotebook =
        remote && !recordsDiffer(change.record, remote)
          ? remote
          : {
              ...change.record,
              version: remote
                ? remote.version + 1
                : Math.max(change.record.version, 1),
              syncStatus: 'synced' as const
            };
      acceptedChanges.push(accepted('notebook', acceptedNotebook));
      if (acceptedNotebook.deletedAt) {
        acceptedDeletedNotebookIds.add(acceptedNotebook.id);
      } else {
        acceptedActiveNotebooks.set(
          notebookDuplicateKey(acceptedNotebook),
          acceptedNotebook
        );
      }
      if (acceptedNotebook !== remote) {
        notebooksToWrite.push(acceptedNotebook);
        notebookSnapshots.push({
          notebook: acceptedNotebook,
          reason: 'push'
        });
      }
    }

    await putNotebooks(tx, notebooksToWrite, ownerUsername);
    await saveNotebookSnapshots(tx, notebookSnapshots, ownerUsername);

    const remoteNotes = await getNotesByIds(
      tx,
      request.notes.map((change) => change.record.id),
      ownerUsername
    );
    const noteTombstones = await getEntityTombstonesByIds(
      tx,
      ownerUsername,
      'note',
      request.notes
        .map((change) => change.record.id)
        .filter((id) => !remoteNotes.has(id))
    );
    const syncableNotebookIds = request.notes.flatMap((change) =>
      noteNotebookIds(change.record)
    );
    const syncableNotebooks = await getNotebooksByIds(
      tx,
      syncableNotebookIds,
      ownerUsername
    );
    for (const notebook of notebooksToWrite) {
      syncableNotebooks.set(notebook.id, notebook);
    }
    const notesToWrite: Note[] = [];
    const noteSnapshots: Array<{ note: Note; reason: string }> = [];

    for (const change of request.notes) {
      const remote = remoteNotes.get(change.record.id) ?? null;
      const syncableNote = noteWithSyncableNotebookRefsFromMap(
        change.record,
        syncableNotebooks
      );
      const tombstone = remote
        ? null
        : (noteTombstones.get(change.record.id) ?? null);
      if (
        tombstone &&
        !tombstoneOverwriteAllowed(syncableNote.note, tombstone, options)
      ) {
        const deletedRemote = deletedRemoteNote(change.record, tombstone);
        noteSnapshots.push(
          { note: change.record, reason: 'conflict' },
          { note: deletedRemote, reason: 'conflict' }
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
      if (
        remote &&
        shouldConflict(syncableNote.note, remote, change.baseVersion)
      ) {
        noteSnapshots.push(
          { note: syncableNote.note, reason: 'conflict' },
          { note: remote, reason: 'conflict' }
        );
        conflicts.push(
          await makeConflict<Note>(
            tx,
            'note',
            syncableNote.note,
            remote,
            request.device.name
          )
        );
        continue;
      }

      const acceptedNote =
        remote &&
        !syncableNote.changed &&
        !recordsDiffer(syncableNote.note, remote)
          ? remote
          : {
              ...syncableNote.note,
              version: remote
                ? remote.version + 1
                : Math.max(syncableNote.note.version, 1),
              syncStatus: 'synced' as const
            };
      acceptedChanges.push(accepted('note', acceptedNote));
      if (acceptedNote !== remote) {
        notesToWrite.push(acceptedNote);
        noteSnapshots.push({ note: acceptedNote, reason: 'push' });
      }
    }

    await putNotes(tx, notesToWrite, ownerUsername);
    await saveNoteSnapshots(tx, noteSnapshots, ownerUsername);
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
