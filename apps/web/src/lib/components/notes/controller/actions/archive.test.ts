import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNote } from '$lib/client/db';
import type { NotesArchiveActionController } from './archive';

const mocks = vi.hoisted(() => ({
  exportNotesMarkdownZip: vi.fn(),
  importNotesMarkdownFiles: vi.fn(),
  importNotesMarkdownSummary: vi.fn()
}));

vi.mock('$lib/client/store', () => ({
  exportNotesMarkdownZip: mocks.exportNotesMarkdownZip,
  importNotesMarkdownFiles: mocks.importNotesMarkdownFiles,
  importNotesMarkdownSummary: mocks.importNotesMarkdownSummary
}));

import {
  exportMarkdown,
  exportSelectedMarkdown,
  handleMarkdownImport,
  shareNote,
  startMarkdownImport
} from './archive';

function note(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    title: 'Imported',
    body: 'Plain text',
    notebookIds: [],
    notebookId: null,
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    deletedAt: null,
    trashedAt: null,
    isFavorite: false,
    deviceId: 'device-1',
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null,
    ...overrides
  };
}

function controller(
  overrides: Partial<NotesArchiveActionController> = {}
): NotesArchiveActionController {
  return {
    archiveOperation: null,
    importBanner: null,
    importMarkdownInput: null,
    isArchiveBusy: false,
    isImporting: false,
    notes: [],
    selectedNote: null,
    selectedNotes: [],
    syncMessage: '',
    titleValue: '',
    bodyValue: '',
    beginArchiveOperation: vi.fn(),
    downloadBlob: vi.fn(),
    endArchiveOperation: vi.fn(),
    flushPendingSave: vi.fn(),
    notify: vi.fn(),
    refresh: vi.fn(),
    selectNote: vi.fn(),
    shareNotePayload: vi.fn(async () => 'shared' as const),
    updateArchiveOperation: vi.fn(),
    yieldToUi: vi.fn(),
    ...overrides
  };
}

