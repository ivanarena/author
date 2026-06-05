import type { Device } from '@author/schema';
import {
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNotebook
} from './db';
import { decryptConflictForDisplay } from './conflict-crypto';
import { decryptNoteFields, decryptNotebookFields } from './encryption';

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
  const decrypted = await Promise.all(
    notebooks.map((notebook) => decryptNotebookFields(notebook))
  );
  return decrypted
    .filter((notebook) => !notebook.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadPendingConflicts(): Promise<LocalConflict[]> {
  const conflicts = await localDb.conflicts
    .where('status')
    .equals('pending')
    .sortBy('createdAt');
  return await Promise.all(
    conflicts.map(async (conflict) => ({
      ...conflict,
      conflict: await decryptConflictForDisplay(conflict.conflict)
    }))
  );
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
