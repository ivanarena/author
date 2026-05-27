import type { LocalNote } from '$lib/client/db';
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

export interface NotesArchiveActionController {
  archiveOperation: ArchiveOperation | null;
  importBanner: ImportBanner | null;
  importMarkdownInput: HTMLInputElement | null;
  isArchiveBusy: boolean;
  isImporting: boolean;
  notes: LocalNote[];
  syncMessage: string;

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
  updateArchiveOperation: (detail: string, progress: number) => void;
  yieldToUi: () => Promise<void>;
}

export async function exportMarkdown(
  controller: NotesArchiveActionController
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
    const archive = await exportNotesMarkdownZip();
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
