import { onMount, tick } from 'svelte';
import type { Device } from '@author/schema';
import type { RemoteSyncState, TrustedAuthDevice } from '@author/api-types';
import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
import {
  getEncryptionKeyMaterialStorageMode,
  hasStoredEncryptionKeyMaterial,
  setEncryptionKeyMaterialStorageMode,
  type EncryptionKeyMaterialStorageMode
} from '$lib/client/encryption';
import {
  clearDebugLog,
  debugLogUpdatedEventName,
  formatDebugLogEntries,
  installFrontendDebugLogging,
  loadDebugLogEntries,
  recordDebugLog,
  type DebugLogEntry
} from '$lib/client/debug-log';
import { noteNotebookIds, normalizeNotebookName } from '$lib/client/note-utils';
import {
  clearStoredSession,
  ensureLocalNotesEncrypted,
  getTheme,
  getOrCreateDevice,
  loadDevices,
  loadLastSyncPass,
  loadNotes,
  loadNotebooks,
  loadPendingConflicts,
  loadPendingSyncCount,
  loadSyncDebugInfo,
  loadTrash,
  getLoginHint,
  getStoredSession,
  setTheme,
  watchSystemTheme,
  type ResolvedTheme
} from '$lib/client/store';
import { loadConfig } from '$lib/client/api-client';
import type { SyncProgress } from '$lib/client/sync';
import {
  countNotesByNotebook,
  countWords,
  filterNotesBySearch,
  filterNotesForView,
  groupNotes,
  sortNotes,
  syncIndicatorState,
  type NoteGroupBy,
  type NoteSort
} from '$lib/client/view-model';
import {
  editorMetadataRowsForNote,
  formatSyncDebugLog,
  formatSyncPassDetail,
  formatSyncPassTime,
  metadataRowsForNote
} from './copy';
import type {
  AppNotification,
  ArchiveOperation,
  AuthMode,
  ConflictChoice,
  ConflictDialogModel,
  ContextMenuModel,
  EditorPaneModel,
  ImportBanner,
  MetadataRow,
  NavigationDockModel,
  NotesFilterId,
  NotificationStackModel,
  SettingsModalModel,
  SettingsSection,
  Theme
} from './models';
import {
  EDITOR_FONT_OPTIONS,
  getEditorFontCss,
  getStoredCompactView,
  getStoredEditorFont,
  getStoredEditorLineHeight,
  getStoredEditorTextSize,
  getStoredEditorZoom,
  getStoredGroup,
  applyAppFont,
  getStoredSort,
  MAX_EDITOR_LINE_HEIGHT,
  MAX_EDITOR_TEXT_SIZE,
  MAX_EDITOR_ZOOM,
  MIN_EDITOR_LINE_HEIGHT,
  MIN_EDITOR_TEXT_SIZE,
  MIN_EDITOR_ZOOM,
  type EditorFont,
  zoomPercent as formatZoomPercent
} from './page-preferences';
import type { ContextMenuState, EditorSnapshot } from './ui-types';
import * as accountActions from './actions/account';
import * as archiveActions from './actions/archive';
import * as editorActions from './actions/editor';
import * as libraryActions from './actions/library';
import * as syncActions from './actions/sync';
import * as uiActions from './actions/ui';

