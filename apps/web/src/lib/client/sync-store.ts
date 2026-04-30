import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import { chooseConflictVersion, nextVersionAfter, recordsDiffer } from '@author/sync-spec';
import { localDb, type LocalNote, type LocalNotebook } from './db';
import { getOrCreateDevice, newId, nowIso } from './local-state';

export async function saveDevices(devices: Device[]): Promise<void> {
  if (!devices.length) return;
  await localDb.devices.bulkPut(devices);
}

export async function markAcceptedChanges(
  accepted: Array<{ entityType: 'note' | 'notebook'; id: string; version: number; updatedAt: string }>,
  syncedAt: string,
  pushed: Array<{
    entityType: 'note' | 'notebook';
    id: string;
    version: number;
    updatedAt: string;
  }> = []
): Promise<void> {
  const pushedByKey = new Map(pushed.map((change) => [`${change.entityType}:${change.id}`, change]));

  await localDb.transaction('rw', [localDb.notes, localDb.notebooks], async () => {
    for (const change of accepted) {
      if (change.entityType === 'note') {
        const note = await localDb.notes.get(change.id);
        if (note) {
          const pushedNote = pushedByKey.get(`note:${change.id}`);
          const stillMatchesPush =
            !pushedNote ||
            (note.version === pushedNote.version && note.updatedAt === pushedNote.updatedAt);
          await localDb.notes.put({
            ...note,
            version: stillMatchesPush ? change.version : note.version,
            syncStatus: stillMatchesPush ? 'synced' : 'pending',
            lastSyncedVersion: change.version,
            lastSyncedAt: syncedAt
          });
        }
      } else {
        const notebook = await localDb.notebooks.get(change.id);
        if (notebook) {
          const pushedNotebook = pushedByKey.get(`notebook:${change.id}`);
          const stillMatchesPush =
            !pushedNotebook ||
            (notebook.version === pushedNotebook.version &&
              notebook.updatedAt === pushedNotebook.updatedAt);
          await localDb.notebooks.put({
            ...notebook,
            version: stillMatchesPush ? change.version : notebook.version,
            syncStatus: stillMatchesPush ? 'synced' : 'pending',
            lastSyncedVersion: change.version,
            lastSyncedAt: syncedAt
          });
        }
      }
    }
  });
}

export async function saveConflict(
  conflict: SyncConflict<Note> | SyncConflict<Notebook>
): Promise<void> {
  const createdAt = nowIso();
  await localDb.conflicts.put({
    id: conflict.id,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    status: 'pending',
    createdAt,
    conflict
  });

  if (conflict.entityType === 'note') {
    const note = await localDb.notes.get(conflict.entityId);
    if (note) await localDb.notes.put({ ...note, syncStatus: 'conflict' });
  } else {
    const notebook = await localDb.notebooks.get(conflict.entityId);
    if (notebook) await localDb.notebooks.put({ ...notebook, syncStatus: 'conflict' });
  }
}

