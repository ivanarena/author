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
  signupWithDevice,
  updateE2eeKeyring
} from './api-client';
import { localDb, type LocalNote, type LocalNotebook } from './db';
import {
  E2EE_KEYRING_UNLOCK_FAILED_MESSAGE,
  ENCRYPTION_DECRYPT_FAILED_MESSAGE,
  hasStoredEncryptionKeyMaterial,
  keyMaterialFromPassword,
  keyringMaterialFromWrapped,
  migratePasswordMaterialToAccountKeyring,
  prepareNewAccountKeyring,
  type E2eeRecoveryKit
} from './encryption';
import { recordDebugLog } from './debug-log';
import {
  absorbSameDevicePushConflict,
  ensureLocalNotesEncrypted,
  getOrCreateDevice,
  getOrCreateDeviceTrustSecret,
  markAcceptedChanges,
  mergeRemoteChanges,
  applyRemoteDeletes,
  repairSameDevicePendingConflicts,
  removeDeletedNotebookReferences,
  saveDevices,
  saveConflict
} from './store';

const PUSH_BATCH_SIZE = 20;
const PULL_BATCH_SIZE = 1000;
const LAST_PUSHED_DEVICE_SIGNATURE_KEY = 'lastPushedDeviceSignature';
const SYNC_LOCK_NAME = 'author-sync';
const SYNC_LOCK_STORAGE_KEY = 'author-sync-lock-v2';
const SYNC_LOCK_TTL_MS = 60_000;
const SYNC_LOCK_RETRY_MS = 250;
const SYNC_LOCK_WAIT_MS = 60_000;

type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>
  ): Promise<T>;
};

type SyncLease = {
  owner: string;
  expiresAt: number;
};

let activeFallbackLeaseOwner: string | null = null;

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

export type E2eeAuthLoginResponse = Omit<AuthLoginResponse, 'token'> & {
  token: string;
  encryptionKeyMaterial?: string;
  recoveryCode?: string;
  recoveryKit?: E2eeRecoveryKit;
};

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
    isFavorite: Boolean(record.isFavorite),
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
    Boolean(before.isFavorite) !== after.isFavorite ||
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

function deviceSignature(device: Device): string {
  return `${device.id}\0${device.name}`;
}

function isLocalOnlyDeleted(record: {
  deletedAt?: string | null;
  lastSyncedVersion?: number | null;
}): boolean {
  return safeBaseVersion(record) === 0 && Boolean(record.deletedAt);
}

async function rememberPushedDevice(device: Device): Promise<void> {
  await localDb.syncMeta.put({
    key: LAST_PUSHED_DEVICE_SIGNATURE_KEY,
    value: deviceSignature(device)
  });
}

export {
  AuthError,
  SyncHttpError,
  changePassword,
  deleteAccount,
  disableTotp,
  enableTotp,
  loadAccount,
  loadSyncStatus,
  logout,
  setupTotp,
  updateAccount,
  validateSession
} from './api-client';

export async function runSync(
  token: string,
  onProgress?: SyncProgressCallback
): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  return withSyncLock(() => runSyncUnlocked(token, onProgress));
}

