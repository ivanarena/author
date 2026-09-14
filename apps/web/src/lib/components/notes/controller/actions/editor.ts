import { tick } from 'svelte';
import {
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNotebook
} from '$lib/client/db';
import { decryptText, encryptText } from '$lib/client/encryption';
import { createBlankNote, updateNoteContent } from '$lib/client/store';
import { pushEditorHistory, sameEditorSnapshot } from '../editor-history';
import type { NotesFilterId } from '../models';
import type { ContextMenuState, EditorSnapshot } from '../ui-types';

const EMPTY_NOTEBOOK_FILTERS = new Set<NotesFilterId>([
  'all',
  'favorites',
  'unfiled',
  'trash'
]);
const MAX_EDITOR_HISTORY = 120;
const EDITOR_RECOVERY_KEY = 'author-editor-recovery-v1';

interface EditorRecoverySnapshot {
  version: 2;
  noteId: string | null;
  notebookId: string | null;
  title: string;
  body: string;
  savedAt: string;
}

let editorRecoveryQueue: Promise<void> = Promise.resolve();

export interface NotesEditorActionController {
  bodyTextarea: HTMLTextAreaElement | null;
  bodyValue: string;
  canRedoEditor: boolean;
  canUndoEditor: boolean;
  conflicts: LocalConflict[];
  contextMenu: ContextMenuState;
  draftCreatePromise: Promise<LocalNote> | null;
  editorSessionId: number;
  filterId: NotesFilterId;
  lastHistorySnapshot: EditorSnapshot;
  notes: LocalNote[];
  notebooks: LocalNotebook[];
  pendingSaveNoteId: string | null;
  pendingSyncCount: number;
  redoStack: EditorSnapshot[];
  saveTimer: ReturnType<typeof setTimeout> | null;
  selectedNote: LocalNote | null;
  selectedNoteIds: Set<string>;
  selectedNotebookMenuOpen: boolean;
  titleInput: HTMLInputElement | null;
  titleValue: string;
  trash: LocalNote[];
  undoStack: EditorSnapshot[];

  closeMenus: () => void;
  closeNotebookMenus: () => void;
  refresh: () => Promise<void>;
  scheduleSync?: (delayMs?: number) => void;
}

export async function selectNote(
  controller: NotesEditorActionController,
  note: LocalNote
): Promise<void> {
  await flushPendingSave(controller);
  controller.editorSessionId += 1;
  controller.selectedNote = note;
  controller.closeNotebookMenus();
  controller.titleValue = note.title;
  controller.bodyValue = note.body;
  resetEditorHistory(controller);
  void focusEditor(controller, note.title || note.body ? 'body' : 'title');
}

export async function newNote(
  controller: NotesEditorActionController
): Promise<void> {
  controller.closeMenus();
  await flushPendingSave(controller);
  controller.filterId = 'all';
  openDraftNote(controller);
}

export function handleEditorInput(
  controller: NotesEditorActionController,
  event: Event,
  field: 'title' | 'body'
): void {
  const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement)
    .value;
  const nextSnapshot = {
    title: field === 'title' ? value : controller.titleValue,
    body: field === 'body' ? value : controller.bodyValue
  };

  if (field === 'title') {
    controller.titleValue = value;
  } else {
    controller.bodyValue = value;
  }

  if (!sameEditorSnapshot(controller.lastHistorySnapshot, nextSnapshot)) {
    controller.undoStack = pushEditorHistory(
      controller.undoStack,
      controller.lastHistorySnapshot,
      MAX_EDITOR_HISTORY
    );
    controller.redoStack = [];
    controller.lastHistorySnapshot = nextSnapshot;
  }

  scheduleNoteSave(controller);
  rememberEditorRecovery(controller);
}

export function undoEditorHistory(
  controller: NotesEditorActionController
): void {
  if (!controller.canUndoEditor) return;
  const current = currentEditorSnapshot(controller);
  const snapshot = controller.undoStack[controller.undoStack.length - 1];
  if (!snapshot) return;
  controller.undoStack = controller.undoStack.slice(0, -1);
  controller.redoStack = pushEditorHistory(
    controller.redoStack,
    current,
    MAX_EDITOR_HISTORY
  );
  applyEditorHistorySnapshot(controller, snapshot);
}