async function mergeRemoteNote(remote: Note, syncedAt: string): Promise<void> {
  const local = await localDb.notes.get(remote.id);
  const remoteLocal: LocalNote = {
    ...remote,
    syncStatus: 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notes.put(remoteLocal);
    return;
  }

  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(local, remote)
  ) {
    await saveConflict({
      id: newId(),
      entityType: 'note',
      entityId: remote.id,
      reason: 'remote_changed',
      local: {
        source: 'local',
        deviceId: local.deviceId,
        deviceName: (await getOrCreateDevice()).name,
        updatedAt: local.updatedAt,
        version: local.version,
        previewText: local.body.slice(0, 160) || 'Empty note',
        record: local
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: remote.deviceId,
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: remote.body.slice(0, 160) || 'Empty note',
        record: remote
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notes.put(remoteLocal);
  }
}

async function mergeRemoteNotebook(remote: Notebook, syncedAt: string): Promise<void> {
  const local = await localDb.notebooks.get(remote.id);
  const remoteLocal: LocalNotebook = {
    ...remote,
    syncStatus: 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notebooks.put(remoteLocal);
    return;
  }

  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(local, remote)
  ) {
    await saveConflict({
      id: newId(),
      entityType: 'notebook',
      entityId: remote.id,
      reason: 'remote_changed',
      local: {
        source: 'local',
        deviceId: local.deviceId,
        deviceName: (await getOrCreateDevice()).name,
        updatedAt: local.updatedAt,
        version: local.version,
        previewText: local.name,
        record: local
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: remote.deviceId,
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: remote.name,
        record: remote
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notebooks.put(remoteLocal);
  }
}

export async function mergeRemoteChanges(
  notes: Note[],
  notebooks: Notebook[],
  syncedAt: string
): Promise<void> {
  for (const notebook of notebooks) {
    await mergeRemoteNotebook(notebook, syncedAt);
  }

  for (const note of notes) {
    await mergeRemoteNote(note, syncedAt);
  }
}

export async function resolveConflict(
  conflictId: string,
  choice: 'keep-newer' | 'keep-older' | 'keep-local' | 'keep-remote' | 'duplicate-both'
): Promise<void> {
  const localConflict = await localDb.conflicts.get(conflictId);
  if (!localConflict || localConflict.status === 'resolved') return;

  const conflict = localConflict.conflict;
  const device = await getOrCreateDevice();
  const now = nowIso();

  if (choice === 'duplicate-both') {
    if (conflict.entityType === 'note') {
      const remote = conflict.remote.record as Note;
      const local = conflict.local.record as Note;
      await localDb.notes.put({
        ...remote,
        syncStatus: 'synced',
        lastSyncedVersion: remote.version,
        lastSyncedAt: now
      });
      await localDb.notes.put({
        ...local,
        id: newId(),
        title: local.title ? `${local.title} copy` : '',
        createdAt: now,
        updatedAt: now,
        deviceId: device.id,
        version: 1,
        syncStatus: 'pending',
        lastSyncedVersion: 0,
        lastSyncedAt: null
      });
    } else {
      const remote = conflict.remote.record as Notebook;
      const local = conflict.local.record as Notebook;
      await localDb.notebooks.put({
        ...remote,
        syncStatus: 'synced',
        lastSyncedVersion: remote.version,
        lastSyncedAt: now
      });
      await localDb.notebooks.put({
        ...local,
        id: newId(),
        name: `${local.name} copy`,
        createdAt: now,
        updatedAt: now,
        deviceId: device.id,
        version: 1,
        syncStatus: 'pending',
        lastSyncedVersion: 0,
        lastSyncedAt: null
      });
    }
  } else {
    if (conflict.entityType === 'note') {
      const noteConflict = conflict as SyncConflict<Note>;
      const selected = chooseConflictVersion(noteConflict, choice);
      const record = selected.record as Note;
      const isRemote = selected.source === 'remote';
      await localDb.notes.put({
        ...record,
        deviceId: isRemote ? record.deviceId : device.id,
        version: isRemote ? noteConflict.remote.version : nextVersionAfter(noteConflict.remote.version),
        syncStatus: isRemote ? 'synced' : 'pending',
        lastSyncedVersion: noteConflict.remote.version,
        lastSyncedAt: isRemote ? now : null
      });
    } else {
      const notebookConflict = conflict as SyncConflict<Notebook>;
      const selected = chooseConflictVersion(notebookConflict, choice);
      const record = selected.record as Notebook;
      const isRemote = selected.source === 'remote';
      await localDb.notebooks.put({
        ...record,
        deviceId: isRemote ? record.deviceId : device.id,
        version: isRemote
          ? notebookConflict.remote.version
          : nextVersionAfter(notebookConflict.remote.version),
        syncStatus: isRemote ? 'synced' : 'pending',
        lastSyncedVersion: notebookConflict.remote.version,
        lastSyncedAt: isRemote ? now : null
      });
    }
  }

  await localDb.conflicts.put({ ...localConflict, status: 'resolved' });
}
