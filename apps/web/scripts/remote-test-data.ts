import { randomUUID } from 'node:crypto';
import type { Device, Note, Notebook } from '@author/schema';
import {
  encryptNoteFields,
  encryptNotebookFields,
  isCurrentEncryptedText,
  isCurrentFieldHash,
  keyMaterialFromPassword
} from '../src/lib/client/encryption';
import {
  all,
  get,
  openConfiguredDatabase,
  run,
  type NotesDb
} from '../src/lib/server/db';
import {
  authenticateUser,
  setUserPassword,
  updateUserProfile
} from '../src/lib/server/auth';
import { pushChanges, upsertDevice } from '../src/lib/server/repository';
import type { RemoteTestTarget } from '../src/lib/server/remote-test-target';

export const REMOTE_TEST_DEVICE_ID = 'author-remote-test-seed-device';
export const REMOTE_TEST_NOTE_PREFIX = 'author-remote-test-note';
export const REMOTE_TEST_NOTEBOOK_PREFIX = 'author-remote-test-notebook';
export const REMOTE_TEST_RUN_PREFIX = 'author-remote-test-run';

export interface SeedRemoteTestAccountResult {
  acceptedRecords: number;
  notebooks: Notebook[];
  notes: Note[];
}

export interface RemoteTestRunFixture {
  device: Device;
  note: Note;
  runId: string;
}

export async function openRemoteTestDatabase(
  target: Pick<RemoteTestTarget, 'databaseUrl' | 'authToken'>
): Promise<NotesDb> {
  return await openConfiguredDatabase({
    provider: 'turso',
    client: {
      url: target.databaseUrl,
      authToken: target.authToken
    }
  });
}

export async function seedRemoteTestAccount(
  db: NotesDb,
  target: Pick<RemoteTestTarget, 'username' | 'password' | 'email'>
): Promise<SeedRemoteTestAccountResult> {
  const username = target.username.trim().toLowerCase();
  const keyMaterial = await keyMaterialFromPassword(username, target.password);
  const now = new Date().toISOString();
  const device: Device = {
    id: REMOTE_TEST_DEVICE_ID,
    name: 'Author remote staging seed'
  };
  const notebooks: Notebook[] = [
    {
      id: `${REMOTE_TEST_NOTEBOOK_PREFIX}-inbox`,
      name: 'Remote Smoke Inbox',
      nameHash: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId: device.id,
      version: 1,
      syncStatus: 'synced'
    },
    {
      id: `${REMOTE_TEST_NOTEBOOK_PREFIX}-archive`,
      name: 'Remote Smoke Archive',
      nameHash: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId: device.id,
      version: 1,
      syncStatus: 'synced'
    }
  ];
  const notes: Note[] = [
    {
      id: `${REMOTE_TEST_NOTE_PREFIX}-baseline`,
      title: 'Remote smoke baseline',
      body: 'Seeded encrypted note for staging smoke tests.',
      titleHash: null,
      bodyHash: null,
      notebookIds: [notebooks[0].id],
      notebookId: notebooks[0].id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      trashedAt: null,
      deviceId: device.id,
      version: 1,
      syncStatus: 'synced'
    },
    {
      id: `${REMOTE_TEST_NOTE_PREFIX}-archive`,
      title: 'Remote smoke archive',
      body: 'A second seeded note keeps notebook joins honest.',
      titleHash: null,
      bodyHash: null,
      notebookIds: [notebooks[1].id],
      notebookId: notebooks[1].id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      trashedAt: null,
      deviceId: device.id,
      version: 1,
      syncStatus: 'synced'
    }
  ];

  const user = await setUserPassword(db, username, target.password);
  await updateUserProfile(db, user.username, user.displayName, target.email);
  await clearRemoteTestAccountData(db, user.username);
  await upsertDevice(db, device, undefined, user.username);

  const encryptedNotebooks = await Promise.all(
    notebooks.map((notebook) => encryptNotebookFields(notebook, keyMaterial))
  );
  const encryptedNotes = await Promise.all(
    notes.map((note) => encryptNoteFields(note, keyMaterial))
  );
  const result = await pushChanges(
    db,
    {
      device,
      notebooks: encryptedNotebooks.map((record) => ({
        record,
        baseVersion: 0
      })),
      notes: encryptedNotes.map((record) => ({ record, baseVersion: 0 }))
    },
    user.username
  );
  const verified = await authenticateUser(db, user.username, target.password);
  if (!verified) throw new Error('Seeded remote test user cannot authenticate');

  await assertSeededAccountIsCurrentOnly(db, user.username);

  return {
    acceptedRecords: result.accepted.length,
    notebooks,
    notes
  };
}

