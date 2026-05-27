import type { LocalNote, LocalNotebook } from '$lib/client/db';
import { noteNotebookIds } from '$lib/client/note-utils';
import {
  assignNoteToNotebook,
  createNotebook,
  deleteNotebook,
  deleteNotePermanently,
  moveNoteToTrash,
  notebookNameExists,
  renameNotebook,
  restoreNote
} from '$lib/client/store';
import type { NotesFilterId } from '../models';

export interface NotesLibraryActionController {
  deletingNotebookId: string | null;
  filterId: NotesFilterId;
  linkingNoteId: string | null;
  loginOpen: boolean;
  newNotebookOpen: boolean;
  notebookError: string;
  notebookNameValue: string;
  notebooks: LocalNotebook[];
  notes: LocalNote[];
  renameNotebookError: string;
  renameNotebookValue: string;
  renamingNotebookId: string | null;
  selectedActiveNoteCount: number;
  selectedNote: LocalNote | null;
  selectedNoteIds: Set<string>;
  selectedNotebookMenuOpen: boolean;
  selectedNotes: LocalNote[];
  selectedTrashedNoteCount: number;
  trash: LocalNote[];
  visibleNotes: LocalNote[];

  clearSelectedNotes: () => void;
  closeContextMenu: () => void;
  flushPendingSave: () => Promise<void>;
  localNotebookNameExists: (name: string, excludeId?: string) => boolean;
  newNote: () => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (note: LocalNote) => Promise<void>;
}

export function toggleNoteSelection(
  controller: NotesLibraryActionController,
  note: LocalNote,
  selected: boolean
): void {
  const next = new Set(controller.selectedNoteIds);
  if (selected) {
    next.add(note.id);
  } else {
    next.delete(note.id);
  }
  controller.selectedNoteIds = next;
  controller.selectedNotebookMenuOpen = false;
}

export function toggleAllVisibleNotes(
  controller: NotesLibraryActionController,
  selected: boolean
): void {
  const next = new Set(controller.selectedNoteIds);
  for (const note of controller.visibleNotes) {
    if (selected) {
      next.add(note.id);
    } else {
      next.delete(note.id);
    }
  }
  controller.selectedNoteIds = next;
  controller.selectedNotebookMenuOpen = false;
}

export function clearSelectedNotes(
  controller: NotesLibraryActionController
): void {
  controller.selectedNoteIds = new Set();
  controller.selectedNotebookMenuOpen = false;
}

export function toggleSelectedNotebookMenu(
  controller: NotesLibraryActionController
): void {
  if (!controller.selectedActiveNoteCount) return;
  controller.selectedNotebookMenuOpen = !controller.selectedNotebookMenuOpen;
  controller.linkingNoteId = null;
  controller.closeContextMenu();
}

export function toggleNotebookMenuForNote(
  controller: NotesLibraryActionController,
  note: LocalNote
): void {
  if (note.trashedAt) return;
  controller.linkingNoteId =
    controller.linkingNoteId === note.id ? null : note.id;
  controller.selectedNotebookMenuOpen = false;
  controller.closeContextMenu();
}

export async function assignNotebookForSelected(
  controller: NotesLibraryActionController,
  notebookId: string | null
): Promise<void> {
  const notes = controller.selectedNotes.filter((note) => !note.trashedAt);
  if (!notes.length) return;
  const assigned =
    notebookId === null
      ? false
      : !notes.every((note) => noteNotebookIds(note).includes(notebookId));
  for (const note of notes) {
    await assignNoteToNotebook(note.id, notebookId, assigned);
  }
  controller.selectedNotebookMenuOpen = false;
  await controller.refresh();
}

export function selectedNotesHaveNotebook(
  controller: NotesLibraryActionController,
  notebookId: string | null
): boolean {
  const notes = controller.selectedNotes.filter((note) => !note.trashedAt);
  if (!notes.length) return false;
  if (notebookId === null)
    return notes.every((note) => noteNotebookIds(note).length === 0);
  return notes.every((note) => noteNotebookIds(note).includes(notebookId));
}

