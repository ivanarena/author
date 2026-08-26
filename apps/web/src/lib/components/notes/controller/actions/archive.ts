import type { LocalNote } from '$lib/client/db';
import { noteDisplayTitle } from '$lib/client/note-utils';
import {
  exportNotesMarkdownZip,
  importNotesMarkdownFiles,
  importNotesMarkdownSummary
} from '$lib/client/store';
import type {
  AppNotification,
  ArchiveOperation,
  ImportBanner
} from '../models';

export interface ShareNotePayload {
  title: string;
  text: string;
}

export interface NotesArchiveActionController {
  archiveOperation: ArchiveOperation | null;
  importBanner: ImportBanner | null;
  importMarkdownInput: HTMLInputElement | null;
  isArchiveBusy: boolean;
  isImporting: boolean;
  notes: LocalNote[];
  selectedNote: LocalNote | null;
  selectedNotes: LocalNote[];
  syncMessage: string;
  titleValue: string;
  bodyValue: string;

  beginArchiveOperation: (
    label: string,
    detail: string,
    progress: number
  ) => void;
  downloadBlob: (blob: Blob, fileName: string) => void;
  endArchiveOperation: (syncAfter?: boolean) => void;
  flushPendingSave: () => Promise<void>;
  notify: (
    kind: AppNotification['kind'],
    title: string,
    message?: string
  ) => void;
  refresh: () => Promise<void>;
  selectNote: (note: LocalNote) => Promise<void>;
  shareNotePayload: (payload: ShareNotePayload) => Promise<'shared' | 'copied'>;
  updateArchiveOperation: (detail: string, progress: number) => void;
  yieldToUi: () => Promise<void>;
}

export async function exportMarkdown(
  controller: NotesArchiveActionController,
  notebookIds?: string[]
): Promise<void> {
  if (controller.isArchiveBusy) return;
  await controller.flushPendingSave();
  controller.beginArchiveOperation(
    'Exporting Markdown',
    'Collecting notes',
    16
  );
  try {
    await controller.yieldToUi();
    const archive = await exportNotesMarkdownZip(undefined, notebookIds);
    controller.updateArchiveOperation('Writing ZIP archive', 78);
    await controller.yieldToUi();
    controller.downloadBlob(archive.blob, archive.fileName);
    controller.updateArchiveOperation('Done', 100);
    controller.syncMessage = `Exported ${archive.noteCount} ${
      archive.noteCount === 1 ? 'note' : 'notes'
    }`;
    controller.notify('success', 'Export complete', controller.syncMessage);
    await controller.yieldToUi();
  } catch (error) {
    controller.syncMessage =
      error instanceof Error ? error.message : 'Export failed';
    controller.notify('error', 'Export failed', controller.syncMessage);
  } finally {
    controller.endArchiveOperation();
  }
}

export async function exportSelectedMarkdown(
  controller: NotesArchiveActionController
): Promise<void> {
  if (controller.isArchiveBusy) return;
  const notes = controller.selectedNotes.filter(
    (note) => !note.deletedAt && !note.trashedAt
  );
  if (!notes.length) {
    controller.notify('info', 'No notes selected', 'Select notes to export.');
    return;
  }

  await controller.flushPendingSave();
  controller.beginArchiveOperation(
    'Exporting selected notes',
    'Collecting notes',
    18
  );
  try {
    await controller.yieldToUi();
    const archive = await exportNotesMarkdownZip(notes.map((note) => note.id));
    controller.updateArchiveOperation('Writing ZIP archive', 78);
    await controller.yieldToUi();
    controller.downloadBlob(archive.blob, archive.fileName);
    controller.updateArchiveOperation('Done', 100);
    controller.syncMessage = `Exported ${archive.noteCount} selected ${
      archive.noteCount === 1 ? 'note' : 'notes'
    }`;
    controller.notify('success', 'Export complete', controller.syncMessage);
    await controller.yieldToUi();
  } catch (error) {
    controller.syncMessage =
      error instanceof Error ? error.message : 'Export failed';
    controller.notify('error', 'Export failed', controller.syncMessage);
  } finally {
    controller.endArchiveOperation();
  }
}

export async function shareNote(
  controller: NotesArchiveActionController,
  note: LocalNote
): Promise<void> {
  if (note.trashedAt || note.deletedAt) return;
  const currentNote = noteForSharing(controller, note);
  const title = noteDisplayTitle(currentNote);
  const text = noteShareText(currentNote, title);

  try {
    const result = await controller.shareNotePayload({ title, text });
    controller.notify(
      'success',
      result === 'shared' ? 'Note shared' : 'Note copied',
      result === 'shared'
        ? 'The note was sent to your share sheet.'
        : 'The note text was copied to the clipboard.'
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    controller.notify(
      'error',
      'Share failed',
      error instanceof Error ? error.message : 'Could not share note'
    );
  } finally {
    await controller.flushPendingSave();
  }
}

export function startMarkdownImport(
  controller: NotesArchiveActionController
): void {
  if (controller.isArchiveBusy) return;
  controller.importMarkdownInput?.click();
}

export async function handleMarkdownImport(
  controller: NotesArchiveActionController,
  event: Event
): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const files = input.files ? [...input.files] : [];
  input.value = '';
  if (!files.length || controller.isArchiveBusy) return;

  await controller.flushPendingSave();
  controller.beginArchiveOperation('Importing Markdown', 'Reading folder', 8);
  try {
    await controller.yieldToUi();
    controller.updateArchiveOperation(`Reading ${files.length} files`, 28);
    const result = await importNotesMarkdownFiles(files);
    controller.updateArchiveOperation('Adding notes', 62);
    await controller.yieldToUi();
    await controller.refresh();
    controller.updateArchiveOperation('Refreshing library', 86);

    const importedNote = controller.notes.find(
      (note) => note.id === result.noteIds[0]
    );
    if (importedNote) {
      await controller.selectNote(importedNote);
    }

    const message = importNotesMarkdownSummary(result);
    controller.syncMessage = message;
    controller.importBanner = {
      kind: 'success',
      title: 'Import succeeded',
      message
    };
    controller.notify('success', 'Import succeeded', message);
    controller.updateArchiveOperation('Done', 100);
    await controller.yieldToUi();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed';
    controller.syncMessage = message;
    controller.importBanner = {
      kind: 'error',
      title: 'Import failed',
      message
    };
    controller.notify('error', 'Import failed', message);
  } finally {
    controller.endArchiveOperation(true);
  }
}

function noteForSharing(
  controller: NotesArchiveActionController,
  note: LocalNote
): LocalNote {
  if (controller.selectedNote?.id !== note.id) return note;
  return {
    ...note,
    title: controller.titleValue.trim(),
    body: controller.bodyValue
  };
}

function noteShareText(note: LocalNote, title: string): string {
  const body = note.body.trim();
  if (!body) return title;
  if (!title || title === body) return body;
  return `${title}\n\n${body}`;
}
