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

export async function upsertDevice(
  db: NotesExecutor,
  device: Device,
  seenAt = new Date().toISOString()
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO devices (id, name, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
    [device.id, device.name, seenAt]
  );
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
  id: string
): Promise<Note | null> {
  const row = (await queryOne(db, 'SELECT * FROM notes WHERE id = ?', [
    id
  ])) as Row | null;
  return row ? toNote(row) : null;
}

export async function getNotebook(
  db: NotesExecutor,
  id: string
): Promise<Notebook | null> {
  const row = (await queryOne(db, 'SELECT * FROM notebooks WHERE id = ?', [
    id
  ])) as Row | null;
  return row ? toNotebook(row) : null;
}

async function getActiveNotebookByName(
  db: NotesExecutor,
  name: string,
  excludeId: string
): Promise<Notebook | null> {
  const row = (await queryOne(
    db,
    `SELECT * FROM notebooks
     WHERE deleted_at IS NULL
       AND id <> ?
       AND lower(trim(name)) = lower(?)
     LIMIT 1`,
    [excludeId, name.trim()]
  )) as Row | null;

  return row ? toNotebook(row) : null;
}

export async function listNotes(db: NotesExecutor): Promise<Note[]> {
  const rows = (await queryAll(
    db,
    'SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC'
  )) as Row[];
  return rows.map(toNote);
}

export async function listNotebooks(db: NotesExecutor): Promise<Notebook[]> {
  const rows = (await queryAll(
    db,
    'SELECT * FROM notebooks WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC'
  )) as Row[];
  return rows.map(toNotebook);
}

export async function pullChangesSince(
  db: NotesExecutor,
  since: string | null | undefined
): Promise<PullResponse> {
  const sinceValue = since ?? '0000-01-01T00:00:00.000Z';
  const notes = (
    (await queryAll(
      db,
      'SELECT * FROM notes WHERE updated_at > ? ORDER BY updated_at ASC',
      [sinceValue]
    )) as Row[]
  ).map(toNote);
  const notebooks = (
    (await queryAll(
      db,
      'SELECT * FROM notebooks WHERE updated_at > ? ORDER BY updated_at ASC',
      [sinceValue]
    )) as Row[]
  ).map(toNotebook);
  const devices = (
    (await queryAll(
      db,
      'SELECT id, name FROM devices ORDER BY name ASC'
    )) as Row[]
  ).map(toDevice);

  return {
    serverTime: new Date().toISOString(),
    notes,
    notebooks,
    devices
  };
}

async function saveNoteSnapshot(
  db: NotesExecutor,
  note: Note,
  reason: string,
  savedAt = new Date().toISOString()
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO note_versions (
       note_id, title, body, notebook_ids, notebook_id, created_at, updated_at,
       deleted_at, trashed_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      note.title,
      note.body,
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
  savedAt = new Date().toISOString()
): Promise<void> {
  await runSql(
    db,
    `INSERT INTO notebook_versions (
       notebook_id, name, created_at, updated_at, deleted_at, device_id, version, saved_at, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notebook.id,
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

async function putNote(db: NotesExecutor, note: Note): Promise<Note> {
  await runSql(
    db,
    `INSERT INTO notes (
       id, title, body, notebook_ids, notebook_id, created_at, updated_at,
       deleted_at, trashed_at, device_id, version, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       notebook_ids = excluded.notebook_ids,
       notebook_id = excluded.notebook_id,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       trashed_at = excluded.trashed_at,
       device_id = excluded.device_id,
       version = excluded.version,
       sync_status = excluded.sync_status`,
    [
      note.id,
      note.title,
      note.body,
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

  return { ...note, syncStatus: 'synced' };
}

async function putNotebook(
  db: NotesExecutor,
  notebook: Notebook
): Promise<Notebook> {
  await runSql(
    db,
    `INSERT INTO notebooks (
       id, name, created_at, updated_at, deleted_at, device_id, version, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       device_id = excluded.device_id,
       version = excluded.version,
       sync_status = excluded.sync_status`,
    [
      notebook.id,
      notebook.name,
      notebook.createdAt,
      notebook.updatedAt,
      notebook.deletedAt,
      notebook.deviceId,
      notebook.version,
      'synced'
    ]
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
  remote: Note | null
): Promise<Note> {
  if (remote && !recordsDiffer(local, remote)) {
    return remote;
  }

  const version = remote ? remote.version + 1 : Math.max(local.version, 1);
  const acceptedNote = await putNote(db, {
    ...local,
    version,
    syncStatus: 'synced'
  });
  await saveNoteSnapshot(db, acceptedNote, 'push');
  return acceptedNote;
}

async function acceptNotebookChange(
  db: NotesExecutor,
  local: Notebook,
  remote: Notebook | null
): Promise<Notebook> {
  if (remote && !recordsDiffer(local, remote)) {
    return remote;
  }

  const version = remote ? remote.version + 1 : Math.max(local.version, 1);
  const acceptedNotebook = await putNotebook(db, {
    ...local,
    version,
    syncStatus: 'synced'
  });
  await saveNotebookSnapshot(db, acceptedNotebook, 'push');
  return acceptedNotebook;
}

export async function pushChanges(
  db: NotesDb,
  request: PushRequest
): Promise<PushResponse> {
  const now = new Date().toISOString();
  const acceptedChanges: AcceptedChange[] = [];
  const conflicts: PushResponse['conflicts'] = [];

  await withWriteTransaction(db, async (tx) => {
    await upsertDevice(tx, request.device, now);

    for (const change of request.notebooks) {
      const remote = await getNotebook(tx, change.record.id);
      if (remote && shouldConflict(change.record, remote, change.baseVersion)) {
        await saveNotebookSnapshot(tx, change.record, 'conflict');
        await saveNotebookSnapshot(tx, remote, 'conflict');
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
            change.record.id
          );
      if (duplicate) {
        await saveNotebookSnapshot(tx, change.record, 'conflict');
        await saveNotebookSnapshot(tx, duplicate, 'conflict');
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
          await acceptNotebookChange(tx, change.record, remote)
        )
      );
    }

    for (const change of request.notes) {
      const remote = await getNote(tx, change.record.id);
      if (remote && shouldConflict(change.record, remote, change.baseVersion)) {
        await saveNoteSnapshot(tx, change.record, 'conflict');
        await saveNoteSnapshot(tx, remote, 'conflict');
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
        accepted('note', await acceptNoteChange(tx, change.record, remote))
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
  now = new Date()
): Promise<CleanupResponse> {
  const cutoff = retentionCutoff(now, NOTE_RETENTION_DAYS);
  const oldNotes = (
    (await queryAll(
      db,
      'SELECT * FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?',
      [cutoff]
    )) as Row[]
  ).map(toNote);
  const oldNotebooks = (
    (await queryAll(
      db,
      'SELECT * FROM notebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff]
    )) as Row[]
  ).map(toNotebook);

  await withWriteTransaction(db, async (tx) => {
    for (const note of oldNotes) {
      await saveNoteSnapshot(tx, note, 'cleanup');
    }
    for (const notebook of oldNotebooks) {
      await saveNotebookSnapshot(tx, notebook, 'cleanup');
    }

    await runSql(
      tx,
      'DELETE FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?',
      [cutoff]
    );
    await runSql(
      tx,
      'DELETE FROM notebooks WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff]
    );
  });

  return {
    deletedNotes: oldNotes.length,
    deletedNotebooks: oldNotebooks.length,
    cutoff
  };
}
