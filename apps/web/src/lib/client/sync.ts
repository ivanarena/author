import type {
  AccountResponse,
  AccountUpdateRequest,
  AuthLoginResponse,
  AuthSignupRequest,
  AuthValidateResponse,
  DeleteAccountRequest,
  PasswordChangeRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncStatusResponse
} from '@author/api-types';
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

export class AuthError extends Error {
  constructor(message = 'Login expired') {
    super(message);
    this.name = 'AuthError';
  }
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message = `Sync failed: ${status}`
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`
  };
}

async function responseError(
  response: Response,
  fallback: string
): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (response.status === 401) return new AuthError(body?.error ?? undefined);
  return new SyncHttpError(response.status, body?.error ?? fallback);
}

async function apiPost<TRequest, TResponse>(
  path: string,
  token: string,
  body: TRequest
): Promise<TResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await responseError(response, `Sync failed: ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

export async function validateSession(
  token: string
): Promise<AuthValidateResponse> {
  const response = await fetch('/api/auth/validate', {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Session check failed: ${response.status}`
    );
  }

  return (await response.json()) as AuthValidateResponse;
}

export async function loadSyncStatus(
  token: string
): Promise<SyncStatusResponse> {
  const response = await fetch('/api/sync/status', {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Sync status failed: ${response.status}`
    );
  }

  return (await response.json()) as SyncStatusResponse;
}

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
    const pushResponse = await apiPost<PushRequest, PushResponse>(
      '/api/sync/push',
      token,
      pushPayload
    );
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
    const pullResponse = await apiPost<
      { since: string | null; sinceRevision: number | null; limit: number },
      PullResponse
    >('/api/sync/pull', token, {
      since: lastPulledAt,
      sinceRevision: pullCursor,
      limit: PULL_BATCH_SIZE
    });
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
      value: String(pullResponse.serverRevision)
    });
    pulled +=
      pullResponse.notes.length +
      pullResponse.notebooks.length +
      pullResponse.deletedNoteIds.length +
      pullResponse.deletedNotebookIds.length;
    hasMore = Boolean(pullResponse.hasMore);
    pullCursor = pullResponse.serverRevision;
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
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ username, password, device })
  });

  if (!response.ok) {
    throw await responseError(response, 'Login failed');
  }

  return (await response.json()) as AuthLoginResponse;
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
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await responseError(response, 'Signup failed');
  }

  return (await response.json()) as AuthLoginResponse;
}

export async function loadAccount(token: string): Promise<AccountResponse> {
  const response = await fetch('/api/account', {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw await responseError(response, `Account failed: ${response.status}`);
  }

  return (await response.json()) as AccountResponse;
}

export async function updateAccount(
  token: string,
  body: AccountUpdateRequest
): Promise<AccountResponse> {
  const response = await fetch('/api/account', {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await responseError(response, `Account failed: ${response.status}`);
  }

  return (await response.json()) as AccountResponse;
}

export async function changePassword(
  token: string,
  body: PasswordChangeRequest
): Promise<AccountResponse> {
  return await apiPost<PasswordChangeRequest, AccountResponse>(
    '/api/account/password',
    token,
    body
  );
}

export async function logout(token: string): Promise<void> {
  await apiPost<Record<string, never>, { ok: true }>(
    '/api/auth/logout',
    token,
    {}
  );
}

export async function deleteAccount(
  token: string,
  body: DeleteAccountRequest
): Promise<void> {
  const response = await fetch('/api/account', {
    method: 'DELETE',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Delete account failed: ${response.status}`
    );
  }
}
