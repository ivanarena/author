import { onMount, tick } from 'svelte';
import type { Device } from '@author/schema';
import type { RemoteSyncState } from '@author/api-types';
import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
import {
  hasStoredEncryptionKeyMaterial,
  rememberEncryptionPassword
} from '$lib/client/encryption';
import { noteNotebookIds, normalizeNotebookName } from '$lib/client/note-utils';
import {
  adoptLocalWorkspaceForAccount,
  assignNoteToNotebook,
  assertLocalWorkspaceCanUseAccount,
  clearLocalWorkspace,
  clearStoredSession,
  createBlankNote,
  createNotebook,
  deleteNotebook,
  ensureLocalNotesEncrypted,
  exportNotesMarkdownZip,
  getTheme,
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
  rememberLocalWorkspaceAccount,
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
  loadSyncStatus,
  login,
  logout,
  runSync,
  signup,
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
  NotebookAssignmentCallback,
  NotebookCallback
} from './ui-types';

export type NotesFilterId = 'all' | 'unfiled' | 'trash' | (string & {});
export type Theme = 'light' | 'dark';
export type AuthMode = 'signin' | 'signup';
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

export interface ImportBanner {
  kind: 'success' | 'error';
  title: string;
  message: string;
}

export interface AppNotification {
  id: string;
  kind: 'success' | 'error' | 'info';
  title: string;
  message: string;
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
  selectedNoteIds: Set<string>;
  selectedNoteCount: number;
  selectedVisibleNoteCount: number;
  allVisibleNotesSelected: boolean;
  someVisibleNotesSelected: boolean;
  selectedActiveNoteCount: number;
  selectedTrashedNoteCount: number;
  compactView: boolean;
  linkingNoteId: string | null;
  selectedNotebookMenuOpen: boolean;
  noteSort: NoteSort;
  searchValue: string;
  currentTime: Date;
  syncIndicator: SyncIndicator;
  newNote: () => void | Promise<void>;
  changeSort: (event: Event) => void;
  selectNote: NoteCallback;
  toggleNoteSelection: (note: LocalNote, selected: boolean) => void;
  toggleAllVisibleNotes: (selected: boolean) => void;
  clearSelectedNotes: () => void;
  toggleSelectedNotebookMenu: () => void;
  toggleNotebookMenuForNote: NoteCallback;
  assignNotebookForSelected: (
    notebookId: string | null
  ) => void | Promise<void>;
  selectedNotesHaveNotebook: (notebookId: string | null) => boolean;
  trashSelectedNotes: () => void | Promise<void>;
  restoreSelectedNotes: () => void | Promise<void>;
  openNoteContext: (event: MouseEvent, note: LocalNote) => void;
  restoreNoteFromRow: NoteCallback;
  trashNote: NoteCallback;
  assignNotebookForNote: NotebookAssignmentCallback;
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
  accountProfileEditing: boolean;
  accountPasswordEditing: boolean;
  accountDeleteEditing: boolean;
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
  openAccountMenu: () => void;
  scheduleAccountMenuClose: () => void;
  closeAccountMenuOnBlur: (event: FocusEvent) => void;
  toggleMenus: () => void;
  closeAccountMenu: () => void;
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
  importMarkdownInput: HTMLInputElement | null;
  hasToken: boolean;
  accountUsername: string;
  accountDisplayName: string;
  accountMessage: string;
  accountError: string;
  accountProfileEditing: boolean;
  accountPasswordEditing: boolean;
  accountDeleteEditing: boolean;
  currentPasswordValue: string;
  newPasswordValue: string;
  confirmPasswordValue: string;
  deletePasswordValue: string;
  isAccountBusy: boolean;
  isSyncing: boolean;
  isImporting: boolean;
  isArchiveBusy: boolean;
  archiveOperation: ArchiveOperation | null;
  importBanner: ImportBanner | null;
  compactView: boolean;
  theme: Theme;
  settingsSection: SettingsSection;
  editorZoom: number;
  minEditorZoom: number;
  maxEditorZoom: number;
  loginOpen: boolean;
  authMode: AuthMode;
  loginUsernameValue: string;
  loginPasswordValue: string;
  signupDisplayNameValue: string;
  signupConfirmPasswordValue: string;
  loginError: string;
  isLoggingIn: boolean;
  syncNow: () => void | Promise<void>;
  saveAccountProfile: () => void | Promise<void>;
  changeAccountPassword: () => void | Promise<void>;
  logoutAccount: () => void | Promise<void>;
  deleteAccount: () => void | Promise<void>;
  toggleLoginMenu: () => void;
  closeLoginModal: () => void;
  startAccountProfileEdit: () => void;
  cancelAccountProfileEdit: () => void;
  startAccountPasswordEdit: () => void;
  cancelAccountPasswordEdit: () => void;
  startAccountDeleteEdit: () => void;
  cancelAccountDeleteEdit: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  exportMarkdown: () => void | Promise<void>;
  startMarkdownImport: () => void;
  handleMarkdownImport: (event: Event) => void | Promise<void>;
  toggleCompactView: () => void;
  toggleTheme: () => void;
  zoomEditor: (direction: -1 | 1) => void;
  zoomPercent: () => string;
  submitLoginMenu: () => void | Promise<void>;
  setAuthMode: (mode: AuthMode) => void;
  closeSettings: () => void;
}