export type {
  AppNotification,
  ArchiveOperation,
  AuthMode,
  ConflictChoice,
  ConflictDialogModel,
  ContextMenuModel,
  EditorPaneModel,
  ImportBanner,
  MetadataRow,
  NavigationDockModel,
  NoteListPanelModel,
  NotebookSidebarModel,
  NotesFilterId,
  NotificationStackModel,
  SettingsModalModel,
  SettingsSection,
  Theme
} from './models';

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
  syncActivityLabel = $state('');
  syncActivityDetail = $state('');
  remoteSyncEnabled = $state(false);
  remoteSyncState = $state<RemoteSyncState | 'unknown'>('unknown');
  remoteSyncError = $state('');
  isSyncing = $state(false);
  isLoggingIn = $state(false);
  isAccountBusy = $state(false);
  hasToken = $state(false);
  accountUsername = $state('');
  accountEmail = $state('');
  accountDisplayName = $state('');
  accountTwoFactorEnabled = $state(false);
  accountTrustedDevices = $state<TrustedAuthDevice[]>([]);
  accountMessage = $state('');
  accountError = $state('');
  accountProfileEditing = $state(false);
  accountPasswordEditing = $state(false);
  accountTotpEditing = $state(false);
  accountTotpSecret = $state('');
  accountTotpUrl = $state('');
  accountTotpCodeValue = $state('');
  accountTotpPasswordValue = $state('');
  accountDeleteEditing = $state(false);
  currentDeviceName = $state('');
  deviceNameEditing = $state(false);
  deviceNameValue = $state('');
  deviceNameError = $state('');
  encryptionKeyStorageMode =
    $state<EncryptionKeyMaterialStorageMode>('persistent');
  currentPasswordValue = $state('');
  newPasswordValue = $state('');
  confirmPasswordValue = $state('');
  deletePasswordValue = $state('');
  isBrowserOnline = $state(true);
  theme = $state<Theme>('light');
  resolvedTheme = $state<ResolvedTheme>('light');
  newNotebookOpen = $state(false);
  notebookNameValue = $state('');
  notebookError = $state('');
  loginOpen = $state(false);
  authMode = $state<AuthMode>('signin');
  deviceOtpLoginAvailable = $state(false);
  loginUsernameValue = $state('');
  loginPasswordValue = $state('');
  loginTotpCodeValue = $state('');
  signupEmailValue = $state('');
  signupConfirmPasswordValue = $state('');
  signupEnabled = $state(false);
  signupEmailRequired = $state(true);
  loginError = $state('');
  renamingNotebookId = $state<string | null>(null);
  renameNotebookValue = $state('');
  renameNotebookError = $state('');
  deletingNotebookId = $state<string | null>(null);
  noteSort = $state<NoteSort>('date-desc');
  noteGroup = $state<NoteGroupBy>('smart');
  searchValue = $state('');
  compactView = $state(false);
  editorZoom = $state(1);
  editorFont = $state<EditorFont>('kedebideri');
  editorTextSize = $state(16);
  editorLineHeight = $state(1.75);
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
  lastSyncPass = $state({
    completedAt: null as string | null,
    pushed: 0,
    pulled: 0,
    conflicts: 0
  });
  syncDebugInfo = $state({
    lastErrorAt: null as string | null,
    lastErrorMessage: '',
    lastErrorStack: ''
  });
  appDebugLogEntries = $state<DebugLogEntry[]>([]);

  titleInput: HTMLInputElement | null = null;
  bodyTextarea: HTMLTextAreaElement | null = null;
  importMarkdownInput: HTMLInputElement | null = null;
  settingsModal: HTMLElement | null = null;
  loginModal: HTMLElement | null = null;
  readonly minEditorZoom = MIN_EDITOR_ZOOM;
  readonly maxEditorZoom = MAX_EDITOR_ZOOM;
  readonly minEditorTextSize = MIN_EDITOR_TEXT_SIZE;
  readonly maxEditorTextSize = MAX_EDITOR_TEXT_SIZE;
  readonly minEditorLineHeight = MIN_EDITOR_LINE_HEIGHT;
  readonly maxEditorLineHeight = MAX_EDITOR_LINE_HEIGHT;
  readonly editorFontOptions = EDITOR_FONT_OPTIONS;

  saveTimer: ReturnType<typeof setTimeout> | null = null;
  pendingSaveNoteId: string | null = null;
  autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  retrySyncTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineSessionTimer: ReturnType<typeof setInterval> | null = null;
  menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  accountMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  remoteStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  draftCreatePromise: Promise<LocalNote> | null = null;
  editorSessionId = 0;
  syncQueued = false;
  lastHistorySnapshot: EditorSnapshot = { title: '', body: '' };

  filteredNotes = $derived(
    filterNotesForView(this.notes, this.trash, this.filterId)
  );
  searchedNotes = $derived(
    filterNotesBySearch(this.filteredNotes, this.searchValue)
  );
  visibleNotes = $derived(sortNotes(this.searchedNotes, this.noteSort));
  visibleNoteGroups = $derived(
    groupNotes(
      this.visibleNotes,
      this.noteSort,
      this.noteGroup,
      this.currentTime
    )
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
      syncActivityLabel: this.syncActivityLabel,
      syncActivityDetail: this.syncActivityDetail,
      remoteSyncEnabled: this.remoteSyncEnabled,
      remoteSyncState: this.remoteSyncState,
      remoteSyncError: this.remoteSyncError
    })
  );
  lastSyncPassTitle = $derived(
    this.lastSyncPass.completedAt
      ? formatSyncPassTime(this.lastSyncPass.completedAt)
      : 'No completed pass yet'
  );
  lastSyncPassDetail = $derived(formatSyncPassDetail(this.lastSyncPass));
  syncDebugTitle = $derived(
    this.syncDebugInfo.lastErrorAt
      ? formatSyncPassTime(this.syncDebugInfo.lastErrorAt)
      : 'No sync errors yet'
  );
  syncDebugDetail = $derived(
    this.syncDebugInfo.lastErrorMessage ||
      'The most recent sync error will appear here.'
  );
  syncDebugLog = $derived(formatSyncDebugLog(this.syncDebugInfo));
  appDebugTitle = $derived(
    this.appDebugLogEntries.at(-1)?.at
      ? formatSyncPassTime(this.appDebugLogEntries.at(-1)?.at ?? '')
      : 'No diagnostic logs recorded'
  );
  appDebugDetail = $derived(
    this.appDebugLogEntries.at(-1)
      ? `${this.appDebugLogEntries.length} entries saved locally`
      : 'App, database, sync, and worker logs will appear here.'
  );
  appDebugLog = $derived(formatDebugLogEntries(this.appDebugLogEntries));
  contextNote = $derived(this.getContextNote(this.contextMenu));
  contextNotebook = $derived(this.getContextNotebook(this.contextMenu));
  selectedDeviceName = $derived(
    this.selectedNote ? this.deviceName(this.selectedNote.deviceId) : ''
  );
  editorMetadataRows = $derived(
    this.selectedNote
      ? editorMetadataRowsForNote(
          this.selectedNote,
          this.deviceName(this.selectedNote.deviceId)
        )
      : [{ label: 'Status', value: 'Unsaved draft' }]
  );
  isArchiveBusy = $derived(Boolean(this.archiveOperation) || this.isImporting);
  canUndoEditor = $derived(
    this.undoStack.length > 0 && !this.selectedNote?.trashedAt
  );
  canRedoEditor = $derived(
    this.redoStack.length > 0 && !this.selectedNote?.trashedAt
  );
  editorFontCss = $derived(getEditorFontCss(this.editorFont));

  constructor() {
    $effect(() => {
      if (this.settingsOpen) void this.focusSettingsModal();
    });

    $effect(() => {
      if (this.loginOpen) void this.focusLoginModal();
    });

    $effect(() => {
      if (this.hasToken && this.isBrowserOnline && this.pendingSyncCount > 0) {
        this.scheduleSync(AUTO_SYNC_DELAY_MS);
      }
    });

    onMount(() => {
      const stopDebugLogging = installFrontendDebugLogging();
      const handleDebugLogUpdated = () => {
        this.appDebugLogEntries = loadDebugLogEntries();
      };
      window.addEventListener(
        debugLogUpdatedEventName(),
        handleDebugLogUpdated
      );
      this.appDebugLogEntries = loadDebugLogEntries();
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
      window.addEventListener('pagehide', this.handlePageHide);
      const stopWatchingSystemTheme = watchSystemTheme((theme) => {
        this.resolvedTheme = theme;
      });

      void this.initialize();

      return () => {
        clearInterval(clock);
        void this.flushPendingSave();
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
        window.removeEventListener('pagehide', this.handlePageHide);
        window.removeEventListener(
          debugLogUpdatedEventName(),
          handleDebugLogUpdated
        );
        stopWatchingSystemTheme();
        stopDebugLogging();
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
      return;
    }

    void this.flushPendingSave().then(() => this.scheduleSync(0));
  };

  handlePageHide = () => {
    void this.flushPendingSave();
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
    const insideContextMenu = this.eventPathMatches(event, '.context-menu');
    if (!insideContextMenu) {
      this.closeContextMenu();
    }
    if (
      !this.eventPathMatches(
        event,
        '.menu-dock, .batch-actions, .batch-popover, .link-popover, .row-actions, .context-menu'
      )
    ) {
      this.closeNotebookMenus();
    }
    if (!this.eventPathMatches(event, '.profile-menu')) {
      this.closeAccountMenu();
    }
    if (!this.settingsOpen) return;
    if (
      this.eventPathMatches(
        event,
        '.settings-modal, .login-layer, .login-modal, .profile-menu'
      )
    )
      return;
    this.closeSettings();
  };

  private eventPathMatches(event: Event, selector: string): boolean {
    return event
      .composedPath()
      .some((node) => node instanceof Element && node.matches(selector));
  }

  selectNote = async (note: LocalNote) => {
    await editorActions.selectNote(this, note);
  };

  newNote = async () => {
    await editorActions.newNote(this);
  };

  handleEditorInput = (event: Event, field: 'title' | 'body') => {
    editorActions.handleEditorInput(this, event, field);
  };

  undoEditorHistory = () => {
    editorActions.undoEditorHistory(this);
  };

  redoEditorHistory = () => {
    editorActions.redoEditorHistory(this);
  };

  openMenus = () => {
    uiActions.openMenus(this);
  };

  toggleMenus = () => {
    uiActions.toggleMenus(this);
  };

  openAccountMenu = () => {
    uiActions.openAccountMenu(this);
  };

  closeAccountMenu = () => {
    uiActions.closeAccountMenu(this);
  };

  scheduleAccountMenuClose = () => {
    uiActions.scheduleAccountMenuClose(this);
  };

  scheduleMenusClose = () => {
    uiActions.scheduleMenusClose(this);
  };

  closeMenusOnBlur = (event: FocusEvent) => {
    uiActions.closeMenusOnBlur(this, event);
  };

  closeAccountMenuOnBlur = (event: FocusEvent) => {
    uiActions.closeAccountMenuOnBlur(this, event);
  };

  openSettingsModal = (section: SettingsSection = 'account') => {
    uiActions.openSettingsModal(this, section);
  };

  openLoginSettings = () => {
    this.settingsOpen = false;
    accountActions.openLoginSettings(this);
    this.closeContextMenu();
  };

  closeSettings = () => {
    uiActions.closeSettings(this);
  };

  setSettingsSection = (section: SettingsSection) => {
    uiActions.setSettingsSection(this, section);
  };

  clearAppDebugLog = () => {
    clearDebugLog();
    this.appDebugLogEntries = [];
  };

  changeSort = (event: Event) => {
    uiActions.changeSort(this, event);
  };

  setNoteSort = (sort: NoteSort) => {
    uiActions.setNoteSort(this, sort);
  };

  setNoteGroup = (group: NoteGroupBy) => {
    uiActions.setNoteGroup(this, group);
  };

  toggleNoteSelection = (note: LocalNote, selected: boolean) => {
    libraryActions.toggleNoteSelection(this, note, selected);
  };

  toggleAllVisibleNotes = (selected: boolean) => {
    libraryActions.toggleAllVisibleNotes(this, selected);
  };

  clearSelectedNotes = () => {
    libraryActions.clearSelectedNotes(this);
  };

  toggleSelectedNotebookMenu = () => {
    libraryActions.toggleSelectedNotebookMenu(this);
  };

  toggleNotebookMenuForNote = (note: LocalNote) => {
    libraryActions.toggleNotebookMenuForNote(this, note);
  };

  assignNotebookForSelected = async (notebookId: string | null) => {
    await libraryActions.assignNotebookForSelected(this, notebookId);
  };

  selectedNotesHaveNotebook = (notebookId: string | null): boolean => {
    return libraryActions.selectedNotesHaveNotebook(this, notebookId);
  };

  trashSelectedNotes = async () => {
    await libraryActions.trashSelectedNotes(this);
  };

  restoreSelectedNotes = async () => {
    await libraryActions.restoreSelectedNotes(this);
  };

  deleteSelectedNotesPermanently = async () => {
    await libraryActions.deleteSelectedNotesPermanently(this);
  };

  toggleCompactView = () => {
    uiActions.toggleCompactView(this);
  };

  zoomEditor = (direction: -1 | 1) => {
    uiActions.zoomEditor(this, direction);
  };

  zoomPercent = (): string => formatZoomPercent(this.editorZoom);

  setEditorFont = (font: EditorFont) => {
    uiActions.setEditorFont(this, font);
  };

  setEditorTextSize = (size: number) => {
    uiActions.setEditorTextSize(this, size);
  };

  setEditorLineHeight = (lineHeight: number) => {
    uiActions.setEditorLineHeight(this, lineHeight);
  };

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

  contextDeleteNotePermanently = async (note: LocalNote) => {
    this.closeContextMenu();
    await this.deleteNotePermanentlyFromRow(note);
  };

  contextNoteMetadataRows = (note: LocalNote): MetadataRow[] =>
    metadataRowsForNote(
      note,
      countWords(`${note.title} ${note.body}`),
      this.deviceName(note.deviceId)
    );

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
    return libraryActions.contextCreateNotebookForNote(this, note, rawName);
  };

  assignNotebookForNote = async (
    note: LocalNote,
    notebookId: string | null
  ) => {
    await libraryActions.assignNotebookForNote(this, note, notebookId);
  };

  toggleNewNotebookMenu = () => {
    libraryActions.toggleNewNotebookMenu(this);
  };

  submitNewNotebookMenu = async () => {
    await libraryActions.submitNewNotebookMenu(this);
  };

  startRenameNotebook = (notebook: LocalNotebook) => {
    libraryActions.startRenameNotebook(this, notebook);
  };

  cancelRenameNotebook = () => {
    libraryActions.cancelRenameNotebook(this);
  };

  submitRenameNotebook = async (notebook: LocalNotebook) => {
    await libraryActions.submitRenameNotebook(this, notebook);
  };

  askDeleteNotebook = (notebook: LocalNotebook) => {
    libraryActions.askDeleteNotebook(this, notebook);
  };

  cancelDeleteNotebook = () => {
    libraryActions.cancelDeleteNotebook(this);
  };

  confirmDeleteNotebook = async (notebook: LocalNotebook) => {
    await libraryActions.confirmDeleteNotebook(this, notebook);
  };

  trashNote = async (note: LocalNote) => {
    await libraryActions.trashNote(this, note);
  };

  restoreNoteFromRow = async (note: LocalNote) => {
    await libraryActions.restoreNoteFromRow(this, note);
  };

  deleteNotePermanentlyFromRow = async (note: LocalNote) => {
    await libraryActions.deleteNotePermanentlyFromRow(this, note);
  };

  syncNow = async () => {
    await syncActions.syncNow(this);
  };

  exportMarkdown = async () => {
    await archiveActions.exportMarkdown(this);
  };

  startMarkdownImport = () => {
    archiveActions.startMarkdownImport(this);
  };

  handleMarkdownImport = async (event: Event) => {
    await archiveActions.handleMarkdownImport(this, event);
  };

  toggleLoginMenu = () => {
    this.newNotebookOpen = false;
    accountActions.openLoginSettings(this);
  };

  closeLoginModal = () => {
    accountActions.closeLoginModal(this);
  };

  setAuthMode = (mode: AuthMode) => {
    accountActions.setAuthMode(this, mode);
  };

  startAccountProfileEdit = () => {
    accountActions.startAccountProfileEdit(this);
  };

  cancelAccountProfileEdit = () => {
    accountActions.cancelAccountProfileEdit(this);
  };

  startDeviceNameEdit = () => {
    accountActions.startDeviceNameEdit(this);
  };

  cancelDeviceNameEdit = () => {
    accountActions.cancelDeviceNameEdit(this);
  };

  saveDeviceName = async () => {
    await accountActions.saveDeviceName(this);
  };

  setEncryptionKeyStorageMode = (mode: EncryptionKeyMaterialStorageMode) => {
    setEncryptionKeyMaterialStorageMode(mode);
    this.encryptionKeyStorageMode = getEncryptionKeyMaterialStorageMode();
    this.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
    this.accountMessage =
      mode === 'session'
        ? 'Sync key will be forgotten when this browser session ends.'
        : 'Sync key will stay on this browser for offline restarts.';
  };

  startAccountPasswordEdit = () => {
    accountActions.startAccountPasswordEdit(this);
  };

  cancelAccountPasswordEdit = () => {
    accountActions.cancelAccountPasswordEdit(this);
  };

  startAccountTotpEdit = async () => {
    await accountActions.startAccountTotpEdit(this);
  };

  cancelAccountTotpEdit = () => {
    accountActions.cancelAccountTotpEdit(this);
  };

  startAccountDeleteEdit = () => {
    accountActions.startAccountDeleteEdit(this);
  };

  cancelAccountDeleteEdit = () => {
    accountActions.cancelAccountDeleteEdit(this);
  };

  submitLoginMenu = async () => {
    await accountActions.submitLoginMenu(this);
  };

  toggleTheme = () => {
    uiActions.toggleTheme(this);
  };

  setThemeChoice = (theme: Theme) => {
    uiActions.setThemeChoice(this, theme);
  };

  saveAccountProfile = async () => {
    await accountActions.saveAccountProfile(this);
  };

  changeAccountPassword = async () => {
    await accountActions.changeAccountPassword(this);
  };

  saveAccountTotp = async () => {
    await accountActions.saveAccountTotp(this);
  };

  revokeTrustedDevice = async (deviceId: string) => {
    await accountActions.revokeTrustedDevice(this, deviceId);
  };

  logoutAccount = async () => {
    await accountActions.logoutAccount(this);
  };

  deleteAccount = async () => {
    await accountActions.deleteAccount(this);
  };

  resolveActiveConflict = async (choice: ConflictChoice) => {
    await syncActions.resolveActiveConflict(this, choice);
  };

  conflictMessage = (conflict: LocalConflict): string => {
    if (conflict.conflict.reason === 'duplicate_name') {
      return 'A notebook with this name already exists. Keep the existing notebook or keep the local one as a renamed copy.';
    }

    return 'Choose which version to keep. Both versions are preserved until you decide.';
  };

  private initialize = async () => {
    recordDebugLog({
      level: 'info',
      source: 'App',
      message: 'Opening workspace'
    });
    try {
      this.theme = getTheme();
      this.resolvedTheme = setTheme(this.theme);
      this.noteSort = getStoredSort();
      this.noteGroup = getStoredGroup();
      this.compactView = getStoredCompactView();
      this.editorZoom = getStoredEditorZoom();
      this.editorFont = getStoredEditorFont();
      applyAppFont(this.editorFont);
      this.editorTextSize = getStoredEditorTextSize();
      this.editorLineHeight = getStoredEditorLineHeight();
      const storedSession = getStoredSession();
      this.accountUsername = storedSession?.user.username ?? '';
      this.accountEmail = storedSession?.user.email ?? '';
      this.accountDisplayName = storedSession?.user.displayName ?? '';
      this.accountTwoFactorEnabled = Boolean(
        storedSession?.user.twoFactorEnabled
      );
      this.loginUsernameValue = getLoginHint();
      this.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
      this.encryptionKeyStorageMode = getEncryptionKeyMaterialStorageMode();
      await this.refreshPublicConfig();
      if (storedSession?.token && !hasStoredEncryptionKeyMaterial()) {
        recordDebugLog({
          level: 'warn',
          source: 'App',
          message: 'Stored session has no encryption key material'
        });
        this.clearLocalSession({
          accountMessage: 'Sign in again to unlock notes.',
          openLogin: true,
          syncMessage: 'Sign in to unlock and sync'
        });
        return;
      }
      await ensureLocalNotesEncrypted();
      await this.refresh();
      if (!(await editorActions.restoreEditorRecovery(this))) {
        this.openDraftNote();
      }

      this.hasToken = Boolean(storedSession?.token);
      if (storedSession?.token) {
        await this.resumeOnlineSession(storedSession.token);
      }
      recordDebugLog({
        level: 'info',
        source: 'App',
        message: 'Workspace opened'
      });
    } catch (error) {
      recordDebugLog({
        level: 'error',
        source: 'App',
        message: 'Startup failed',
        detail: error
      });
      this.notify(
        'error',
        'Startup failed',
        error instanceof Error ? error.message : 'Could not open notes'
      );
    }
  };

  refreshPublicConfig = async () => {
    try {
      const config = await loadConfig();
      this.signupEnabled = config.signup.enabled;
      this.signupEmailRequired = config.signup.emailRequired;
      if (!this.signupEnabled && this.authMode === 'signup') {
        this.authMode = 'signin';
        this.signupEmailValue = '';
        this.signupConfirmPasswordValue = '';
      }
    } catch (error) {
      recordDebugLog({
        level: 'warn',
        source: 'API',
        message: 'Could not load public config',
        detail: error
      });
      this.signupEnabled = false;
      this.signupEmailRequired = true;
      if (this.authMode === 'signup') this.authMode = 'signin';
    }
  };

  refreshAccount = async (token = getStoredSession()?.token ?? null) => {
    await syncActions.refreshAccount(this, token);
  };

  private resumeOnlineSession = async (
    token = getStoredSession()?.token ?? null
  ) => {
    await syncActions.resumeOnlineSession(this, token);
  };

  refresh = async () => {
    try {
      const [
        notes,
        notebooks,
        trash,
        conflicts,
        devices,
        currentDevice,
        pendingSyncCount,
        lastSyncPass,
        syncDebugInfo
      ] = await Promise.all([
        loadNotes(),
        loadNotebooks(),
        loadTrash(),
        loadPendingConflicts(),
        loadDevices(),
        getOrCreateDevice(),
        loadPendingSyncCount(),
        loadLastSyncPass(),
        loadSyncDebugInfo()
      ]);

      this.notes = notes;
      this.notebooks = notebooks;
      this.trash = trash;
      this.conflicts = conflicts;
      this.devices = devices.some((device) => device.id === currentDevice.id)
        ? devices
        : [currentDevice, ...devices];
      this.currentDeviceName = currentDevice.name;
      if (!this.deviceNameEditing) this.deviceNameValue = currentDevice.name;
      this.pendingSyncCount = pendingSyncCount;
      this.lastSyncPass = lastSyncPass;
      this.syncDebugInfo = syncDebugInfo;
      this.refreshSelectedNote(notes, trash);
      this.pruneSelectedNotes(notes, trash);
    } catch (error) {
      recordDebugLog({
        level: 'error',
        source: 'Database',
        message: 'Could not load local workspace',
        detail: error
      });
      throw error;
    }
  };

  clearPendingSave = () => {
    editorActions.clearPendingSave(this);
  };

  closeNotebookMenus = () => {
    this.linkingNoteId = null;
    this.selectedNotebookMenuOpen = false;
  };

  closeMenus = () => {
    if (this.menuCloseTimer) {
      clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
    this.menusOpen = false;
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

  private refreshSelectedNote = (notes: LocalNote[], trash: LocalNote[]) => {
    if (!this.selectedNote) return;
    const current = [...notes, ...trash].find(
      (note) => note.id === this.selectedNote?.id
    );
    if (current) {
      this.selectedNote = current;
    }
  };

  flushPendingSave = async () => {
    await editorActions.flushPendingSave(this);
  };

  openDraftNote = () => {
    editorActions.openDraftNote(this);
  };

  clearSensitiveWorkspace = () => {
    editorActions.clearSensitiveWorkspace(this);
  };

  private focusEditor = async (target: 'title' | 'body') => {
    await editorActions.focusEditor(this, target);
  };

  private isEditorEventTarget = (target: EventTarget | null): boolean =>
    editorActions.isEditorEventTarget(this, target);

  closeContextMenu = () => {
    this.contextMenu = null;
  };

  private focusSettingsModal = async () => {
    await tick();
    this.settingsModal?.focus({ preventScroll: true });
  };

  private focusLoginModal = async () => {
    await tick();
    this.loginModal?.focus({ preventScroll: true });
  };

  downloadBlob = (blob: Blob, fileName: string) => {
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

  beginArchiveOperation = (label: string, detail: string, progress: number) => {
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

  updateArchiveOperation = (detail: string, progress: number) => {
    if (!this.archiveOperation) return;
    this.archiveOperation = {
      ...this.archiveOperation,
      detail,
      progress: Math.max(0, Math.min(100, progress))
    };
  };

  endArchiveOperation = (syncAfter = false) => {
    this.archiveOperation = null;
    this.isImporting = false;
    if (syncAfter || this.syncQueued) {
      this.syncQueued = false;
      this.scheduleSync(0);
    }
  };

  yieldToUi = async () => {
    await tick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  };

  clearLocalSession = ({
    accountMessage = '',
    clearEncryptionKeyMaterial = false,
    openLogin = false,
    syncMessage = 'Sign in to sync'
  }: {
    accountMessage?: string;
    clearEncryptionKeyMaterial?: boolean;
    openLogin?: boolean;
    syncMessage?: string;
  } = {}) => {
    clearStoredSession({ clearEncryptionKeyMaterial });
    this.hasToken = false;
    this.accountUsername = '';
    this.accountEmail = '';
    this.accountDisplayName = '';
    this.accountTwoFactorEnabled = false;
    this.accountTrustedDevices = [];
    this.accountMessage = accountMessage;
    this.accountError = '';
    this.accountProfileEditing = false;
    this.accountPasswordEditing = false;
    this.accountTotpEditing = false;
    this.accountDeleteEditing = false;
    this.accountTotpSecret = '';
    this.accountTotpUrl = '';
    this.accountTotpCodeValue = '';
    this.accountTotpPasswordValue = '';
    this.currentPasswordValue = '';
    this.newPasswordValue = '';
    this.confirmPasswordValue = '';
    this.deletePasswordValue = '';
    this.loginUsernameValue = getLoginHint();
    this.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
    this.loginPasswordValue = '';
    this.loginTotpCodeValue = '';
    this.signupEmailValue = '';
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

  notify = (kind: AppNotification['kind'], title: string, message = '') => {
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

  localNotebookNameExists = (name: string, excludeId?: string): boolean => {
    const normalized = normalizeNotebookName(name);
    if (!normalized) return false;
    return this.notebooks.some(
      (notebook) =>
        notebook.id !== excludeId &&
        normalizeNotebookName(notebook.name) === normalized
    );
  };

  scheduleSync = (delayMs = AUTO_SYNC_DELAY_MS) => {
    syncActions.scheduleSync(this, delayMs);
  };

  scheduleSyncRetry = () => {
    syncActions.scheduleSyncRetry(this, SYNC_RETRY_DELAY_MS);
  };

  updateSyncProgress = (progress: SyncProgress) => {
    syncActions.updateSyncProgress(this, progress);
  };

  refreshRemoteSyncStatus = async (
    token = getStoredSession()?.token ?? null
  ) => {
    await syncActions.refreshRemoteSyncStatus(this, token);
  };

  expireSession = (message = 'Sign-in expired') => {
    syncActions.expireSession(this, message);
  };

  handleSyncError = async (error: unknown) => {
    await syncActions.handleSyncError(this, error);
  };
}

export function createNotesPageController(): NotesPageController {
  return new NotesPageController();
}
