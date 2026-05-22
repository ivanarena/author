import { createApiClient } from '../src/lib/client/api-client';
import {
  decryptNoteFields,
  encryptNoteFields,
  keyMaterialFromPassword
} from '../src/lib/client/encryption';
import {
  assertNoCurrentOnlyBlockers,
  assertStoredNoteIsEncrypted,
  cleanupRemoteTestRun,
  createRemoteTestRunFixture,
  openRemoteTestDatabase,
  REMOTE_TEST_NOTE_PREFIX,
  seedRemoteTestAccount
} from './remote-test-data';
import {
  assertSafeRemoteTestTarget,
  remoteTestTargetFromEnv
} from '../src/lib/server/remote-test-target';

function expectStatus(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const target = remoteTestTargetFromEnv(process.env, { requireApiUrl: true });
assertSafeRemoteTestTarget(target);

const db = await openRemoteTestDatabase(target);
const run = createRemoteTestRunFixture(
  target.username,
  process.env.AUTHOR_REMOTE_TEST_RUN_ID ?? process.env.GITHUB_RUN_ID
);

try {
  await assertNoCurrentOnlyBlockers(db);
  if (process.env.AUTHOR_REMOTE_TEST_SKIP_SEED !== 'true') {
    await seedRemoteTestAccount(db, target);
  }

  const api = createApiClient({ baseUrl: target.apiUrl ?? undefined });
  const health = await fetch(new URL('/api/health', target.apiUrl!).toString());
  expectStatus(health.ok, `Health check failed: ${health.status}`);

  const config = await api.loadConfig();
  expectStatus(config.signup.emailRequired, 'Signup email requirement changed');
  expectStatus(
    config.signup.emailAllowListRequired,
    'Signup allow-list requirement changed'
  );

  const login = await api.loginWithDevice({
    username: target.username,
    password: target.password,
    device: run.device
  });
  expectStatus(
    login.user.username === target.username,
    'Remote test login returned the wrong user'
  );

  const validated = await api.validateSession(login.token);
  expectStatus(validated.ok, 'Remote test session did not validate');
  const account = await api.loadAccount(login.token);
  expectStatus(
    account.user.email === target.email,
    'Remote test account email did not match seeded account'
  );

  const keyMaterial = await keyMaterialFromPassword(
    target.username,
    target.password
  );
  const initialPull = await api.pullSyncChanges(login.token, { since: null });
  const decryptedSeededNotes = await Promise.all(
    initialPull.notes.map((note) => decryptNoteFields(note, keyMaterial))
  );
  expectStatus(
    decryptedSeededNotes.some(
      (note) =>
        note.id === `${REMOTE_TEST_NOTE_PREFIX}-baseline` &&
        note.title === 'Remote smoke baseline'
    ),
    'Seeded encrypted note was not returned by remote pull'
  );

  const encryptedRunNote = await encryptNoteFields(run.note, keyMaterial);
  const pushed = await api.pushSyncChanges(login.token, {
    device: run.device,
    notebooks: [],
    notes: [{ record: encryptedRunNote, baseVersion: 0 }]
  });
  expectStatus(pushed.conflicts.length === 0, 'Fresh remote push conflicted');
  expectStatus(
    pushed.accepted.length === 1,
    'Fresh remote push was not accepted'
  );
  await assertStoredNoteIsEncrypted(db, target.username, run.note.id);

  const afterPush = await api.pullSyncChanges(login.token, { since: null });
  const decryptedAfterPush = await Promise.all(
    afterPush.notes.map((note) => decryptNoteFields(note, keyMaterial))
  );
  expectStatus(
    decryptedAfterPush.some(
      (note) => note.id === run.note.id && note.body === run.note.body
    ),
    'Remote pull did not return the pushed encrypted note'
  );

  const staleOverwrite = await encryptNoteFields(
    {
      ...run.note,
      body: `${run.note.body} stale overwrite`,
      updatedAt: new Date().toISOString(),
      version: 2
    },
    keyMaterial
  );
  const conflict = await api.pushSyncChanges(login.token, {
    device: run.device,
    notebooks: [],
    notes: [{ record: staleOverwrite, baseVersion: 0 }]
  });
  expectStatus(
    conflict.conflicts.length === 1,
    'Stale remote push did not produce a conflict'
  );
  expectStatus(
    conflict.accepted.length === 0,
    'Stale remote push was unexpectedly accepted'
  );

  console.log(
    `Remote staging smoke passed for ${target.username} against ${target.apiUrl}`
  );
} finally {
  await cleanupRemoteTestRun(db, target.username, run.runId);
  db.close();
}
