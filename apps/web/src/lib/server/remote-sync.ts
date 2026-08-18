import { randomUUID } from 'node:crypto';
import type { Note, Notebook } from '@author/schema';
import type { PullResponse } from '@author/api-types';
import { recordsDiffer, safeRevisionCursor } from '@author/sync-spec';
import { getRemoteDatabaseConfig, shouldSyncRemoteDatabase } from './config';
import {
  all as queryAll,
  get as queryOne,
  openConfiguredDatabase,
  run as runSql,
  withWriteTransaction,
  type NotesDb,
  type NotesExecutor
} from './db';
import {
  deleteDevicesByIds,
  deleteNotesByIds,
  deleteNotebooksByIds,
  getEntityTombstonesByIds,
  getSyncMeta,
  latestEntityRevision,
  LEGACY_OWNER_USERNAME,
  getNotesByIds,
  getNotebooksByIds,
  pullMirrorChangesSinceRevision,
  pushChanges,
  pruneVersionSnapshots,
  setSyncMeta,
  upsertDevice
} from './repository';
import type { EntityTombstone } from './repository';

const MIRROR_DEVICE = {
  id: 'server-db-mirror',
  name: 'Server DB mirror'
};
const MIRROR_LOCK_KEY = 'mirror.lock.v1';
const MIRROR_LOCK_TTL_MS = 15 * 60_000;
const MIRROR_LOCK_HEARTBEAT_MS = 30_000;

let syncInFlight: Promise<void> | null = null;

type Row = Record<string, unknown>;

