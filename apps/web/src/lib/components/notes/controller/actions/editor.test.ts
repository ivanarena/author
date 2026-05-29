import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
import type { NotesFilterId } from '../models';
import type { ContextMenuState, EditorSnapshot } from '../ui-types';
import type { NotesEditorActionController } from './editor';

const mocks = vi.hoisted(() => ({
  createBlankNote: vi.fn(),
  tick: vi.fn(),
  updateNoteContent: vi.fn()
}));

vi.mock('svelte', () => ({
  tick: mocks.tick
}));

vi.mock('$lib/client/store', () => ({
  createBlankNote: mocks.createBlankNote,
  updateNoteContent: mocks.updateNoteContent
}));

import {
  clearSensitiveWorkspace,
  clearPendingSave,
  flushPendingSave,
  handleEditorInput,
  openDraftNote,
  redoEditorHistory,
  restoreEditorRecovery,
  selectNote,
  undoEditorHistory
} from './editor';

class MemoryStorage {
  private values = new Map<string, string>();

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const recoveryKey = 'author-editor-recovery-v1';
const storage = new MemoryStorage();

function note(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    title: 'Draft',
    body: 'Body',
    notebookIds: [],
    notebookId: null,
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    deletedAt: null,
    trashedAt: null,
    deviceId: 'device-1',
    version: 1,
    syncStatus: 'synced',
    lastSyncedVersion: 1,
    lastSyncedAt: '2026-05-29T10:00:00.000Z',
    ...overrides
  };
}

function notebook(overrides: Partial<LocalNotebook> = {}): LocalNotebook {
  return {
    id: 'notebook-1',
    name: 'Work',
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    deletedAt: null,
    deviceId: 'device-1',
    version: 1,
    syncStatus: 'synced',
    lastSyncedVersion: 1,
    lastSyncedAt: '2026-05-29T10:00:00.000Z',
    ...overrides
  };
}

function contextMenu(): ContextMenuState {
  return null;
}

function controller(
  overrides: Partial<NotesEditorActionController> = {}
): NotesEditorActionController {
  const initialSnapshot: EditorSnapshot = { title: '', body: '' };
  return {
    bodyTextarea: null,
    bodyValue: '',
    canRedoEditor: false,
    canUndoEditor: false,
    conflicts: [] as LocalConflict[],
    contextMenu: contextMenu(),
    draftCreatePromise: null,
    editorSessionId: 0,
    filterId: 'all' as NotesFilterId,
    lastHistorySnapshot: initialSnapshot,
    notes: [],
    notebooks: [],
    pendingSaveNoteId: null,
    pendingSyncCount: 0,
    redoStack: [],
    saveTimer: null,
    selectedNote: null,
    selectedNoteIds: new Set<string>(),
    selectedNotebookMenuOpen: false,
    titleInput: null,
    titleValue: '',
    trash: [],
    undoStack: [],
    closeMenus: vi.fn(),
    closeNotebookMenus: vi.fn(),
    refresh: vi.fn(),
    scheduleSync: vi.fn(),
    ...overrides
  };
}

function inputEvent(value: string): Event {
  return {
    currentTarget: { value }
  } as unknown as Event;
}

