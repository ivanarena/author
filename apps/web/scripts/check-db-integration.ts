import { randomBytes, randomUUID } from 'node:crypto';
import {
  getLocalDatabaseConfig,
  getRemoteDatabaseConfig,
  shouldSyncRemoteDatabase
} from '../src/lib/server/config';
import { authenticateUser, createAuthSession, sessionFromToken, setUserPassword } from '../src/lib/server/auth';
import { openConfiguredDatabase, openDatabase, run, type NotesDb } from '../src/lib/server/db';
import { getNote, pullChangesSince, pushChanges } from '../src/lib/server/repository';
import { syncRemoteDatabase } from '../src/lib/server/remote-sync';
import type { Device, Note, Notebook } from '@author/schema';

function randomPassword(): string {
  return randomBytes(18).toString('base64url');
}

const localConfig = getLocalDatabaseConfig();
const remoteConfig = getRemoteDatabaseConfig();
const username = `db-check-${randomUUID().slice(0, 8)}`;
const password = randomPassword();
const device: Device = {
  id: `db-check-device-${randomUUID()}`,
  name: 'DB integration check'
};
const now = new Date().toISOString();
const notebook: Notebook = {
  id: `db-check-notebook-${randomUUID()}`,
  name: `DB check ${randomUUID().slice(0, 8)}`,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  deviceId: device.id,
  version: 1,
  syncStatus: 'pending'
};
const note: Note = {
  id: `db-check-note-${randomUUID()}`,
  title: 'DB integration check',
  body: `Round trip ${randomUUID()}`,
  notebookIds: [notebook.id],
  notebookId: notebook.id,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  trashedAt: null,
  deviceId: device.id,
  version: 1,
  syncStatus: 'pending'
};
const remoteDevice: Device = {
  id: `db-check-remote-device-${randomUUID()}`,
  name: 'DB integration remote check'
};
const remoteOnlyNote: Note = {
  ...note,
  id: `db-check-remote-note-${randomUUID()}`,
  title: 'DB remote reconciliation check',
  body: `Remote to local ${randomUUID()}`,
  notebookIds: [],
  notebookId: null,
  deviceId: remoteDevice.id
};

async function cleanupDb(target: NotesDb): Promise<void> {
  await run(target, 'DELETE FROM note_versions WHERE note_id IN (?, ?)', [note.id, remoteOnlyNote.id]).catch(() => {});
  await run(target, 'DELETE FROM notebook_versions WHERE notebook_id = ?', [notebook.id]).catch(() => {});
  await run(target, 'DELETE FROM notes WHERE id IN (?, ?)', [note.id, remoteOnlyNote.id]).catch(() => {});
  await run(target, 'DELETE FROM notebooks WHERE id = ?', [notebook.id]).catch(() => {});
  await run(target, 'DELETE FROM auth_sessions WHERE username = ?', [username]).catch(() => {});
  await run(target, 'DELETE FROM users WHERE username = ?', [username]).catch(() => {});
  await run(target, 'DELETE FROM devices WHERE id IN (?, ?)', [device.id, remoteDevice.id]).catch(() => {});
}

const db = await openDatabase();
let remote: NotesDb | null = null;

try {
  await setUserPassword(db, username, password);
  const user = await authenticateUser(db, username, password);
  if (!user) throw new Error('Created user could not authenticate');

  const session = await createAuthSession(db, user, null);
  const validated = await sessionFromToken(db, session.token);
  if (validated?.user.username !== username) throw new Error('Created session could not validate');

  const pushed = await pushChanges(db, {
    device,
    notebooks: [{ record: notebook, baseVersion: 0 }],
    notes: [{ record: note, baseVersion: 0 }]
  });
  if (pushed.accepted.length !== 2 || pushed.conflicts.length) {
    throw new Error('Push round trip was not accepted cleanly');
  }

  const pulled = await pullChangesSince(db, '0000-01-01T00:00:00.000Z');
  const pulledNote = pulled.notes.find((candidate) => candidate.id === note.id);
  const pulledNotebook = pulled.notebooks.find((candidate) => candidate.id === notebook.id);
  if (pulledNote?.body !== note.body || pulledNotebook?.name !== notebook.name) {
    throw new Error('Pull round trip did not return the pushed records');
  }

  if (remoteConfig && shouldSyncRemoteDatabase()) {
    await syncRemoteDatabase(db);
    remote = await openConfiguredDatabase(remoteConfig);

    const remotePulled = await pullChangesSince(remote, '0000-01-01T00:00:00.000Z');
    if (!remotePulled.notes.some((candidate) => candidate.id === note.id && candidate.body === note.body)) {
      throw new Error('Local-only record did not reconcile to the remote database');
    }

    const remotePushed = await pushChanges(remote, {
      device: remoteDevice,
      notebooks: [],
      notes: [{ record: remoteOnlyNote, baseVersion: 0 }]
    });
    if (remotePushed.accepted.length !== 1 || remotePushed.conflicts.length) {
      throw new Error('Remote-only push was not accepted cleanly');
    }

    await syncRemoteDatabase(db);
    const mirroredRemoteNote = await getNote(db, remoteOnlyNote.id);
    if (mirroredRemoteNote?.body !== remoteOnlyNote.body) {
      throw new Error('Remote-only record did not reconcile to the local database');
    }
  }

  console.log(
    `DB integration check passed for local SQLite at ${localConfig.filePath}${
      remoteConfig && shouldSyncRemoteDatabase() ? ' with Turso reconciliation' : ''
    }`
  );
} finally {
  await cleanupDb(db);
  if (remote) {
    await cleanupDb(remote);
    remote.close();
  }
  db.close();
}
