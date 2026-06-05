import {
  localDb,
  type LocalNote,
  type LocalNoteSnapshot,
  type LocalNoteSnapshotReason
} from './db';
import { decryptNoteFields, encryptNoteFields } from './encryption';
import { getOrCreateDevice, newId, nowIso } from './local-state';
import { noteNotebookIds, primaryNotebookId } from './note-utils';
import { isLocalOnlyRecord } from './entity-store-records';

const MAX_LOCAL_NOTE_SNAPSHOTS_PER_NOTE = 50;

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
    isFavorite: false,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null
  };

  await localDb.notes.put(await encryptNoteFields(note));
  return note;
}

export async function updateNoteContent(
  noteId: string,
  title: string,
  body: string
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return null;

  const plainNote = await decryptNoteFields(note);
  const trimmedTitle = title.trim();
  if (plainNote.title === trimmedTitle && plainNote.body === body) {
    return plainNote;
  }

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    title: trimmedTitle,
    body,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await recordLocalNoteSnapshot(note, 'edit');
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

export async function setNoteFavorite(
  noteId: string,
  isFavorite: boolean
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return note ?? null;
  if (Boolean(note.isFavorite) === isFavorite) {
    return decryptNoteFields(note);
  }

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    isFavorite,
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
  await recordLocalNoteSnapshot(note, 'trash');
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
  await recordLocalNoteSnapshot(note, 'restore');
  await localDb.notes.put({
    ...note,
    trashedAt: null,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function deleteNotePermanently(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return;

  await deleteLocalNoteSnapshots(noteId);
  if (isLocalOnlyRecord(note)) {
    await localDb.notes.delete(noteId);
    return;
  }

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    deletedAt: now,
    trashedAt: note.trashedAt ?? now,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function loadNoteSnapshots(
  noteId: string,
  limit = 20
): Promise<LocalNoteSnapshot[]> {
  const snapshots = await localDb.noteSnapshots
    .where('id')
    .equals(noteId)
    .toArray();
  const sorted = sortLocalNoteSnapshots(snapshots).slice(0, limit);
  return Promise.all(sorted.map((snapshot) => decryptNoteFields(snapshot)));
}

export async function restoreLatestNoteSnapshot(
  noteId: string
): Promise<LocalNote | null> {
  const [snapshot] = await loadNoteSnapshots(noteId, 1);
  if (!snapshot) return null;
  return restoreLoadedNoteSnapshot(noteId, snapshot);
}

export async function restoreNoteSnapshot(
  noteId: string,
  snapshotId: string
): Promise<LocalNote | null> {
  const storedSnapshot = await localDb.noteSnapshots.get(snapshotId);
  if (!storedSnapshot || storedSnapshot.id !== noteId) return null;
  const snapshot = await decryptNoteFields(storedSnapshot);
  return restoreLoadedNoteSnapshot(noteId, snapshot);
}

async function restoreLoadedNoteSnapshot(
  noteId: string,
  snapshot: LocalNoteSnapshot
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt || note.trashedAt) return null;

  const device = await getOrCreateDevice();
  const now = nowIso();
  const updated: LocalNote = {
    ...note,
    title: snapshot.title,
    body: snapshot.body,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await recordLocalNoteSnapshot(note, 'restore');
  await localDb.notes.put(await encryptNoteFields(updated));
  return updated;
}

async function recordLocalNoteSnapshot(
  note: LocalNote,
  reason: LocalNoteSnapshotReason
): Promise<void> {
  if (note.deletedAt) return;

  const savedAt = nowIso();
  const snapshot: LocalNoteSnapshot = {
    ...note,
    snapshotId: newId(),
    savedAt,
    reason
  };
  await localDb.noteSnapshots.put(await encryptNoteFields(snapshot));
  await pruneLocalNoteSnapshots(note.id);
}

async function pruneLocalNoteSnapshots(noteId: string): Promise<void> {
  const snapshots = await localDb.noteSnapshots
    .where('id')
    .equals(noteId)
    .toArray();
  const expired = sortLocalNoteSnapshots(snapshots).slice(
    MAX_LOCAL_NOTE_SNAPSHOTS_PER_NOTE
  );
  if (!expired.length) return;
  await localDb.noteSnapshots.bulkDelete(
    expired.map((snapshot) => snapshot.snapshotId)
  );
}

async function deleteLocalNoteSnapshots(noteId: string): Promise<void> {
  await localDb.noteSnapshots.where('id').equals(noteId).delete();
}

function sortLocalNoteSnapshots(
  snapshots: LocalNoteSnapshot[]
): LocalNoteSnapshot[] {
  return [...snapshots].sort(
    (a, b) =>
      b.savedAt.localeCompare(a.savedAt) ||
      b.snapshotId.localeCompare(a.snapshotId)
  );
}
