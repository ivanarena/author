import { onMount, tick } from 'svelte';
import type { Device } from '@author/schema';
import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
import {
  hasStoredEncryptionKeyMaterial,
  rememberEncryptionPassword
} from '$lib/client/encryption';
import { noteNotebookIds, normalizeNotebookName } from '$lib/client/note-utils';
import {
  assignNoteToNotebook,
  clearStoredSession,
  createBlankNote,
  createNotebook,
  deleteNotebook,
  ensureLocalNotesEncrypted,
  exportNotesJson,
  exportNotesMarkdownZip,
  getTheme,
  importNotesJson,
  importNotesJsonSummary,
  importNotesMarkdownFiles,
  importNotesMarkdownSummary,
  loadDevices,
  loadNotes,
  loadNotebooks,
  loadPendingConflicts,
  loadPendingSyncCount,
  loadTrash,
  moveNoteToTrash,
  notebookNameExists,
  renameNotebook,
  reencryptLocalNotes,
  restoreNote,
  resolveConflict,
  getLoginHint,
  getStoredSession,
  setTheme,
  setStoredSession,
  updateNoteContent
} from '$lib/client/store';
import {
  AuthError,
  changePassword,
  deleteAccount,
  login,
  logout,
  runSync,
  updateAccount,
  validateSession
} from '$lib/client/sync';
import {
  countNotesByNotebook,
  countWords,
  filterNotesBySearch,
  filterNotesForView,
  groupNotesByDateRange,
  sortNotes,
  syncIndicatorState,
  type NoteGroup,
  type NoteSort,
  type SyncIndicator
} from '$lib/client/view-model';
import { pushEditorHistory, sameEditorSnapshot } from './editor-history';
import {
  getStoredCompactView,
  getStoredEditorZoom,
  getStoredSort,
  MAX_EDITOR_ZOOM,
  MIN_EDITOR_ZOOM,
  nextEditorZoom,
  setStoredCompactView,
  setStoredEditorZoom,
  setStoredSort,
  zoomPercent as formatZoomPercent
} from './page-preferences';
import type {
  ContextMenuState,
  EditorSnapshot,
  NoteCallback,
  NotebookCallback
} from './ui-types';

export type NotesFilterId = 'all' | 'unfiled' | 'trash' | (string & {});
export type Theme = 'light' | 'dark';
export type SettingsSection = 'account' | 'sync' | 'data' | 'appearance';
export type ConflictChoice =
  | 'keep-newer'
  | 'keep-older'
  | 'keep-local'
  | 'keep-remote'
  | 'duplicate-both';

export interface ArchiveOperation {
  label: string;
  detail: string;
  progress: number;
}

export interface NotebookSidebarModel {
  notes: LocalNote[];
  notebooks: LocalNotebook[];
  trash: LocalNote[];
  notebookCounts: Map<string, number>;
  unfiledCount: number;
  filterId: NotesFilterId;
  newNotebookOpen: boolean;
  notebookNameValue: string;
  notebookError: string;
  renamingNotebookId: string | null;
  renameNotebookValue: string;
  renameNotebookError: string;
  deletingNotebookId: string | null;
  toggleNewNotebookMenu: () => void;
  submitNewNotebookMenu: () => void | Promise<void>;
  openNotebookContext: (event: MouseEvent, notebook: LocalNotebook) => void;
  startRenameNotebook: NotebookCallback;
  cancelRenameNotebook: () => void;
  submitRenameNotebook: NotebookCallback;
  askDeleteNotebook: NotebookCallback;
  cancelDeleteNotebook: () => void;
  confirmDeleteNotebook: NotebookCallback;
}

export interface NoteListPanelModel {
  visibleNoteGroups: NoteGroup[];
  visibleNotes: LocalNote[];
  notebooks: LocalNotebook[];
  selectedNote: LocalNote | null;
  compactView: boolean;
  linkingNoteId: string | null;
  noteSort: NoteSort;
  searchValue: string;
  currentTime: Date;
  syncIndicator: SyncIndicator;
  newNote: () => void | Promise<void>;
  changeSort: (event: Event) => void;
  selectNote: NoteCallback;
  openNoteContext: (event: MouseEvent, note: LocalNote) => void;
  restoreNoteFromRow: NoteCallback;
  trashNote: NoteCallback;
  assignNotebookForNote: (
    note: LocalNote,
    notebookId: string | null
  ) => void | Promise<void>;
  notebookNamesForNote: (note: LocalNote) => string[];
}

export interface NavigationDockModel
  extends NotebookSidebarModel, NoteListPanelModel {
  menusOpen: boolean;
  accountMenuOpen: boolean;
  settingsOpen: boolean;
  hasToken: boolean;
  accountUsername: string;
  accountDisplayName: string;
  accountMessage: string;
  accountError: string;
  currentPasswordValue: string;
  newPasswordValue: string;
  confirmPasswordValue: string;
  deletePasswordValue: string;
  isAccountBusy: boolean;
  isSyncing: boolean;
  isArchiveBusy: boolean;
  theme: Theme;
  openMenus: () => void;
  scheduleMenusClose: () => void;
  closeMenusOnBlur: (event: FocusEvent) => void;
  toggleMenus: () => void;
  toggleAccountMenu: () => void;
  closeAccountMenu: () => void;
  toggleSettings: () => void;
  syncNow: () => void | Promise<void>;
  saveAccountProfile: () => void | Promise<void>;
  changeAccountPassword: () => void | Promise<void>;
  logoutAccount: () => void | Promise<void>;
  deleteAccount: () => void | Promise<void>;
  openLoginSettings: () => void;
  toggleTheme: () => void;
  openSettingsModal: (section?: SettingsSection) => void;
}

