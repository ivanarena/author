import type { Note, Notebook } from '@author/schema';
import { recordsDiffer } from '@author/sync-spec';
import { getRemoteDatabaseConfig, shouldSyncRemoteDatabase } from './config';
import {
  all as queryAll,
  get as queryOne,
  openConfiguredDatabase,
  run as runSql,
  type NotesDb,
  type NotesExecutor
} from './db';
import {
  getNote,
  getNotebook,
  pullChangesSince,
  pushChanges,
  upsertDevice
} from './repository';

const MIRROR_DEVICE = {
  id: 'server-db-mirror',
  name: 'Server DB mirror'
};

let syncInFlight: Promise<void> | null = null;

type Row = Record<string, unknown>;

type AuthUserRecord = {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  createdAt: string;
  updatedAt: string;
};

function asString(value: unknown): string {
  return String(value ?? '');
}

function toAuthUser(row: Row): AuthUserRecord {
  return {
    username: asString(row.username),
    passwordHash: asString(row.password_hash),
    passwordSalt: asString(row.password_salt),
    passwordIterations: Number(row.password_iterations),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function newerOrTieBreakingSource<T extends Note | Notebook>(source: T, target: T): boolean {
  const sourceTime = Date.parse(source.updatedAt);
  const targetTime = Date.parse(target.updatedAt);
  if (Number.isFinite(sourceTime) && Number.isFinite(targetTime) && sourceTime !== targetTime) {
    return sourceTime > targetTime;
  }

  if (source.version !== target.version) return source.version > target.version;
  return source.deviceId.localeCompare(target.deviceId) >= 0;
}

function authCredentialsDiffer(source: AuthUserRecord, target: AuthUserRecord): boolean {
  return (
    source.passwordHash !== target.passwordHash ||
    source.passwordSalt !== target.passwordSalt ||
    source.passwordIterations !== target.passwordIterations
  );
}

function authUsersDiffer(source: AuthUserRecord, target: AuthUserRecord): boolean {
  return (
    authCredentialsDiffer(source, target) ||
    source.createdAt !== target.createdAt ||
    source.updatedAt !== target.updatedAt
  );
}

function newerAuthUser(source: AuthUserRecord, target: AuthUserRecord): boolean {
  const sourceTime = Date.parse(source.updatedAt);
  const targetTime = Date.parse(target.updatedAt);
  if (Number.isFinite(sourceTime) && Number.isFinite(targetTime) && sourceTime !== targetTime) {
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
  const rows = (await queryAll(db, 'SELECT * FROM users ORDER BY username ASC')) as Row[];
  return rows.map(toAuthUser);
}

async function getAuthUser(db: NotesExecutor, username: string): Promise<AuthUserRecord | null> {
  const row = (await queryOne(db, 'SELECT * FROM users WHERE username = ?', [username])) as Row | null;
  return row ? toAuthUser(row) : null;
}

async function putAuthUser(
  db: NotesExecutor,
  user: AuthUserRecord,
  revokeSessions: boolean
): Promise<void> {
  if (revokeSessions) {
    await runSql(db, 'DELETE FROM auth_sessions WHERE username = ?', [user.username]);
  }

  await runSql(
    db,
    `INSERT INTO users (
       username, password_hash, password_salt, password_iterations, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      user.username,
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

async function syncDevices(source: NotesDb, target: NotesDb): Promise<void> {
  const pulled = await pullChangesSince(source, null);
  for (const device of pulled.devices) {
    await upsertDevice(target, device);
  }
}

async function notebookChanges(source: NotesDb, target: NotesDb): Promise<PushRequestNotebookChange[]> {
  const pulled = await pullChangesSince(source, null);
  const changes: PushRequestNotebookChange[] = [];

  for (const notebook of pulled.notebooks) {
    const targetNotebook = await getNotebook(target, notebook.id);
    if (!targetNotebook || (recordsDiffer(notebook, targetNotebook) && newerOrTieBreakingSource(notebook, targetNotebook))) {
      changes.push({ record: notebook, baseVersion: targetNotebook?.version ?? 0 });
    }
  }

  return changes;
}

async function noteChanges(source: NotesDb, target: NotesDb): Promise<PushRequestNoteChange[]> {
  const pulled = await pullChangesSince(source, null);
  const changes: PushRequestNoteChange[] = [];

  for (const note of pulled.notes) {
    const targetNote = await getNote(target, note.id);
    if (!targetNote || (recordsDiffer(note, targetNote) && newerOrTieBreakingSource(note, targetNote))) {
      changes.push({ record: note, baseVersion: targetNote?.version ?? 0 });
    }
  }

  return changes;
}

type PushRequestNotebookChange = { record: Notebook; baseVersion: number };
type PushRequestNoteChange = { record: Note; baseVersion: number };

async function syncOneWay(source: NotesDb, target: NotesDb): Promise<void> {
  await syncUsers(source, target);
  await syncDevices(source, target);
  const notebooks = await notebookChanges(source, target);
  const notes = await noteChanges(source, target);
  if (!notebooks.length && !notes.length) return;

  await pushChanges(target, {
    device: MIRROR_DEVICE,
    notebooks,
    notes
  });
}

export async function syncDatabases(local: NotesDb, remote: NotesDb): Promise<void> {
  await syncOneWay(remote, local);
  await syncOneWay(local, remote);
  await syncOneWay(remote, local);
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
      await syncDatabases(local, remote);
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