export function redoEditorHistory(
  controller: NotesEditorActionController
): void {
  if (!controller.canRedoEditor) return;
  const current = currentEditorSnapshot(controller);
  const snapshot = controller.redoStack[controller.redoStack.length - 1];
  if (!snapshot) return;
  controller.redoStack = controller.redoStack.slice(0, -1);
  controller.undoStack = pushEditorHistory(
    controller.undoStack,
    current,
    MAX_EDITOR_HISTORY
  );
  applyEditorHistorySnapshot(controller, snapshot);
}

export function clearPendingSave(
  controller: NotesEditorActionController
): void {
  if (controller.saveTimer) {
    clearTimeout(controller.saveTimer);
    controller.saveTimer = null;
  }
  controller.pendingSaveNoteId = null;
}

export async function restoreEditorRecovery(
  controller: NotesEditorActionController
): Promise<boolean> {
  const recovery = await readEditorRecovery();
  if (!recovery) return false;

  if (!recovery.noteId && !recovery.title.trim() && !recovery.body.trim()) {
    await clearEditorRecovery();
    return false;
  }

  if (recovery.noteId) {
    const existing = [...controller.notes, ...controller.trash].find(
      (note) => note.id === recovery.noteId
    );
    if (!existing || existing.deletedAt || existing.trashedAt) {
      await clearEditorRecovery();
      return false;
    }

    let note = existing;
    if (
      existing.title !== recovery.title.trim() ||
      existing.body !== recovery.body
    ) {
      note =
        (await updateNoteContent(
          recovery.noteId,
          recovery.title,
          recovery.body
        )) ?? existing;
      await controller.refresh();
      note =
        [...controller.notes, ...controller.trash].find(
          (candidate) => candidate.id === recovery.noteId
        ) ?? note;
    }

    controller.editorSessionId += 1;
    controller.selectedNote = note;
    controller.closeNotebookMenus();
    controller.titleValue = recovery.title;
    controller.bodyValue = recovery.body;
    resetEditorHistory(controller);
    await clearEditorRecoveryIfMatches(
      recovery.noteId,
      recovery.title,
      recovery.body
    );
    void focusEditor(
      controller,
      recovery.title || recovery.body ? 'body' : 'title'
    );
    controller.scheduleSync?.(0);
    return true;
  }

  const note = await createBlankNote({
    title: recovery.title,
    body: recovery.body,
    notebookId: recovery.notebookId
  });
  await controller.refresh();
  const current =
    controller.notes.find((candidate) => candidate.id === note.id) ?? note;
  controller.editorSessionId += 1;
  controller.selectedNote = current;
  controller.closeNotebookMenus();
  controller.titleValue = recovery.title;
  controller.bodyValue = recovery.body;
  resetEditorHistory(controller);
  await clearEditorRecovery();
  void focusEditor(
    controller,
    recovery.title || recovery.body ? 'body' : 'title'
  );
  controller.scheduleSync?.(0);
  return true;
}

export async function flushPendingSave(
  controller: NotesEditorActionController
): Promise<void> {
  if (!controller.saveTimer) return;
  const noteId = controller.pendingSaveNoteId;
  clearPendingSave(controller);
  await saveEditorNow(controller, noteId);
}

export function openDraftNote(controller: NotesEditorActionController): void {
  clearPendingSave(controller);
  void clearEditorRecovery();
  controller.editorSessionId += 1;
  controller.selectedNote = null;
  controller.closeNotebookMenus();
  controller.titleValue = '';
  controller.bodyValue = '';
  resetEditorHistory(controller);
  void focusEditor(controller, 'title');
}

export function clearSensitiveWorkspace(
  controller: NotesEditorActionController
): void {
  clearPendingSave(controller);
  // Do not erase encrypted crash recovery while the account key is locked.
  // Legacy plaintext recovery cannot be retained on a locked surface.
  safeLocalStorage()?.removeItem(EDITOR_RECOVERY_KEY);
  controller.editorSessionId += 1;
  controller.notes = [];
  controller.notebooks = [];
  controller.trash = [];
  controller.conflicts = [];
  controller.selectedNote = null;
  controller.selectedNoteIds = new Set();
  controller.titleValue = '';
  controller.bodyValue = '';
  controller.filterId = 'all';
  controller.pendingSyncCount = 0;
  controller.closeNotebookMenus();
  resetEditorHistory(controller);
}