export async function trashSelectedNotes(
  controller: NotesLibraryActionController
): Promise<void> {
  const notes = controller.selectedNotes.filter((note) => !note.trashedAt);
  if (!notes.length) return;
  await controller.flushPendingSave();
  for (const note of notes) {
    await moveNoteToTrash(note.id);
  }
  const selectedNoteWasTrashed = Boolean(
    controller.selectedNote &&
    notes.some((note) => note.id === controller.selectedNote?.id)
  );
  controller.clearSelectedNotes();
  await controller.refresh();

  if (selectedNoteWasTrashed) {
    const next =
      controller.notes.find((candidate) => !candidate.trashedAt) ?? null;
    if (next) {
      await controller.selectNote(next);
    } else {
      await controller.newNote();
    }
  }
}

export async function restoreSelectedNotes(
  controller: NotesLibraryActionController
): Promise<void> {
  const notes = controller.selectedNotes.filter((note) => note.trashedAt);
  if (!notes.length) return;
  for (const note of notes) {
    await restoreNote(note.id);
  }
  const firstRestoredId = notes[0]?.id ?? null;
  controller.filterId = 'all';
  controller.clearSelectedNotes();
  await controller.refresh();
  const restored = firstRestoredId
    ? controller.notes.find((note) => note.id === firstRestoredId)
    : null;
  if (restored) await controller.selectNote(restored);
}

export async function deleteSelectedNotesPermanently(
  controller: NotesLibraryActionController
): Promise<void> {
  const notes = controller.selectedNotes.filter((note) => note.trashedAt);
  if (!notes.length) return;
  await controller.flushPendingSave();
  for (const note of notes) {
    await deleteNotePermanently(note.id);
  }
  const selectedNoteWasDeleted = Boolean(
    controller.selectedNote &&
    notes.some((note) => note.id === controller.selectedNote?.id)
  );
  controller.clearSelectedNotes();
  await controller.refresh();

  if (selectedNoteWasDeleted) {
    const next =
      controller.filterId === 'trash'
        ? (controller.trash[0] ?? null)
        : (controller.notes[0] ?? null);
    if (next) {
      await controller.selectNote(next);
    } else {
      await controller.newNote();
    }
  }
}

export async function contextCreateNotebookForNote(
  controller: NotesLibraryActionController,
  note: LocalNote,
  rawName: string
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return 'Name required';
  if (
    controller.localNotebookNameExists(name) ||
    (await notebookNameExists(name))
  ) {
    return 'Notebook already exists';
  }

  const notebook = await createNotebook(name);
  if (!notebook) return 'Notebook already exists';

  const updated = await assignNoteToNotebook(note.id, notebook.id, true);
  if (updated && controller.selectedNote?.id === note.id) {
    controller.selectedNote = updated;
  }
  controller.filterId = notebook.id;
  await controller.refresh();
  controller.closeContextMenu();
  return null;
}

export async function assignNotebookForNote(
  controller: NotesLibraryActionController,
  note: LocalNote,
  notebookId: string | null
): Promise<void> {
  const updated = await assignNoteToNotebook(
    note.id,
    notebookId,
    notebookId ? !noteNotebookIds(note).includes(notebookId) : false
  );
  if (updated && controller.selectedNote?.id === note.id) {
    controller.selectedNote = updated;
  }
  await controller.refresh();
}

export function toggleNewNotebookMenu(
  controller: NotesLibraryActionController
): void {
  controller.newNotebookOpen = !controller.newNotebookOpen;
  controller.loginOpen = false;
  controller.renamingNotebookId = null;
  controller.deletingNotebookId = null;
  controller.notebookNameValue = '';
  controller.notebookError = '';
}

export async function submitNewNotebookMenu(
  controller: NotesLibraryActionController
): Promise<void> {
  const name = controller.notebookNameValue.trim();
  if (!name) {
    controller.notebookError = 'Name required';
    return;
  }

  if (
    controller.localNotebookNameExists(name) ||
    (await notebookNameExists(name))
  ) {
    controller.notebookError = 'Notebook already exists';
    return;
  }

  const notebook = await createNotebook(name);
  if (notebook) {
    controller.filterId = notebook.id;
    if (controller.selectedNote && !controller.selectedNote.trashedAt) {
      const updated = await assignNoteToNotebook(
        controller.selectedNote.id,
        notebook.id,
        true
      );
      if (updated) controller.selectedNote = updated;
    }
    await controller.refresh();
    controller.newNotebookOpen = false;
    controller.notebookNameValue = '';
    controller.notebookError = '';
  } else {
    controller.notebookError = 'Notebook already exists';
  }
}