type AuthUserRecord = {
  username: string;
  email: string | null;
  displayName: string | null;
  passwordHash: string;
  passwordSalt: string;
  e2eeKeyring: string | null;
  totpSecret: string | null;
  totpEnabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AccountTombstone = {
  username: string;
  deletionId: string;
  deletedAt: string;
};

type MirrorLease = {
  owner: string;
  expiresAt: string;
};

class MirrorLockUnavailable extends Error {
  constructor() {
    super('Remote mirror sync is already running');
    this.name = 'MirrorLockUnavailable';
  }
}

function asString(value: unknown): string {
  return String(value ?? '');
}

function parseMirrorLease(value: string | null): MirrorLease | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MirrorLease>;
    if (
      typeof parsed.owner !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }
    return {
      owner: parsed.owner,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}

function lockExpiresAt(now = Date.now()): string {
  return new Date(now + MIRROR_LOCK_TTL_MS).toISOString();
}

function leaseIsActive(lease: MirrorLease, now = Date.now()): boolean {
  const expiresAt = Date.parse(lease.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

async function acquireMirrorLease(
  db: NotesDb,
  owner: string,
  now = Date.now()
): Promise<boolean> {
  return await withWriteTransaction(db, async (tx) => {
    const existing = parseMirrorLease(await getSyncMeta(tx, MIRROR_LOCK_KEY));
    if (existing && existing.owner !== owner && leaseIsActive(existing, now)) {
      return false;
    }

    await setSyncMeta(
      tx,
      MIRROR_LOCK_KEY,
      JSON.stringify({ owner, expiresAt: lockExpiresAt(now) })
    );
    return true;
  });
}

async function refreshMirrorLease(
  db: NotesDb,
  owner: string
): Promise<boolean> {
  return await withWriteTransaction(db, async (tx) => {
    const existing = parseMirrorLease(await getSyncMeta(tx, MIRROR_LOCK_KEY));
    if (!existing || existing.owner !== owner) return false;

    await setSyncMeta(
      tx,
      MIRROR_LOCK_KEY,
      JSON.stringify({ owner, expiresAt: lockExpiresAt() })
    );
    return true;
  });
}

async function releaseMirrorLease(db: NotesDb, owner: string): Promise<void> {
  await withWriteTransaction(db, async (tx) => {
    const existing = parseMirrorLease(await getSyncMeta(tx, MIRROR_LOCK_KEY));
    if (existing?.owner === owner) {
      await runSql(tx, 'DELETE FROM sync_meta WHERE key = ?', [
        MIRROR_LOCK_KEY
      ]);
    }
  });
}

async function acquireMirrorLeases(
  local: NotesDb,
  remote: NotesDb
): Promise<{ release: () => Promise<void> }> {
  const owner = randomUUID();
  if (!(await acquireMirrorLease(local, owner))) {
    throw new MirrorLockUnavailable();
  }

  try {
    if (!(await acquireMirrorLease(remote, owner))) {
      throw new MirrorLockUnavailable();
    }
  } catch (error) {
    await releaseMirrorLease(local, owner).catch(() => {});
    throw error;
  }

  let heartbeatStopped = false;
  const heartbeat = setInterval(() => {
    if (heartbeatStopped) return;
    void Promise.allSettled([
      refreshMirrorLease(local, owner),
      refreshMirrorLease(remote, owner)
    ]);
  }, MIRROR_LOCK_HEARTBEAT_MS);

  return {
    release: async () => {
      heartbeatStopped = true;
      clearInterval(heartbeat);
      await Promise.allSettled([
        releaseMirrorLease(remote, owner),
        releaseMirrorLease(local, owner)
      ]);
    }
  };
}

function toAuthUser(row: Row): AuthUserRecord {
  return {
    username: asString(row.username),
    email:
      row.email === null || row.email === undefined
        ? null
        : asString(row.email),
    displayName:
      row.display_name === null || row.display_name === undefined
        ? null
        : asString(row.display_name),
    passwordHash: asString(row.password_hash),
    passwordSalt: asString(row.password_salt),
    e2eeKeyring:
      row.e2ee_keyring === null || row.e2ee_keyring === undefined
        ? null
        : asString(row.e2ee_keyring),
    totpSecret:
      row.totp_secret === null || row.totp_secret === undefined
        ? null
        : asString(row.totp_secret),
    totpEnabledAt:
      row.totp_enabled_at === null || row.totp_enabled_at === undefined
        ? null
        : asString(row.totp_enabled_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

type ChangeStamp = {
  updatedAt: string;
  version: number;
  deviceId: string;
};

class MirrorDivergenceError extends Error {
  constructor(entityType: 'note' | 'notebook', entityId: string) {
    super(
      `Remote mirror divergent ${entityType} ${entityId}; refusing to choose a winner`
    );
    this.name = 'MirrorDivergenceError';
  }
}

function newerOrTieBreakingStamp(
  source: ChangeStamp,
  target: ChangeStamp
): boolean {
  const sourceTime = Date.parse(source.updatedAt);
  const targetTime = Date.parse(target.updatedAt);
  if (
    Number.isFinite(sourceTime) &&
    Number.isFinite(targetTime) &&
    sourceTime !== targetTime
  ) {
    return sourceTime > targetTime;
  }

  if (source.version !== target.version) return source.version > target.version;
  return source.deviceId.localeCompare(target.deviceId) >= 0;
}

function recordStamp(record: Note | Notebook): ChangeStamp {
  return {
    updatedAt: record.updatedAt,
    version: record.version,
    deviceId: record.deviceId
  };
}

function tombstoneStamp(tombstone: EntityTombstone): ChangeStamp {
  return {
    updatedAt: tombstone.deletedAt,
    version: tombstone.version,
    deviceId: tombstone.deviceId
  };
}

function newerOrTieBreakingSource<T extends Note | Notebook>(
  source: T,
  target: T
): boolean {
  return newerOrTieBreakingStamp(recordStamp(source), recordStamp(target));
}

function recordWinsOverTombstone(
  record: Note | Notebook,
  tombstone: EntityTombstone
): boolean {
  return newerOrTieBreakingStamp(
    recordStamp(record),
    tombstoneStamp(tombstone)
  );
}

function tombstoneWinsOverRecord(
  tombstone: EntityTombstone,
  record: Note | Notebook
): boolean {
  return newerOrTieBreakingStamp(
    tombstoneStamp(tombstone),
    recordStamp(record)
  );
}

function canSourceOverwriteTarget<T extends Note | Notebook>(
  source: T,
  target: T
): boolean {
  return (
    newerOrTieBreakingSource(source, target) && source.version > target.version
  );
}

async function targetHasNoUnmirroredChange(
  target: NotesDb,
  ownerUsername: string,
  entityType: 'note' | 'notebook',
  entityId: string,
  targetOutboundRevision: number,
  mirroredTargetEntities: Set<string>
): Promise<boolean> {
  if (mirroredTargetEntities.has(`${entityType}:${entityId}`)) return true;
  return (
    (await latestEntityRevision(target, ownerUsername, entityType, entityId)) <=
    targetOutboundRevision
  );
}

function canTombstoneOverwriteRecord(
  tombstone: EntityTombstone,
  record: Note | Notebook
): boolean {
  return (
    tombstoneWinsOverRecord(tombstone, record) &&
    tombstone.version > record.version
  );
}

function recordIsDeleted(record: Note | Notebook): boolean {
  return Boolean(record.deletedAt);
}

function bothRecordsAreDeleted(
  source: Note | Notebook,
  target: Note | Notebook
): boolean {
  return recordIsDeleted(source) && recordIsDeleted(target);
}

function authCredentialsDiffer(
  source: AuthUserRecord,
  target: AuthUserRecord
): boolean {
  return (
    source.passwordHash !== target.passwordHash ||
    source.passwordSalt !== target.passwordSalt ||
    source.totpSecret !== target.totpSecret ||
    source.totpEnabledAt !== target.totpEnabledAt
  );
}

function authUsersDiffer(
  source: AuthUserRecord,
  target: AuthUserRecord
): boolean {
  return (
    authCredentialsDiffer(source, target) ||
    source.email !== target.email ||
    source.displayName !== target.displayName ||
    source.e2eeKeyring !== target.e2eeKeyring ||
    source.createdAt !== target.createdAt ||
    source.updatedAt !== target.updatedAt
  );
}

async function listAuthUsers(db: NotesExecutor): Promise<AuthUserRecord[]> {
  const rows = (await queryAll(
    db,
    'SELECT * FROM users ORDER BY username ASC'
  )) as Row[];
  return rows.map(toAuthUser);
}

async function getAuthUser(
  db: NotesExecutor,
  username: string
): Promise<AuthUserRecord | null> {
  const row = (await queryOne(db, 'SELECT * FROM users WHERE username = ?', [
    username
  ])) as Row | null;
  return row ? toAuthUser(row) : null;
}

async function putAuthUser(
  db: NotesExecutor,
  user: AuthUserRecord,
  revokeSessions: boolean
): Promise<void> {
  if (revokeSessions) {
    await runSql(db, 'DELETE FROM auth_sessions WHERE username = ?', [
      user.username
    ]);
    await runSql(db, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
      user.username
    ]);
  }

  await runSql(
    db,
    `INSERT INTO users (
       username, email, display_name, password_hash, password_salt,
       e2ee_keyring, totp_secret, totp_enabled_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       e2ee_keyring = excluded.e2ee_keyring,
       totp_secret = excluded.totp_secret,
       totp_enabled_at = excluded.totp_enabled_at,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      user.username,
      user.email,
      user.displayName,
      user.passwordHash,
      user.passwordSalt,
      user.e2eeKeyring,
      user.totpSecret,
      user.totpEnabledAt,
      user.createdAt,
      user.updatedAt
    ]
  );
}

async function deleteAuthUserData(
  db: NotesExecutor,
  username: string
): Promise<void> {
  await runSql(db, 'DELETE FROM auth_sessions WHERE username = ?', [username]);
  await runSql(db, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM users WHERE username = ?', [username]);
  await runSql(db, 'DELETE FROM entity_changes WHERE owner_username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM entity_tombstones WHERE owner_username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM note_versions WHERE owner_username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM notebook_versions WHERE owner_username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM notes WHERE owner_username = ?', [username]);
  await runSql(db, 'DELETE FROM notebooks WHERE owner_username = ?', [
    username
  ]);
  await runSql(db, 'DELETE FROM devices WHERE owner_username = ?', [username]);
}

async function listAccountTombstones(
  db: NotesExecutor
): Promise<AccountTombstone[]> {
  const rows = (await queryAll(
    db,
    'SELECT username, deletion_id, deleted_at FROM account_tombstones ORDER BY username'
  )) as Row[];
  return rows.map((row) => ({
    username: asString(row.username),
    deletionId: asString(row.deletion_id),
    deletedAt: asString(row.deleted_at)
  }));
}

async function applyAccountTombstone(
  db: NotesDb,
  tombstone: AccountTombstone
): Promise<void> {
  await withWriteTransaction(db, async (tx) => {
    await runSql(
      tx,
      `INSERT INTO account_tombstones (username, deletion_id, deleted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET
         deletion_id = excluded.deletion_id,
         deleted_at = excluded.deleted_at
       WHERE excluded.deleted_at > account_tombstones.deleted_at`,
      [tombstone.username, tombstone.deletionId, tombstone.deletedAt]
    );
    await deleteAuthUserData(tx, tombstone.username);
  });
}

async function syncAccountTombstones(
  local: NotesDb,
  remote: NotesDb
): Promise<void> {
  const combined = new Map<string, AccountTombstone>();
  for (const tombstone of [
    ...(await listAccountTombstones(local)),
    ...(await listAccountTombstones(remote))
  ]) {
    const current = combined.get(tombstone.username);
    if (!current || tombstone.deletedAt > current.deletedAt) {
      combined.set(tombstone.username, tombstone);
    }
  }
  for (const tombstone of combined.values()) {
    await applyAccountTombstone(local, tombstone);
    await applyAccountTombstone(remote, tombstone);
  }
}

async function orphanedOwnerUsernames(db: NotesExecutor): Promise<string[]> {
  const ownerTables = [
    'devices',
    'notes',
    'notebooks',
    'entity_changes',
    'entity_tombstones',
    'note_versions',
    'notebook_versions'
  ];
  const usernames = new Set<string>();

  for (const table of ownerTables) {
    const rows = (await queryAll(
      db,
      `SELECT DISTINCT owner_username FROM ${table} WHERE owner_username <> ?`,
      [LEGACY_OWNER_USERNAME]
    )) as Row[];
    for (const row of rows) {
      const username = asString(row.owner_username);
      if (username) usernames.add(username);
    }
  }

  const orphaned: string[] = [];
  for (const username of usernames) {
    if (!(await getAuthUser(db, username))) orphaned.push(username);
  }
  return orphaned;
}

async function syncUsers(
  source: NotesDb,
  target: NotesDb,
  { copyUsers }: { copyUsers: boolean }
): Promise<void> {
  const users = await listAuthUsers(source);
  if (copyUsers) {
    for (const user of users) {
      const targetUser = await getAuthUser(target, user.username);
      if (!targetUser) {
        await putAuthUser(target, user, false);
        continue;
      }

      if (authUsersDiffer(user, targetUser)) {
        await putAuthUser(
          target,
          user,
          authCredentialsDiffer(user, targetUser)
        );
      }
    }
  }
}

async function syncDevices(
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string
): Promise<void> {
  for (const device of snapshot.devices) {
    await upsertDevice(target, device, undefined, ownerUsername);
  }
}

type MirrorChange<T extends Note | Notebook> = {
  record: T;
  baseVersion: number;
};

type MirrorUpsertPlan<T extends Note | Notebook> = {
  copySourceToTarget: MirrorChange<T>[];
  copyTargetToSource: MirrorChange<T>[];
  deleteSourceIds: string[];
};

type MirrorDeletePlan<T extends Note | Notebook> = {
  deleteTargetIds: string[];
  copyTargetToSource: MirrorChange<T>[];
};

async function notebookChanges(
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string,
  targetOutboundRevision: number,
  mirroredTargetEntities: Set<string>
): Promise<MirrorUpsertPlan<Notebook>> {
  const copySourceToTarget: MirrorChange<Notebook>[] = [];
  const copyTargetToSource: MirrorChange<Notebook>[] = [];
  const deleteSourceIds: string[] = [];
  const notebookIds = snapshot.notebooks.map((notebook) => notebook.id);
  const targetNotebooks = await getNotebooksByIds(
    target,
    notebookIds,
    ownerUsername
  );
  const targetTombstones = await getEntityTombstonesByIds(
    target,
    ownerUsername,
    'notebook',
    notebookIds
  );

  for (const notebook of snapshot.notebooks) {
    const targetNotebook = targetNotebooks.get(notebook.id) ?? null;
    if (targetNotebook) {
      if (!recordsDiffer(notebook, targetNotebook)) {
        if (notebook.version > targetNotebook.version) {
          copySourceToTarget.push({
            record: notebook,
            baseVersion: targetNotebook.version
          });
        }
        continue;
      }
      if (
        canSourceOverwriteTarget(notebook, targetNotebook) &&
        (await targetHasNoUnmirroredChange(
          target,
          ownerUsername,
          'notebook',
          notebook.id,
          targetOutboundRevision,
          mirroredTargetEntities
        ))
      ) {
        copySourceToTarget.push({
          record: notebook,
          baseVersion: targetNotebook.version
        });
        continue;
      }
      if (bothRecordsAreDeleted(notebook, targetNotebook)) {
        deleteSourceIds.push(notebook.id);
        continue;
      }
      throw new MirrorDivergenceError('notebook', notebook.id);
    }

    const targetTombstone = targetTombstones.get(notebook.id) ?? null;
    if (
      !targetTombstone ||
      (recordWinsOverTombstone(notebook, targetTombstone) &&
        (await targetHasNoUnmirroredChange(
          target,
          ownerUsername,
          'notebook',
          notebook.id,
          targetOutboundRevision,
          mirroredTargetEntities
        )))
    ) {
      copySourceToTarget.push({
        record: notebook,
        baseVersion: targetTombstone?.version ?? 0
      });
    } else if (recordIsDeleted(notebook)) {
      deleteSourceIds.push(notebook.id);
    } else {
      throw new MirrorDivergenceError('notebook', notebook.id);
    }
  }

  return { copySourceToTarget, copyTargetToSource, deleteSourceIds };
}

async function noteChanges(
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string,
  targetOutboundRevision: number,
  mirroredTargetEntities: Set<string>
): Promise<MirrorUpsertPlan<Note>> {
  const copySourceToTarget: MirrorChange<Note>[] = [];
  const copyTargetToSource: MirrorChange<Note>[] = [];
  const deleteSourceIds: string[] = [];
  const noteIds = snapshot.notes.map((note) => note.id);
  const targetNotes = await getNotesByIds(target, noteIds, ownerUsername);
  const targetTombstones = await getEntityTombstonesByIds(
    target,
    ownerUsername,
    'note',
    noteIds
  );

  for (const note of snapshot.notes) {
    const targetNote = targetNotes.get(note.id) ?? null;
    if (targetNote) {
      if (!recordsDiffer(note, targetNote)) {
        if (note.version > targetNote.version) {
          copySourceToTarget.push({
            record: note,
            baseVersion: targetNote.version
          });
        }
        continue;
      }
      if (
        canSourceOverwriteTarget(note, targetNote) &&
        (await targetHasNoUnmirroredChange(
          target,
          ownerUsername,
          'note',
          note.id,
          targetOutboundRevision,
          mirroredTargetEntities
        ))
      ) {
        copySourceToTarget.push({
          record: note,
          baseVersion: targetNote.version
        });
        continue;
      }
      if (bothRecordsAreDeleted(note, targetNote)) {
        deleteSourceIds.push(note.id);
        continue;
      }
      throw new MirrorDivergenceError('note', note.id);
    }

    const targetTombstone = targetTombstones.get(note.id) ?? null;
    if (
      !targetTombstone ||
      (recordWinsOverTombstone(note, targetTombstone) &&
        (await targetHasNoUnmirroredChange(
          target,
          ownerUsername,
          'note',
          note.id,
          targetOutboundRevision,
          mirroredTargetEntities
        )))
    ) {
      copySourceToTarget.push({
        record: note,
        baseVersion: targetTombstone?.version ?? 0
      });
    } else if (recordIsDeleted(note)) {
      deleteSourceIds.push(note.id);
    } else {
      throw new MirrorDivergenceError('note', note.id);
    }
  }

  return { copySourceToTarget, copyTargetToSource, deleteSourceIds };
}

async function notebookDeleteChanges(
  source: NotesDb,
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string,
  targetOutboundRevision: number,
  mirroredTargetEntities: Set<string>
): Promise<MirrorDeletePlan<Notebook>> {
  const notebookIds = [...new Set(snapshot.deletedNotebookIds)].filter(Boolean);
  const deleteTargetIds: string[] = [];
  const copyTargetToSource: MirrorChange<Notebook>[] = [];
  if (!notebookIds.length) return { deleteTargetIds, copyTargetToSource };

  const [sourceTombstones, sourceNotebooks, targetNotebooks] =
    await Promise.all([
      getEntityTombstonesByIds(source, ownerUsername, 'notebook', notebookIds),
      getNotebooksByIds(source, notebookIds, ownerUsername),
      getNotebooksByIds(target, notebookIds, ownerUsername)
    ]);

  for (const notebookId of notebookIds) {
    const sourceTombstone = sourceTombstones.get(notebookId) ?? null;
    const sourceNotebook = sourceNotebooks.get(notebookId) ?? null;
    const targetNotebook = targetNotebooks.get(notebookId) ?? null;

    if (sourceNotebook) continue;

    if (!targetNotebook) {
      deleteTargetIds.push(notebookId);
      continue;
    }

    if (recordIsDeleted(targetNotebook)) {
      deleteTargetIds.push(notebookId);
      continue;
    }

    if (
      sourceTombstone &&
      canTombstoneOverwriteRecord(sourceTombstone, targetNotebook) &&
      (await targetHasNoUnmirroredChange(
        target,
        ownerUsername,
        'notebook',
        notebookId,
        targetOutboundRevision,
        mirroredTargetEntities
      ))
    ) {
      deleteTargetIds.push(notebookId);
      continue;
    }
    throw new MirrorDivergenceError('notebook', notebookId);
  }

  return { deleteTargetIds, copyTargetToSource };
}

async function noteDeleteChanges(
  source: NotesDb,
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string,
  targetOutboundRevision: number,
  mirroredTargetEntities: Set<string>
): Promise<MirrorDeletePlan<Note>> {
  const noteIds = [...new Set(snapshot.deletedNoteIds)].filter(Boolean);
  const deleteTargetIds: string[] = [];
  const copyTargetToSource: MirrorChange<Note>[] = [];
  if (!noteIds.length) return { deleteTargetIds, copyTargetToSource };

  const [sourceTombstones, sourceNotes, targetNotes] = await Promise.all([
    getEntityTombstonesByIds(source, ownerUsername, 'note', noteIds),
    getNotesByIds(source, noteIds, ownerUsername),
    getNotesByIds(target, noteIds, ownerUsername)
  ]);

  for (const noteId of noteIds) {
    const sourceTombstone = sourceTombstones.get(noteId) ?? null;
    const sourceNote = sourceNotes.get(noteId) ?? null;
    const targetNote = targetNotes.get(noteId) ?? null;

    if (sourceNote) continue;

    if (!targetNote) {
      deleteTargetIds.push(noteId);
      continue;
    }

    if (recordIsDeleted(targetNote)) {
      deleteTargetIds.push(noteId);
      continue;
    }

    if (
      sourceTombstone &&
      canTombstoneOverwriteRecord(sourceTombstone, targetNote) &&
      (await targetHasNoUnmirroredChange(
        target,
        ownerUsername,
        'note',
        noteId,
        targetOutboundRevision,
        mirroredTargetEntities
      ))
    ) {
      deleteTargetIds.push(noteId);
      continue;
    }
    throw new MirrorDivergenceError('note', noteId);
  }

  return { deleteTargetIds, copyTargetToSource };
}

async function pushMirrorChanges(
  target: NotesDb,
  ownerUsername: string,
  notebooks: MirrorChange<Notebook>[],
  notes: MirrorChange<Note>[],
  cursorKey: string
): Promise<void> {
  if (!notebooks.length && !notes.length) return;

  const result = await pushChanges(
    target,
    {
      device: MIRROR_DEVICE,
      notebooks,
      notes
    },
    ownerUsername,
    { allowTombstoneOverwrite: true, preserveRecordVersions: true }
  );
  if (result.conflicts.length) {
    throw new Error(
      `Remote mirror conflict while applying ${cursorKey}: ${result.conflicts.length}`
    );
  }
}

async function syncEntityOwnerOneWay(
  source: NotesDb,
  target: NotesDb,
  cursorKey: string,
  targetOutboundCursorKey: string,
  ownerUsername: string
): Promise<void> {
  const ownerCursorKey = `${cursorKey}.${ownerUsername}`;
  const storedTargetOutboundCursor = Number(
    (await getSyncMeta(
      source,
      `${targetOutboundCursorKey}.${ownerUsername}`
    )) ?? 0
  );
  const targetOutboundRevision =
    Number.isSafeInteger(storedTargetOutboundCursor) &&
    storedTargetOutboundCursor >= 0
      ? storedTargetOutboundCursor
      : 0;
  const storedCursor = Number((await getSyncMeta(target, ownerCursorKey)) ?? 0);
  let cursor =
    Number.isSafeInteger(storedCursor) && storedCursor >= 0 ? storedCursor : 0;
  let hasMore = true;
  let resetCursor = false;
  const mirroredTargetEntities = new Set<string>();

  while (hasMore) {
    const snapshot = await pullMirrorChangesSinceRevision(source, cursor, {
      ownerUsername
    });
    if (snapshot.serverRevision < cursor && !resetCursor) {
      resetCursor = true;
      cursor = 0;
      await setSyncMeta(target, ownerCursorKey, '0');
      continue;
    }
    const nextCursor = safeRevisionCursor(
      snapshot.serverRevision,
      cursor,
      Boolean(snapshot.hasMore),
      `Remote mirror ${ownerCursorKey}`
    );

    await syncDevices(snapshot, target, ownerUsername);
    await deleteDevicesByIds(target, snapshot.deletedDeviceIds, ownerUsername);

    const [notebookUpserts, noteUpserts, notebookDeletes, noteDeletes] =
      await Promise.all([
        notebookChanges(
          snapshot,
          target,
          ownerUsername,
          targetOutboundRevision,
          mirroredTargetEntities
        ),
        noteChanges(
          snapshot,
          target,
          ownerUsername,
          targetOutboundRevision,
          mirroredTargetEntities
        ),
        notebookDeleteChanges(
          source,
          snapshot,
          target,
          ownerUsername,
          targetOutboundRevision,
          mirroredTargetEntities
        ),
        noteDeleteChanges(
          source,
          snapshot,
          target,
          ownerUsername,
          targetOutboundRevision,
          mirroredTargetEntities
        )
      ]);

    await deleteNotebooksByIds(
      source,
      notebookUpserts.deleteSourceIds,
      ownerUsername
    );
    await deleteNotesByIds(source, noteUpserts.deleteSourceIds, ownerUsername);
    await deleteNotebooksByIds(
      target,
      notebookDeletes.deleteTargetIds,
      ownerUsername
    );
    await deleteNotesByIds(target, noteDeletes.deleteTargetIds, ownerUsername);

    await pushMirrorChanges(
      target,
      ownerUsername,
      notebookUpserts.copySourceToTarget,
      noteUpserts.copySourceToTarget,
      ownerCursorKey
    );
    for (const change of notebookUpserts.copySourceToTarget) {
      mirroredTargetEntities.add(`notebook:${change.record.id}`);
    }
    for (const change of noteUpserts.copySourceToTarget) {
      mirroredTargetEntities.add(`note:${change.record.id}`);
    }
    for (const id of notebookDeletes.deleteTargetIds) {
      mirroredTargetEntities.add(`notebook:${id}`);
    }
    for (const id of noteDeletes.deleteTargetIds) {
      mirroredTargetEntities.add(`note:${id}`);
    }

    await pushMirrorChanges(
      source,
      ownerUsername,
      [
        ...notebookUpserts.copyTargetToSource,
        ...notebookDeletes.copyTargetToSource
      ],
      [...noteUpserts.copyTargetToSource, ...noteDeletes.copyTargetToSource],
      ownerCursorKey
    );

    await setSyncMeta(target, ownerCursorKey, String(nextCursor));
    hasMore = Boolean(snapshot.hasMore);
    cursor = nextCursor;
  }
}

async function syncOwners(source: NotesDb, target: NotesDb): Promise<string[]> {
  const owners = new Set<string>([LEGACY_OWNER_USERNAME]);
  for (const user of await listAuthUsers(source)) owners.add(user.username);
  for (const user of await listAuthUsers(target)) owners.add(user.username);
  return [...owners].sort();
}

async function syncOneWay(
  source: NotesDb,
  target: NotesDb,
  cursorKey: string,
  targetOutboundCursorKey: string,
  { copyUsers = false }: { copyUsers?: boolean } = {}
): Promise<void> {
  await syncUsers(source, target, { copyUsers });
  for (const ownerUsername of await syncOwners(source, target)) {
    await syncEntityOwnerOneWay(
      source,
      target,
      cursorKey,
      targetOutboundCursorKey,
      ownerUsername
    );
  }
}

export async function syncDatabases(
  local: NotesDb,
  remote: NotesDb
): Promise<void> {
  const now = new Date();
  await syncAccountTombstones(local, remote);

  const [localOrphans, remoteOrphans, localUsers, remoteUsers] =
    await Promise.all([
      orphanedOwnerUsernames(local),
      orphanedOwnerUsernames(remote),
      listAuthUsers(local),
      listAuthUsers(remote)
    ]);
  if (localOrphans.length || remoteOrphans.length) {
    throw new Error(
      `Remote mirror found owner data without an account row: ${[
        ...localOrphans.map((name) => `local:${name}`),
        ...remoteOrphans.map((name) => `remote:${name}`)
      ].join(', ')}`
    );
  }
  const remoteUsernames = new Set(remoteUsers.map((user) => user.username));
  const unexplainedLocalOnlyUsers = localUsers
    .map((user) => user.username)
    .filter((username) => !remoteUsernames.has(username));
  if (unexplainedLocalOnlyUsers.length) {
    throw new Error(
      `Remote mirror is missing account rows without explicit tombstones: ${unexplainedLocalOnlyUsers.join(', ')}`
    );
  }

  await syncOneWay(
    remote,
    local,
    'mirror.remote.revision',
    'mirror.local.revision',
    { copyUsers: true }
  );
  await syncOneWay(
    local,
    remote,
    'mirror.local.revision',
    'mirror.remote.revision'
  );
  await syncOneWay(
    remote,
    local,
    'mirror.remote.revision',
    'mirror.local.revision',
    { copyUsers: true }
  );
  await pruneVersionSnapshots(local, now);
  await pruneVersionSnapshots(remote, now);
}

export async function syncRemoteDatabase(local: NotesDb): Promise<void> {
  if (!shouldSyncRemoteDatabase()) return;

  if (syncInFlight) {
    await syncInFlight;
    return;
  }

  syncInFlight = (async () => {
    const remoteConfig = getRemoteDatabaseConfig();
    if (!remoteConfig) return;

    const remote = await openConfiguredDatabase(remoteConfig);
    try {
      let leases: Awaited<ReturnType<typeof acquireMirrorLeases>> | null = null;
      leases = await acquireMirrorLeases(local, remote);

      try {
        await syncDatabases(local, remote);
      } finally {
        await leases.release();
      }
    } finally {
      remote.close();
    }
  })();

  try {
    await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

export async function waitForRemoteSyncIdleForTests(): Promise<void> {
  await syncInFlight?.catch(() => {});
}