async function runSyncUnlocked(
  token: string,
  onProgress?: SyncProgressCallback
): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  if (!hasStoredEncryptionKeyMaterial()) {
    throw new Error('Sign in again to sync encrypted notes');
  }

  onProgress?.({ phase: 'preparing' });
  const device = await getOrCreateDevice();
  await ensureLocalNotesEncrypted();
  await repairSameDevicePendingConflicts();
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').toArray(),
    localDb.notebooks.where('syncStatus').equals('pending').toArray()
  ]);

  const localOnlyDeletedNoteIds = notes
    .filter(isLocalOnlyDeleted)
    .map((record) => record.id);
  const localOnlyDeletedNotebookIds = notebooks
    .filter(isLocalOnlyDeleted)
    .map((record) => record.id);
  await Promise.all([
    localOnlyDeletedNoteIds.length
      ? localDb.notes.bulkDelete(localOnlyDeletedNoteIds)
      : undefined,
    localOnlyDeletedNotebookIds.length
      ? localDb.notebooks.bulkDelete(localOnlyDeletedNotebookIds)
      : undefined
  ]);

  const syncableNotes = notes.filter(
    (record) => !localOnlyDeletedNoteIds.includes(record.id)
  );
  const syncableNotebooks = notebooks.filter(
    (record) => !localOnlyDeletedNotebookIds.includes(record.id)
  );

  const preparedNotes = syncableNotes.map((record) =>
    preparePendingNote(record, device)
  );
  const preparedNotebooks = syncableNotebooks.map((record) =>
    preparePendingNotebook(record, device)
  );
  const repairedNotes = preparedNotes.filter((record, index) =>
    noteNeedsRepair(syncableNotes[index], record)
  );
  const repairedNotebooks = preparedNotebooks.filter((record, index) =>
    notebookNeedsRepair(syncableNotebooks[index], record)
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
  let noteBatchStart = 0;
  let notebookBatchStart = 0;
  const storedDeviceSignature =
    (await localDb.syncMeta.get(LAST_PUSHED_DEVICE_SIGNATURE_KEY))?.value ?? '';
  if (
    pendingNotes.length === 0 &&
    pendingNotebooks.length === 0 &&
    storedDeviceSignature !== deviceSignature(device)
  ) {
    onProgress?.({
      phase: 'pushing',
      pushed,
      total: totalPushCount,
      batchSize: 0
    });
    await assertActiveSyncLease();
    await pushSyncChanges(token, { device, notes: [], notebooks: [] });
    await assertActiveSyncLease();
    await rememberPushedDevice(device);
    onProgress?.({
      phase: 'pushing',
      pushed,
      total: totalPushCount,
      batchSize: 0
    });
  }
  while (
    noteBatchStart < pendingNotes.length ||
    notebookBatchStart < pendingNotebooks.length
  ) {
    const notebookBatchEnd = Math.min(
      notebookBatchStart + PUSH_BATCH_SIZE,
      pendingNotebooks.length
    );
    const noteSlots = PUSH_BATCH_SIZE - (notebookBatchEnd - notebookBatchStart);
    const noteBatchEnd = Math.min(
      noteBatchStart + noteSlots,
      pendingNotes.length
    );
    const pushPayload: PushRequest = {
      device,
      notes: pendingNotes.slice(noteBatchStart, noteBatchEnd),
      notebooks: pendingNotebooks.slice(notebookBatchStart, notebookBatchEnd)
    };
    noteBatchStart = noteBatchEnd;
    notebookBatchStart = notebookBatchEnd;
    const batchSize = pushPayload.notes.length + pushPayload.notebooks.length;
    onProgress?.({
      phase: 'pushing',
      pushed,
      total: totalPushCount,
      batchSize
    });
    await assertActiveSyncLease();
    const pushResponse = await pushSyncChanges(token, pushPayload);
    await assertActiveSyncLease();
    await rememberPushedDevice(device);
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
      if (
        await absorbSameDevicePushConflict(conflict, pushResponse.serverTime)
      ) {
        continue;
      }
      conflicts += 1;
      const pushed =
        conflict.entityType === 'note'
          ? pushPayload.notes.find(
              (change) => change.record.id === conflict.entityId
            )?.record
          : pushPayload.notebooks.find(
              (change) => change.record.id === conflict.entityId
            )?.record;
      await saveConflict(
        conflict,
        pushed
          ? { version: pushed.version, updatedAt: pushed.updatedAt }
          : undefined
      );
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
    await assertActiveSyncLease();
    const pullResponse = await pullSyncChanges(token, pullPayload);
    await assertActiveSyncLease();
    if (pullResponse.serverRevision < pullCursor && !resetPullCursor) {
      resetPullCursor = true;
      recordDebugLog({
        level: 'warn',
        source: 'Sync',
        message: 'Remote revision moved behind local cursor',
        detail: {
          localCursor: pullCursor,
          serverRevision: pullResponse.serverRevision
        }
      });
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
    const appliedRemoteDeletes = await applyRemoteDeletes(
      pullResponse.deletedNoteIds,
      pullResponse.deletedNotebookIds,
      pullResponse.deletedDeviceIds
    );
    await mergeRemoteChanges(
      pullResponse.notes,
      pullResponse.notebooks,
      pullResponse.serverTime
    );
    await removeDeletedNotebookReferences(
      appliedRemoteDeletes.deletedNotebookIds,
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

async function withSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = navigatorLocks();
  if (locks) {
    return locks.request(SYNC_LOCK_NAME, { mode: 'exclusive' }, operation);
  }

  return withStorageSyncLease(operation);
}

function navigatorLocks(): LockManagerLike | null {
  const locks = (
    globalThis.navigator as { locks?: LockManagerLike } | undefined
  )?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

async function withStorageSyncLease<T>(
  operation: () => Promise<T>
): Promise<T> {
  const owner = syncLeaseOwner();
  const waitUntil = Date.now() + SYNC_LOCK_WAIT_MS;
  while (!(await tryAcquireSyncLease(owner))) {
    if (Date.now() >= waitUntil) {
      throw new Error('Sync is already running in another tab');
    }
    await delay(SYNC_LOCK_RETRY_MS);
  }

  activeFallbackLeaseOwner = owner;
  const heartbeat = setInterval(
    () => {
      void refreshSyncLease(owner);
    },
    Math.max(1_000, Math.floor(SYNC_LOCK_TTL_MS / 3))
  );

  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    activeFallbackLeaseOwner = null;
    await releaseSyncLease(owner);
  }
}

async function tryAcquireSyncLease(owner: string): Promise<boolean> {
  return await localDb.transaction('rw', localDb.syncMeta, async () => {
    const now = Date.now();
    const current = parseSyncLease(
      (await localDb.syncMeta.get(SYNC_LOCK_STORAGE_KEY))?.value ?? null
    );
    if (current && current.owner !== owner && current.expiresAt > now) {
      return false;
    }
    await localDb.syncMeta.put({
      key: SYNC_LOCK_STORAGE_KEY,
      value: JSON.stringify({ owner, expiresAt: now + SYNC_LOCK_TTL_MS })
    });
    return true;
  });
}

async function refreshSyncLease(owner: string): Promise<void> {
  await localDb.transaction('rw', localDb.syncMeta, async () => {
    const current = parseSyncLease(
      (await localDb.syncMeta.get(SYNC_LOCK_STORAGE_KEY))?.value ?? null
    );
    if (current?.owner !== owner) return;
    await localDb.syncMeta.put({
      key: SYNC_LOCK_STORAGE_KEY,
      value: JSON.stringify({
        owner,
        expiresAt: Date.now() + SYNC_LOCK_TTL_MS
      })
    });
  });
}

async function releaseSyncLease(owner: string): Promise<void> {
  await localDb.transaction('rw', localDb.syncMeta, async () => {
    const current = parseSyncLease(
      (await localDb.syncMeta.get(SYNC_LOCK_STORAGE_KEY))?.value ?? null
    );
    if (current?.owner === owner) {
      await localDb.syncMeta.delete(SYNC_LOCK_STORAGE_KEY);
    }
  });
}

async function assertActiveSyncLease(): Promise<void> {
  const owner = activeFallbackLeaseOwner;
  if (!owner) return;
  const current = parseSyncLease(
    (await localDb.syncMeta.get(SYNC_LOCK_STORAGE_KEY))?.value ?? null
  );
  if (current?.owner !== owner || current.expiresAt <= Date.now()) {
    throw new Error('Sync lease was lost to another tab');
  }
}

function parseSyncLease(value: string | null): SyncLease | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SyncLease>;
    if (
      typeof parsed.owner !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }
    return { owner: parsed.owner, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function syncLeaseOwner(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function login(
  username: string,
  password: string | null,
  totpCode: string | null = null
): Promise<E2eeAuthLoginResponse> {
  const device = await getOrCreateDevice();
  const response = await loginWithDevice({
    username,
    password,
    totpCode,
    device,
    deviceTrustSecret: await getOrCreateDeviceTrustSecret()
  });
  if (!password?.trim()) return response;
  if (response.e2eeKeyring) {
    return {
      ...response,
      encryptionKeyMaterial: await unlockLoginKeyring(
        response.e2eeKeyring,
        response.user.username,
        password
      )
    };
  }

  const passwordMaterial = await keyMaterialFromPassword(
    response.user.username,
    password
  );
  const migrated = await migratePasswordMaterialToAccountKeyring(
    response.user.username,
    passwordMaterial
  );
  await updateE2eeKeyring(
    response.token,
    migrated.e2eeKeyring,
    password,
    response.e2eeKeyring ?? null
  );
  return {
    ...response,
    e2eeKeyring: migrated.e2eeKeyring,
    encryptionKeyMaterial: migrated.keyMaterial,
    recoveryCode: migrated.recoveryCode,
    recoveryKit: migrated.recoveryKit
  };
}

async function unlockLoginKeyring(
  e2eeKeyring: string,
  username: string,
  password: string
): Promise<string> {
  try {
    return await keyringMaterialFromWrapped(e2eeKeyring, username, password);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === ENCRYPTION_DECRYPT_FAILED_MESSAGE
    ) {
      throw new Error(E2EE_KEYRING_UNLOCK_FAILED_MESSAGE, { cause: error });
    }
    throw error;
  }
}

export async function signup(
  username: string,
  email: string,
  invitationCode: string,
  password: string
): Promise<E2eeAuthLoginResponse> {
  const device = await getOrCreateDevice();
  const keyring = await prepareNewAccountKeyring(username, password);
  const body: AuthSignupRequest = {
    username,
    email,
    invitationCode,
    password,
    e2eeKeyring: keyring.e2eeKeyring,
    device,
    deviceTrustSecret: await getOrCreateDeviceTrustSecret()
  };
  const response = await signupWithDevice(body);
  return {
    ...response,
    e2eeKeyring: keyring.e2eeKeyring,
    encryptionKeyMaterial: keyring.keyMaterial,
    recoveryCode: keyring.recoveryCode,
    recoveryKit: keyring.recoveryKit
  };
}
