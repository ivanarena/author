import type { RemoteSyncState, TrustedAuthDevice } from '@author/api-types';
import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
import type { StoredTheme } from '$lib/client/local-state';
import type {
  NoteGroup,
  NoteSort,
  SyncIndicator
} from '$lib/client/view-model';
import type { EditorFont, EditorFontOption } from './page-preferences';
import type {
  ContextMenuState,
  EditorSnapshot,
  NoteCallback,
  NotebookAssignmentCallback,
  NotebookCallback
} from './ui-types';

export type NotesFilterId = 'all' | 'unfiled' | 'trash' | (string & {});
export type Theme = StoredTheme;
export type AuthMode = 'signin' | 'signup';
export type SettingsSection =
  | 'account'
  | 'sync'
  | 'data'
  | 'appearance'
  | 'legal';
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

export interface MetadataRow {
  label: string;
  value: string;
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
  setNoteSort: (sort: NoteSort) => void;
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
  deleteSelectedNotesPermanently: () => void | Promise<void>;
  openNoteContext: (event: MouseEvent, note: LocalNote) => void;
  restoreNoteFromRow: NoteCallback;
  deleteNotePermanentlyFromRow: NoteCallback;
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
  accountEmail: string;
  accountDisplayName: string;
  accountTwoFactorEnabled: boolean;
  accountTrustedDevices: TrustedAuthDevice[];
  accountMessage: string;
  accountError: string;
  accountProfileEditing: boolean;
  accountPasswordEditing: boolean;
  accountTotpEditing: boolean;
  accountDeleteEditing: boolean;
  accountTotpSecret: string;
  accountTotpUrl: string;
  accountTotpCodeValue: string;
  accountTotpPasswordValue: string;
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
  saveAccountTotp: () => void | Promise<void>;
  revokeTrustedDevice: (deviceId: string) => void | Promise<void>;
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
  editorFont: EditorFont;
  editorFontCss: string;
  editorTextSize: number;
  editorLineHeight: number;
  canUndoEditor: boolean;
  canRedoEditor: boolean;
  selectedDeviceName: string;
  editorMetadataRows: MetadataRow[];
  minEditorZoom: number;
  maxEditorZoom: number;
  minEditorTextSize: number;
  maxEditorTextSize: number;
  minEditorLineHeight: number;
  maxEditorLineHeight: number;
  editorFontOptions: EditorFontOption[];
  zoomPercent: () => string;
  zoomEditor: (direction: -1 | 1) => void;
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
  accountEmail: string;
  accountDisplayName: string;
  accountTwoFactorEnabled: boolean;
  accountTrustedDevices: TrustedAuthDevice[];
  accountMessage: string;
  accountError: string;
  accountProfileEditing: boolean;
  accountPasswordEditing: boolean;
  accountTotpEditing: boolean;
  accountDeleteEditing: boolean;
  accountTotpSecret: string;
  accountTotpUrl: string;
  accountTotpCodeValue: string;
  accountTotpPasswordValue: string;
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
  editorFont: EditorFont;
  editorTextSize: number;
  editorLineHeight: number;
  minEditorZoom: number;
  maxEditorZoom: number;
  minEditorTextSize: number;
  maxEditorTextSize: number;
  minEditorLineHeight: number;
  maxEditorLineHeight: number;
  editorFontOptions: EditorFontOption[];
  loginOpen: boolean;
  authMode: AuthMode;
  deviceOtpLoginAvailable: boolean;
  loginUsernameValue: string;
  loginPasswordValue: string;
  loginTotpCodeValue: string;
  signupEmailValue: string;
  signupDisplayNameValue: string;
  signupConfirmPasswordValue: string;
  signupEnabled: boolean;
  signupEmailRequired: boolean;
  loginError: string;
  isLoggingIn: boolean;
  pendingSyncCount: number;
  syncIndicator: SyncIndicator;
  lastSyncPassTitle: string;
  lastSyncPassDetail: string;
  remoteSyncEnabled: boolean;
  remoteSyncState: RemoteSyncState | 'unknown';
  remoteSyncError: string;
  syncDebugTitle: string;
  syncDebugDetail: string;
  syncDebugLog: string;
  syncNow: () => void | Promise<void>;
  saveAccountProfile: () => void | Promise<void>;
  changeAccountPassword: () => void | Promise<void>;
  saveAccountTotp: () => void | Promise<void>;
  revokeTrustedDevice: (deviceId: string) => void | Promise<void>;
  logoutAccount: () => void | Promise<void>;
  deleteAccount: () => void | Promise<void>;
  toggleLoginMenu: () => void;
  closeLoginModal: () => void;
  startAccountProfileEdit: () => void;
  cancelAccountProfileEdit: () => void;
  startAccountPasswordEdit: () => void;
  cancelAccountPasswordEdit: () => void;
  startAccountTotpEdit: () => void | Promise<void>;
  cancelAccountTotpEdit: () => void;
  startAccountDeleteEdit: () => void;
  cancelAccountDeleteEdit: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  exportMarkdown: () => void | Promise<void>;
  startMarkdownImport: () => void;
  handleMarkdownImport: (event: Event) => void | Promise<void>;
  toggleCompactView: () => void;
  toggleTheme: () => void;
  setThemeChoice: (theme: Theme) => void;
  setEditorFont: (font: EditorFont) => void;
  setEditorTextSize: (size: number) => void;
  setEditorLineHeight: (lineHeight: number) => void;
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
  contextDeleteNotePermanently: NoteCallback;
  contextNoteMetadataRows: (note: LocalNote) => MetadataRow[];
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