export function createRemoteTestRunFixture(
  username: string,
  runId = randomUUID()
): RemoteTestRunFixture {
  const safeRunId = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const now = new Date().toISOString();
  const device: Device = {
    id: `${REMOTE_TEST_RUN_PREFIX}-${safeRunId}-device`,
    name: 'Author remote staging smoke'
  };
  const note: Note = {
    id: `${REMOTE_TEST_RUN_PREFIX}-${safeRunId}-note`,
    title: `Remote smoke run ${safeRunId}`,
    body: `Encrypted staging smoke note for ${username} at ${now}`,
    titleHash: null,
    bodyHash: null,
    notebookIds: [],
    notebookId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending'
  };
  return { device, note, runId: safeRunId };
}

export async function cleanupRemoteTestRun(
  db: NotesDb,
  username: string,
  runId: string
): Promise<void> {
  const noteId = `${REMOTE_TEST_RUN_PREFIX}-${runId}-note`;
  const deviceId = `${REMOTE_TEST_RUN_PREFIX}-${runId}-device`;
  await run(
    db,
    'DELETE FROM note_versions WHERE owner_username = ? AND note_id = ?',
    [username, noteId]
  ).catch(() => {});
  await run(db, 'DELETE FROM notes WHERE owner_username = ? AND id = ?', [
    username,
    noteId
  ]).catch(() => {});
  await run(
    db,
    'DELETE FROM auth_sessions WHERE username = ? AND device_id = ?',
    [username, deviceId]
  ).catch(() => {});
  await run(
    db,
    `DELETE FROM entity_changes
     WHERE owner_username = ?
       AND entity_type = 'note'
       AND entity_id = ?`,
    [username, noteId]
  ).catch(() => {});
  await run(
    db,
    `DELETE FROM entity_tombstones
     WHERE owner_username = ?
       AND entity_type = 'note'
       AND entity_id = ?`,
    [username, noteId]
  ).catch(() => {});
  await run(db, 'DELETE FROM devices WHERE owner_username = ? AND id = ?', [
    username,
    deviceId
  ]).catch(() => {});
}

export async function assertNoCurrentOnlyBlockers(db: NotesDb): Promise<void> {
  const rows = await all(
    db,
    `SELECT 'notes.title' AS kind, COUNT(*) AS count FROM notes WHERE title LIKE 'enc:v1:%' OR title LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'notes.body' AS kind, COUNT(*) AS count FROM notes WHERE body LIKE 'enc:v1:%' OR body LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'notebooks.name' AS kind, COUNT(*) AS count FROM notebooks WHERE name LIKE 'enc:v1:%' OR name LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'note_versions.title' AS kind, COUNT(*) AS count FROM note_versions WHERE title LIKE 'enc:v1:%' OR title LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'note_versions.body' AS kind, COUNT(*) AS count FROM note_versions WHERE body LIKE 'enc:v1:%' OR body LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'notebook_versions.name' AS kind, COUNT(*) AS count FROM notebook_versions WHERE name LIKE 'enc:v1:%' OR name LIKE 'enc:v2:%'
     UNION ALL
     SELECT 'users.password_hash' AS kind, COUNT(*) AS count FROM users WHERE password_hash NOT LIKE 'argon2id:v1:%'`
  );
  const blockers = rows
    .map((row) => ({
      kind: String(row.kind),
      count: Number(row.count)
    }))
    .filter((row) => row.count > 0);
  if (blockers.length > 0) {
    throw new Error(
      `Remote test database has current-only blockers: ${blockers
        .map((row) => `${row.kind}=${row.count}`)
        .join(', ')}`
    );
  }
}

export async function assertStoredNoteIsEncrypted(
  db: NotesDb,
  username: string,
  noteId: string
): Promise<void> {
  const row = await get(
    db,
    `SELECT title, body, title_hash, body_hash
     FROM notes
     WHERE owner_username = ? AND id = ?`,
    [username, noteId]
  );
  if (!row) throw new Error(`Expected remote test note ${noteId} to exist`);
  if (
    !isCurrentEncryptedText(String(row.title)) ||
    !isCurrentEncryptedText(String(row.body)) ||
    !isCurrentFieldHash(String(row.title_hash)) ||
    !isCurrentFieldHash(String(row.body_hash))
  ) {
    throw new Error(`Remote test note ${noteId} is not current AES/hash data`);
  }
}

async function assertSeededAccountIsCurrentOnly(
  db: NotesDb,
  username: string
): Promise<void> {
  const row = await get(
    db,
    'SELECT password_hash FROM users WHERE username = ?',
    [username]
  );
  if (!String(row?.password_hash ?? '').startsWith('argon2id:v1:')) {
    throw new Error('Seeded remote test account is not Argon2id current-only');
  }
  await assertStoredNoteIsEncrypted(
    db,
    username,
    `${REMOTE_TEST_NOTE_PREFIX}-baseline`
  );
}

async function clearRemoteTestAccountData(
  db: NotesDb,
  ownerUsername: string
): Promise<void> {
  const args = [ownerUsername];
  await run(db, 'DELETE FROM note_versions WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notebook_versions WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notes WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notebooks WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM entity_tombstones WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM entity_changes WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM auth_sessions WHERE username = ?', args);
  await run(db, 'DELETE FROM devices WHERE owner_username = ?', args);
}
