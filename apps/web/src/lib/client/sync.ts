import type { PullResponse, PushRequest, PushResponse } from '@author/api-types';
import { localDb } from './db';
import {
  getOrCreateDevice,
  markAcceptedChanges,
  mergeRemoteChanges,
  saveDevices,
  saveConflict
} from './store';

async function apiPost<TRequest, TResponse>(
  path: string,
  token: string,
  body: TRequest
): Promise<TResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

export async function runSync(token: string): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  const device = await getOrCreateDevice();
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').toArray(),
    localDb.notebooks.where('syncStatus').equals('pending').toArray()
  ]);

  const pushPayload: PushRequest = {
    device,
    notes: notes.map((record) => ({ record, baseVersion: record.lastSyncedVersion })),
    notebooks: notebooks.map((record) => ({ record, baseVersion: record.lastSyncedVersion }))
  };

  let conflicts = 0;
  if (pushPayload.notes.length || pushPayload.notebooks.length) {
    const pushResponse = await apiPost<PushRequest, PushResponse>('/api/sync/push', token, pushPayload);
    await markAcceptedChanges(pushResponse.accepted, pushResponse.serverTime);
    for (const conflict of pushResponse.conflicts) {
      conflicts += 1;
      await saveConflict(conflict);
    }
  }

  const since = (await localDb.syncMeta.get('lastPulledAt'))?.value ?? null;
  const pullResponse = await apiPost<{ since: string | null }, PullResponse>('/api/sync/pull', token, {
    since
  });
  await saveDevices(pullResponse.devices);
  await mergeRemoteChanges(pullResponse.notes, pullResponse.notebooks, pullResponse.serverTime);
  await localDb.syncMeta.put({ key: 'lastPulledAt', value: pullResponse.serverTime });

  return {
    pushed: pushPayload.notes.length + pushPayload.notebooks.length,
    pulled: pullResponse.notes.length + pullResponse.notebooks.length,
    conflicts
  };
}

export async function login(password: string): Promise<string> {
  const device = await getOrCreateDevice();
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ password, device })
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  const body = (await response.json()) as { token: string };
  return body.token;
}