export function startRenameNotebook(
  controller: NotesLibraryActionController,
  notebook: LocalNotebook
): void {
  controller.renamingNotebookId = notebook.id;
  controller.deletingNotebookId = null;
  controller.newNotebookOpen = false;
  controller.loginOpen = false;
  controller.renameNotebookValue = notebook.name;
  controller.renameNotebookError = '';
}

export function cancelRenameNotebook(
  controller: NotesLibraryActionController
): void {
  controller.renamingNotebookId = null;
  controller.renameNotebookValue = '';
  controller.renameNotebookError = '';
}

export async function submitRenameNotebook(
  controller: NotesLibraryActionController,
  notebook: LocalNotebook
): Promise<void> {
  const name = controller.renameNotebookValue.trim();
  if (!name) {
    controller.renameNotebookError = 'Name required';
    return;
  }

  if (
    controller.localNotebookNameExists(name, notebook.id) ||
    (await notebookNameExists(name, notebook.id))
  ) {
    controller.renameNotebookError = 'Notebook already exists';
    return;
  }

  const updated = await renameNotebook(notebook.id, name);
  if (!updated) {
    controller.renameNotebookError = 'Notebook already exists';
    return;
  }

  await controller.refresh();
  controller.renamingNotebookId = null;
  controller.renameNotebookValue = '';
  controller.renameNotebookError = '';
}

export function askDeleteNotebook(
  controller: NotesLibraryActionController,
  notebook: LocalNotebook
): void {
  controller.deletingNotebookId = notebook.id;
  controller.renamingNotebookId = null;
  controller.newNotebookOpen = false;
  controller.loginOpen = false;
}

export function cancelDeleteNotebook(
  controller: NotesLibraryActionController
): void {
  controller.deletingNotebookId = null;
}

export async function confirmDeleteNotebook(
  controller: NotesLibraryActionController,
  notebook: LocalNotebook
): Promise<void> {
  const selectedNoteWasInNotebook = Boolean(
    controller.selectedNote &&
    !controller.selectedNote.trashedAt &&
    noteNotebookIds(controller.selectedNote).includes(notebook.id)
  );

  await deleteNotebook(notebook.id);

  if (controller.filterId === notebook.id) {
    controller.filterId = 'all';
  }

  controller.deletingNotebookId = null;
  await controller.refresh();

  if (selectedNoteWasInNotebook) {
    const next = controller.notes.find(
      (note) => note.id !== controller.selectedNote?.id
    );
    if (next) {
      await controller.selectNote(next);
    } else {
      await controller.newNote();
    }
  }
}

export async function trashNote(
  controller: NotesLibraryActionController,
  note: LocalNote
): Promise<void> {
  await moveNoteToTrash(note.id);
  await controller.refresh();

  if (controller.selectedNote?.id === note.id) {
    const next =
      controller.notes.find((candidate) => candidate.id !== note.id) ?? null;
    if (next) {
      await controller.selectNote(next);
    } else {
      await controller.newNote();
    }
  }
}

export async function restoreNoteFromRow(
  controller: NotesLibraryActionController,
  note: LocalNote
): Promise<void> {
  await restoreNote(note.id);
  controller.filterId = 'all';
  await controller.refresh();
  const restored = controller.notes.find(
    (candidate) => candidate.id === note.id
  );
  if (restored) await controller.selectNote(restored);
}

export async function deleteNotePermanentlyFromRow(
  controller: NotesLibraryActionController,
  note: LocalNote
): Promise<void> {
  if (!note.trashedAt) return;
  await controller.flushPendingSave();
  await deleteNotePermanently(note.id);
  const selectedNoteWasDeleted = controller.selectedNote?.id === note.id;
  controller.selectedNoteIds.delete(note.id);
  controller.selectedNoteIds = new Set(controller.selectedNoteIds);
  await controller.refresh();

  if (selectedNoteWasDeleted) {
    const next =
      controller.filterId === 'trash'
        ? (controller.trash.find((candidate) => candidate.id !== note.id) ??
          null)
        : (controller.notes[0] ?? null);
    if (next) {
      await controller.selectNote(next);
    } else {
      await controller.newNote();
    }
  }
}
