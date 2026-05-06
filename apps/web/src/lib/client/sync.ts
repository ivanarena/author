import type {
  AuthLoginResponse,
  AuthSignupRequest,
  PullRequest,
  PushRequest
} from '@author/api-types';
import { safeRevisionCursor } from '@author/sync-spec';
import {
  loginWithDevice,
  pullSyncChanges,
  pushSyncChanges,
  signupWithDevice
} from './api-client';
import { localDb } from './db';
import { hasStoredEncryptionKeyMaterial } from './encryption';
import {
  ensureLocalNotesEncrypted,
  getOrCreateDevice,
  markAcceptedChanges,
  mergeRemoteChanges,
  applyRemoteDeletes,
  saveDevices,
  saveConflict
} from './store';

const PUSH_BATCH_SIZE = 100;
const PULL_BATCH_SIZE = 500;

export {
  AuthError,
  SyncHttpError,
  changePassword,
  deleteAccount,
  loadAccount,
  loadSyncStatus,
  logout,
  updateAccount,
  validateSession
} from './api-client';

export async function runSync(
  token: string
): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  if (!hasStoredEncryptionKeyMaterial()) {
    throw new Error('Sign in again to sync encrypted notes');
  }

  const device = await getOrCreateDevice();
  await ensureLocalNotesEncrypted();
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').toArray(),
    localDb.notebooks.where('syncStatus').equals('pending').toArray()
  ]);

  const pendingNotes = notes.map((record) => ({
    record,
    baseVersion: record.lastSyncedVersion
  }));
  const pendingNotebooks = notebooks.map((record) => ({
    record,
    baseVersion: record.lastSyncedVersion
  }));

  let conflicts = 0;
  let pushed = 0;
  while (pendingNotes.length || pendingNotebooks.length) {
    const pushPayload: PushRequest = {
      device,
      notes: pendingNotes.splice(0, PUSH_BATCH_SIZE),
      notebooks: pendingNotebooks.splice(0, PUSH_BATCH_SIZE)
    };
    const pushResponse = await pushSyncChanges(token, pushPayload);
    pushed += pushPayload.notes.length + pushPayload.notebooks.length;
    await markAcceptedChanges(pushResponse.accepted, pushResponse.serverTime, [
      ...pushPayload.notes.map((change) => ({
        entityType: 'note' as const,
        id: change.record.id,
        version: change.record.version,
        updatedAt: change.record.updatedAt
      })),
      ...pushPayload.notebooks.map((change) => ({
        entityType: 'notebook' as const,
        id: change.record.id,
        version: change.record.version,
        updatedAt: change.record.updatedAt
      }))
    ]);
    for (const conflict of pushResponse.conflicts) {
      conflicts += 1;
      await saveConflict(conflict);
    }
  }

  const lastPulledAt =
    (await localDb.syncMeta.get('lastPulledAt'))?.value ?? null;
  const lastPulledRevisionValue = (
    await localDb.syncMeta.get('lastPulledRevision')
  )?.value;
  const storedRevision =
    lastPulledRevisionValue === undefined ? 0 : Number(lastPulledRevisionValue);
  const lastPulledRevision =
    Number.isSafeInteger(storedRevision) && storedRevision >= 0
      ? storedRevision
      : 0;
  let pullCursor = lastPulledRevision;
  let pulled = 0;
  let hasMore = true;
  while (hasMore) {
    const pullPayload: PullRequest = {
      since: lastPulledAt,
      sinceRevision: pullCursor,
      limit: PULL_BATCH_SIZE
    };
    const pullResponse = await pullSyncChanges(token, pullPayload);
    const nextPullCursor = safeRevisionCursor(
      pullResponse.serverRevision,
      pullCursor,
      Boolean(pullResponse.hasMore)
    );

    await saveDevices(pullResponse.devices);
    await applyRemoteDeletes(
      pullResponse.deletedNoteIds,
      pullResponse.deletedNotebookIds,
      pullResponse.deletedDeviceIds
    );
    await mergeRemoteChanges(
      pullResponse.notes,
      pullResponse.notebooks,
      pullResponse.serverTime
    );
    await localDb.syncMeta.put({
      key: 'lastPulledAt',
      value: pullResponse.serverTime
    });
    await localDb.syncMeta.put({
      key: 'lastPulledRevision',
      value: String(nextPullCursor)
    });
    pulled +=
      pullResponse.notes.length +
      pullResponse.notebooks.length +
      pullResponse.deletedNoteIds.length +
      pullResponse.deletedNotebookIds.length;
    hasMore = Boolean(pullResponse.hasMore);
    pullCursor = nextPullCursor;
  }

  return {
    pushed,
    pulled,
    conflicts
  };
}

export async function login(
  username: string,
  password: string
): Promise<AuthLoginResponse> {
  const device = await getOrCreateDevice();
  return await loginWithDevice({ username, password, device });
}

export async function signup(
  username: string,
  password: string,
  displayName: string | null = null
): Promise<AuthLoginResponse> {
  const device = await getOrCreateDevice();
  const body: AuthSignupRequest = {
    username,
    password,
    displayName,
    device
  };
  return await signupWithDevice(body);
}