describe('archive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportNotesMarkdownZip.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'author-notes.zip',
      noteCount: 2
    });
    mocks.importNotesMarkdownFiles.mockResolvedValue({
      importedNotes: 1,
      importedNotebooks: 0,
      reusedNotebooks: 0,
      skippedNotes: 0,
      noteIds: ['note-1']
    });
    mocks.importNotesMarkdownSummary.mockReturnValue('Imported 1 note');
  });

  it('exports after flushing pending editor text and always ends the operation', async () => {
    const model = controller();

    await exportMarkdown(model);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(model.beginArchiveOperation).toHaveBeenCalledWith(
      'Exporting Markdown',
      'Collecting notes',
      16
    );
    expect(mocks.exportNotesMarkdownZip).toHaveBeenCalled();
    expect(model.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'author-notes.zip'
    );
    expect(model.syncMessage).toBe('Exported 2 notes');
    expect(model.notify).toHaveBeenCalledWith(
      'success',
      'Export complete',
      'Exported 2 notes'
    );
    expect(model.endArchiveOperation).toHaveBeenCalledWith();
  });

  it('surfaces export failures without leaving archive state open', async () => {
    mocks.exportNotesMarkdownZip.mockRejectedValueOnce(new Error('Disk full'));
    const model = controller();

    await exportMarkdown(model);

    expect(model.syncMessage).toBe('Disk full');
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'Export failed',
      'Disk full'
    );
    expect(model.endArchiveOperation).toHaveBeenCalledWith();
  });

  it('exports selected active notes as a Markdown archive', async () => {
    const model = controller({
      selectedNotes: [
        note({ id: 'note-1' }),
        note({ id: 'note-2' }),
        note({ id: 'trash', trashedAt: '2026-05-29T10:00:00.000Z' })
      ]
    });

    await exportSelectedMarkdown(model);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(model.beginArchiveOperation).toHaveBeenCalledWith(
      'Exporting selected notes',
      'Collecting notes',
      18
    );
    expect(mocks.exportNotesMarkdownZip).toHaveBeenCalledWith([
      'note-1',
      'note-2'
    ]);
    expect(model.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'author-notes.zip'
    );
    expect(model.syncMessage).toBe('Exported 2 selected notes');
    expect(model.endArchiveOperation).toHaveBeenCalledWith();
  });

  it('does not start selected export without active selected notes', async () => {
    const model = controller({
      selectedNotes: [
        note({ id: 'trash', trashedAt: '2026-05-29T10:00:00.000Z' })
      ]
    });

    await exportSelectedMarkdown(model);

    expect(mocks.exportNotesMarkdownZip).not.toHaveBeenCalled();
    expect(model.beginArchiveOperation).not.toHaveBeenCalled();
    expect(model.notify).toHaveBeenCalledWith(
      'info',
      'No notes selected',
      'Select notes to export.'
    );
  });

  it('shares the current editor text when sharing the selected note', async () => {
    const selected = note({ id: 'note-1', title: 'Saved', body: 'Saved body' });
    const model = controller({
      selectedNote: selected,
      titleValue: ' Current ',
      bodyValue: 'Current body',
      shareNotePayload: vi.fn(async () => 'copied' as const)
    });

    await shareNote(model, selected);

    expect(model.shareNotePayload).toHaveBeenCalledWith({
      title: 'Current',
      text: 'Current\n\nCurrent body'
    });
    expect(model.notify).toHaveBeenCalledWith(
      'success',
      'Note copied',
      'The note text was copied to the clipboard.'
    );
    expect(model.flushPendingSave).toHaveBeenCalled();
  });

  it('ignores share cancellation and reports share failures', async () => {
    const model = controller({
      shareNotePayload: vi.fn(async () => {
        throw new DOMException('Canceled', 'AbortError');
      })
    });

    await shareNote(model, note());

    expect(model.notify).not.toHaveBeenCalled();
    expect(model.flushPendingSave).toHaveBeenCalled();

    const failing = controller({
      shareNotePayload: vi.fn(async () => {
        throw new Error('No share target');
      })
    });
    await shareNote(failing, note());

    expect(failing.notify).toHaveBeenCalledWith(
      'error',
      'Share failed',
      'No share target'
    );
  });

  it('opens the hidden import picker only when archive work is idle', () => {
    const input = { click: vi.fn() };

    startMarkdownImport(
      controller({ importMarkdownInput: input as unknown as HTMLInputElement })
    );
    expect(input.click).toHaveBeenCalled();

    input.click.mockClear();
    startMarkdownImport(
      controller({
        isArchiveBusy: true,
        importMarkdownInput: input as unknown as HTMLInputElement
      })
    );
    expect(input.click).not.toHaveBeenCalled();
  });

  it('imports files, refreshes, selects the first imported note, and queues sync', async () => {
    const imported = note();
    const model = controller({
      notes: [imported],
      refresh: vi.fn(async () => undefined)
    });
    const input = {
      files: [
        new File(['# Imported'], 'Imported.md', { type: 'text/markdown' })
      ],
      value: 'picked'
    } as unknown as HTMLInputElement;

    await handleMarkdownImport(model, {
      currentTarget: input
    } as unknown as Event);

    expect(input.value).toBe('');
    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(model.beginArchiveOperation).toHaveBeenCalledWith(
      'Importing Markdown',
      'Reading folder',
      8
    );
    expect(mocks.importNotesMarkdownFiles).toHaveBeenCalledWith([
      expect.any(File)
    ]);
    expect(model.refresh).toHaveBeenCalled();
    expect(model.selectNote).toHaveBeenCalledWith(imported);
    expect(model.importBanner).toEqual({
      kind: 'success',
      title: 'Import succeeded',
      message: 'Imported 1 note'
    });
    expect(model.endArchiveOperation).toHaveBeenCalledWith(true);
  });

  it('records import errors and still resumes archive cleanup', async () => {
    mocks.importNotesMarkdownFiles.mockRejectedValueOnce(
      new Error('No Markdown notes')
    );
    const model = controller();
    const input = {
      files: [new File([''], 'empty.md')],
      value: 'picked'
    } as unknown as HTMLInputElement;

    await handleMarkdownImport(model, {
      currentTarget: input
    } as unknown as Event);

    expect(model.syncMessage).toBe('No Markdown notes');
    expect(model.importBanner).toEqual({
      kind: 'error',
      title: 'Import failed',
      message: 'No Markdown notes'
    });
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'Import failed',
      'No Markdown notes'
    );
    expect(model.endArchiveOperation).toHaveBeenCalledWith(true);
  });
});