export async function focusEditor(
  controller: NotesEditorActionController,
  target: 'title' | 'body'
): Promise<void> {
  await tick();
  const element =
    target === 'body' ? controller.bodyTextarea : controller.titleInput;
  if (!element || element.readOnly) return;

  element.focus({ preventScroll: true });
  element.setSelectionRange(element.value.length, element.value.length);
}

export function isEditorEventTarget(
  controller: NotesEditorActionController,
  target: EventTarget | null
): boolean {
  return target === controller.titleInput || target === controller.bodyTextarea;
}

async function saveEditorNow(
  controller: NotesEditorActionController,
  noteId: string | null
): Promise<void> {
  const currentNoteId = noteId ?? controller.selectedNote?.id ?? null;
  const titleToSave = controller.titleValue;
  const bodyToSave = controller.bodyValue;
  let savedNoteId: string | null = currentNoteId;

  if (currentNoteId) {
    const updated = await updateNoteContent(
      currentNoteId,
      titleToSave,
      bodyToSave
    );
    if (updated && controller.selectedNote?.id === currentNoteId) {
      controller.selectedNote = updated;
    }
  } else if (controller.titleValue.trim() || controller.bodyValue.trim()) {
    const draftSessionId = controller.editorSessionId;
    if (!controller.draftCreatePromise) {
      controller.draftCreatePromise = createBlankNote({
        title: titleToSave,
        body: bodyToSave,
        notebookId: draftNotebookId(controller)
      });
    }

    const draftCreatePromise = controller.draftCreatePromise;
    try {
      const note = await draftCreatePromise;
      savedNoteId = note.id;
      await rememberEditorRecoveryNoteId(
        null,
        note.id,
        titleToSave,
        bodyToSave
      );
      const stillEditingDraft =
        controller.editorSessionId === draftSessionId &&
        (controller.selectedNote === null ||
          controller.selectedNote.id === note.id);
      if (stillEditingDraft) {
        controller.selectedNote = note;

        if (note.title !== titleToSave.trim() || note.body !== bodyToSave) {
          const updated = await updateNoteContent(
            note.id,
            titleToSave,
            bodyToSave
          );
          if (updated) controller.selectedNote = updated;
        }
      }
    } finally {
      if (controller.draftCreatePromise === draftCreatePromise) {
        controller.draftCreatePromise = null;
      }
    }
  }

  await controller.refresh();
  if (savedNoteId) {
    await clearEditorRecoveryIfMatches(savedNoteId, titleToSave, bodyToSave);
  }
  controller.scheduleSync?.(0);
}

