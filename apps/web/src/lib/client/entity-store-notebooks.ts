import { localDb, type LocalNotebook } from './db';
import { decryptNotebookFields, encryptNotebookFields } from './encryption';
import { getOrCreateDevice, newId, nowIso } from './local-state';
import {
  normalizeNotebookName,
  noteNotebookIds,
  primaryNotebookId
} from './note-utils';
import { isLocalOnlyRecord } from './entity-store-records';

export async function createNotebook(
  name: string
): Promise<LocalNotebook | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (await notebookNameExists(trimmed)) return null;

  const device = await getOrCreateDevice();
  const now = nowIso();
  const notebook: LocalNotebook = {
    id: newId(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null
  };

  await localDb.notebooks.put(await encryptNotebookFields(notebook));
  return notebook;
}

export async function renameNotebook(
  notebookId: string,
  name: string
): Promise<LocalNotebook | null> {
  const trimmed = name.trim();
  if (!trimmed || (await notebookNameExists(trimmed, notebookId))) return null;

  const notebook = await localDb.notebooks.get(notebookId);
  if (!notebook || notebook.deletedAt) return null;
  const plainNotebook = await decryptNotebookFields(notebook);
  if (plainNotebook.name === trimmed) return plainNotebook;

  const device = await getOrCreateDevice();
  const updated: LocalNotebook = {
    ...plainNotebook,
    name: trimmed,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: notebook.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notebooks.put(await encryptNotebookFields(updated));
  return updated;
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  const notebook = await localDb.notebooks.get(notebookId);
  if (!notebook || notebook.deletedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.transaction(
    'rw',
    [localDb.notebooks, localDb.notes],
    async () => {
      if (isLocalOnlyRecord(notebook)) {
        await localDb.notebooks.delete(notebookId);
      } else {
        await localDb.notebooks.put({
          ...notebook,
          deletedAt: now,
          updatedAt: now,
          deviceId: device.id,
          version: notebook.version + 1,
          syncStatus: 'pending'
        });
      }

      const assignedNotes = await localDb.notes.toArray();
      const updatedNotes = assignedNotes
        .filter(
          (note) =>
            !note.deletedAt &&
            !note.trashedAt &&
            noteNotebookIds(note).includes(notebookId)
        )
        .map((note) => {
          const notebookIds = noteNotebookIds(note).filter(
            (id) => id !== notebookId
          );
          return {
            ...note,
            notebookIds,
            notebookId: primaryNotebookId(notebookIds),
            updatedAt: now,
            deviceId: device.id,
            version: note.version + 1,
            syncStatus: 'pending' as const
          };
        });

      if (updatedNotes.length) {
        await localDb.notes.bulkPut(updatedNotes);
      }
    }
  );
}

export async function notebookNameExists(
  name: string,
  excludeId?: string
): Promise<boolean> {
  const normalized = normalizeNotebookName(name);
  if (!normalized) return false;

  const notebooks = await Promise.all(
    (await localDb.notebooks.toArray()).map((notebook) =>
      decryptNotebookFields(notebook)
    )
  );
  return notebooks.some(
    (notebook) =>
      !notebook.deletedAt &&
      notebook.id !== excludeId &&
      normalizeNotebookName(notebook.name) === normalized
  );
}