export interface ContextMenuModel {
  contextMenu: ContextMenuState;
  contextNote: LocalNote | null;
  contextNotebook: LocalNotebook | null;
  notebooks: LocalNotebook[];
  contextRenameNotebook: NotebookCallback;
  contextDeleteNotebook: NotebookCallback;
  contextTrashNote: NoteCallback;
  contextRestoreNote: NoteCallback;
  contextAssignNotebookForNote: NotebookAssignmentCallback;
  contextCreateNotebookForNote: (
    note: LocalNote,
    name: string
  ) => Promise<string | null>;
}

export interface ConflictDialogModel {
  activeConflict: LocalConflict | null;
  conflictMessage: (conflict: LocalConflict) => string;
  resolveActiveConflict: (choice: ConflictChoice) => void | Promise<void>;
}

export interface NotificationStackModel {
  notifications: AppNotification[];
  dismissNotification: (id: string) => void;
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
    ConflictDialogModel,
    NotificationStackModel
{
  notes = $state<LocalNote[]>([]);
  notebooks = $state<LocalNotebook[]>([]);
  trash = $state<LocalNote[]>([]);
  devices = $state<Device[]>([]);
  conflicts = $state<LocalConflict[]>([]);
  pendingSyncCount = $state(0);
  selectedNote = $state<LocalNote | null>(null);
  selectedNoteIds = $state<Set<string>>(new Set());
  titleValue = $state('');
  bodyValue = $state('');
  filterId = $state<NotesFilterId>('all');
  linkingNoteId = $state<string | null>(null);
  selectedNotebookMenuOpen = $state(false);
  syncMessage = $state('Sign in to sync');
  remoteSyncEnabled = $state(false);
  remoteSyncState = $state<RemoteSyncState | 'unknown'>('unknown');
  remoteSyncError = $state('');
  isSyncing = $state(false);
  isLoggingIn = $state(false);
  isAccountBusy = $state(false);
  hasToken = $state(false);
  accountUsername = $state('');
  accountDisplayName = $state('');
  accountMessage = $state('');
  accountError = $state('');
  accountProfileEditing = $state(false);
  accountPasswordEditing = $state(false);
  accountDeleteEditing = $state(false);
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
  authMode = $state<AuthMode>('signin');
  loginUsernameValue = $state('');
  loginPasswordValue = $state('');
  signupDisplayNameValue = $state('');
  signupConfirmPasswordValue = $state('');
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
  importBanner = $state<ImportBanner | null>(null);
  notifications = $state<AppNotification[]>([]);
  settingsSection = $state<SettingsSection>('account');
  settingsOpen = $state(false);
  contextMenu = $state<ContextMenuState>(null);
  undoStack = $state<EditorSnapshot[]>([]);
  redoStack = $state<EditorSnapshot[]>([]);

  titleInput: HTMLInputElement | null = null;
  bodyTextarea: HTMLTextAreaElement | null = null;
  importMarkdownInput: HTMLInputElement | null = null;
  settingsModal: HTMLElement | null = null;
  readonly minEditorZoom = MIN_EDITOR_ZOOM;
  readonly maxEditorZoom = MAX_EDITOR_ZOOM;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private retrySyncTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineSessionTimer: ReturnType<typeof setInterval> | null = null;
  private menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private accountMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  selectedNoteCount = $derived(this.selectedNoteIds.size);
  selectedVisibleNoteCount = $derived(
    this.visibleNotes.filter((note) => this.selectedNoteIds.has(note.id)).length
  );
  allVisibleNotesSelected = $derived(
    this.visibleNotes.length > 0 &&
      this.selectedVisibleNoteCount === this.visibleNotes.length
  );
  someVisibleNotesSelected = $derived(this.selectedVisibleNoteCount > 0);
  selectedNotes = $derived(
    [...this.notes, ...this.trash].filter((note) =>
      this.selectedNoteIds.has(note.id)
    )
  );
  selectedActiveNoteCount = $derived(
    this.selectedNotes.filter((note) => !note.trashedAt).length
  );
  selectedTrashedNoteCount = $derived(
    this.selectedNotes.filter((note) => note.trashedAt).length
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
      syncMessage: this.syncMessage,
      remoteSyncEnabled: this.remoteSyncEnabled,
      remoteSyncState: this.remoteSyncState,
      remoteSyncError: this.remoteSyncError
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
        if (this.accountMenuCloseTimer)
          clearTimeout(this.accountMenuCloseTimer);
        if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
        if (this.retrySyncTimer) clearTimeout(this.retrySyncTimer);
        if (this.onlineSessionTimer) clearInterval(this.onlineSessionTimer);
        if (this.remoteStatusTimer) clearTimeout(this.remoteStatusTimer);
        for (const timer of this.notificationTimers.values()) {
          clearTimeout(timer);
        }
        this.notificationTimers.clear();
        document.removeEventListener(
          'visibilitychange',
          this.handleVisibilityChange
        );
      };
    });
  }

  handleOnline = () => {
    this.isBrowserOnline = true;
    this.syncMessage = this.hasToken ? 'All changes saved' : 'Sign in to sync';
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
    this.closeNotebookMenus();
  };

  handleWindowClick = (event: MouseEvent) => {
    this.closeContextMenu();
    if (!(event.target instanceof Element)) return;
    if (
      !event.target.closest(
        '.batch-actions, .batch-popover, .link-popover, .row-actions'
      )
    ) {
      this.closeNotebookMenus();
    }
    if (!event.target.closest('.profile-menu')) {
      this.closeAccountMenu();
    }
    if (!this.settingsOpen) return;
    if (
      event.target.closest('.settings-modal') ||
      event.target.closest('.login-layer') ||
      event.target.closest('.login-modal') ||
      event.target.closest('.profile-menu')
    )
      return;
    this.closeSettings();
  };

  selectNote = async (note: LocalNote) => {
    await this.flushPendingSave();
    this.selectedNote = note;
    this.closeNotebookMenus();
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

  openAccountMenu = () => {
    if (this.accountMenuCloseTimer) {
      clearTimeout(this.accountMenuCloseTimer);
      this.accountMenuCloseTimer = null;
    }
    this.accountMenuOpen = true;
    this.menusOpen = false;
    this.closeContextMenu();
  };

  closeAccountMenu = () => {
    if (this.accountMenuCloseTimer) {
      clearTimeout(this.accountMenuCloseTimer);
      this.accountMenuCloseTimer = null;
    }
    this.accountMenuOpen = false;
  };

  scheduleAccountMenuClose = () => {
    if (this.accountMenuCloseTimer) clearTimeout(this.accountMenuCloseTimer);
    this.accountMenuCloseTimer = setTimeout(() => {
      this.accountMenuOpen = false;
      this.accountMenuCloseTimer = null;
    }, 160);
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

  closeAccountMenuOnBlur = (event: FocusEvent) => {
    const current = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (next && current.contains(next)) return;
    this.closeAccountMenu();
  };

  openSettingsModal = (section: SettingsSection = 'account') => {
    this.settingsSection = section;
    this.settingsOpen = true;
    this.closeAccountMenu();
    this.closeContextMenu();
  };

  openLoginSettings = () => {
    this.settingsOpen = false;
    this.loginOpen = true;
    this.authMode = 'signin';
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.signupDisplayNameValue = '';
    this.signupConfirmPasswordValue = '';
    this.loginError = '';
    this.closeAccountMenu();
    this.closeContextMenu();
  };

  closeSettings = () => {
    this.settingsOpen = false;
    this.loginOpen = false;
  };

  setSettingsSection = (section: SettingsSection) => {
    this.settingsSection = section;
  };

  changeSort = (event: Event) => {
    this.noteSort = (event.currentTarget as HTMLSelectElement)
      .value as NoteSort;
    setStoredSort(this.noteSort);
  };

  toggleNoteSelection = (note: LocalNote, selected: boolean) => {
    const next = new Set(this.selectedNoteIds);
    if (selected) {
      next.add(note.id);
    } else {
      next.delete(note.id);
    }
    this.selectedNoteIds = next;
    this.selectedNotebookMenuOpen = false;
  };

  toggleAllVisibleNotes = (selected: boolean) => {
    const next = new Set(this.selectedNoteIds);
    for (const note of this.visibleNotes) {
      if (selected) {
        next.add(note.id);
      } else {
        next.delete(note.id);
      }
    }
    this.selectedNoteIds = next;
    this.selectedNotebookMenuOpen = false;
  };

  clearSelectedNotes = () => {
    this.selectedNoteIds = new Set();
    this.selectedNotebookMenuOpen = false;
  };

  toggleSelectedNotebookMenu = () => {
    if (!this.selectedActiveNoteCount) return;
    this.selectedNotebookMenuOpen = !this.selectedNotebookMenuOpen;
    this.linkingNoteId = null;
    this.closeContextMenu();
  };

  toggleNotebookMenuForNote = (note: LocalNote) => {
    if (note.trashedAt) return;
    this.linkingNoteId = this.linkingNoteId === note.id ? null : note.id;
    this.selectedNotebookMenuOpen = false;
    this.closeContextMenu();
  };

  assignNotebookForSelected = async (notebookId: string | null) => {
    const notes = this.selectedNotes.filter((note) => !note.trashedAt);
    if (!notes.length) return;
    const assigned =
      notebookId === null
        ? false
        : !notes.every((note) => noteNotebookIds(note).includes(notebookId));
    for (const note of notes) {
      await assignNoteToNotebook(note.id, notebookId, assigned);
    }
    this.selectedNotebookMenuOpen = false;
    await this.refresh();
  };

  selectedNotesHaveNotebook = (notebookId: string | null): boolean => {
    const notes = this.selectedNotes.filter((note) => !note.trashedAt);
    if (!notes.length) return false;
    if (notebookId === null)
      return notes.every((note) => noteNotebookIds(note).length === 0);
    return notes.every((note) => noteNotebookIds(note).includes(notebookId));
  };

  trashSelectedNotes = async () => {
    const notes = this.selectedNotes.filter((note) => !note.trashedAt);
    if (!notes.length) return;
    await this.flushPendingSave();
    for (const note of notes) {
      await moveNoteToTrash(note.id);
    }
    const selectedNoteWasTrashed = Boolean(
      this.selectedNote &&
      notes.some((note) => note.id === this.selectedNote?.id)
    );
    this.clearSelectedNotes();
    await this.refresh();

    if (selectedNoteWasTrashed) {
      const next = this.notes.find((candidate) => !candidate.trashedAt) ?? null;
      if (next) {
        await this.selectNote(next);
      } else {
        await this.newNote();
      }
    }
  };

  restoreSelectedNotes = async () => {
    const notes = this.selectedNotes.filter((note) => note.trashedAt);
    if (!notes.length) return;
    for (const note of notes) {
      await restoreNote(note.id);
    }
    const firstRestoredId = notes[0]?.id ?? null;
    this.filterId = 'all';
    this.clearSelectedNotes();
    await this.refresh();
    const restored = firstRestoredId
      ? this.notes.find((note) => note.id === firstRestoredId)
      : null;
    if (restored) await this.selectNote(restored);
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

  contextTrashNote = async (note: LocalNote) => {
    this.closeContextMenu();
    await this.trashNote(note);
  };

  contextRestoreNote = async (note: LocalNote) => {
    this.closeContextMenu();
    await this.restoreNoteFromRow(note);
  };

  contextAssignNotebookForNote = async (
    note: LocalNote,
    notebookId: string | null
  ) => {
    await this.assignNotebookForNote(note, notebookId);
    this.closeContextMenu();
  };

  contextCreateNotebookForNote = async (
    note: LocalNote,
    rawName: string
  ): Promise<string | null> => {
    const name = rawName.trim();
    if (!name) return 'Name required';
    if (
      this.localNotebookNameExists(name) ||
      (await notebookNameExists(name))
    ) {
      return 'Notebook already exists';
    }

    const notebook = await createNotebook(name);
    if (!notebook) return 'Notebook already exists';

    const updated = await assignNoteToNotebook(note.id, notebook.id, true);
    if (updated && this.selectedNote?.id === note.id) {
      this.selectedNote = updated;
    }
    this.filterId = notebook.id;
    await this.refresh();
    this.closeContextMenu();
    return null;
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
    const selectedNoteWasInNotebook = Boolean(
      this.selectedNote &&
      !this.selectedNote.trashedAt &&
      noteNotebookIds(this.selectedNote).includes(notebook.id)
    );

    await deleteNotebook(notebook.id);

    if (this.filterId === notebook.id) {
      this.filterId = 'all';
    }

    this.deletingNotebookId = null;
    await this.refresh();

    if (selectedNoteWasInNotebook) {
      const next = this.notes.find((note) => note.id !== this.selectedNote?.id);
      if (next) {
        await this.selectNote(next);
      } else {
        await this.newNote();
      }
    }
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

    await this.flushPendingSave();

    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.retrySyncTimer) {
      clearTimeout(this.retrySyncTimer);
      this.retrySyncTimer = null;
    }
    this.isSyncing = true;
    this.syncMessage = 'Saving locally';
    let syncCompleted = false;
    try {
      const result = await runSync(token);
      this.syncMessage =
        result.conflicts > 0
          ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
          : 'Local changes saved';
      await this.refresh();
      await this.refreshRemoteSyncStatus(token);
      this.pollRemoteSyncStatusIfBusy();
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

  exportMarkdown = async () => {
    if (this.isArchiveBusy) return;
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
      this.notify('success', 'Export complete', this.syncMessage);
      await this.yieldToUi();
    } catch (error) {
      this.syncMessage =
        error instanceof Error ? error.message : 'Export failed';
      this.notify('error', 'Export failed', this.syncMessage);
    } finally {
      this.endArchiveOperation();
    }
  };

  startMarkdownImport = () => {
    if (this.isArchiveBusy) return;
    this.importMarkdownInput?.click();
  };

  handleMarkdownImport = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (!files.length || this.isArchiveBusy) return;

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

      const message = importNotesMarkdownSummary(result);
      this.syncMessage = message;
      this.importBanner = {
        kind: 'success',
        title: 'Import succeeded',
        message
      };
      this.notify('success', 'Import succeeded', message);
      this.updateArchiveOperation('Done', 100);
      await this.yieldToUi();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      this.syncMessage = message;
      this.importBanner = {
        kind: 'error',
        title: 'Import failed',
        message
      };
      this.notify('error', 'Import failed', message);
    } finally {
      this.endArchiveOperation(true);
    }
  };

  toggleLoginMenu = () => {
    this.loginOpen = true;
    this.newNotebookOpen = false;
    this.authMode = 'signin';
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.signupDisplayNameValue = '';
    this.signupConfirmPasswordValue = '';
    this.loginError = '';
    this.closeAccountMenu();
  };

  closeLoginModal = () => {
    if (this.isLoggingIn) return;
    this.loginOpen = false;
    this.loginPasswordValue = '';
    this.signupConfirmPasswordValue = '';
    this.loginError = '';
  };

  setAuthMode = (mode: AuthMode) => {
    if (this.isLoggingIn || this.authMode === mode) return;
    this.authMode = mode;
    this.loginError = '';
    this.loginPasswordValue = '';
    this.signupConfirmPasswordValue = '';
    if (mode === 'signin') {
      this.signupDisplayNameValue = '';
      this.loginUsernameValue = getLoginHint();
    }
  };

  startAccountProfileEdit = () => {
    this.accountProfileEditing = true;
    this.accountPasswordEditing = false;
    this.accountDeleteEditing = false;
    this.accountError = '';
    this.accountMessage = '';
  };

  cancelAccountProfileEdit = () => {
    this.accountProfileEditing = false;
    this.accountDisplayName = getStoredSession()?.user.displayName ?? '';
    this.accountError = '';
  };

  startAccountPasswordEdit = () => {
    this.accountPasswordEditing = true;
    this.accountProfileEditing = false;
    this.accountDeleteEditing = false;
    this.currentPasswordValue = '';
    this.newPasswordValue = '';
    this.confirmPasswordValue = '';
    this.accountError = '';
    this.accountMessage = '';
  };

  cancelAccountPasswordEdit = () => {
    this.accountPasswordEditing = false;
    this.currentPasswordValue = '';
    this.newPasswordValue = '';
    this.confirmPasswordValue = '';
    this.accountError = '';
  };

  startAccountDeleteEdit = () => {
    this.accountDeleteEditing = true;
    this.accountProfileEditing = false;
    this.accountPasswordEditing = false;
    this.deletePasswordValue = '';
    this.accountError = '';
    this.accountMessage = '';
  };

  cancelAccountDeleteEdit = () => {
    this.accountDeleteEditing = false;
    this.deletePasswordValue = '';
    this.accountError = '';
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
    if (
      this.authMode === 'signup' &&
      password !== this.signupConfirmPasswordValue
    ) {
      this.loginError = 'Passwords do not match';
      return;
    }

    this.isLoggingIn = true;
    this.loginError = '';
    let shouldSync = false;
    try {
      const storedUsername = getStoredSession()?.user.username ?? '';
      const previousUsername =
        storedUsername.trim() || getLoginHint().trim() || null;
      await assertLocalWorkspaceCanUseAccount(username, previousUsername);
      const session =
        this.authMode === 'signup'
          ? await signup(username, password, this.signupDisplayNameValue)
          : await login(username, password);
      const encryption = await rememberEncryptionPassword(
        session.user.username,
        password
      );
      await adoptLocalWorkspaceForAccount({
        username: session.user.username,
        fallbackOwnerUsername: previousUsername,
        previousMaterial: encryption.previousMaterial,
        nextMaterial: encryption.nextMaterial
      });
      setStoredSession({
        token: session.token,
        user: session.user,
        expiresAt: session.expiresAt
      });
      this.hasToken = true;
      this.accountUsername = session.user.username;
      this.accountDisplayName = session.user.displayName ?? '';
      this.accountError = '';
      this.accountMessage =
        this.authMode === 'signup' ? 'Account created' : 'Signed in';
      this.loginOpen = false;
      this.authMode = 'signin';
      this.loginUsernameValue = session.user.username;
      this.loginPasswordValue = '';
      this.signupDisplayNameValue = '';
      this.signupConfirmPasswordValue = '';
      this.syncMessage = 'Signed in';
      this.notify(
        'success',
        this.accountMessage,
        'Syncing local and remote notes.'
      );
      await this.refresh();
      shouldSync = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      this.loginError = message;
      this.syncMessage = message;
      this.notify('error', 'Sign-in failed', message);
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
      this.accountProfileEditing = false;
      this.notify('success', 'Profile saved');
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not save profile';
      this.notify('error', 'Profile update failed', this.accountError);
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
      this.accountPasswordEditing = false;
      this.clearLocalSession({
        accountMessage: 'Password changed. Sign in again to keep syncing.',
        openLogin: true,
        syncMessage: 'Sign in to sync'
      });
      this.loginUsernameValue = response.user.username;
      this.notify(
        'success',
        'Password changed',
        'Sign in again to keep syncing.'
      );
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not change password';
      this.notify('error', 'Password change failed', this.accountError);
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
      this.notify('info', 'Signed out', 'This browser is no longer syncing.');
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
      await this.flushPendingSave();
      await deleteAccount(token, { password: this.deletePasswordValue });
      await clearLocalWorkspace();
      await this.refresh();
      this.openDraftNote();
      this.deletePasswordValue = '';
      this.accountDeleteEditing = false;
      this.clearLocalSession({
        accountMessage: 'Account deleted',
        syncMessage: 'Sign in to sync'
      });
      this.notify('info', 'Account deleted');
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not delete account';
      this.notify('error', 'Delete account failed', this.accountError);
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
      await rememberLocalWorkspaceAccount(session.user.username);
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
    this.pruneSelectedNotes(notes, trash);
  };

  private clearPendingSave = () => {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  };

  private closeNotebookMenus = () => {
    this.linkingNoteId = null;
    this.selectedNotebookMenuOpen = false;
  };

  private pruneSelectedNotes = (notes: LocalNote[], trash: LocalNote[]) => {
    if (!this.selectedNoteIds.size) return;
    const noteIds = new Set([...notes, ...trash].map((note) => note.id));
    const selectedNoteIds = [...this.selectedNoteIds].filter((noteId) =>
      noteIds.has(noteId)
    );
    if (selectedNoteIds.length !== this.selectedNoteIds.size) {
      this.selectedNoteIds = new Set(selectedNoteIds);
    }
    if (!selectedNoteIds.length) {
      this.selectedNotebookMenuOpen = false;
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
    this.closeNotebookMenus();
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
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  private beginArchiveOperation = (
    label: string,
    detail: string,
    progress: number
  ) => {
    this.settingsSection = 'data';
    this.isImporting = true;
    this.archiveOperation = { label, detail, progress };
    this.importBanner = null;
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
    this.accountProfileEditing = false;
    this.accountPasswordEditing = false;
    this.accountDeleteEditing = false;
    this.currentPasswordValue = '';
    this.newPasswordValue = '';
    this.confirmPasswordValue = '';
    this.deletePasswordValue = '';
    this.loginUsernameValue = getLoginHint();
    this.loginPasswordValue = '';
    this.signupDisplayNameValue = '';
    this.signupConfirmPasswordValue = '';
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
    if (this.remoteStatusTimer) {
      clearTimeout(this.remoteStatusTimer);
      this.remoteStatusTimer = null;
    }
    this.remoteSyncEnabled = false;
    this.remoteSyncState = 'unknown';
    this.remoteSyncError = '';
    if (openLogin) {
      this.settingsOpen = false;
    }
  };

  dismissNotification = (id: string) => {
    const timer = this.notificationTimers.get(id);
    if (timer) clearTimeout(timer);
    this.notificationTimers.delete(id);
    this.notifications = this.notifications.filter(
      (notification) => notification.id !== id
    );
  };

  private notify = (
    kind: AppNotification['kind'],
    title: string,
    message = ''
  ) => {
    const id = crypto.randomUUID();
    this.notifications = [
      ...this.notifications.slice(-2),
      { id, kind, title, message }
    ];
    const duration = kind === 'error' ? 7000 : 4200;
    const timer = setTimeout(() => {
      this.dismissNotification(id);
    }, duration);
    this.notificationTimers.set(id, timer);
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

  private refreshRemoteSyncStatus = async (
    token = getStoredSession()?.token ?? null
  ) => {
    if (!token || !this.isBrowserOnline) return;
    try {
      const status = await loadSyncStatus(token);
      this.remoteSyncEnabled = status.remote.enabled;
      this.remoteSyncState = status.remote.state;
      this.remoteSyncError = status.remote.lastError ?? '';
    } catch (error) {
      if (error instanceof AuthError) {
        this.expireSession(error.message);
        return;
      }
      this.remoteSyncEnabled = true;
      this.remoteSyncState = 'error';
      this.remoteSyncError =
        error instanceof Error ? error.message : 'Could not check remote sync';
    }
  };

  private pollRemoteSyncStatusIfBusy = () => {
    if (this.remoteStatusTimer) {
      clearTimeout(this.remoteStatusTimer);
      this.remoteStatusTimer = null;
    }
    if (
      !this.hasToken ||
      !this.remoteSyncEnabled ||
      (this.remoteSyncState !== 'queued' && this.remoteSyncState !== 'syncing')
    ) {
      return;
    }

    this.remoteStatusTimer = setTimeout(async () => {
      this.remoteStatusTimer = null;
      await this.refreshRemoteSyncStatus();
      this.pollRemoteSyncStatusIfBusy();
    }, 1500);
  };

  private expireSession = (message = 'Login expired') => {
    const displayMessage =
      message.toLowerCase() === 'unauthorized' ? 'Login expired' : message;
    this.clearLocalSession({
      accountMessage: displayMessage,
      openLogin: true,
      syncMessage: displayMessage
    });
    this.notify('error', 'Session ended', displayMessage);
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
    this.notify('error', 'Sync failed', this.syncMessage);
    this.scheduleSyncRetry();
  };
}

export function createNotesPageController(): NotesPageController {
  return new NotesPageController();
}
