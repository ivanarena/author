import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import {
  chooseConflictVersion,
  nextVersionAfter,
  previewText,
  recordsDiffer
} from '@author/sync-spec';
import {
  decryptConflictForDisplay,
  encryptConflictForStorage
} from './conflict-crypto';
import { localDb, type LocalNote, type LocalNotebook } from './db';
import {
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE,
  decryptNoteFields,
  decryptNotebookFields,
  encryptNoteFields,
  encryptNotebookFields,
  isCurrentEncryptedText,
  isUnsupportedEncryptedText
} from './encryption';
import { getOrCreateDevice, newId, nowIso } from './local-state';

type ConflictChoice =
  | 'keep-newer'
  | 'keep-older'
  | 'keep-local'
  | 'keep-remote'
  | 'duplicate-both';

export async function saveDevices(devices: Device[]): Promise<void> {
  if (!devices.length) return;
  await localDb.devices.bulkPut(devices);
}

async function deviceName(deviceId: string): Promise<string> {
  return (await localDb.devices.get(deviceId))?.name ?? deviceId;
}

function canApplyRemoteDelete(record: { syncStatus: string }): boolean {
  return record.syncStatus !== 'pending' && record.syncStatus !== 'conflict';
}

async function remoteCameFromThisDevice(record: {
  deviceId: string;
}): Promise<boolean> {
  return record.deviceId === (await getOrCreateDevice()).id;
}

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

function normalizedNotebookIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function noteNotebookIds(
  note: Pick<LocalNote, 'notebookId' | 'notebookIds'>
): string[] {
  const ids = note.notebookIds?.length
    ? note.notebookIds
    : note.notebookId
      ? [note.notebookId]
      : [];
  return normalizedNotebookIds(ids);
}

function primaryNotebookId(ids: string[]): string | null {
  return ids[0] ?? null;
}

function remappedNotebookIds(
  ids: string[],
  fromNotebookId: string,
  toNotebookId: string
): string[] {
  return normalizedNotebookIds(
    ids.map((id) => (id === fromNotebookId ? toNotebookId : id))
  );
}