export interface EditorPaneModel {
  selectedNote: LocalNote | null;
  titleValue: string;
  bodyValue: string;
  titleInput: HTMLInputElement | null;
  bodyTextarea: HTMLTextAreaElement | null;
  currentTime: Date;
  wordCount: number;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
  editorZoom: number;
  canUndoEditor: boolean;
  canRedoEditor: boolean;
  selectedDeviceName: string;
  zoomPercent: () => string;
  handleTitleKeydown: (event: KeyboardEvent) => void;
  handleEditorInput: (event: Event, field: 'title' | 'body') => void;
  undoEditorHistory: () => void;
  redoEditorHistory: () => void;
  openEditorContext: (event: MouseEvent) => void;
}

export interface SettingsModalModel {
  settingsModal: HTMLElement | null;
  importInput: HTMLInputElement | null;
  importMarkdownInput: HTMLInputElement | null;
  hasToken: boolean;
  accountUsername: string;
  accountDisplayName: string;
  accountMessage: string;
  accountError: string;
  currentPasswordValue: string;
  newPasswordValue: string;
  confirmPasswordValue: string;
  deletePasswordValue: string;
  isAccountBusy: boolean;
  isSyncing: boolean;
  isImporting: boolean;
  isArchiveBusy: boolean;
  archiveOperation: ArchiveOperation | null;
  compactView: boolean;
  theme: Theme;
  settingsSection: SettingsSection;
  editorZoom: number;
  minEditorZoom: number;
  maxEditorZoom: number;
  loginOpen: boolean;
  loginUsernameValue: string;
  loginPasswordValue: string;
  loginError: string;
  isLoggingIn: boolean;
  syncNow: () => void | Promise<void>;
  saveAccountProfile: () => void | Promise<void>;
  changeAccountPassword: () => void | Promise<void>;
  logoutAccount: () => void | Promise<void>;
  deleteAccount: () => void | Promise<void>;
  toggleLoginMenu: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  exportJson: () => void | Promise<void>;
  exportMarkdown: () => void | Promise<void>;
  startJsonImport: () => void;
  startMarkdownImport: () => void;
  handleJsonImport: (event: Event) => void | Promise<void>;
  handleMarkdownImport: (event: Event) => void | Promise<void>;
  toggleCompactView: () => void;
  toggleTheme: () => void;
  zoomEditor: (direction: -1 | 1) => void;
  zoomPercent: () => string;
  submitLoginMenu: () => void | Promise<void>;
  closeSettings: () => void;
}

export interface ContextMenuModel {
  contextMenu: ContextMenuState;
  contextNote: LocalNote | null;
  contextNotebook: LocalNotebook | null;
  notebooks: LocalNotebook[];
  assignNotebookForNote: (
    note: LocalNote,
    notebookId: string | null
  ) => void | Promise<void>;
  contextRenameNotebook: NotebookCallback;
  contextDeleteNotebook: NotebookCallback;
  contextLinkNote: NoteCallback;
  contextTrashNote: NoteCallback;
  contextRestoreNote: NoteCallback;
}

export interface ConflictDialogModel {
  activeConflict: LocalConflict | null;
  conflictMessage: (conflict: LocalConflict) => string;
  resolveActiveConflict: (choice: ConflictChoice) => void | Promise<void>;
}

const EMPTY_NOTEBOOK_FILTERS = new Set<NotesFilterId>([
  'all',
  'unfiled',
  'trash'
]);
const MAX_EDITOR_HISTORY = 120;
const AUTO_SYNC_DELAY_MS = 600;
const SYNC_RETRY_DELAY_MS = 12_000;
const ONLINE_SESSION_SYNC_MS = 60_000;

