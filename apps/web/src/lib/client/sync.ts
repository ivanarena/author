import type {
  AccountResponse,
  AccountUpdateRequest,
  AuthLoginResponse,
  AuthValidateResponse,
  DeleteAccountRequest,
  PasswordChangeRequest,
  PullResponse,
  PushRequest,
  PushResponse
} from '@author/api-types';
import { localDb } from './db';
import { hasStoredEncryptionKeyMaterial } from './encryption';
import {
  ensureLocalNotesEncrypted,
  getOrCreateDevice,
  markAcceptedChanges,
  mergeRemoteChanges,
  saveDevices,
  saveConflict
} from './store';

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

  const pushPayload: PushRequest = {
    device,
    notes: notes.map((record) => ({
      record,
      baseVersion: record.lastSyncedVersion
    })),
    notebooks: notebooks.map((record) => ({
      record,
      baseVersion: record.lastSyncedVersion
    }))
  };

  let conflicts = 0;
  if (pushPayload.notes.length || pushPayload.notebooks.length) {
    const pushResponse = await apiPost<PushRequest, PushResponse>(
      '/api/sync/push',
      token,
      pushPayload
    );
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
  const pullResponse = await apiPost<{ since: string | null }, PullResponse>(
    '/api/sync/pull',
    token,
    {
      since: lastPulledAt
    }
  );
  await saveDevices(pullResponse.devices);
  await mergeRemoteChanges(
    pullResponse.notes,
    pullResponse.notebooks,
    pullResponse.serverTime
  );
  await localDb.syncMeta.put({
    key: 'lastPulledAt',
    value: pullResponse.serverTime
  });

  return {
    pushed: pushPayload.notes.length + pushPayload.notebooks.length,
    pulled: pullResponse.notes.length + pullResponse.notebooks.length,
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