function normalizedNotebookName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function notebookCopyName(
  baseName: string,
  notebooks: LocalNotebook[],
  excludedIds: Set<string>
): string {
  const base = baseName.trim() || 'Notebook';
  const taken = new Set(
    notebooks
      .filter(
        (notebook) => !notebook.deletedAt && !excludedIds.has(notebook.id)
      )
      .map((notebook) => normalizedNotebookName(notebook.name))
  );
  let candidate = `${base} copy`;
  let suffix = 2;
  while (taken.has(normalizedNotebookName(candidate))) {
    candidate = `${base} copy ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function remapLocalNoteNotebookReferences(
  fromNotebookId: string,
  toNotebookId: string,
  device: Device,
  updatedAt: string
): Promise<void> {
  const notes = await localDb.notes.toArray();
  const updates: LocalNote[] = [];
  for (const note of notes) {
    if (
      note.syncStatus === 'conflict' ||
      note.syncStatus === 'deleted' ||
      note.deletedAt
    ) {
      continue;
    }

    const notebookIds = noteNotebookIds(note);
    if (!notebookIds.includes(fromNotebookId)) continue;
    const nextNotebookIds = remappedNotebookIds(
      notebookIds,
      fromNotebookId,
      toNotebookId
    );
    if (nextNotebookIds.join('\0') === notebookIds.join('\0')) continue;

    updates.push({
      ...note,
      notebookIds: nextNotebookIds,
      notebookId: primaryNotebookId(nextNotebookIds),
      updatedAt,
      deviceId: device.id,
      version: safePendingVersion(note),
      syncStatus: 'pending',
      lastSyncedAt: null
    });
  }

  if (updates.length) await localDb.notes.bulkPut(updates);
}

async function uniqueNotebookCopyName(
  baseName: string,
  excludedIds: Set<string>
): Promise<string> {
  const notebooks = await Promise.all(
    (await localDb.notebooks.toArray()).map((notebook) =>
      decryptNotebookFields(notebook)
    )
  );
  return notebookCopyName(baseName, notebooks, excludedIds);
}

export async function applyRemoteDeletes(
  deletedNoteIds: string[] = [],
  deletedNotebookIds: string[] = [],
  deletedDeviceIds: string[] = []
): Promise<{ deletedNotebookIds: string[] }> {
  const noteIds = [...new Set(deletedNoteIds)].filter(Boolean);
  const notebookIds = [...new Set(deletedNotebookIds)].filter(Boolean);
  const deviceIds = [...new Set(deletedDeviceIds)].filter(Boolean);
  const notebookIdsForReferenceCleanup: string[] = [];
  if (!noteIds.length && !notebookIds.length && !deviceIds.length) {
    return { deletedNotebookIds: [] };
  }

  await localDb.transaction(
    'rw',
    [localDb.notes, localDb.notebooks, localDb.devices],
    async () => {
      for (const id of noteIds) {
        const note = await localDb.notes.get(id);
        if (note && canApplyRemoteDelete(note)) await localDb.notes.delete(id);
      }

      for (const id of notebookIds) {
        const notebook = await localDb.notebooks.get(id);
        if (!notebook) {
          notebookIdsForReferenceCleanup.push(id);
          continue;
        }

        if (canApplyRemoteDelete(notebook)) {
          await localDb.notebooks.delete(id);
          notebookIdsForReferenceCleanup.push(id);
        }
      }

      for (const id of deviceIds) {
        await localDb.devices.delete(id);
      }
    }
  );

  return { deletedNotebookIds: notebookIdsForReferenceCleanup };
}

export async function removeDeletedNotebookReferences(
  deletedNotebookIds: string[],
  updatedAt = nowIso()
): Promise<void> {
  const ids = [...new Set(deletedNotebookIds)].filter(Boolean);
  if (!ids.length) return;
  const device = await getOrCreateDevice();
  for (const id of ids) {
    await removeLocalNoteNotebookReferences(id, device, updatedAt);
  }
}

export async function markAcceptedChanges(
  accepted: Array<{
    entityType: 'note' | 'notebook';
    id: string;
    version: number;
    updatedAt: string;
  }>,
  syncedAt: string,
  pushed: Array<{
    entityType: 'note' | 'notebook';
    id: string;
    version: number;
    updatedAt: string;
  }> = []
): Promise<void> {
  const pushedByKey = new Map(
    pushed.map((change) => [`${change.entityType}:${change.id}`, change])
  );

  await localDb.transaction(
    'rw',
    [localDb.notes, localDb.notebooks],
    async () => {
      for (const change of accepted) {
        if (change.entityType === 'note') {
          const note = await localDb.notes.get(change.id);
          if (note) {
            const pushedNote = pushedByKey.get(`note:${change.id}`);
            const stillMatchesPush =
              !pushedNote ||
              (note.version === pushedNote.version &&
                note.updatedAt === pushedNote.updatedAt);
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
    }
  );
}

export async function saveConflict(
  conflict: SyncConflict<Note> | SyncConflict<Notebook>,
  pushed?: { version: number; updatedAt: string }
): Promise<void> {
  const createdAt = nowIso();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (conflict.entityType === 'note') {
      const current = await localDb.notes.get(conflict.entityId);
      const currentConflict: SyncConflict<Note> = current
        ? {
            ...(conflict as SyncConflict<Note>),
            local: {
              ...(conflict as SyncConflict<Note>).local,
              deviceId: current.deviceId,
              updatedAt: current.updatedAt,
              version: current.version,
              record: current
            }
          }
        : (conflict as SyncConflict<Note>);
      const storedConflict = await encryptConflictForStorage(currentConflict);
      const saved = await localDb.transaction(
        'rw',
        [localDb.notes, localDb.conflicts],
        async () => {
          const latest = await localDb.notes.get(conflict.entityId);
          if (
            current &&
            (!latest ||
              latest.version !== current.version ||
              latest.updatedAt !== current.updatedAt)
          ) {
            return false;
          }
          if (
            !current &&
            latest &&
            pushed &&
            (latest.version !== pushed.version ||
              latest.updatedAt !== pushed.updatedAt)
          ) {
            return false;
          }
          await localDb.conflicts.put({
            id: conflict.id,
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            status: 'pending',
            createdAt,
            conflict: storedConflict
          });
          if (latest) {
            await localDb.notes.put({ ...latest, syncStatus: 'conflict' });
          }
          return true;
        }
      );
      if (saved) return;
      continue;
    }

    const current = await localDb.notebooks.get(conflict.entityId);
    const currentConflict: SyncConflict<Notebook> = current
      ? {
          ...(conflict as SyncConflict<Notebook>),
          local: {
            ...(conflict as SyncConflict<Notebook>).local,
            deviceId: current.deviceId,
            updatedAt: current.updatedAt,
            version: current.version,
            record: current
          }
        }
      : (conflict as SyncConflict<Notebook>);
    const storedConflict = await encryptConflictForStorage(currentConflict);
    const saved = await localDb.transaction(
      'rw',
      [localDb.notebooks, localDb.conflicts],
      async () => {
        const latest = await localDb.notebooks.get(conflict.entityId);
        if (
          current &&
          (!latest ||
            latest.version !== current.version ||
            latest.updatedAt !== current.updatedAt)
        ) {
          return false;
        }
        if (
          !current &&
          latest &&
          pushed &&
          (latest.version !== pushed.version ||
            latest.updatedAt !== pushed.updatedAt)
        ) {
          return false;
        }
        await localDb.conflicts.put({
          id: conflict.id,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          status: 'pending',
          createdAt,
          conflict: storedConflict
        });
        if (latest) {
          await localDb.notebooks.put({ ...latest, syncStatus: 'conflict' });
        }
        return true;
      }
    );
    if (saved) return;
  }

  throw new Error(
    'Local record kept changing while its sync conflict was saved'
  );
}

export async function absorbSameDevicePushConflict(
  conflict: SyncConflict<Note> | SyncConflict<Notebook>,
  syncedAt: string
): Promise<boolean> {
  if (conflict.reason !== 'remote_changed') return false;
  if (conflict.remote.deviceId !== (await getOrCreateDevice()).id) {
    return false;
  }

  if (conflict.entityType === 'note') {
    const remote = conflict.remote.record as Note;
    const note = await localDb.notes.get(conflict.entityId);
    if (!note) return true;
    await localDb.notes.put({
      ...note,
      syncStatus: note.syncStatus === 'deleted' ? 'deleted' : 'pending',
      lastSyncedVersion: Math.max(note.lastSyncedVersion, remote.version),
      lastSyncedAt: syncedAt
    });
    return true;
  }

  const remote = conflict.remote.record as Notebook;
  const notebook = await localDb.notebooks.get(conflict.entityId);
  if (!notebook) return true;
  await localDb.notebooks.put({
    ...notebook,
    syncStatus: notebook.syncStatus === 'deleted' ? 'deleted' : 'pending',
    lastSyncedVersion: Math.max(notebook.lastSyncedVersion, remote.version),
    lastSyncedAt: syncedAt
  });
  return true;
}

export async function repairSameDevicePendingConflicts(
  syncedAt = nowIso()
): Promise<void> {
  const conflicts = await localDb.conflicts
    .where('status')
    .equals('pending')
    .toArray();
  for (const localConflict of conflicts) {
    if (await absorbSameDevicePushConflict(localConflict.conflict, syncedAt)) {
      await localDb.conflicts.put({ ...localConflict, status: 'resolved' });
    }
  }
}

async function mergeRemoteNote(remote: Note, syncedAt: string): Promise<void> {
  assertRemoteNoteDoesNotNeedLegacyMigration(remote);
  const local = await localDb.notes.get(remote.id);
  const remotePlain = await decryptNoteFields(remote);
  const remoteStored = await encryptNoteFields(remotePlain);
  const shouldRepublishEncryption = noteNeedsEncryptionRepublish(
    remote,
    remoteStored
  );
  const republishDevice = shouldRepublishEncryption
    ? await getOrCreateDevice()
    : null;
  const remoteLocal: LocalNote = {
    ...remoteStored,
    isFavorite: Boolean(remotePlain.isFavorite),
    deviceId: republishDevice?.id ?? remoteStored.deviceId,
    version: republishDevice
      ? nextVersionAfter(remote.version)
      : remoteStored.version,
    syncStatus: shouldRepublishEncryption ? 'pending' : 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notes.put(remoteLocal);
    return;
  }

  const localPlain = await decryptNoteFields(local);
  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(localPlain, remotePlain)
  ) {
    if (await remoteCameFromThisDevice(remote)) {
      if (remote.version > local.lastSyncedVersion) {
        await localDb.notes.put({
          ...local,
          lastSyncedVersion: remote.version,
          lastSyncedAt: syncedAt
        });
      }
      return;
    }

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
        previewText: previewText(localPlain),
        record: localPlain
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: await deviceName(remote.deviceId),
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: previewText(remotePlain),
        record: remotePlain
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notes.put(remoteLocal);
  }
}

function assertSupportedRemoteEncryptedText(value: string): void {
  if (isUnsupportedEncryptedText(value)) {
    throw new Error(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE);
  }
}

function assertRemoteNoteDoesNotNeedLegacyMigration(remote: Note): void {
  assertSupportedRemoteEncryptedText(remote.title);
  assertSupportedRemoteEncryptedText(remote.body);
}

function assertRemoteNotebookDoesNotNeedLegacyMigration(
  remote: Notebook
): void {
  assertSupportedRemoteEncryptedText(remote.name);
}

function noteNeedsEncryptionRepublish(remote: Note, stored: Note): boolean {
  return (
    !isCurrentEncryptedText(remote.title) ||
    !isCurrentEncryptedText(remote.body) ||
    (remote.titleHash ?? null) !== (stored.titleHash ?? null) ||
    (remote.bodyHash ?? null) !== (stored.bodyHash ?? null)
  );
}

async function mergeRemoteNotebook(
  remote: Notebook,
  syncedAt: string
): Promise<void> {
  assertRemoteNotebookDoesNotNeedLegacyMigration(remote);
  const local = await localDb.notebooks.get(remote.id);
  const remotePlain = await decryptNotebookFields(remote);
  const remoteStored = await encryptNotebookFields(remotePlain);
  const shouldRepublishEncryption = notebookNeedsEncryptionRepublish(
    remote,
    remoteStored
  );
  const republishDevice = shouldRepublishEncryption
    ? await getOrCreateDevice()
    : null;
  const remoteLocal: LocalNotebook = {
    ...remoteStored,
    deviceId: republishDevice?.id ?? remoteStored.deviceId,
    version: republishDevice
      ? nextVersionAfter(remote.version)
      : remoteStored.version,
    syncStatus: shouldRepublishEncryption ? 'pending' : 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notebooks.put(remoteLocal);
    return;
  }

  const localPlain = await decryptNotebookFields(local);
  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(localPlain, remotePlain)
  ) {
    if (await remoteCameFromThisDevice(remote)) {
      if (remote.version > local.lastSyncedVersion) {
        await localDb.notebooks.put({
          ...local,
          lastSyncedVersion: remote.version,
          lastSyncedAt: syncedAt
        });
      }
      return;
    }

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
        previewText: previewText(localPlain),
        record: localPlain
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: await deviceName(remote.deviceId),
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: previewText(remotePlain),
        record: remotePlain
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notebooks.put(remoteLocal);
  }
}

function notebookNeedsEncryptionRepublish(
  remote: Notebook,
  stored: Notebook
): boolean {
  return (
    !isCurrentEncryptedText(remote.name) ||
    (remote.nameHash ?? null) !== (stored.nameHash ?? null)
  );
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

  const deletedNotebookIds: string[] = [];
  for (const notebook of notebooks) {
    if (!notebook.deletedAt) continue;
    const local = await localDb.notebooks.get(notebook.id);
    if (local?.deletedAt && canApplyRemoteDelete(local)) {
      deletedNotebookIds.push(notebook.id);
    }
  }
  await removeDeletedNotebookReferences(deletedNotebookIds, syncedAt);
}

export async function resolveConflict(
  conflictId: string,
  choice: ConflictChoice
): Promise<void> {
  const localConflict = await localDb.conflicts.get(conflictId);
  if (!localConflict || localConflict.status === 'resolved') return;

  const conflict = await decryptConflictForDisplay(localConflict.conflict);
  const device = await getOrCreateDevice();
  const now = nowIso();

  if (
    conflict.entityType === 'notebook' &&
    conflict.reason === 'duplicate_name'
  ) {
    await resolveDuplicateNotebookNameConflict(
      conflict as SyncConflict<Notebook>,
      choice,
      device,
      now
    );
    await localDb.conflicts.put({ ...localConflict, status: 'resolved' });
    return;
  }

  if (choice === 'duplicate-both') {
    if (conflict.entityType === 'note') {
      const remote = conflict.remote.record as Note;
      const local = conflict.local.record as Note;
      await localDb.notes.put(
        await encryptNoteFields({
          ...remote,
          syncStatus: 'synced',
          lastSyncedVersion: remote.version,
          lastSyncedAt: now
        })
      );
      await localDb.notes.put(
        await encryptNoteFields({
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
        })
      );
    } else {
      const remote = conflict.remote.record as Notebook;
      const local = conflict.local.record as Notebook;
      const copyId = newId();
      await localDb.notebooks.put(
        await encryptNotebookFields({
          ...remote,
          syncStatus: 'synced',
          lastSyncedVersion: remote.version,
          lastSyncedAt: now
        })
      );
      await localDb.notebooks.put({
        ...(await encryptNotebookFields({
          ...local,
          id: copyId,
          name: `${local.name} copy`,
          createdAt: now,
          updatedAt: now,
          deviceId: device.id,
          version: 1,
          syncStatus: 'pending',
          lastSyncedVersion: 0,
          lastSyncedAt: null
        }))
      });
      await remapLocalNoteNotebookReferences(local.id, copyId, device, now);
    }
  } else {
    if (conflict.entityType === 'note') {
      const noteConflict = conflict as SyncConflict<Note>;
      const selected = chooseConflictVersion(noteConflict, choice);
      const record = selected.record as Note;
      const isRemote = selected.source === 'remote';
      await localDb.notes.put(
        await encryptNoteFields({
          ...record,
          deviceId: isRemote ? record.deviceId : device.id,
          version: isRemote
            ? noteConflict.remote.version
            : nextVersionAfter(noteConflict.remote.version),
          syncStatus: isRemote ? 'synced' : 'pending',
          lastSyncedVersion: noteConflict.remote.version,
          lastSyncedAt: isRemote ? now : null
        })
      );
    } else {
      const notebookConflict = conflict as SyncConflict<Notebook>;
      const selected = chooseConflictVersion(notebookConflict, choice);
      const record = selected.record as Notebook;
      const isRemote = selected.source === 'remote';
      await localDb.notebooks.put(
        await encryptNotebookFields({
          ...record,
          deviceId: isRemote ? record.deviceId : device.id,
          version: isRemote
            ? notebookConflict.remote.version
            : nextVersionAfter(notebookConflict.remote.version),
          syncStatus: isRemote ? 'synced' : 'pending',
          lastSyncedVersion: notebookConflict.remote.version,
          lastSyncedAt: isRemote ? now : null
        })
      );
      if (isRemote && record.deletedAt) {
        await removeLocalNoteNotebookReferences(record.id, device, now);
      }
    }
  }

  await localDb.conflicts.put({ ...localConflict, status: 'resolved' });
}

async function resolveDuplicateNotebookNameConflict(
  conflict: SyncConflict<Notebook>,
  choice: ConflictChoice,
  device: Device,
  now: string
): Promise<void> {
  const local = conflict.local.record as LocalNotebook;
  const remote = conflict.remote.record as LocalNotebook;
  const selected =
    choice === 'duplicate-both'
      ? conflict.local
      : chooseConflictVersion(conflict, choice);
  const keepRemote =
    choice !== 'duplicate-both' && selected.source === 'remote';

  await localDb.notebooks.put(
    await encryptNotebookFields({
      ...remote,
      syncStatus: 'synced',
      lastSyncedVersion: remote.version,
      lastSyncedAt: now
    })
  );

  if (keepRemote) {
    await remapLocalNoteNotebookReferences(local.id, remote.id, device, now);
    if (local.id !== remote.id) await localDb.notebooks.delete(local.id);
    return;
  }

  const copyId = newId();
  const copyName = await uniqueNotebookCopyName(
    local.name,
    new Set([local.id, remote.id, copyId])
  );
  await localDb.notebooks.put(
    await encryptNotebookFields({
      ...local,
      id: copyId,
      name: copyName,
      nameHash: null,
      createdAt: now,
      updatedAt: now,
      deviceId: device.id,
      version: 1,
      syncStatus: 'pending',
      lastSyncedVersion: 0,
      lastSyncedAt: null
    })
  );
  await remapLocalNoteNotebookReferences(local.id, copyId, device, now);
  if (local.id !== copyId) await localDb.notebooks.delete(local.id);
}

async function removeLocalNoteNotebookReferences(
  notebookId: string,
  device: Device,
  updatedAt: string
): Promise<void> {
  const notes = await localDb.notes.toArray();
  const updates: LocalNote[] = [];
  for (const note of notes) {
    if (
      note.syncStatus === 'conflict' ||
      note.syncStatus === 'deleted' ||
      note.deletedAt
    ) {
      continue;
    }

    const notebookIds = noteNotebookIds(note);
    if (!notebookIds.includes(notebookId)) continue;
    const nextNotebookIds = normalizedNotebookIds(
      notebookIds.filter((id) => id !== notebookId)
    );
    if (nextNotebookIds.join('\0') === notebookIds.join('\0')) continue;

    updates.push({
      ...note,
      notebookIds: nextNotebookIds,
      notebookId: primaryNotebookId(nextNotebookIds),
      updatedAt,
      deviceId: device.id,
      version: safePendingVersion(note),
      syncStatus: 'pending',
      lastSyncedAt: null
    });
  }

  if (updates.length) await localDb.notes.bulkPut(updates);
}