describe('editor actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', storage);
    storage.clear();
    mocks.tick.mockResolvedValue(undefined);
    mocks.updateNoteContent.mockImplementation(
      async (id: string, title: string, body: string) =>
        note({
          id,
          title: title.trim(),
          body,
          syncStatus: 'pending',
          lastSyncedVersion: 1
        })
    );
    mocks.createBlankNote.mockImplementation(
      async ({
        title,
        body,
        notebookId
      }: {
        title: string;
        body: string;
        notebookId?: string | null;
      }) =>
        note({
          id: 'created-note',
          title: title.trim(),
          body,
          notebookId: notebookId ?? null,
          notebookIds: notebookId ? [notebookId] : [],
          syncStatus: 'pending',
          lastSyncedVersion: 0,
          lastSyncedAt: null
        })
    );
  });

  it('selects a note only after flushing pending editor text', async () => {
    const selected = note({ title: 'Selected', body: 'Text' });
    const model = controller({
      saveTimer: setTimeout(() => undefined, 1000),
      pendingSaveNoteId: 'old-note',
      titleValue: 'Unsaved',
      bodyValue: 'Text'
    });

    await selectNote(model, selected);

    expect(mocks.updateNoteContent).toHaveBeenCalledWith(
      'old-note',
      'Unsaved',
      'Text'
    );
    expect(model.selectedNote).toBe(selected);
    expect(model.titleValue).toBe('Selected');
    expect(model.bodyValue).toBe('Text');
    expect(model.closeMenus).toHaveBeenCalled();
    expect(model.closeNotebookMenus).toHaveBeenCalled();
  });

  it('records recovery text and flushes a pending edit to the selected note', async () => {
    const selected = note();
    const model = controller({
      selectedNote: selected,
      titleValue: selected.title,
      bodyValue: selected.body,
      lastHistorySnapshot: {
        title: selected.title,
        body: selected.body
      }
    });

    handleEditorInput(model, inputEvent('Body changed'), 'body');

    expect(model.bodyValue).toBe('Body changed');
    expect(model.selectedNote).toMatchObject({
      id: selected.id,
      body: 'Body changed',
      syncStatus: 'pending'
    });
    expect(model.pendingSaveNoteId).toBe(selected.id);
    expect(JSON.parse(localStorage.getItem(recoveryKey) ?? '{}')).toMatchObject(
      {
        noteId: selected.id,
        title: selected.title,
        body: 'Body changed'
      }
    );

    await flushPendingSave(model);

    expect(mocks.updateNoteContent).toHaveBeenCalledWith(
      selected.id,
      selected.title,
      'Body changed'
    );
    expect(model.saveTimer).toBeNull();
    expect(localStorage.getItem(recoveryKey)).toBeNull();
    expect(model.scheduleSync).toHaveBeenCalledWith(0);
  });

  it('restores unsaved draft recovery into a newly created local note', async () => {
    const created = note({
      id: 'created-note',
      title: 'Recovered',
      body: 'Still here',
      notebookId: 'notebook-1',
      notebookIds: ['notebook-1']
    });
    const model = controller({
      notes: [created],
      notebooks: [notebook()],
      refresh: vi.fn(async () => undefined)
    });
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        noteId: null,
        notebookId: 'notebook-1',
        title: 'Recovered',
        body: 'Still here',
        savedAt: '2026-05-29T10:10:00.000Z'
      })
    );

    await expect(restoreEditorRecovery(model)).resolves.toBe(true);

    expect(mocks.createBlankNote).toHaveBeenCalledWith({
      title: 'Recovered',
      body: 'Still here',
      notebookId: 'notebook-1'
    });
    expect(model.selectedNote).toMatchObject({ id: 'created-note' });
    expect(model.titleValue).toBe('Recovered');
    expect(model.bodyValue).toBe('Still here');
    expect(model.scheduleSync).toHaveBeenCalledWith(0);
    expect(localStorage.getItem(recoveryKey)).toBeNull();
  });

  it('keeps undo and redo snapshots plain text and schedules a save', () => {
    const model = controller({
      canUndoEditor: true,
      canRedoEditor: true,
      selectedNote: note(),
      titleValue: 'Second',
      bodyValue: 'Beta',
      lastHistorySnapshot: { title: 'Second', body: 'Beta' },
      undoStack: [{ title: 'First', body: 'Alpha' }]
    });

    undoEditorHistory(model);

    expect(model.titleValue).toBe('First');
    expect(model.bodyValue).toBe('Alpha');
    expect(model.redoStack).toEqual([{ title: 'Second', body: 'Beta' }]);
    expect(model.pendingSaveNoteId).toBe('note-1');

    redoEditorHistory(model);

    expect(model.titleValue).toBe('Second');
    expect(model.bodyValue).toBe('Beta');
    expect(model.undoStack.at(-1)).toEqual({ title: 'First', body: 'Alpha' });
    clearPendingSave(model);
  });

  it('clears local-only editing state when locking the workspace', () => {
    const model = controller({
      conflicts: [
        {
          id: 'conflict-1',
          entityType: 'note',
          entityId: 'note-1',
          status: 'pending',
          createdAt: '2026-05-29T10:00:00.000Z',
          conflict: {} as LocalConflict['conflict']
        }
      ],
      filterId: 'trash',
      notes: [note()],
      notebooks: [notebook()],
      pendingSyncCount: 3,
      selectedNote: note(),
      selectedNoteIds: new Set(['note-1']),
      titleValue: 'Secret',
      bodyValue: 'Secret body',
      trash: [note({ id: 'trashed', trashedAt: '2026-05-29T10:00:00.000Z' })]
    });
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        noteId: 'note-1',
        notebookId: null,
        title: 'Secret',
        body: 'Secret body',
        savedAt: '2026-05-29T10:00:00.000Z'
      })
    );

    clearSensitiveWorkspace(model);

    expect(model.notes).toEqual([]);
    expect(model.notebooks).toEqual([]);
    expect(model.trash).toEqual([]);
    expect(model.conflicts).toEqual([]);
    expect(model.selectedNote).toBeNull();
    expect(model.selectedNoteIds.size).toBe(0);
    expect(model.titleValue).toBe('');
    expect(model.bodyValue).toBe('');
    expect(model.filterId).toBe('all');
    expect(model.pendingSyncCount).toBe(0);
    expect(localStorage.getItem(recoveryKey)).toBeNull();
  });

  it('opens a blank draft without carrying pending recovery state', async () => {
    const model = controller({
      saveTimer: setTimeout(() => undefined, 1000),
      selectedNote: note(),
      titleValue: 'Old',
      bodyValue: 'Old body'
    });
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        noteId: 'note-1',
        notebookId: null,
        title: 'Old',
        body: 'Old body',
        savedAt: '2026-05-29T10:00:00.000Z'
      })
    );

    await openDraftNote(model);

    expect(model.selectedNote).toBeNull();
    expect(model.titleValue).toBe('');
    expect(model.bodyValue).toBe('');
    expect(model.saveTimer).toBeNull();
    expect(localStorage.getItem(recoveryKey)).toBeNull();
  });
});