export class NotesPageController
  implements
    NavigationDockModel,
    EditorPaneModel,
    SettingsModalModel,
    ContextMenuModel,
    ConflictDialogModel
{
  notes = $state<LocalNote[]>([]);
  notebooks = $state<LocalNotebook[]>([]);
  trash = $state<LocalNote[]>([]);
  devices = $state<Device[]>([]);
  conflicts = $state<LocalConflict[]>([]);
  pendingSyncCount = $state(0);
  selectedNote = $state<LocalNote | null>(null);
  titleValue = $state('');
  bodyValue = $state('');
  filterId = $state<NotesFilterId>('all');
  linkingNoteId = $state<string | null>(null);
  syncMessage = $state('Sign in to sync');
  isSyncing = $state(false);
  isLoggingIn = $state(false);
  isAccountBusy = $state(false);
  hasToken = $state(false);
  accountUsername = $state('');
  accountDisplayName = $state('');
  accountMessage = $state('');
  accountError = $state('');
  currentPasswordValue = $state('');
  newPasswordValue = $state('');
  confirmPasswordValue = $state('');
  deletePasswordValue = $state('');
  isBrowserOnline = $state(true);
  theme = $state<Theme>('light');
  newNotebookOpen = $state(false);
  notebookNameValue = $state('');
  notebookError = $state('');
  loginOpen = $state(false);
  loginUsernameValue = $state('');
  loginPasswordValue = $state('');
  loginError = $state('');
  renamingNotebookId = $state<string | null>(null);
  renameNotebookValue = $state('');
  renameNotebookError = $state('');
  deletingNotebookId = $state<string | null>(null);
  noteSort = $state<NoteSort>('date-desc');
  searchValue = $state('');
  compactView = $state(false);
  editorZoom = $state(1);
  currentTime = $state(new Date());
  menusOpen = $state(false);
  accountMenuOpen = $state(false);
  isImporting = $state(false);
  archiveOperation = $state<ArchiveOperation | null>(null);
  settingsSection = $state<SettingsSection>('account');
  settingsOpen = $state(false);
  contextMenu = $state<ContextMenuState>(null);
  undoStack = $state<EditorSnapshot[]>([]);
  redoStack = $state<EditorSnapshot[]>([]);

  titleInput: HTMLInputElement | null = null;
  bodyTextarea: HTMLTextAreaElement | null = null;
  importInput: HTMLInputElement | null = null;
  importMarkdownInput: HTMLInputElement | null = null;
  settingsModal: HTMLElement | null = null;
  readonly minEditorZoom = MIN_EDITOR_ZOOM;
  readonly maxEditorZoom = MAX_EDITOR_ZOOM;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private retrySyncTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineSessionTimer: ReturnType<typeof setInterval> | null = null;
  private menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private syncQueued = false;
  private lastHistorySnapshot: EditorSnapshot = { title: '', body: '' };

  filteredNotes = $derived(
    filterNotesForView(this.notes, this.trash, this.filterId)
  );
  searchedNotes = $derived(
    filterNotesBySearch(this.filteredNotes, this.searchValue)
  );
  visibleNotes = $derived(sortNotes(this.searchedNotes, this.noteSort));
  visibleNoteGroups = $derived(
    groupNotesByDateRange(this.visibleNotes, this.noteSort, this.currentTime)
  );
  wordCount = $derived(countWords(`${this.titleValue} ${this.bodyValue}`));
  activeConflict = $derived(this.conflicts[0] ?? null);
  notebookCounts = $derived(countNotesByNotebook(this.notes));
  unfiledCount = $derived(this.notebookCounts.get('') ?? 0);
  syncIndicator = $derived(
    syncIndicatorState({
      isSyncing: this.isSyncing,
      conflictCount: this.conflicts.length,
      isBrowserOnline: this.isBrowserOnline,
      hasSession: this.hasToken,
      pendingSyncCount: this.pendingSyncCount,
      syncMessage: this.syncMessage
    })
  );
  contextNote = $derived(this.getContextNote(this.contextMenu));
  contextNotebook = $derived(this.getContextNotebook(this.contextMenu));
  selectedDeviceName = $derived(
    this.selectedNote ? this.deviceName(this.selectedNote.deviceId) : ''
  );
  isArchiveBusy = $derived(Boolean(this.archiveOperation) || this.isImporting);
  canUndoEditor = $derived(
    this.undoStack.length > 0 && !this.selectedNote?.trashedAt
  );
  canRedoEditor = $derived(
    this.redoStack.length > 0 && !this.selectedNote?.trashedAt
  );

  constructor() {
    $effect(() => {
      if (this.settingsOpen) void this.focusSettingsModal();
    });

    $effect(() => {
      if (this.hasToken && this.isBrowserOnline && this.pendingSyncCount > 0) {
        this.scheduleSync(AUTO_SYNC_DELAY_MS);
      }
    });

    onMount(() => {
      this.isBrowserOnline = navigator.onLine;
      const clock = setInterval(() => {
        this.currentTime = new Date();
      }, 1000);
      this.onlineSessionTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') {
          this.scheduleSync(0);
        }
      }, ONLINE_SESSION_SYNC_MS);

      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange
      );

      void this.initialize();

      return () => {
        clearInterval(clock);
        this.clearPendingSave();
        if (this.menuCloseTimer) clearTimeout(this.menuCloseTimer);
        if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
        if (this.retrySyncTimer) clearTimeout(this.retrySyncTimer);
        if (this.onlineSessionTimer) clearInterval(this.onlineSessionTimer);
        document.removeEventListener(
          'visibilitychange',
          this.handleVisibilityChange
        );
      };
    });
  }

  handleOnline = () => {
    this.isBrowserOnline = true;
    this.syncMessage = this.hasSyncSession()
      ? 'All changes saved'
      : 'Sign in to sync';
    void this.resumeOnlineSession();
  };

  handleOffline = () => {
    this.isBrowserOnline = false;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.syncMessage = 'Offline';
  };

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      if (!navigator.onLine) {
        this.isBrowserOnline = false;
      }
      this.scheduleSync(0);
    }
  };

  handleTitleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void this.focusEditor('body');
  };

  handleGlobalKeydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();

    if (
      (event.metaKey || event.ctrlKey) &&
      this.isEditorEventTarget(event.target)
    ) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.redoEditorHistory();
        } else {
          this.undoEditorHistory();
        }
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        this.redoEditorHistory();
        return;
      }
    }

    if (event.key !== 'Escape') return;
    this.closeContextMenu();
    this.closeAccountMenu();
    this.closeSettings();
    this.linkingNoteId = null;
  };

  handleWindowClick = (event: MouseEvent) => {
    this.closeContextMenu();
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('.profile-menu')) {
      this.closeAccountMenu();
    }
    if (!this.settingsOpen) return;
    if (
      event.target.closest('.settings-modal') ||
      event.target.closest('.profile-menu')
    )
      return;
    this.closeSettings();
  };

  selectNote = async (note: LocalNote) => {
    await this.flushPendingSave();
    this.selectedNote = note;
    this.linkingNoteId = null;
    this.titleValue = note.title;
    this.bodyValue = note.body;
    this.resetEditorHistory();
    void this.focusEditor(note.title || note.body ? 'body' : 'title');
  };

  newNote = async () => {
    await this.flushPendingSave();
    this.filterId = 'all';
    this.openDraftNote();
  };

  handleEditorInput = (event: Event, field: 'title' | 'body') => {
    const value = (
      event.currentTarget as HTMLInputElement | HTMLTextAreaElement
    ).value;
    const nextSnapshot = {
      title: field === 'title' ? value : this.titleValue,
      body: field === 'body' ? value : this.bodyValue
    };

    if (field === 'title') {
      this.titleValue = value;
    } else {
      this.bodyValue = value;
    }

    if (!sameEditorSnapshot(this.lastHistorySnapshot, nextSnapshot)) {
      this.undoStack = pushEditorHistory(
        this.undoStack,
        this.lastHistorySnapshot,
        MAX_EDITOR_HISTORY
      );
      this.redoStack = [];
      this.lastHistorySnapshot = nextSnapshot;
    }

    this.scheduleNoteSave();
  };

  undoEditorHistory = () => {
    if (!this.canUndoEditor) return;
    const current = this.currentEditorSnapshot();
    const snapshot = this.undoStack[this.undoStack.length - 1];
    if (!snapshot) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = pushEditorHistory(
      this.redoStack,
      current,
      MAX_EDITOR_HISTORY
    );
    this.applyEditorHistorySnapshot(snapshot);
  };

  redoEditorHistory = () => {
    if (!this.canRedoEditor) return;
    const current = this.currentEditorSnapshot();
    const snapshot = this.redoStack[this.redoStack.length - 1];
    if (!snapshot) return;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = pushEditorHistory(
      this.undoStack,
      current,
      MAX_EDITOR_HISTORY
    );
    this.applyEditorHistorySnapshot(snapshot);
  };

  openMenus = () => {
    if (this.menuCloseTimer) {
      clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
    this.menusOpen = true;
  };

  toggleMenus = () => {
    if (this.menuCloseTimer) {
      clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
    this.closeAccountMenu();
    this.menusOpen = !this.menusOpen;
  };

  toggleAccountMenu = () => {
    this.accountMenuOpen = !this.accountMenuOpen;
    if (this.accountMenuOpen) {
      this.menusOpen = false;
      this.closeContextMenu();
    }
  };

  closeAccountMenu = () => {
    this.accountMenuOpen = false;
  };

  scheduleMenusClose = () => {
    if (this.menuCloseTimer) clearTimeout(this.menuCloseTimer);
    this.menuCloseTimer = setTimeout(() => {
      this.menusOpen = false;
      this.menuCloseTimer = null;
    }, 180);
  };

  closeMenusOnBlur = (event: FocusEvent) => {
    const current = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (next && current.contains(next)) return;
    this.menusOpen = false;
  };

  toggleSettings = () => {
    this.settingsOpen = !this.settingsOpen;
    if (!this.settingsOpen) {
      this.loginOpen = false;
    }
    this.closeAccountMenu();
    this.closeContextMenu();
  };

  openSettingsModal = (section: SettingsSection = 'account') => {
    this.settingsSection = section;
    this.settingsOpen = true;
    if (!this.hasToken && section !== 'appearance' && section !== 'data') {
      this.loginOpen = true;
      this.loginUsernameValue = getLoginHint();
    }
    this.closeAccountMenu();
    this.closeContextMenu();
  };

  openLoginSettings = () => {
    this.settingsSection = 'account';
    this.loginOpen = true;
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.loginError = '';
    this.openSettingsModal();
  };

  closeSettings = () => {
    this.settingsOpen = false;
    this.loginOpen = false;
  };

  setSettingsSection = (section: SettingsSection) => {
    this.settingsSection = section;
    if (!this.hasToken && section === 'account') {
      this.loginOpen = true;
      this.loginUsernameValue = getLoginHint();
      this.loginPasswordValue = '';
      this.loginError = '';
    } else if (section !== 'sync') {
      this.loginOpen = false;
    }
  };

  changeSort = (event: Event) => {
    this.noteSort = (event.currentTarget as HTMLSelectElement)
      .value as NoteSort;
    setStoredSort(this.noteSort);
  };

  toggleCompactView = () => {
    this.compactView = !this.compactView;
    setStoredCompactView(this.compactView);
  };

  zoomEditor = (direction: -1 | 1) => {
    this.editorZoom = nextEditorZoom(this.editorZoom, direction);
    setStoredEditorZoom(this.editorZoom);
  };

  zoomPercent = (): string => formatZoomPercent(this.editorZoom);

  openNotebookContext = (event: MouseEvent, notebook: LocalNotebook) => {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = this.positionContextMenu({
      type: 'notebook',
      notebookId: notebook.id,
      x: event.clientX,
      y: event.clientY
    });
  };

  openNoteContext = (event: MouseEvent, note: LocalNote) => {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = this.positionContextMenu({
      type: 'note',
      noteId: note.id,
      x: event.clientX,
      y: event.clientY
    });
  };

  openEditorContext = (event: MouseEvent) => {
    if (!this.selectedNote) return;
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = this.positionContextMenu({
      type: 'editor',
      noteId: this.selectedNote.id,
      x: event.clientX,
      y: event.clientY
    });
  };

  contextRenameNotebook = (notebook: LocalNotebook) => {
    this.startRenameNotebook(notebook);
    this.closeContextMenu();
  };

  contextDeleteNotebook = (notebook: LocalNotebook) => {
    this.askDeleteNotebook(notebook);
    this.closeContextMenu();
  };

  contextLinkNote = (note: LocalNote) => {
    this.linkingNoteId = note.id;
    this.closeContextMenu();
  };

  contextTrashNote = async (note: LocalNote) => {
    this.closeContextMenu();
    await this.trashNote(note);
  };

  contextRestoreNote = async (note: LocalNote) => {
    this.closeContextMenu();
    await this.restoreNoteFromRow(note);
  };

  assignNotebookForNote = async (
    note: LocalNote,
    notebookId: string | null
  ) => {
    const updated = await assignNoteToNotebook(
      note.id,
      notebookId,
      notebookId ? !noteNotebookIds(note).includes(notebookId) : false
    );
    if (updated && this.selectedNote?.id === note.id)
      this.selectedNote = updated;
    await this.refresh();
  };

  toggleNewNotebookMenu = () => {
    this.newNotebookOpen = !this.newNotebookOpen;
    this.loginOpen = false;
    this.renamingNotebookId = null;
    this.deletingNotebookId = null;
    this.notebookNameValue = '';
    this.notebookError = '';
  };

  submitNewNotebookMenu = async () => {
    const name = this.notebookNameValue.trim();
    if (!name) {
      this.notebookError = 'Name required';
      return;
    }

    if (
      this.localNotebookNameExists(name) ||
      (await notebookNameExists(name))
    ) {
      this.notebookError = 'Notebook already exists';
      return;
    }

    const notebook = await createNotebook(name);
    if (notebook) {
      this.filterId = notebook.id;
      if (this.selectedNote && !this.selectedNote.trashedAt) {
        const updated = await assignNoteToNotebook(
          this.selectedNote.id,
          notebook.id,
          true
        );
        if (updated) this.selectedNote = updated;
      }
      await this.refresh();
      this.newNotebookOpen = false;
      this.notebookNameValue = '';
      this.notebookError = '';
    } else {
      this.notebookError = 'Notebook already exists';
    }
  };

  startRenameNotebook = (notebook: LocalNotebook) => {
    this.renamingNotebookId = notebook.id;
    this.deletingNotebookId = null;
    this.newNotebookOpen = false;
    this.loginOpen = false;
    this.renameNotebookValue = notebook.name;
    this.renameNotebookError = '';
  };

  cancelRenameNotebook = () => {
    this.renamingNotebookId = null;
    this.renameNotebookValue = '';
    this.renameNotebookError = '';
  };

  submitRenameNotebook = async (notebook: LocalNotebook) => {
    const name = this.renameNotebookValue.trim();
    if (!name) {
      this.renameNotebookError = 'Name required';
      return;
    }

    if (
      this.localNotebookNameExists(name, notebook.id) ||
      (await notebookNameExists(name, notebook.id))
    ) {
      this.renameNotebookError = 'Notebook already exists';
      return;
    }

    const updated = await renameNotebook(notebook.id, name);
    if (!updated) {
      this.renameNotebookError = 'Notebook already exists';
      return;
    }

    await this.refresh();
    this.cancelRenameNotebook();
  };

  askDeleteNotebook = (notebook: LocalNotebook) => {
    this.deletingNotebookId = notebook.id;
    this.renamingNotebookId = null;
    this.newNotebookOpen = false;
    this.loginOpen = false;
  };

  cancelDeleteNotebook = () => {
    this.deletingNotebookId = null;
  };

  confirmDeleteNotebook = async (notebook: LocalNotebook) => {
    await deleteNotebook(notebook.id);

    if (this.filterId === notebook.id) {
      this.filterId = 'all';
    }

    if (
      this.selectedNote &&
      noteNotebookIds(this.selectedNote).includes(notebook.id)
    ) {
      const notebookIds = noteNotebookIds(this.selectedNote).filter(
        (id) => id !== notebook.id
      );
      this.selectedNote = {
        ...this.selectedNote,
        notebookIds,
        notebookId: notebookIds[0] ?? null
      };
    }

    this.deletingNotebookId = null;
    await this.refresh();
  };

  trashNote = async (note: LocalNote) => {
    await moveNoteToTrash(note.id);
    await this.refresh();

    if (this.selectedNote?.id === note.id) {
      const next =
        this.notes.find((candidate) => candidate.id !== note.id) ?? null;
      if (next) {
        await this.selectNote(next);
      } else {
        await this.newNote();
      }
    }
  };

  restoreNoteFromRow = async (note: LocalNote) => {
    await restoreNote(note.id);
    this.filterId = 'all';
    await this.refresh();
    const restored = this.notes.find((candidate) => candidate.id === note.id);
    if (restored) await this.selectNote(restored);
  };

  syncNow = async () => {
    if (this.isArchiveBusy) {
      this.syncQueued = true;
      this.syncMessage = 'Sync paused during import/export';
      return;
    }
    const token = getStoredSession()?.token ?? null;
    this.hasToken = Boolean(token);
    if (!token) return;
    if (!hasStoredEncryptionKeyMaterial()) {
      this.expireSession('Sign in again to sync encrypted notes');
      return;
    }
    if (!this.isBrowserOnline) {
      this.syncMessage = 'Offline';
      return;
    }
    if (this.isSyncing) {
      this.syncQueued = true;
      return;
    }

    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.retrySyncTimer) {
      clearTimeout(this.retrySyncTimer);
      this.retrySyncTimer = null;
    }
    this.isSyncing = true;
    this.syncMessage = 'Saving';
    let syncCompleted = false;
    try {
      const result = await runSync(token);
      this.syncMessage =
        result.conflicts > 0
          ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
          : 'All changes saved';
      await this.refresh();
      syncCompleted = true;
    } catch (error) {
      this.handleSyncError(error);
    } finally {
      this.isSyncing = false;
      const shouldSyncAgain =
        syncCompleted && (this.syncQueued || this.pendingSyncCount > 0);
      this.syncQueued = false;
      if (shouldSyncAgain) {
        this.scheduleSync(0);
      }
    }
  };

  exportJson = async () => {
    if (this.isSyncing || this.isArchiveBusy) return;
    await this.flushPendingSave();
    this.beginArchiveOperation('Exporting JSON', 'Collecting notes', 18);
    try {
      await this.yieldToUi();
      const archive = await exportNotesJson();
      this.updateArchiveOperation('Preparing download', 72);
      await this.yieldToUi();
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: 'application/json'
      });
      this.downloadBlob(
        blob,
        `author-notes-${new Date().toISOString().slice(0, 10)}.json`
      );
      this.updateArchiveOperation('Done', 100);
      this.syncMessage = `Exported ${archive.notes.length} ${
        archive.notes.length === 1 ? 'note' : 'notes'
      }`;
      await this.yieldToUi();
    } catch (error) {
      this.syncMessage =
        error instanceof Error ? error.message : 'Export failed';
    } finally {
      this.endArchiveOperation();
    }
  };

  exportMarkdown = async () => {
    if (this.isSyncing || this.isArchiveBusy) return;
    await this.flushPendingSave();
    this.beginArchiveOperation('Exporting Markdown', 'Collecting notes', 16);
    try {
      await this.yieldToUi();
      const archive = await exportNotesMarkdownZip();
      this.updateArchiveOperation('Writing ZIP archive', 78);
      await this.yieldToUi();
      this.downloadBlob(archive.blob, archive.fileName);
      this.updateArchiveOperation('Done', 100);
      this.syncMessage = `Exported ${archive.noteCount} ${
        archive.noteCount === 1 ? 'note' : 'notes'
      }`;
      await this.yieldToUi();
    } catch (error) {
      this.syncMessage =
        error instanceof Error ? error.message : 'Export failed';
    } finally {
      this.endArchiveOperation();
    }
  };

  startJsonImport = () => {
    if (this.isSyncing || this.isArchiveBusy) return;
    this.importInput?.click();
  };

  startMarkdownImport = () => {
    if (this.isSyncing || this.isArchiveBusy) return;
    this.importMarkdownInput?.click();
  };

  handleJsonImport = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || this.isSyncing || this.isArchiveBusy) return;

    await this.flushPendingSave();
    this.beginArchiveOperation('Importing JSON', 'Reading file', 12);
    try {
      await this.yieldToUi();
      const payload = JSON.parse(await file.text()) as unknown;
      this.updateArchiveOperation('Adding notes', 42);
      await this.yieldToUi();
      const result = await importNotesJson(payload);
      this.updateArchiveOperation('Refreshing library', 82);
      await this.refresh();

      const importedNote = this.notes.find(
        (note) => note.id === result.noteIds[0]
      );
      if (importedNote) {
        await this.selectNote(importedNote);
      }

      this.syncMessage = importNotesJsonSummary(result);
      this.updateArchiveOperation('Done', 100);
      await this.yieldToUi();
    } catch (error) {
      this.syncMessage =
        error instanceof Error ? error.message : 'Import failed';
    } finally {
      this.endArchiveOperation(true);
    }
  };

  handleMarkdownImport = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (!files.length || this.isSyncing || this.isArchiveBusy) return;

    await this.flushPendingSave();
    this.beginArchiveOperation('Importing Markdown', 'Reading folder', 8);
    try {
      await this.yieldToUi();
      this.updateArchiveOperation(`Reading ${files.length} files`, 28);
      const result = await importNotesMarkdownFiles(files);
      this.updateArchiveOperation('Adding notes', 62);
      await this.yieldToUi();
      await this.refresh();
      this.updateArchiveOperation('Refreshing library', 86);

      const importedNote = this.notes.find(
        (note) => note.id === result.noteIds[0]
      );
      if (importedNote) {
        await this.selectNote(importedNote);
      }

      this.syncMessage = importNotesMarkdownSummary(result);
      this.updateArchiveOperation('Done', 100);
      await this.yieldToUi();
    } catch (error) {
      this.syncMessage =
        error instanceof Error ? error.message : 'Import failed';
    } finally {
      this.endArchiveOperation(true);
    }
  };

  toggleLoginMenu = () => {
    this.loginOpen = !this.loginOpen;
    this.newNotebookOpen = false;
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.loginError = '';
  };

  submitLoginMenu = async () => {
    const username = this.loginUsernameValue.trim();
    const password = this.loginPasswordValue;
    if (this.isLoggingIn) return;
    if (!username) {
      this.loginError = 'Username required';
      return;
    }
    if (!password.trim()) {
      this.loginError = 'Password required';
      return;
    }

    this.isLoggingIn = true;
    this.loginError = '';
    let shouldSync = false;
    try {
      const session = await login(username, password);
      const encryption = await rememberEncryptionPassword(
        session.user.username,
        password
      );
      setStoredSession({
        token: session.token,
        user: session.user,
        expiresAt: session.expiresAt
      });
      await reencryptLocalNotes(
        encryption.previousMaterial,
        encryption.nextMaterial
      );
      this.hasToken = true;
      this.accountUsername = session.user.username;
      this.accountDisplayName = session.user.displayName ?? '';
      this.accountError = '';
      this.accountMessage = 'Signed in';
      this.loginOpen = false;
      this.loginUsernameValue = session.user.username;
      this.loginPasswordValue = '';
      this.syncMessage = 'Signed in';
      shouldSync = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      this.loginError = message;
      this.syncMessage = message;
    } finally {
      this.isLoggingIn = false;
    }

    if (shouldSync) void this.syncNow();
  };

  toggleTheme = () => {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    setTheme(this.theme);
  };

  saveAccountProfile = async () => {
    const storedSession = getStoredSession();
    const token = storedSession?.token ?? null;
    if (!token || this.isAccountBusy) return;
    this.isAccountBusy = true;
    this.accountError = '';
    this.accountMessage = '';
    try {
      const response = await updateAccount(token, {
        displayName: this.accountDisplayName
      });
      this.accountUsername = response.user.username;
      this.accountDisplayName = response.user.displayName ?? '';
      setStoredSession({
        token,
        user: response.user,
        expiresAt: storedSession?.expiresAt ?? null
      });
      this.accountMessage = 'Profile saved';
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not save profile';
    } finally {
      this.isAccountBusy = false;
    }
  };

  changeAccountPassword = async () => {
    const token = getStoredSession()?.token ?? null;
    if (!token || this.isAccountBusy) return;
    if (!this.currentPasswordValue.trim()) {
      this.accountError = 'Current password required';
      return;
    }
    if (!this.newPasswordValue.trim()) {
      this.accountError = 'New password required';
      return;
    }
    if (this.newPasswordValue !== this.confirmPasswordValue) {
      this.accountError = 'Passwords do not match';
      return;
    }

    this.isAccountBusy = true;
    this.accountError = '';
    this.accountMessage = '';
    try {
      const response = await changePassword(token, {
        currentPassword: this.currentPasswordValue,
        newPassword: this.newPasswordValue
      });
      const encryption = await rememberEncryptionPassword(
        this.accountUsername,
        this.newPasswordValue
      );
      await reencryptLocalNotes(
        encryption.previousMaterial,
        encryption.nextMaterial
      );
      this.accountUsername = response.user.username;
      this.accountDisplayName = response.user.displayName ?? '';
      this.currentPasswordValue = '';
      this.newPasswordValue = '';
      this.confirmPasswordValue = '';
      this.clearLocalSession({
        accountMessage: 'Password changed. Sign in again to keep syncing.',
        openLogin: true,
        syncMessage: 'Sign in to sync'
      });
      this.loginUsernameValue = response.user.username;
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not change password';
    } finally {
      this.isAccountBusy = false;
    }
  };

  logoutAccount = async () => {
    const token = getStoredSession()?.token ?? null;
    if (this.isAccountBusy) return;
    this.isAccountBusy = true;
    this.accountError = '';
    try {
      if (token) await logout(token).catch(() => undefined);
      this.clearLocalSession({
        accountMessage: 'Signed out',
        syncMessage: 'Sign in to sync'
      });
    } finally {
      this.isAccountBusy = false;
    }
  };

  deleteAccount = async () => {
    const token = getStoredSession()?.token ?? null;
    if (!token || this.isAccountBusy) return;
    if (!this.deletePasswordValue.trim()) {
      this.accountError = 'Password required to delete account';
      return;
    }
    this.isAccountBusy = true;
    this.accountError = '';
    this.accountMessage = '';
    try {
      await deleteAccount(token, { password: this.deletePasswordValue });
      this.deletePasswordValue = '';
      this.clearLocalSession({
        accountMessage: 'Account deleted',
        syncMessage: 'Sign in to sync'
      });
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not delete account';
    } finally {
      this.isAccountBusy = false;
    }
  };

  resolveActiveConflict = async (choice: ConflictChoice) => {
    if (!this.activeConflict) return;
    await resolveConflict(this.activeConflict.id, choice);
    await this.refresh();
    await this.syncNow();
  };

  conflictMessage = (conflict: LocalConflict): string => {
    if (conflict.conflict.reason === 'duplicate_name') {
      return 'A notebook with this name already exists. Choose one version or duplicate both.';
    }

    return 'Choose which version to keep. Both versions are preserved until you decide.';
  };

  private initialize = async () => {
    this.theme = getTheme();
    setTheme(this.theme);
    this.noteSort = getStoredSort();
    this.compactView = getStoredCompactView();
    this.editorZoom = getStoredEditorZoom();
    const storedSession = getStoredSession();
    this.accountUsername = storedSession?.user.username ?? '';
    this.accountDisplayName = storedSession?.user.displayName ?? '';
    this.loginUsernameValue = getLoginHint();
    await ensureLocalNotesEncrypted();
    await this.refresh();
    this.openDraftNote();

    this.hasToken = Boolean(storedSession?.token);
    if (storedSession?.token) {
      await this.resumeOnlineSession(storedSession.token);
    }
  };

  private resumeOnlineSession = async (
    token = getStoredSession()?.token ?? null
  ) => {
    if (!token) {
      this.hasToken = false;
      return;
    }

    if (!hasStoredEncryptionKeyMaterial()) {
      this.expireSession('Sign in again to sync encrypted notes');
      return;
    }

    try {
      const session = await validateSession(token);
      this.hasToken = true;
      this.accountUsername = session.user.username;
      this.accountDisplayName = session.user.displayName ?? '';
      setStoredSession({
        token,
        user: session.user,
        expiresAt: session.expiresAt
      });
      if (!this.isBrowserOnline) {
        this.syncMessage = 'Offline';
        return;
      }
      await this.syncNow();
    } catch (error) {
      this.handleSyncError(error);
    }
  };

  private refresh = async () => {
    const [notes, notebooks, trash, conflicts, devices, pendingSyncCount] =
      await Promise.all([
        loadNotes(),
        loadNotebooks(),
        loadTrash(),
        loadPendingConflicts(),
        loadDevices(),
        loadPendingSyncCount()
      ]);

    this.notes = notes;
    this.notebooks = notebooks;
    this.trash = trash;
    this.conflicts = conflicts;
    this.devices = devices;
    this.pendingSyncCount = pendingSyncCount;
  };

  private clearPendingSave = () => {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  };

  private flushPendingSave = async () => {
    if (!this.saveTimer) return;
    this.clearPendingSave();
    await this.saveEditorNow(this.selectedNote?.id ?? null);
  };

  private openDraftNote = () => {
    this.clearPendingSave();
    this.selectedNote = null;
    this.linkingNoteId = null;
    this.titleValue = '';
    this.bodyValue = '';
    this.resetEditorHistory();
    void this.focusEditor('title');
  };

  private focusEditor = async (target: 'title' | 'body') => {
    await tick();
    const element = target === 'body' ? this.bodyTextarea : this.titleInput;
    if (!element || element.readOnly) return;

    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  };

  private currentEditorSnapshot = (): EditorSnapshot => ({
    title: this.titleValue,
    body: this.bodyValue
  });

  private resetEditorHistory = () => {
    this.undoStack = [];
    this.redoStack = [];
    this.lastHistorySnapshot = this.currentEditorSnapshot();
  };

  private applyEditorHistorySnapshot = (snapshot: EditorSnapshot) => {
    this.titleValue = snapshot.title;
    this.bodyValue = snapshot.body;
    this.lastHistorySnapshot = snapshot;
    this.scheduleNoteSave();
  };

  private isEditorEventTarget = (target: EventTarget | null): boolean =>
    target === this.titleInput || target === this.bodyTextarea;

  private closeContextMenu = () => {
    this.contextMenu = null;
  };

  private focusSettingsModal = async () => {
    await tick();
    this.settingsModal?.focus({ preventScroll: true });
  };

  private downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.addEventListener('click', (event) => event.stopPropagation());
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  private beginArchiveOperation = (
    label: string,
    detail: string,
    progress: number
  ) => {
    this.settingsSection = 'data';
    this.isImporting = true;
    this.archiveOperation = { label, detail, progress };
    this.syncMessage = label;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  };

  private updateArchiveOperation = (detail: string, progress: number) => {
    if (!this.archiveOperation) return;
    this.archiveOperation = {
      ...this.archiveOperation,
      detail,
      progress: Math.max(0, Math.min(100, progress))
    };
  };

  private endArchiveOperation = (syncAfter = false) => {
    this.archiveOperation = null;
    this.isImporting = false;
    if (syncAfter || this.syncQueued) {
      this.syncQueued = false;
      this.scheduleSync(0);
    }
  };

  private yieldToUi = async () => {
    await tick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  };

  private saveEditorNow = async (noteId: string | null) => {
    if (noteId) {
      const updated = await updateNoteContent(
        noteId,
        this.titleValue,
        this.bodyValue
      );
      if (updated && this.selectedNote?.id === noteId) {
        this.selectedNote = updated;
      }
    } else if (this.titleValue.trim() || this.bodyValue.trim()) {
      const note = await createBlankNote({
        title: this.titleValue,
        body: this.bodyValue,
        notebookId: this.draftNotebookId()
      });
      this.selectedNote = note;
    }

    await this.refresh();
  };

  private scheduleNoteSave = () => {
    if (this.selectedNote?.trashedAt) return;
    this.clearPendingSave();
    const noteId = this.selectedNote?.id ?? null;
    if (this.selectedNote) {
      this.selectedNote = {
        ...this.selectedNote,
        title: this.titleValue.trim(),
        body: this.bodyValue,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending'
      };
    }

    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.saveEditorNow(noteId);
    }, 120);
  };

  private draftNotebookId = (): string | null =>
    EMPTY_NOTEBOOK_FILTERS.has(this.filterId) ? null : this.filterId;

  private hasSyncSession = (): boolean => this.hasToken;

  private clearLocalSession = ({
    accountMessage = '',
    openLogin = false,
    syncMessage = 'Sign in to sync'
  }: {
    accountMessage?: string;
    openLogin?: boolean;
    syncMessage?: string;
  } = {}) => {
    clearStoredSession();
    this.hasToken = false;
    this.accountUsername = '';
    this.accountDisplayName = '';
    this.accountMessage = accountMessage;
    this.accountError = '';
    this.currentPasswordValue = '';
    this.newPasswordValue = '';
    this.confirmPasswordValue = '';
    this.deletePasswordValue = '';
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.loginError = '';
    this.loginOpen = openLogin;
    this.accountMenuOpen = false;
    this.syncQueued = false;
    this.syncMessage = syncMessage;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.retrySyncTimer) {
      clearTimeout(this.retrySyncTimer);
      this.retrySyncTimer = null;
    }
    if (openLogin) {
      this.settingsSection = 'account';
      this.settingsOpen = true;
    }
  };

  private notebookName = (notebookId: string | null): string | null => {
    if (!notebookId) return null;
    return (
      this.notebooks.find((notebook) => notebook.id === notebookId)?.name ??
      null
    );
  };

  notebookNamesForNote = (note: LocalNote): string[] =>
    noteNotebookIds(note)
      .map((notebookId) => this.notebookName(notebookId))
      .filter((name): name is string => Boolean(name));

  private deviceName(deviceId: string | null | undefined): string {
    if (!deviceId) return 'Unknown device';
    return (
      this.devices.find((device) => device.id === deviceId)?.name ?? deviceId
    );
  }

  private positionContextMenu = <T extends Exclude<ContextMenuState, null>>(
    menu: T
  ): T => {
    const width = menu.type === 'notebook' ? 190 : 280;
    const height =
      menu.type === 'notebook'
        ? 84
        : Math.min(360, 142 + Math.max(1, this.notebooks.length) * 40);
    return {
      ...menu,
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8)
    };
  };

  private getContextNote(menu: ContextMenuState): LocalNote | null {
    if (menu?.type !== 'note' && menu?.type !== 'editor') return null;
    return (
      [...this.notes, ...this.trash].find((note) => note.id === menu.noteId) ??
      null
    );
  }

  private getContextNotebook(menu: ContextMenuState): LocalNotebook | null {
    if (menu?.type !== 'notebook') return null;
    return (
      this.notebooks.find((notebook) => notebook.id === menu.notebookId) ?? null
    );
  }

  private localNotebookNameExists = (
    name: string,
    excludeId?: string
  ): boolean => {
    const normalized = normalizeNotebookName(name);
    if (!normalized) return false;
    return this.notebooks.some(
      (notebook) =>
        notebook.id !== excludeId &&
        normalizeNotebookName(notebook.name) === normalized
    );
  };

  private scheduleSync = (delayMs = AUTO_SYNC_DELAY_MS) => {
    if (!this.hasToken || !this.isBrowserOnline) return;
    if (this.isArchiveBusy) {
      this.syncQueued = true;
      return;
    }
    if (this.isSyncing) {
      this.syncQueued = true;
      return;
    }
    if (this.autoSyncTimer) return;

    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null;
      void this.syncNow();
    }, delayMs);
  };

  private scheduleSyncRetry = () => {
    if (!this.hasToken || !this.isBrowserOnline || this.retrySyncTimer) return;
    this.retrySyncTimer = setTimeout(() => {
      this.retrySyncTimer = null;
      this.scheduleSync(0);
    }, SYNC_RETRY_DELAY_MS);
  };

  private expireSession = (message = 'Login expired') => {
    const displayMessage =
      message.toLowerCase() === 'unauthorized' ? 'Login expired' : message;
    this.clearLocalSession({
      accountMessage: displayMessage,
      openLogin: true,
      syncMessage: displayMessage
    });
  };

  private handleSyncError = (error: unknown) => {
    if (error instanceof AuthError) {
      this.expireSession(error.message);
      return;
    }

    if (!navigator.onLine) {
      this.isBrowserOnline = false;
      this.syncMessage = 'Offline';
      return;
    }

    this.syncMessage = error instanceof Error ? error.message : 'Sync failed';
    this.scheduleSyncRetry();
  };
}

export function createNotesPageController(): NotesPageController {
  return new NotesPageController();
}