function scheduleNoteSave(controller: NotesEditorActionController): void {
  if (controller.selectedNote?.trashedAt) return;
  clearPendingSave(controller);
  const noteId = controller.selectedNote?.id ?? null;
  controller.pendingSaveNoteId = noteId;
  if (controller.selectedNote) {
    controller.selectedNote = {
      ...controller.selectedNote,
      title: controller.titleValue.trim(),
      body: controller.bodyValue,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending'
    };
  }

  controller.saveTimer = setTimeout(async () => {
    controller.saveTimer = null;
    await saveEditorNow(controller, noteId);
  }, 120);
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function queueEditorRecovery<T>(operation: () => Promise<T>): Promise<T> {
  const result = editorRecoveryQueue.then(operation, operation);
  editorRecoveryQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function editorRecoveryContext(field: 'title' | 'body'): string {
  return `editor-recovery:v2:${field}`;
}

async function readEditorRecovery(): Promise<EditorRecoverySnapshot | null> {
  return await queueEditorRecovery(async () => {
    const stored = await localDb.editorRecovery.get(EDITOR_RECOVERY_KEY);
    if (stored) {
      return {
        version: 2,
        noteId: stored.noteId,
        notebookId: stored.notebookId,
        title: await decryptText(
          stored.title,
          undefined,
          editorRecoveryContext('title')
        ),
        body: await decryptText(
          stored.body,
          undefined,
          editorRecoveryContext('body')
        ),
        savedAt: stored.savedAt
      };
    }

    // Migrate the previous plaintext crash record only after its encrypted
    // replacement has committed successfully.
    const storage = safeLocalStorage();
    const raw = storage?.getItem(EDITOR_RECOVERY_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.version !== 1) return null;
      const recovery: EditorRecoverySnapshot = {
        version: 2,
        noteId: typeof parsed.noteId === 'string' ? parsed.noteId : null,
        notebookId:
          typeof parsed.notebookId === 'string' ? parsed.notebookId : null,
        title: typeof parsed.title === 'string' ? parsed.title : '',
        body: typeof parsed.body === 'string' ? parsed.body : '',
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : ''
      };
      await localDb.editorRecovery.put({
        ...recovery,
        key: EDITOR_RECOVERY_KEY,
        title: await encryptText(
          recovery.title,
          undefined,
          editorRecoveryContext('title')
        ),
        body: await encryptText(
          recovery.body,
          undefined,
          editorRecoveryContext('body')
        )
      });
      storage?.removeItem(EDITOR_RECOVERY_KEY);
      return recovery;
    } catch {
      return null;
    }
  });
}

async function writeEditorRecovery(
  snapshot: EditorRecoverySnapshot
): Promise<void> {
  await queueEditorRecovery(async () => {
    await localDb.editorRecovery.put({
      ...snapshot,
      key: EDITOR_RECOVERY_KEY,
      title: await encryptText(
        snapshot.title,
        undefined,
        editorRecoveryContext('title')
      ),
      body: await encryptText(
        snapshot.body,
        undefined,
        editorRecoveryContext('body')
      )
    });
    safeLocalStorage()?.removeItem(EDITOR_RECOVERY_KEY);
  });
}

async function clearEditorRecovery(): Promise<void> {
  await queueEditorRecovery(async () => {
    await localDb.editorRecovery.delete(EDITOR_RECOVERY_KEY);
    safeLocalStorage()?.removeItem(EDITOR_RECOVERY_KEY);
  });
}

function rememberEditorRecovery(controller: NotesEditorActionController): void {
  if (controller.selectedNote?.trashedAt) return;
  const noteId = controller.selectedNote?.id ?? null;
  if (
    !noteId &&
    !controller.titleValue.trim() &&
    !controller.bodyValue.trim()
  ) {
    void clearEditorRecovery();
    return;
  }

  void writeEditorRecovery({
    version: 2,
    noteId,
    notebookId: draftNotebookId(controller),
    title: controller.titleValue,
    body: controller.bodyValue,
    savedAt: new Date().toISOString()
  });
}

async function rememberEditorRecoveryNoteId(
  previousNoteId: string | null,
  nextNoteId: string,
  title: string,
  body: string
): Promise<void> {
  const recovery = await readEditorRecovery();
  if (
    !recovery ||
    recovery.noteId !== previousNoteId ||
    recovery.title !== title ||
    recovery.body !== body
  ) {
    return;
  }

  await writeEditorRecovery({
    ...recovery,
    noteId: nextNoteId,
    savedAt: new Date().toISOString()
  });
}

async function clearEditorRecoveryIfMatches(
  noteId: string,
  title: string,
  body: string
): Promise<void> {
  const recovery = await readEditorRecovery();
  if (
    recovery?.noteId === noteId &&
    recovery.title === title &&
    recovery.body === body
  ) {
    await clearEditorRecovery();
  }
}

function currentEditorSnapshot(
  controller: NotesEditorActionController
): EditorSnapshot {
  return {
    title: controller.titleValue,
    body: controller.bodyValue
  };
}

function resetEditorHistory(controller: NotesEditorActionController): void {
  controller.undoStack = [];
  controller.redoStack = [];
  controller.lastHistorySnapshot = currentEditorSnapshot(controller);
}

function applyEditorHistorySnapshot(
  controller: NotesEditorActionController,
  snapshot: EditorSnapshot
): void {
  controller.titleValue = snapshot.title;
  controller.bodyValue = snapshot.body;
  controller.lastHistorySnapshot = snapshot;
  scheduleNoteSave(controller);
  rememberEditorRecovery(controller);
}

function draftNotebookId(
  controller: NotesEditorActionController
): string | null {
  return EMPTY_NOTEBOOK_FILTERS.has(controller.filterId)
    ? null
    : controller.filterId;
}
