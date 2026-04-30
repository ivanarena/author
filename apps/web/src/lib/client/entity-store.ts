import type { Device } from '@author/schema';
import {
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNotebook
} from './db';
import {
  decryptNoteFields,
  encryptNoteFields,
  isEncryptedText,
  reencryptNoteFields
} from './encryption';
import {
  normalizeNotebookName,
  noteNotebookIds,
  primaryNotebookId
} from './note-utils';
import { getOrCreateDevice, newId, nowIso } from './local-state';

export async function createBlankNote(
  initial: { title?: string; body?: string; notebookId?: string | null } = {}
): Promise<LocalNote> {
  const device = await getOrCreateDevice();
  const now = nowIso();
  const notebookIds = initial.notebookId ? [initial.notebookId] : [];
  const note: LocalNote = {
    id: newId(),
    title: (initial.title ?? '').trim(),
    body: initial.body ?? '',
    notebookIds,
    notebookId: primaryNotebookId(notebookIds),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null
  };

  await localDb.notes.put(await encryptNoteFields(note));
  return note;
}

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

  await localDb.notebooks.put(notebook);
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
  if (notebook.name === trimmed) return notebook;

  const device = await getOrCreateDevice();
  const updated: LocalNotebook = {
    ...notebook,
    name: trimmed,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: notebook.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notebooks.put(updated);
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
      await localDb.notebooks.put({
        ...notebook,
        deletedAt: now,
        updatedAt: now,
        deviceId: device.id,
        version: notebook.version + 1,
        syncStatus: 'pending'
      });

      const assignedNotes = await localDb.notes.toArray();
      const updatedNotes = assignedNotes
        .filter(
          (note) =>
            !note.deletedAt && noteNotebookIds(note).includes(notebookId)
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

  const notebooks = await localDb.notebooks.toArray();
  return notebooks.some(
    (notebook) =>
      !notebook.deletedAt &&
      notebook.id !== excludeId &&
      normalizeNotebookName(notebook.name) === normalized
  );
}

export async function updateNoteContent(
  noteId: string,
  title: string,
  body: string
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return null;

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    title: title.trim(),
    body,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notes.put(await encryptNoteFields(updated));
  return updated;
}

export async function assignNoteToNotebook(
  noteId: string,
  notebookId: string | null,
  assigned: boolean
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return note ?? null;

  const currentIds = noteNotebookIds(note);
  const notebookIds = notebookId
    ? assigned
      ? currentIds.includes(notebookId)
        ? currentIds
        : [...currentIds, notebookId]
      : currentIds.filter((id) => id !== notebookId)
    : [];

  if (currentIds.join('\0') === notebookIds.join('\0'))
    return decryptNoteFields(note);

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    notebookIds,
    notebookId: primaryNotebookId(notebookIds),
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notes.put(updated);
  return decryptNoteFields(updated);
}

export async function moveNoteToTrash(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.trashedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    trashedAt: now,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function restoreNote(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || !note.trashedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    trashedAt: null,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function loadNotes(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  const decrypted = await Promise.all(
    notes.map((note) => decryptNoteFields(note))
  );
  return decrypted
    .filter((note) => !note.deletedAt && !note.trashedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadTrash(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  const decrypted = await Promise.all(
    notes.map((note) => decryptNoteFields(note))
  );
  return decrypted
    .filter((note) => !note.deletedAt && Boolean(note.trashedAt))
    .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
}

export async function loadNotebooks(): Promise<LocalNotebook[]> {
  const notebooks = await localDb.notebooks.toArray();
  return notebooks
    .filter((notebook) => !notebook.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadPendingConflicts(): Promise<LocalConflict[]> {
  return localDb.conflicts
    .where('status')
    .equals('pending')
    .sortBy('createdAt');
}

export async function loadDevices(): Promise<Device[]> {
  return localDb.devices.toArray();
}

export async function loadPendingSyncCount(): Promise<number> {
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').count(),
    localDb.notebooks.where('syncStatus').equals('pending').count()
  ]);
  return notes + notebooks;
}

export async function ensureLocalNotesEncrypted(): Promise<void> {
  const notes = await localDb.notes.toArray();
  const plaintextNotes = notes.filter(
    (note) => !isEncryptedText(note.title) || !isEncryptedText(note.body)
  );
  if (!plaintextNotes.length) return;

  await localDb.notes.bulkPut(
    await Promise.all(plaintextNotes.map((note) => encryptNoteFields(note)))
  );
}

export async function reencryptLocalNotes(
  previousMaterial: string,
  nextMaterial: string
): Promise<void> {
  if (previousMaterial === nextMaterial) return;

  const notes = await localDb.notes.toArray();
  if (!notes.length) return;

  await localDb.notes.bulkPut(
    await Promise.all(
      notes.map((note) =>
        reencryptNoteFields(note, previousMaterial, nextMaterial)
      )
    )
  );
}
