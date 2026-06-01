import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LocalNote,
  LocalNotebook,
  LocalNoteSnapshot
} from '$lib/client/db';
import type { NotesFilterId } from '../models';
import type { NotesLibraryActionController } from './library';

const mocks = vi.hoisted(() => ({
  assignNoteToNotebook: vi.fn(),
  createNotebook: vi.fn(),
  deleteNotebook: vi.fn(),
  deleteNotePermanently: vi.fn(),
  loadNoteSnapshots: vi.fn(),
  moveNoteToTrash: vi.fn(),
  notebookNameExists: vi.fn(),
  renameNotebook: vi.fn(),
  restoreLatestNoteSnapshot: vi.fn(),
  restoreNoteSnapshot: vi.fn(),
  restoreNote: vi.fn()
}));

vi.mock('$lib/client/store', () => ({
  assignNoteToNotebook: mocks.assignNoteToNotebook,
  createNotebook: mocks.createNotebook,
  deleteNotebook: mocks.deleteNotebook,
  deleteNotePermanently: mocks.deleteNotePermanently,
  loadNoteSnapshots: mocks.loadNoteSnapshots,
  moveNoteToTrash: mocks.moveNoteToTrash,
  notebookNameExists: mocks.notebookNameExists,
  renameNotebook: mocks.renameNotebook,
  restoreLatestNoteSnapshot: mocks.restoreLatestNoteSnapshot,
  restoreNoteSnapshot: mocks.restoreNoteSnapshot,
  restoreNote: mocks.restoreNote
}));

import {
  assignNotebookForNote,
  assignNotebookForSelected,
  clearSelectedNotes,
  closeNoteHistory,
  confirmDeleteNotebook,
  contextCreateNotebookForNote,
  deleteNotePermanentlyFromRow,
  deleteSelectedNotesPermanently,
  openNoteHistory,
  restorePreviousNoteVersion,
  restoreSelectedNotes,
  restoreSelectedHistorySnapshot,
  selectedNotesHaveNotebook,
  selectHistorySnapshot,
  submitNewNotebookMenu,
  submitRenameNotebook,
  toggleAllVisibleNotes,
  toggleNoteSelection,
  toggleSelectedNotebookMenu,
  trashSelectedNotes
} from './library';

