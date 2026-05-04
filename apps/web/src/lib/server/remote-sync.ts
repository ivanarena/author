import { randomUUID } from 'node:crypto';
import type { Note, Notebook } from '@author/schema';
import type { PullResponse } from '@author/api-types';
import { recordsDiffer } from '@author/sync-spec';
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
  getSyncMeta,
  LEGACY_OWNER_USERNAME,
  getNotesByIds,
  getNotebooksByIds,
  pullMirrorChangesSinceRevision,
  pushChanges,
  setSyncMeta,
  upsertDevice
} from './repository';

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
  displayName: string | null;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  createdAt: string;
  updatedAt: string;
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
    void Promise.all([
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
    displayName:
      row.display_name === null || row.display_name === undefined
        ? null
        : asString(row.display_name),
    passwordHash: asString(row.password_hash),
    passwordSalt: asString(row.password_salt),
    passwordIterations: Number(row.password_iterations),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function newerOrTieBreakingSource<T extends Note | Notebook>(
  source: T,
  target: T
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

function authCredentialsDiffer(
  source: AuthUserRecord,
  target: AuthUserRecord
): boolean {
  return (
    source.passwordHash !== target.passwordHash ||
    source.passwordSalt !== target.passwordSalt ||
    source.passwordIterations !== target.passwordIterations
  );
}

function authUsersDiffer(
  source: AuthUserRecord,
  target: AuthUserRecord
): boolean {
  return (
    authCredentialsDiffer(source, target) ||
    source.displayName !== target.displayName ||
    source.createdAt !== target.createdAt ||
    source.updatedAt !== target.updatedAt
  );
}

function newerAuthUser(
  source: AuthUserRecord,
  target: AuthUserRecord
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

  if (source.updatedAt !== target.updatedAt) {
    return source.updatedAt > target.updatedAt;
  }

  const sourceKey = `${source.passwordHash}:${source.passwordSalt}:${source.passwordIterations}`;
  const targetKey = `${target.passwordHash}:${target.passwordSalt}:${target.passwordIterations}`;
  return sourceKey.localeCompare(targetKey) >= 0;
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
  }

  await runSql(
    db,
    `INSERT INTO users (
       username, display_name, password_hash, password_salt, password_iterations, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       display_name = excluded.display_name,
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      user.username,
      user.displayName,
      user.passwordHash,
      user.passwordSalt,
      user.passwordIterations,
      user.createdAt,
      user.updatedAt
    ]
  );
}

async function syncUsers(source: NotesDb, target: NotesDb): Promise<void> {
  const users = await listAuthUsers(source);
  for (const user of users) {
    const targetUser = await getAuthUser(target, user.username);
    if (!targetUser) {
      await putAuthUser(target, user, false);
      continue;
    }

    if (authUsersDiffer(user, targetUser) && newerAuthUser(user, targetUser)) {
      await putAuthUser(target, user, authCredentialsDiffer(user, targetUser));
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

async function notebookChanges(
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string
): Promise<PushRequestNotebookChange[]> {
  const changes: PushRequestNotebookChange[] = [];
  const targetNotebooks = await getNotebooksByIds(
    target,
    snapshot.notebooks.map((notebook) => notebook.id),
    ownerUsername
  );

  for (const notebook of snapshot.notebooks) {
    const targetNotebook = targetNotebooks.get(notebook.id) ?? null;
    const shouldMirror =
      !targetNotebook ||
      (recordsDiffer(notebook, targetNotebook) &&
        newerOrTieBreakingSource(notebook, targetNotebook));
    if (shouldMirror) {
      changes.push({
        record: notebook,
        baseVersion: targetNotebook?.version ?? 0
      });
    }
  }

  return changes;
}

async function noteChanges(
  snapshot: PullResponse,
  target: NotesDb,
  ownerUsername: string
): Promise<PushRequestNoteChange[]> {
  const changes: PushRequestNoteChange[] = [];
  const targetNotes = await getNotesByIds(
    target,
    snapshot.notes.map((note) => note.id),
    ownerUsername
  );

  for (const note of snapshot.notes) {
    const targetNote = targetNotes.get(note.id) ?? null;
    const shouldMirror =
      !targetNote ||
      (recordsDiffer(note, targetNote) &&
        newerOrTieBreakingSource(note, targetNote));
    if (shouldMirror) {
      changes.push({ record: note, baseVersion: targetNote?.version ?? 0 });
    }
  }

  return changes;
}

type PushRequestNotebookChange = { record: Notebook; baseVersion: number };
type PushRequestNoteChange = { record: Note; baseVersion: number };

async function applyMirrorDeletes(
  snapshot: Awaited<ReturnType<typeof pullMirrorChangesSinceRevision>>,
  target: NotesDb,
  ownerUsername: string
): Promise<void> {
  await deleteNotesByIds(target, snapshot.deletedNoteIds, ownerUsername);
  await deleteNotebooksByIds(
    target,
    snapshot.deletedNotebookIds,
    ownerUsername
  );
  await deleteDevicesByIds(target, snapshot.deletedDeviceIds, ownerUsername);
}

async function syncEntityOwnerOneWay(
  source: NotesDb,
  target: NotesDb,
  cursorKey: string,
  ownerUsername: string
): Promise<void> {
  const ownerCursorKey = `${cursorKey}.${ownerUsername}`;
  const cursor = Number((await getSyncMeta(target, ownerCursorKey)) ?? 0);
  const snapshot = await pullMirrorChangesSinceRevision(
    source,
    Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0,
    { ownerUsername }
  );
  await applyMirrorDeletes(snapshot, target, ownerUsername);
  await syncDevices(snapshot, target, ownerUsername);
  const notebooks = await notebookChanges(snapshot, target, ownerUsername);
  const notes = await noteChanges(snapshot, target, ownerUsername);
  if (!notebooks.length && !notes.length) {
    await setSyncMeta(target, ownerCursorKey, String(snapshot.serverRevision));
    return;
  }

  const result = await pushChanges(
    target,
    {
      device: MIRROR_DEVICE,
      notebooks,
      notes
    },
    ownerUsername
  );
  if (result.conflicts.length) {
    throw new Error(
      `Remote mirror conflict while applying ${ownerCursorKey}: ${result.conflicts.length}`
    );
  }
  await setSyncMeta(target, ownerCursorKey, String(snapshot.serverRevision));
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
  cursorKey: string
): Promise<void> {
  await syncUsers(source, target);
  for (const ownerUsername of await syncOwners(source, target)) {
    await syncEntityOwnerOneWay(source, target, cursorKey, ownerUsername);
  }
}

export async function syncDatabases(
  local: NotesDb,
  remote: NotesDb
): Promise<void> {
  await syncOneWay(remote, local, 'mirror.remote.revision');
  await syncOneWay(local, remote, 'mirror.local.revision');
  await syncOneWay(remote, local, 'mirror.remote.revision');
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
