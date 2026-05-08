import type {
  AuthLoginResponse,
  AuthSignupRequest,
  PullRequest,
  PushRequest
} from '@author/api-types';
import type { Device } from '@author/schema';
import { nextVersionAfter, safeRevisionCursor } from '@author/sync-spec';
import {
  loginWithDevice,
  pullSyncChanges,
  pushSyncChanges,
  signupWithDevice
} from './api-client';
import { localDb, type LocalNote, type LocalNotebook } from './db';
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

export type SyncProgress =
  | { phase: 'preparing' }
  | {
      phase: 'pushing';
      pushed: number;
      total: number;
      batchSize: number;
    }
  | {
      phase: 'pulling';
      pulled: number;
      hasMore: boolean;
      pageSize: number;
    };

export type SyncProgressCallback = (progress: SyncProgress) => void;

function safeBaseVersion(record: {
  lastSyncedVersion?: number | null;
}): number {
  const baseVersion = Number(record.lastSyncedVersion);
  return Number.isSafeInteger(baseVersion) && baseVersion >= 0
    ? baseVersion
    : 0;
}

function safePendingVersion(record: {
  version?: number | null;
  lastSyncedVersion?: number | null;
}): number {
  const version = Number(record.version);
  const baseVersion = safeBaseVersion(record);
  return Number.isSafeInteger(version) && version > baseVersion && version > 0
    ? version
    : nextVersionAfter(baseVersion);
}

function normalizedNotebookIds(record: LocalNote): string[] {
  const ids = Array.isArray(record.notebookIds) ? record.notebookIds : [];
  const normalized = [
    ...new Set(
      ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    )
  ];
  if (normalized.length > 0) return normalized;

  const notebookId = record.notebookId?.trim();
  return notebookId ? [notebookId] : [];
}

function preparePendingNote(record: LocalNote, device: Device): LocalNote {
  const notebookIds = normalizedNotebookIds(record);
  return {
    ...record,
    notebookIds,
    notebookId: notebookIds[0] ?? null,
    deletedAt: record.deletedAt ?? null,
    trashedAt: record.trashedAt ?? null,
    deviceId: device.id,
    version: safePendingVersion(record),
    syncStatus: 'pending',
    lastSyncedVersion: safeBaseVersion(record),
    lastSyncedAt: record.lastSyncedAt ?? null
  };
}

function preparePendingNotebook(
  record: LocalNotebook,
  device: Device
): LocalNotebook {
  return {
    ...record,
    deletedAt: record.deletedAt ?? null,
    deviceId: device.id,
    version: safePendingVersion(record),
    syncStatus: 'pending',
    lastSyncedVersion: safeBaseVersion(record),
    lastSyncedAt: record.lastSyncedAt ?? null
  };
}

function noteNeedsRepair(before: LocalNote, after: LocalNote): boolean {
  return (
    before.deviceId !== after.deviceId ||
    before.version !== after.version ||
    before.syncStatus !== after.syncStatus ||
    before.lastSyncedVersion !== after.lastSyncedVersion ||
    before.lastSyncedAt !== after.lastSyncedAt ||
    before.deletedAt !== after.deletedAt ||
    before.trashedAt !== after.trashedAt ||
    before.notebookId !== after.notebookId ||
    (before.notebookIds ?? []).join('\0') !== after.notebookIds.join('\0')
  );
}

function notebookNeedsRepair(
  before: LocalNotebook,
  after: LocalNotebook
): boolean {
  return (
    before.deviceId !== after.deviceId ||
    before.version !== after.version ||
    before.syncStatus !== after.syncStatus ||
    before.lastSyncedVersion !== after.lastSyncedVersion ||
    before.lastSyncedAt !== after.lastSyncedAt ||
    before.deletedAt !== after.deletedAt
  );
}

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
  token: string,
  onProgress?: SyncProgressCallback
): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  if (!hasStoredEncryptionKeyMaterial()) {
    throw new Error('Sign in again to sync encrypted notes');
  }

  onProgress?.({ phase: 'preparing' });
  const device = await getOrCreateDevice();
  await ensureLocalNotesEncrypted();
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').toArray(),
    localDb.notebooks.where('syncStatus').equals('pending').toArray()
  ]);

  const preparedNotes = notes.map((record) =>
    preparePendingNote(record, device)
  );
  const preparedNotebooks = notebooks.map((record) =>
    preparePendingNotebook(record, device)
  );
  const repairedNotes = preparedNotes.filter((record, index) =>
    noteNeedsRepair(notes[index], record)
  );
  const repairedNotebooks = preparedNotebooks.filter((record, index) =>
    notebookNeedsRepair(notebooks[index], record)
  );
  await Promise.all([
    repairedNotes.length > 0 ? localDb.notes.bulkPut(repairedNotes) : undefined,
    repairedNotebooks.length > 0
      ? localDb.notebooks.bulkPut(repairedNotebooks)
      : undefined
  ]);

  const pendingNotes = preparedNotes.map((record) => ({
    record,
    baseVersion: record.lastSyncedVersion
  }));
  const pendingNotebooks = preparedNotebooks.map((record) => ({
    record,
    baseVersion: record.lastSyncedVersion
  }));
  const totalPushCount = pendingNotes.length + pendingNotebooks.length;

  let conflicts = 0;
  let pushed = 0;
  while (pendingNotes.length || pendingNotebooks.length) {
    const pushPayload: PushRequest = {
      device,
      notes: pendingNotes.splice(0, PUSH_BATCH_SIZE),
      notebooks: pendingNotebooks.splice(0, PUSH_BATCH_SIZE)
    };
    const batchSize = pushPayload.notes.length + pushPayload.notebooks.length;
    onProgress?.({
      phase: 'pushing',
      pushed,
      total: totalPushCount,
      batchSize
    });
    const pushResponse = await pushSyncChanges(token, pushPayload);
    pushed += batchSize;
    onProgress?.({
      phase: 'pushing',
      pushed,
      total: totalPushCount,
      batchSize
    });
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

  let lastPulledAt =
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
  let resetPullCursor = false;
  while (hasMore) {
    onProgress?.({
      phase: 'pulling',
      pulled,
      hasMore: true,
      pageSize: 0
    });
    const pullPayload: PullRequest = {
      since: lastPulledAt,
      sinceRevision: pullCursor,
      limit: PULL_BATCH_SIZE
    };
    const pullResponse = await pullSyncChanges(token, pullPayload);
    if (pullResponse.serverRevision < pullCursor && !resetPullCursor) {
      resetPullCursor = true;
      pullCursor = 0;
      lastPulledAt = null;
      await localDb.syncMeta.put({ key: 'lastPulledRevision', value: '0' });
      await localDb.syncMeta.delete('lastPulledAt');
      continue;
    }
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
    onProgress?.({
      phase: 'pulling',
      pulled,
      hasMore,
      pageSize:
        pullResponse.notes.length +
        pullResponse.notebooks.length +
        pullResponse.deletedNoteIds.length +
        pullResponse.deletedNotebookIds.length
    });
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