function note(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    title: 'Note',
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

function snapshot(
  overrides: Partial<LocalNoteSnapshot> = {}
): LocalNoteSnapshot {
  return {
    ...note(),
    snapshotId: 'snapshot-1',
    savedAt: '2026-05-29T10:05:00.000Z',
    reason: 'edit',
    ...overrides
  };
}

function controller(
  overrides: Partial<NotesLibraryActionController> = {}
): NotesLibraryActionController {
  return {
    deletingNotebookId: null,
    filterId: 'all' as NotesFilterId,
    historyLoading: false,
    historyOpen: false,
    historySnapshots: [],
    linkingNoteId: null,
    loginOpen: false,
    newNotebookOpen: false,
    notebookError: '',
    notebookNameValue: '',
    notebooks: [],
    notes: [],
    renameNotebookError: '',
    renameNotebookValue: '',
    renamingNotebookId: null,
    selectedActiveNoteCount: 0,
    selectedHistorySnapshotId: null,
    selectedNote: null,
    selectedNoteIds: new Set<string>(),
    selectedNotebookMenuOpen: false,
    selectedNotes: [],
    selectedTrashedNoteCount: 0,
    trash: [],
    visibleNotes: [],
    clearSelectedNotes: vi.fn(),
    closeContextMenu: vi.fn(),
    flushPendingSave: vi.fn(),
    localNotebookNameExists: vi.fn(() => false),
    newNote: vi.fn(),
    notify: vi.fn(),
    refresh: vi.fn(),
    selectNote: vi.fn(),
    ...overrides
  };
}

describe('library actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assignNoteToNotebook.mockImplementation(
      async (id: string, notebookId: string | null, assigned: boolean) =>
        note({
          id,
          notebookId: assigned ? notebookId : null,
          notebookIds: assigned && notebookId ? [notebookId] : [],
          syncStatus: 'pending'
        })
    );
    mocks.createNotebook.mockResolvedValue(notebook());
    mocks.deleteNotebook.mockResolvedValue(undefined);
    mocks.deleteNotePermanently.mockResolvedValue(undefined);
    mocks.loadNoteSnapshots.mockResolvedValue([]);
    mocks.moveNoteToTrash.mockResolvedValue(undefined);
    mocks.notebookNameExists.mockResolvedValue(false);
    mocks.renameNotebook.mockResolvedValue(notebook({ name: 'Renamed' }));
    mocks.restoreLatestNoteSnapshot.mockResolvedValue(null);
    mocks.restoreNoteSnapshot.mockResolvedValue(null);
    mocks.restoreNote.mockResolvedValue(undefined);
  });

  it('keeps note selection stable and closes notebook menus', () => {
    const first = note({ id: 'note-1' });
    const second = note({ id: 'note-2' });
    const model = controller({
      selectedNoteIds: new Set(['note-1']),
      selectedNotebookMenuOpen: true,
      visibleNotes: [first, second]
    });

    toggleNoteSelection(model, second, true);
    expect(model.selectedNoteIds).toEqual(new Set(['note-1', 'note-2']));
    expect(model.selectedNotebookMenuOpen).toBe(false);

    toggleAllVisibleNotes(model, false);
    expect(model.selectedNoteIds.size).toBe(0);

    model.selectedNoteIds = new Set(['note-1']);
    model.selectedNotebookMenuOpen = true;
    clearSelectedNotes(model);
    expect(model.selectedNoteIds.size).toBe(0);
    expect(model.selectedNotebookMenuOpen).toBe(false);
  });

  it('toggles selected notebook assignments and reports aggregate selection state', async () => {
    const first = note({ id: 'note-1', notebookIds: ['notebook-1'] });
    const second = note({ id: 'note-2', notebookIds: [] });
    const model = controller({
      selectedNotes: [first, second],
      selectedActiveNoteCount: 2
    });

    expect(selectedNotesHaveNotebook(model, 'notebook-1')).toBe(false);
    toggleSelectedNotebookMenu(model);
    expect(model.selectedNotebookMenuOpen).toBe(true);
    expect(model.closeContextMenu).toHaveBeenCalled();

    await assignNotebookForSelected(model, 'notebook-1');

    expect(mocks.assignNoteToNotebook).toHaveBeenCalledWith(
      'note-1',
      'notebook-1',
      true
    );
    expect(mocks.assignNoteToNotebook).toHaveBeenCalledWith(
      'note-2',
      'notebook-1',
      true
    );
    expect(model.selectedNotebookMenuOpen).toBe(false);
    expect(model.refresh).toHaveBeenCalled();
  });

  it('moves selected active notes to trash and selects a safe next note', async () => {
    const selected = note({ id: 'note-1' });
    const next = note({ id: 'note-2' });
    const model = controller({
      notes: [next],
      selectedNote: selected,
      selectedNotes: [selected],
      clearSelectedNotes: vi.fn()
    });

    await trashSelectedNotes(model);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(mocks.moveNoteToTrash).toHaveBeenCalledWith('note-1');
    expect(model.clearSelectedNotes).toHaveBeenCalled();
    expect(model.refresh).toHaveBeenCalled();
    expect(model.selectNote).toHaveBeenCalledWith(next);
  });

  it('restores and permanently deletes selected trashed notes explicitly', async () => {
    const trashed = note({
      id: 'trashed',
      trashedAt: '2026-05-29T10:00:00.000Z'
    });
    const restored = note({ id: 'trashed', trashedAt: null });
    const model = controller({
      notes: [restored],
      selectedNotes: [trashed],
      clearSelectedNotes: vi.fn()
    });

    await restoreSelectedNotes(model);

    expect(mocks.restoreNote).toHaveBeenCalledWith('trashed');
    expect(model.filterId).toBe('all');
    expect(model.clearSelectedNotes).toHaveBeenCalled();
    expect(model.selectNote).toHaveBeenCalledWith(restored);

    await deleteSelectedNotesPermanently(
      controller({
        filterId: 'trash',
        selectedNote: trashed,
        selectedNotes: [trashed],
        trash: [],
        clearSelectedNotes: vi.fn()
      })
    );

    expect(mocks.deleteNotePermanently).toHaveBeenCalledWith('trashed');
  });

  it('creates notebooks only after local and remote duplicate checks pass', async () => {
    const selected = note({ id: 'note-1' });
    const created = notebook({ id: 'new-notebook', name: 'Ideas' });
    mocks.createNotebook.mockResolvedValueOnce(created);
    const model = controller({
      notebookNameValue: ' Ideas ',
      selectedNote: selected
    });

    await submitNewNotebookMenu(model);

    expect(mocks.notebookNameExists).toHaveBeenCalledWith('Ideas');
    expect(mocks.createNotebook).toHaveBeenCalledWith('Ideas');
    expect(mocks.assignNoteToNotebook).toHaveBeenCalledWith(
      selected.id,
      created.id,
      true
    );
    expect(model.filterId).toBe(created.id);
    expect(model.newNotebookOpen).toBe(false);
    expect(model.notebookNameValue).toBe('');

    const duplicate = controller({
      notebookNameValue: 'Ideas',
      localNotebookNameExists: vi.fn(() => true)
    });
    await submitNewNotebookMenu(duplicate);
    expect(duplicate.notebookError).toBe('Notebook already exists');
  });

  it('renames and deletes notebooks without leaving selected notes orphaned', async () => {
    const target = notebook({ id: 'notebook-1', name: 'Work' });
    const selected = note({ id: 'note-1', notebookIds: ['notebook-1'] });
    const next = note({ id: 'note-2' });
    const model = controller({
      filterId: 'notebook-1',
      notes: [selected, next],
      renameNotebookValue: ' Renamed ',
      selectedNote: selected
    });

    await submitRenameNotebook(model, target);

    expect(mocks.renameNotebook).toHaveBeenCalledWith('notebook-1', 'Renamed');
    expect(model.renamingNotebookId).toBeNull();
    expect(model.renameNotebookValue).toBe('');

    await confirmDeleteNotebook(model, target);

    expect(mocks.deleteNotebook).toHaveBeenCalledWith('notebook-1');
    expect(model.filterId).toBe('all');
    expect(model.deletingNotebookId).toBeNull();
    expect(model.selectNote).toHaveBeenCalledWith(next);
  });

  it('creates a notebook from a row context and updates the selected note', async () => {
    const selected = note({ id: 'note-1' });
    const created = notebook({ id: 'context-notebook', name: 'Contexts' });
    const updated = note({
      id: selected.id,
      notebookId: created.id,
      notebookIds: [created.id]
    });
    mocks.createNotebook.mockResolvedValueOnce(created);
    mocks.assignNoteToNotebook.mockResolvedValueOnce(updated);
    const model = controller({ selectedNote: selected });

    await expect(
      contextCreateNotebookForNote(model, selected, ' Contexts ')
    ).resolves.toBeNull();

    expect(model.selectedNote).toBe(updated);
    expect(model.filterId).toBe(created.id);
    expect(model.closeContextMenu).toHaveBeenCalled();
  });

  it('updates row-level assignments and permanent deletes only trashed notes', async () => {
    const selected = note({ id: 'note-1', notebookIds: [] });
    const assigned = note({ id: 'note-1', notebookIds: ['notebook-1'] });
    mocks.assignNoteToNotebook.mockResolvedValueOnce(assigned);
    const model = controller({
      selectedNote: selected,
      selectedNoteIds: new Set(['trashed'])
    });

    await assignNotebookForNote(model, selected, 'notebook-1');

    expect(mocks.assignNoteToNotebook).toHaveBeenCalledWith(
      'note-1',
      'notebook-1',
      true
    );
    expect(model.selectedNote).toBe(assigned);

    const active = note({ id: 'active' });
    await deleteNotePermanentlyFromRow(model, active);
    expect(mocks.deleteNotePermanently).not.toHaveBeenCalled();

    const trashed = note({
      id: 'trashed',
      trashedAt: '2026-05-29T10:00:00.000Z'
    });
    await deleteNotePermanentlyFromRow(
      controller({
        selectedNote: trashed,
        selectedNoteIds: new Set(['trashed']),
        trash: [],
        filterId: 'trash'
      }),
      trashed
    );
    expect(mocks.deleteNotePermanently).toHaveBeenCalledWith('trashed');
  });

  it('restores the latest local note snapshot from the row context', async () => {
    const selected = note({ id: 'note-1', title: 'Current' });
    const restored = note({
      id: 'note-1',
      title: 'Previous',
      syncStatus: 'pending'
    });
    mocks.restoreLatestNoteSnapshot.mockResolvedValueOnce(restored);
    const model = controller({
      selectedNote: selected,
      notes: [restored]
    });

    await restorePreviousNoteVersion(model, selected);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(mocks.restoreLatestNoteSnapshot).toHaveBeenCalledWith('note-1');
    expect(model.refresh).toHaveBeenCalled();
    expect(model.selectNote).toHaveBeenCalledWith(restored);
    expect(model.notify).toHaveBeenCalledWith(
      'success',
      'Previous version restored',
      'The restored text is saved locally and queued for sync.'
    );
  });

  it('reports when a note has no local snapshot to restore', async () => {
    const selected = note({ id: 'note-1' });
    const model = controller({ selectedNote: selected });

    await restorePreviousNoteVersion(model, selected);

    expect(mocks.restoreLatestNoteSnapshot).toHaveBeenCalledWith('note-1');
    expect(model.selectNote).not.toHaveBeenCalled();
    expect(model.notify).toHaveBeenCalledWith(
      'info',
      'No previous version',
      'No local note history is available for this note yet.'
    );
  });

  it('opens local note history and selects the newest snapshot', async () => {
    const selected = note({ id: 'note-1' });
    const newer = snapshot({
      snapshotId: 'snapshot-newer',
      title: 'Newer',
      savedAt: '2026-05-29T10:07:00.000Z'
    });
    const older = snapshot({
      snapshotId: 'snapshot-older',
      title: 'Older',
      savedAt: '2026-05-29T10:05:00.000Z'
    });
    mocks.loadNoteSnapshots.mockResolvedValueOnce([newer, older]);
    const model = controller({
      linkingNoteId: 'note-1',
      selectedNotebookMenuOpen: true
    });

    await openNoteHistory(model, selected);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(mocks.loadNoteSnapshots).toHaveBeenCalledWith('note-1', 50);
    expect(model.historyOpen).toBe(true);
    expect(model.historyLoading).toBe(false);
    expect(model.historySnapshots).toEqual([newer, older]);
    expect(model.selectedHistorySnapshotId).toBe('snapshot-newer');
    expect(model.selectedNotebookMenuOpen).toBe(false);
    expect(model.linkingNoteId).toBeNull();
    expect(model.closeContextMenu).toHaveBeenCalled();
  });

  it('closes local note history and reports load failures', async () => {
    const selected = note({ id: 'note-1' });
    mocks.loadNoteSnapshots.mockRejectedValueOnce(
      new Error('IndexedDB failed')
    );
    const model = controller();

    await openNoteHistory(model, selected);

    expect(model.historyOpen).toBe(false);
    expect(model.historyLoading).toBe(false);
    expect(model.historySnapshots).toEqual([]);
    expect(model.selectedHistorySnapshotId).toBeNull();
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'History unavailable',
      'IndexedDB failed'
    );
  });

  it('changes, restores, and closes selected local note history', async () => {
    const selected = note({ id: 'note-1', title: 'Current' });
    const restored = note({
      id: 'note-1',
      title: 'Historical',
      syncStatus: 'pending'
    });
    const first = snapshot({ snapshotId: 'snapshot-1' });
    const second = snapshot({ snapshotId: 'snapshot-2' });
    mocks.restoreNoteSnapshot.mockResolvedValueOnce(restored);
    const model = controller({
      historyOpen: true,
      historySnapshots: [first, second],
      notes: [restored],
      selectedHistorySnapshotId: first.snapshotId,
      selectedNote: selected
    });

    selectHistorySnapshot(model, second.snapshotId);
    await restoreSelectedHistorySnapshot(model, selected);

    expect(model.selectedHistorySnapshotId).toBeNull();
    expect(model.historyOpen).toBe(false);
    expect(model.historySnapshots).toEqual([]);
    expect(mocks.restoreNoteSnapshot).toHaveBeenCalledWith(
      'note-1',
      'snapshot-2'
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.selectNote).toHaveBeenCalledWith(restored);
    expect(model.notify).toHaveBeenCalledWith(
      'success',
      'Version restored',
      'The restored text is saved locally and queued for sync.'
    );

    model.historyOpen = true;
    model.historyLoading = true;
    model.historySnapshots = [first];
    model.selectedHistorySnapshotId = first.snapshotId;
    closeNoteHistory(model);
    expect(model.historyOpen).toBe(false);
    expect(model.historyLoading).toBe(false);
    expect(model.historySnapshots).toEqual([]);
    expect(model.selectedHistorySnapshotId).toBeNull();
  });
});
