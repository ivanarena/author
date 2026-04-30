<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArchiveRestore,
    Check,
    CircleUserRound,
    Download,
    FilePlus,
    Files,
    FolderPlus,
    FolderSymlink,
    Inbox,
    LogIn,
    Menu,
    Moon,
    Notebook,
    Pencil,
    Redo2,
    RefreshCw,
    Rows3,
    Search,
    Settings,
    Sun,
    Trash2,
    Undo2,
    Upload,
    X,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import type { Device } from '@author/schema';
  import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
  import {
    assignNoteToNotebook,
    clearToken,
    createBlankNote,
    createNotebook,
    deleteNotebook,
    exportNotesJson,
    getTheme,
    getToken,
    getUsername,
    importNotesJson,
    loadDevices,
    loadNotes,
    loadNotebooks,
    loadPendingConflicts,
    loadPendingSyncCount,
    loadTrash,
    moveNoteToTrash,
    noteDisplayTitle,
    noteNotebookIds,
    normalizeNotebookName,
    notebookNameExists,
    renameNotebook,
    restoreNote,
    resolveConflict,
    setTheme,
    setToken,
    setUsername,
    updateNoteContent
  } from '$lib/client/store';
  import { AuthError, login, runSync, validateSession } from '$lib/client/sync';

  type NoteSort = 'date-desc' | 'az' | 'za';
  type NoteGroup = { label: string; notes: LocalNote[] };
  type EditorSnapshot = { title: string; body: string };
  type SyncIndicatorKind =
    | 'synced'
    | 'pending'
    | 'conflict'
    | 'deleted'
    | 'offline'
    | 'local-only'
    | 'syncing';
  type ContextMenuState =
    | { type: 'note'; noteId: string; x: number; y: number }
    | { type: 'notebook'; notebookId: string; x: number; y: number }
    | null;

  const SORT_KEY = 'author-notes-sort';
  const COMPACT_VIEW_KEY = 'author-notes-compact-view';
  const EDITOR_ZOOM_KEY = 'author-notes-editor-zoom';
  const EMPTY_NOTEBOOK_FILTERS = new Set(['all', 'unfiled', 'trash']);
  const MIN_EDITOR_ZOOM = 0.8;
  const MAX_EDITOR_ZOOM = 1.4;
  const EDITOR_ZOOM_STEP = 0.1;
  const MAX_EDITOR_HISTORY = 120;
  const AUTO_SYNC_DELAY_MS = 600;
  const SYNC_RETRY_DELAY_MS = 12_000;
  const ONLINE_SESSION_SYNC_MS = 60_000;

  let notes: LocalNote[] = [];
  let notebooks: LocalNotebook[] = [];
  let trash: LocalNote[] = [];
  let devices: Device[] = [];
  let conflicts: LocalConflict[] = [];
  let pendingSyncCount = 0;
  let selectedNote: LocalNote | null = null;
  let titleValue = '';
  let bodyValue = '';
  let filterId: 'all' | 'unfiled' | 'trash' | string = 'all';
  let linkingNoteId: string | null = null;
  let syncMessage = 'Sign in to sync';
  let isSyncing = false;
  let isLoggingIn = false;
  let hasToken = false;
  let isBrowserOnline = true;
  let theme: 'light' | 'dark' = 'light';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let retrySyncTimer: ReturnType<typeof setTimeout> | null = null;
  let onlineSessionTimer: ReturnType<typeof setInterval> | null = null;
  let syncQueued = false;
  let newNotebookOpen = false;
  let notebookNameValue = '';
  let notebookError = '';
  let loginOpen = false;
  let loginUsernameValue = '';
  let loginPasswordValue = '';
  let loginError = '';
  let renamingNotebookId: string | null = null;
  let renameNotebookValue = '';
  let renameNotebookError = '';
  let deletingNotebookId: string | null = null;
  let noteSort: NoteSort = 'date-desc';
  let searchValue = '';
  let compactView = false;
  let editorZoom = 1;
  let currentTime = new Date();
  let titleInput: HTMLInputElement | null = null;
  let bodyTextarea: HTMLTextAreaElement | null = null;
  let importInput: HTMLInputElement | null = null;
  let settingsModal: HTMLElement | null = null;
  let menusOpen = false;
  let menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let isImporting = false;
  let settingsOpen = false;
  let contextMenu: ContextMenuState = null;
  let undoStack: EditorSnapshot[] = [];
  let redoStack: EditorSnapshot[] = [];
  let lastHistorySnapshot: EditorSnapshot = { title: '', body: '' };

  $: filteredNotes =
    filterId === 'trash'
      ? trash
      : notes.filter((note) => {
          if (filterId === 'all') return true;
          if (filterId === 'unfiled') return noteNotebookIds(note).length === 0;
          return noteNotebookIds(note).includes(filterId);
        });
  $: searchedNotes = filterNotesBySearch(filteredNotes, searchValue);
  $: visibleNotes = sortNotes(searchedNotes, noteSort);
  $: visibleNoteGroups = groupNotesByDateRange(visibleNotes, noteSort);
  $: wordCount = countWords(`${titleValue} ${bodyValue}`);
  $: activeConflict = conflicts[0] ?? null;
  $: notebookCounts = countNotesByNotebook(notes);
  $: unfiledCount = notebookCounts.get('') ?? 0;
  $: syncIndicatorKind = getSyncIndicatorKind();
  $: syncIndicatorLabel = getSyncIndicatorLabel();
  $: syncIndicatorDetail = getSyncIndicatorDetail();
  $: contextNote = getContextNote(contextMenu);
  $: contextNotebook = getContextNotebook(contextMenu);
  $: if (settingsOpen) void focusSettingsModal();
  $: canUndoEditor = undoStack.length > 0 && !selectedNote?.trashedAt;
  $: canRedoEditor = redoStack.length > 0 && !selectedNote?.trashedAt;
  $: if (hasToken && isBrowserOnline && pendingSyncCount > 0) {
    scheduleSync(AUTO_SYNC_DELAY_MS);
  }

  onMount(() => {
    isBrowserOnline = navigator.onLine;
    const clock = setInterval(() => {
      currentTime = new Date();
    }, 1000);
    onlineSessionTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        scheduleSync(0);
      }
    }, ONLINE_SESSION_SYNC_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);

    void initialize();

    return () => {
      clearInterval(clock);
      if (saveTimer) clearTimeout(saveTimer);
      if (menuCloseTimer) clearTimeout(menuCloseTimer);
      if (autoSyncTimer) clearTimeout(autoSyncTimer);
      if (retrySyncTimer) clearTimeout(retrySyncTimer);
      if (onlineSessionTimer) clearInterval(onlineSessionTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  async function initialize() {
    theme = getTheme();
    setTheme(theme);
    noteSort = getStoredSort();
    compactView = getStoredCompactView();
    editorZoom = getStoredEditorZoom();
    await refresh();
    openDraftNote();

    const token = getToken();
    hasToken = Boolean(token);
    if (token) {
      await resumeOnlineSession(token);
    }
  }

  async function resumeOnlineSession(token = getToken()) {
    if (!token) {
      hasToken = false;
      return;
    }

    hasToken = true;
    if (!isBrowserOnline) {
      syncMessage = 'Offline';
      return;
    }

    try {
      await validateSession(token);
      await syncNow();
    } catch (error) {
      handleSyncError(error);
    }
  }

  function handleOnline() {
    isBrowserOnline = true;
    syncMessage = hasSyncSession() ? 'All changes saved' : 'Sign in to sync';
    void resumeOnlineSession();
  }

  function handleOffline() {
    isBrowserOnline = false;
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    syncMessage = 'Offline';
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      if (!navigator.onLine) {
        isBrowserOnline = false;
      }
      scheduleSync(0);
    }
  }

  async function refresh() {
    [notes, notebooks, trash, conflicts, devices, pendingSyncCount] = await Promise.all([
      loadNotes(),
      loadNotebooks(),
      loadTrash(),
      loadPendingConflicts(),
      loadDevices(),
      loadPendingSyncCount()
    ]);
  }

  function clearPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  async function flushPendingSave() {
    if (!saveTimer) return;
    clearPendingSave();
    await saveEditorNow(selectedNote?.id ?? null);
  }

  function openDraftNote() {
    clearPendingSave();
    selectedNote = null;
    linkingNoteId = null;
    titleValue = '';
    bodyValue = '';
    resetEditorHistory();
    void focusEditor('title');
  }

  async function selectNote(note: LocalNote) {
    await flushPendingSave();
    selectedNote = note;
    linkingNoteId = null;
    titleValue = note.title;
    bodyValue = note.body;
    resetEditorHistory();
    void focusEditor(note.title || note.body ? 'body' : 'title');
  }

  async function newNote() {
    await flushPendingSave();
    filterId = 'all';
    openDraftNote();
  }

  async function focusEditor(target: 'title' | 'body') {
    await tick();
    const element = target === 'body' ? bodyTextarea : titleInput;
    if (!element || element.readOnly) return;

    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }

  function currentEditorSnapshot(): EditorSnapshot {
    return {
      title: titleValue,
      body: bodyValue
    };
  }

  function sameEditorSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
    return a.title === b.title && a.body === b.body;
  }

  function resetEditorHistory() {
    undoStack = [];
    redoStack = [];
    lastHistorySnapshot = currentEditorSnapshot();
  }

  function pushEditorHistory(stack: EditorSnapshot[], snapshot: EditorSnapshot): EditorSnapshot[] {
    const nextStack = stack.length && sameEditorSnapshot(stack[stack.length - 1], snapshot)
      ? stack
      : [...stack, snapshot];
    return nextStack.slice(-MAX_EDITOR_HISTORY);
  }

  function handleEditorInput(event: Event, field: 'title' | 'body') {
    const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    const nextSnapshot = {
      title: field === 'title' ? value : titleValue,
      body: field === 'body' ? value : bodyValue
    };

    if (field === 'title') {
      titleValue = value;
    } else {
      bodyValue = value;
    }

    if (!sameEditorSnapshot(lastHistorySnapshot, nextSnapshot)) {
      undoStack = pushEditorHistory(undoStack, lastHistorySnapshot);
      redoStack = [];
      lastHistorySnapshot = nextSnapshot;
    }

    scheduleNoteSave();
  }

  function applyEditorHistorySnapshot(snapshot: EditorSnapshot) {
    titleValue = snapshot.title;
    bodyValue = snapshot.body;
    lastHistorySnapshot = snapshot;
    scheduleNoteSave();
  }

  function undoEditorHistory() {
    if (!canUndoEditor) return;
    const current = currentEditorSnapshot();
    const snapshot = undoStack[undoStack.length - 1];
    if (!snapshot) return;
    undoStack = undoStack.slice(0, -1);
    redoStack = pushEditorHistory(redoStack, current);
    applyEditorHistorySnapshot(snapshot);
  }

  function redoEditorHistory() {
    if (!canRedoEditor) return;
    const current = currentEditorSnapshot();
    const snapshot = redoStack[redoStack.length - 1];
    if (!snapshot) return;
    redoStack = redoStack.slice(0, -1);
    undoStack = pushEditorHistory(undoStack, current);
    applyEditorHistorySnapshot(snapshot);
  }

  function isEditorEventTarget(target: EventTarget | null): boolean {
    return target === titleInput || target === bodyTextarea;
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void focusEditor('body');
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();

    if ((event.metaKey || event.ctrlKey) && isEditorEventTarget(event.target)) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoEditorHistory();
        } else {
          undoEditorHistory();
        }
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        redoEditorHistory();
        return;
      }
    }

    if (event.key !== 'Escape') return;
    closeContextMenu();
    closeSettings();
    linkingNoteId = null;
  }

  function openMenus() {
    if (menuCloseTimer) {
      clearTimeout(menuCloseTimer);
      menuCloseTimer = null;
    }
    menusOpen = true;
  }

  function toggleMenus() {
    if (menuCloseTimer) {
      clearTimeout(menuCloseTimer);
      menuCloseTimer = null;
    }
    menusOpen = !menusOpen;
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function closeSettings() {
    settingsOpen = false;
    loginOpen = false;
  }

  function toggleSettings() {
    settingsOpen = !settingsOpen;
    if (!settingsOpen) {
      loginOpen = false;
    }
    closeContextMenu();
  }

  function openSettingsModal() {
    settingsOpen = true;
    closeContextMenu();
  }

  function openLoginSettings() {
    loginOpen = true;
    loginUsernameValue = getUsername() ?? '';
    openSettingsModal();
  }

  async function focusSettingsModal() {
    await tick();
    settingsModal?.focus({ preventScroll: true });
  }

  function handleWindowClick(event: MouseEvent) {
    closeContextMenu();
    if (!settingsOpen || !(event.target instanceof Element)) return;
    if (event.target.closest('.settings-modal') || event.target.closest('.profile-menu')) return;
    closeSettings();
  }

  function scheduleMenusClose() {
    if (menuCloseTimer) clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(() => {
      menusOpen = false;
      menuCloseTimer = null;
    }, 180);
  }

  function closeMenusOnBlur(event: FocusEvent) {
    const current = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (next && current.contains(next)) return;
    menusOpen = false;
  }

  async function saveEditorNow(noteId: string | null) {
    if (noteId) {
      const updated = await updateNoteContent(noteId, titleValue, bodyValue);
      if (updated && selectedNote?.id === noteId) {
        selectedNote = updated;
      }
    } else if (titleValue.trim() || bodyValue.trim()) {
      const note = await createBlankNote({
        title: titleValue,
        body: bodyValue,
        notebookId: draftNotebookId()
      });
      selectedNote = note;
    }

    await refresh();
  }

  function scheduleNoteSave() {
    if (selectedNote?.trashedAt) return;
    clearPendingSave();
    const noteId = selectedNote?.id ?? null;
    if (selectedNote) {
      selectedNote = {
        ...selectedNote,
        title: titleValue.trim(),
        body: bodyValue,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending'
      };
    }

    saveTimer = setTimeout(async () => {
      saveTimer = null;
      await saveEditorNow(noteId);
    }, 120);
  }

  function draftNotebookId(): string | null {
    return EMPTY_NOTEBOOK_FILTERS.has(filterId) ? null : filterId;
  }

  function getStoredSort(): NoteSort {
    const stored = localStorage.getItem(SORT_KEY);
    return stored === 'az' || stored === 'za' || stored === 'date-desc' ? stored : 'date-desc';
  }

  function getStoredCompactView(): boolean {
    return localStorage.getItem(COMPACT_VIEW_KEY) === '1';
  }

  function getStoredEditorZoom(): number {
    const stored = Number(localStorage.getItem(EDITOR_ZOOM_KEY));
    return Number.isFinite(stored) ? clampZoom(stored) : 1;
  }

  function changeSort(event: Event) {
    noteSort = (event.currentTarget as HTMLSelectElement).value as NoteSort;
    localStorage.setItem(SORT_KEY, noteSort);
  }

  function toggleCompactView() {
    compactView = !compactView;
    localStorage.setItem(COMPACT_VIEW_KEY, compactView ? '1' : '0');
  }

  function zoomEditor(direction: -1 | 1) {
    editorZoom = clampZoom(Number((editorZoom + direction * EDITOR_ZOOM_STEP).toFixed(2)));
    localStorage.setItem(EDITOR_ZOOM_KEY, String(editorZoom));
  }

  function clampZoom(value: number): number {
    return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
  }

  function zoomPercent(): string {
    return `${Math.round(editorZoom * 100)}%`;
  }

  function filterNotesBySearch(items: LocalNote[], query: string): LocalNote[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;

    return items.filter((note) =>
      `${note.title}\n${note.body}`.toLocaleLowerCase().includes(normalized)
    );
  }

  function sortNotes(items: LocalNote[], sort: NoteSort): LocalNote[] {
    const sorted = [...items];
    if (sort === 'az' || sort === 'za') {
      sorted.sort((a, b) =>
        noteDisplayTitle(a).localeCompare(noteDisplayTitle(b), undefined, {
          numeric: true,
          sensitivity: 'base'
        })
      );
      return sort === 'az' ? sorted : sorted.reverse();
    }

    return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function groupNotesByDateRange(items: LocalNote[], sort: NoteSort): NoteGroup[] {
    if (sort !== 'date-desc') return [{ label: sort === 'az' ? 'A-Z' : 'Z-A', notes: items }];

    const groups = new Map<string, LocalNote[]>();
    for (const note of items) {
      const label = dateRangeLabel(note.updatedAt);
      groups.set(label, [...(groups.get(label) ?? []), note]);
    }

    return Array.from(groups, ([label, groupNotes]) => ({ label, notes: groupNotes }));
  }

  function dateRangeLabel(iso: string): string {
    const date = new Date(iso);
    const today = startOfDay(currentTime);
    const target = startOfDay(date);
    const daysAgo = Math.floor((today.getTime() - target.getTime()) / 86_400_000);

    if (daysAgo < 0) return 'Future';
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo < 7) return 'Previous 7 days';
    if (daysAgo < 30) return 'Previous 30 days';
    if (daysAgo < 365) return date.toLocaleString(undefined, { month: 'long' });
    return String(date.getFullYear());
  }

  function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function formatListDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function relativeAge(iso: string): string {
    const date = new Date(iso);
    const today = startOfDay(currentTime);
    const target = startOfDay(date);
    const daysAgo = Math.max(0, Math.floor((today.getTime() - target.getTime()) / 86_400_000));

    if (daysAgo === 0) return 'today';
    if (daysAgo === 1) return '1d ago';
    if (daysAgo < 30) return `${daysAgo}d ago`;

    const monthsAgo = Math.floor(daysAgo / 30);
    if (monthsAgo < 12) return `${monthsAgo}mo ago`;

    const yearsAgo = Math.floor(daysAgo / 365);
    return `${yearsAgo}y ago`;
  }

  function formatClock(date: Date): string {
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function countWords(text: string): number {
    const matches = text.trim().match(/\S+/g);
    return matches?.length ?? 0;
  }

  function notePreview(note: LocalNote): string {
    return note.body.replace(/\s+/g, ' ').trim().slice(0, 96);
  }

  function countNotesByNotebook(items: LocalNote[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const note of items) {
      const notebookIds = noteNotebookIds(note);
      if (!notebookIds.length) {
        counts.set('', (counts.get('') ?? 0) + 1);
        continue;
      }

      for (const key of notebookIds) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }

  function getSyncIndicatorKind(): SyncIndicatorKind {
    const hasSession = hasSyncSession();
    if (isSyncing) return 'syncing';
    if (conflicts.length > 0) return 'conflict';
    if (!isBrowserOnline) return 'offline';
    if (!hasSession) return 'local-only';
    if (pendingSyncCount > 0) return 'pending';
    return 'synced';
  }

  function getSyncIndicatorLabel(): string {
    const hasSession = hasSyncSession();
    if (isSyncing) return 'Saving';
    if (conflicts.length > 0) return `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`;
    if (!isBrowserOnline) return 'Offline';
    if (!hasSession) return 'Local only';
    if (pendingSyncCount > 0) return 'Saving';
    return 'All changes saved';
  }

  function getSyncIndicatorDetail(): string {
    if (isSyncing || conflicts.length > 0 || !isBrowserOnline) return '';
    if (!hasSyncSession()) return 'Sign in to sync';
    if (syncMessage && !isHealthySyncMessage(syncMessage) && syncMessage !== syncIndicatorLabel) {
      return syncMessage;
    }
    return '';
  }

  function isHealthySyncMessage(message: string): boolean {
    return ['Online', 'Saving', 'Syncing', 'Synced', 'All changes saved'].includes(message);
  }

  function hasSyncSession(): boolean {
    return hasToken || Boolean(getToken());
  }

  function noteStatusLabel(note: LocalNote): string {
    if (note.syncStatus === 'pending') return 'Pending sync';
    if (note.syncStatus === 'conflict') return 'Conflict';
    if (note.syncStatus === 'deleted') return 'Deleted';
    return 'Synced';
  }

  function notebookName(notebookId: string | null): string | null {
    if (!notebookId) return null;
    return notebooks.find((notebook) => notebook.id === notebookId)?.name ?? null;
  }

  function notebookNamesForNote(note: LocalNote): string[] {
    return noteNotebookIds(note)
      .map((notebookId) => notebookName(notebookId))
      .filter((name): name is string => Boolean(name));
  }

  function deviceName(deviceId: string | null | undefined): string {
    if (!deviceId) return 'Unknown device';
    return devices.find((device) => device.id === deviceId)?.name ?? deviceId;
  }

  function openNotebookContext(event: MouseEvent, notebook: LocalNotebook) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = positionContextMenu({
      type: 'notebook',
      notebookId: notebook.id,
      x: event.clientX,
      y: event.clientY
    });
  }

  function openNoteContext(event: MouseEvent, note: LocalNote) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = positionContextMenu({
      type: 'note',
      noteId: note.id,
      x: event.clientX,
      y: event.clientY
    });
  }

  function positionContextMenu<T extends Exclude<ContextMenuState, null>>(menu: T): T {
    const width = 190;
    const height = menu.type === 'note' ? 116 : 84;
    return {
      ...menu,
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8)
    };
  }

  function contextMenuStyle(menu: Exclude<ContextMenuState, null>): string {
    return `left: ${menu.x}px; top: ${menu.y}px;`;
  }

  function getContextNote(menu: ContextMenuState): LocalNote | null {
    if (menu?.type !== 'note') return null;
    return [...notes, ...trash].find((note) => note.id === menu.noteId) ?? null;
  }

  function getContextNotebook(menu: ContextMenuState): LocalNotebook | null {
    if (menu?.type !== 'notebook') return null;
    return notebooks.find((notebook) => notebook.id === menu.notebookId) ?? null;
  }

  function contextRenameNotebook(notebook: LocalNotebook) {
    startRenameNotebook(notebook);
    closeContextMenu();
  }

  function contextDeleteNotebook(notebook: LocalNotebook) {
    askDeleteNotebook(notebook);
    closeContextMenu();
  }

  function contextLinkNote(note: LocalNote) {
    linkingNoteId = note.id;
    closeContextMenu();
  }

  async function contextTrashNote(note: LocalNote) {
    closeContextMenu();
    await trashNote(note);
  }

  async function contextRestoreNote(note: LocalNote) {
    closeContextMenu();
    await restoreNoteFromRow(note);
  }

  async function assignNotebookForNote(note: LocalNote, notebookId: string | null) {
    const updated = await assignNoteToNotebook(
      note.id,
      notebookId,
      notebookId ? !noteNotebookIds(note).includes(notebookId) : false
    );
    if (updated && selectedNote?.id === note.id) selectedNote = updated;
    await refresh();
  }

  function localNotebookNameExists(name: string, excludeId?: string): boolean {
    const normalized = normalizeNotebookName(name);
    if (!normalized) return false;
    return notebooks.some(
      (notebook) =>
        notebook.id !== excludeId && normalizeNotebookName(notebook.name) === normalized
    );
  }

  function toggleNewNotebookMenu() {
    newNotebookOpen = !newNotebookOpen;
    loginOpen = false;
    renamingNotebookId = null;
    deletingNotebookId = null;
    notebookNameValue = '';
    notebookError = '';
  }

  async function submitNewNotebookMenu() {
    const name = notebookNameValue.trim();
    if (!name) {
      notebookError = 'Name required';
      return;
    }

    if (localNotebookNameExists(name) || (await notebookNameExists(name))) {
      notebookError = 'Notebook already exists';
      return;
    }

    const notebook = await createNotebook(name);
    if (notebook) {
      filterId = notebook.id;
      if (selectedNote && !selectedNote.trashedAt) {
        const updated = await assignNoteToNotebook(selectedNote.id, notebook.id, true);
        if (updated) selectedNote = updated;
      }
      await refresh();
      newNotebookOpen = false;
      notebookNameValue = '';
      notebookError = '';
    } else {
      notebookError = 'Notebook already exists';
    }
  }

  function startRenameNotebook(notebook: LocalNotebook) {
    renamingNotebookId = notebook.id;
    deletingNotebookId = null;
    newNotebookOpen = false;
    loginOpen = false;
    renameNotebookValue = notebook.name;
    renameNotebookError = '';
  }

  function cancelRenameNotebook() {
    renamingNotebookId = null;
    renameNotebookValue = '';
    renameNotebookError = '';
  }

  async function submitRenameNotebook(notebook: LocalNotebook) {
    const name = renameNotebookValue.trim();
    if (!name) {
      renameNotebookError = 'Name required';
      return;
    }

    if (
      localNotebookNameExists(name, notebook.id) ||
      (await notebookNameExists(name, notebook.id))
    ) {
      renameNotebookError = 'Notebook already exists';
      return;
    }

    const updated = await renameNotebook(notebook.id, name);
    if (!updated) {
      renameNotebookError = 'Notebook already exists';
      return;
    }

    await refresh();
    cancelRenameNotebook();
  }

  function askDeleteNotebook(notebook: LocalNotebook) {
    deletingNotebookId = notebook.id;
    renamingNotebookId = null;
    newNotebookOpen = false;
    loginOpen = false;
  }

  function cancelDeleteNotebook() {
    deletingNotebookId = null;
  }

  async function confirmDeleteNotebook(notebook: LocalNotebook) {
    await deleteNotebook(notebook.id);

    if (filterId === notebook.id) {
      filterId = 'all';
    }

    if (selectedNote && noteNotebookIds(selectedNote).includes(notebook.id)) {
      const notebookIds = noteNotebookIds(selectedNote).filter((id) => id !== notebook.id);
      selectedNote = { ...selectedNote, notebookIds, notebookId: notebookIds[0] ?? null };
    }

    deletingNotebookId = null;
    await refresh();
  }

  async function trashNote(note: LocalNote) {
    await moveNoteToTrash(note.id);
    await refresh();

    if (selectedNote?.id === note.id) {
      const next = notes.find((candidate) => candidate.id !== note.id) ?? null;
      if (next) {
        await selectNote(next);
      } else {
        await newNote();
      }
    }
  }

  async function restoreNoteFromRow(note: LocalNote) {
    await restoreNote(note.id);
    filterId = 'all';
    await refresh();
    const restored = notes.find((candidate) => candidate.id === note.id);
    if (restored) await selectNote(restored);
  }

  function scheduleSync(delayMs = AUTO_SYNC_DELAY_MS) {
    if (!hasToken || !isBrowserOnline) return;
    if (isSyncing) {
      syncQueued = true;
      return;
    }
    if (autoSyncTimer) return;

    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null;
      void syncNow();
    }, delayMs);
  }

  function scheduleSyncRetry() {
    if (!hasToken || !isBrowserOnline || retrySyncTimer) return;
    retrySyncTimer = setTimeout(() => {
      retrySyncTimer = null;
      scheduleSync(0);
    }, SYNC_RETRY_DELAY_MS);
  }

  function expireSession(message = 'Login expired') {
    clearToken();
    hasToken = false;
    syncQueued = false;
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    if (retrySyncTimer) {
      clearTimeout(retrySyncTimer);
      retrySyncTimer = null;
    }
    syncMessage = message;
    settingsOpen = true;
    loginOpen = true;
  }

  function handleSyncError(error: unknown) {
    if (error instanceof AuthError) {
      expireSession(error.message);
      return;
    }

    if (!navigator.onLine) {
      isBrowserOnline = false;
      syncMessage = 'Offline';
      return;
    }

    syncMessage = error instanceof Error ? error.message : 'Sync failed';
    scheduleSyncRetry();
  }

  async function syncNow() {
    const token = getToken();
    hasToken = Boolean(token);
    if (!token) return;
    if (!isBrowserOnline) {
      syncMessage = 'Offline';
      return;
    }
    if (isSyncing) {
      syncQueued = true;
      return;
    }

    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    if (retrySyncTimer) {
      clearTimeout(retrySyncTimer);
      retrySyncTimer = null;
    }
    isSyncing = true;
    syncMessage = 'Saving';
    try {
      const result = await runSync(token);
      syncMessage =
        result.conflicts > 0
          ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
          : 'All changes saved';
      await refresh();
    } catch (error) {
      handleSyncError(error);
    } finally {
      isSyncing = false;
      const shouldSyncAgain = syncQueued || pendingSyncCount > 0;
      syncQueued = false;
      if (shouldSyncAgain) {
        scheduleSync(0);
      }
    }
  }

  async function exportJson() {
    await flushPendingSave();
    const archive = await exportNotesJson();
    const blob = new Blob([JSON.stringify(archive, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `author-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    syncMessage = `Exported ${archive.notes.length} ${archive.notes.length === 1 ? 'note' : 'notes'}`;
  }

  function startJsonImport() {
    importInput?.click();
  }

  async function handleJsonImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || isImporting) return;

    await flushPendingSave();
    isImporting = true;
    syncMessage = 'Importing JSON';
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importNotesJson(payload);
      await refresh();

      const importedNote = notes.find((note) => note.id === result.noteIds[0]);
      if (importedNote) {
        await selectNote(importedNote);
      }

      syncMessage = importSummary(result.importedNotes, result.importedNotebooks, result.skippedNotes);
    } catch (error) {
      syncMessage = error instanceof Error ? error.message : 'Import failed';
    } finally {
      isImporting = false;
    }
  }

  function importSummary(noteCount: number, notebookCount: number, skippedCount: number): string {
    const noteText = `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`;
    const notebookText = notebookCount
      ? `, ${notebookCount} new ${notebookCount === 1 ? 'notebook' : 'notebooks'}`
      : '';
    const skippedText = skippedCount ? `, ${skippedCount} blank skipped` : '';
    return `Imported ${noteText}${notebookText}${skippedText}`;
  }

  function toggleLoginMenu() {
    loginOpen = !loginOpen;
    newNotebookOpen = false;
    loginUsernameValue = getUsername() ?? '';
    loginPasswordValue = '';
    loginError = '';
  }

  async function submitLoginMenu() {
    const username = loginUsernameValue.trim();
    const password = loginPasswordValue;
    if (isLoggingIn) return;
    if (!username) {
      loginError = 'Username required';
      return;
    }
    if (!password.trim()) {
      loginError = 'Password required';
      return;
    }

    isLoggingIn = true;
    loginError = '';
    try {
      const session = await login(username, password);
      setToken(session.token);
      setUsername(session.user.username);
      hasToken = true;
      loginOpen = false;
      loginUsernameValue = session.user.username;
      loginPasswordValue = '';
      await syncNow();
    } catch {
      loginError = 'Login failed';
      syncMessage = 'Login failed';
    } finally {
      isLoggingIn = false;
    }
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
  }

  async function resolveActiveConflict(
    choice: 'keep-newer' | 'keep-older' | 'keep-local' | 'keep-remote' | 'duplicate-both'
  ) {
    if (!activeConflict) return;
    await resolveConflict(activeConflict.id, choice);
    await refresh();
    await syncNow();
  }

  function conflictMessage(conflict: LocalConflict): string {
    if (conflict.conflict.reason === 'duplicate_name') {
      return 'A notebook with this name already exists. Choose one version or duplicate both.';
    }

    return 'Choose which version to keep. Both versions are preserved until you decide.';
  }
</script>

<svelte:head>
  <title>Notes</title>
</svelte:head>

<svelte:window
  on:keydown={handleGlobalKeydown}
  on:click={handleWindowClick}
  on:online={handleOnline}
  on:offline={handleOffline}
/>

<main class="app-shell">
  <div
    class="menu-dock"
    class:open={menusOpen}
    role="navigation"
    aria-label="Navigation"
    on:pointerenter={openMenus}
    on:pointerleave={scheduleMenusClose}
    on:focusin={openMenus}
    on:focusout={closeMenusOnBlur}
  >
    <div class="dock-buttons">
      <button
        class="icon-button menu-trigger"
        title="Show menus"
        aria-label="Show menus"
        aria-controls="navigation-menus"
        aria-expanded={menusOpen}
        on:click={toggleMenus}
      >
        <Menu size={18} strokeWidth={1.8} />
      </button>
      <div class="profile-menu">
        <button
          class="icon-button profile-trigger"
          class:active={settingsOpen}
          title="Profile and settings"
          aria-label="Profile and settings"
          aria-controls="profile-settings"
          aria-expanded={settingsOpen}
          on:click={toggleSettings}
        >
          <CircleUserRound size={18} strokeWidth={1.8} />
        </button>

        <div class="profile-hover-card" role="menu" aria-label="Profile quick actions">
          {#if hasToken}
            <button class="profile-quick-action" role="menuitem" disabled={isSyncing} on:click={syncNow}>
              <RefreshCw size={14} strokeWidth={1.8} />
              <span>{isSyncing ? 'Syncing' : 'Sync'}</span>
            </button>
          {:else}
            <button class="profile-quick-action" role="menuitem" on:click={openLoginSettings}>
              <LogIn size={14} strokeWidth={1.8} />
              <span>Login</span>
            </button>
          {/if}
          <button class="profile-quick-action" role="menuitem" on:click={toggleTheme}>
            {#if theme === 'dark'}
              <Sun size={14} strokeWidth={1.8} />
              <span>Light</span>
            {:else}
              <Moon size={14} strokeWidth={1.8} />
              <span>Dark</span>
            {/if}
          </button>
          <button class="profile-quick-action" role="menuitem" on:click={openSettingsModal}>
            <Settings size={14} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>

    <div class="menu-panels" id="navigation-menus">
      <aside class="notebooks" aria-label="Notebooks">
        <div class="icon-row">
          <button
            class="icon-button"
            class:active={filterId === 'all'}
            title="All notes"
            aria-label="All notes"
            on:click={() => (filterId = 'all')}
          >
            <Files size={16} strokeWidth={1.8} />
          </button>
          <button
            class="icon-button"
            class:active={newNotebookOpen}
            title="New notebook"
            aria-label="New notebook"
            on:click={toggleNewNotebookMenu}
          >
            <FolderPlus size={16} strokeWidth={1.8} />
          </button>
        </div>

        {#if newNotebookOpen}
          <form
            class="menu-form"
            aria-label="New notebook menu"
            on:submit|preventDefault={submitNewNotebookMenu}
          >
            <label class="sr-only" for="new-notebook-name">Notebook name</label>
            <div class="field-row">
              <input
                id="new-notebook-name"
                bind:value={notebookNameValue}
                autocomplete="off"
                placeholder="Notebook name"
                on:input={() => (notebookError = '')}
              />
              <button class="icon-button mini" type="submit" title="Create notebook" aria-label="Create notebook">
                <Check size={14} strokeWidth={1.9} />
              </button>
              <button
                class="icon-button mini"
                type="button"
                title="Close"
                aria-label="Close new notebook menu"
                on:click={() => (newNotebookOpen = false)}
              >
                <X size={14} strokeWidth={1.9} />
              </button>
            </div>
            {#if notebookError}
              <p class="form-error">{notebookError}</p>
            {/if}
          </form>
        {/if}

        <nav>
          <div class="nav-row" class:active={filterId === 'all'}>
            <button class="nav-main" on:click={() => (filterId = 'all')}>
              <Files size={15} strokeWidth={1.8} />
              <span>All notes</span>
            </button>
            <div class="nav-trailing">
              <span class="nav-count">{notes.length}</span>
            </div>
          </div>
          <div class="nav-row" class:active={filterId === 'unfiled'}>
            <button class="nav-main" on:click={() => (filterId = 'unfiled')}>
              <Inbox size={15} strokeWidth={1.8} />
              <span>Unfiled</span>
            </button>
            <div class="nav-trailing">
              <span class="nav-count">{unfiledCount}</span>
            </div>
          </div>
          {#each notebooks as notebook}
            <div class="nav-row notebook-row" class:active={filterId === notebook.id}>
              {#if renamingNotebookId === notebook.id}
                <form
                  class="inline-rename"
                  aria-label="Rename notebook"
                  on:submit|preventDefault={() => submitRenameNotebook(notebook)}
                >
                  <label class="sr-only" for={`rename-notebook-${notebook.id}`}>Notebook name</label>
                  <input
                    id={`rename-notebook-${notebook.id}`}
                    bind:value={renameNotebookValue}
                    autocomplete="off"
                    on:input={() => (renameNotebookError = '')}
                  />
                  <button
                    class="icon-button mini"
                    type="submit"
                    title="Save notebook name"
                    aria-label="Save notebook name"
                  >
                    <Check size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    class="icon-button mini"
                    type="button"
                    title="Cancel rename"
                    aria-label="Cancel rename"
                    on:click={cancelRenameNotebook}
                  >
                    <X size={14} strokeWidth={1.9} />
                  </button>
                  {#if renameNotebookError}
                    <p class="form-error notebook-error">{renameNotebookError}</p>
                  {/if}
                </form>
              {:else if deletingNotebookId === notebook.id}
                <div class="delete-confirm" aria-label={`Delete ${notebook.name}?`} role="group">
                  <span>Delete?</span>
                  <button
                    class="icon-button mini danger"
                    title="Delete notebook"
                    aria-label="Confirm delete notebook"
                    on:click={() => confirmDeleteNotebook(notebook)}
                  >
                    <Check size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    class="icon-button mini"
                    title="Cancel delete"
                    aria-label="Cancel delete notebook"
                    on:click={cancelDeleteNotebook}
                  >
                    <X size={14} strokeWidth={1.9} />
                  </button>
                </div>
              {:else}
                <button
                  class="notebook-main"
                  on:click={() => (filterId = notebook.id)}
                  on:contextmenu={(event) => openNotebookContext(event, notebook)}
                >
                  <Notebook size={15} strokeWidth={1.8} />
                  <span>{notebook.name}</span>
                </button>
                <div class="nav-trailing notebook-trailing">
                  <span class="nav-count">{notebookCounts.get(notebook.id) ?? 0}</span>
                  <div class="notebook-actions">
                    <button
                      class="icon-button mini"
                      title="Rename notebook"
                      aria-label="Rename notebook"
                      on:click|stopPropagation={() => startRenameNotebook(notebook)}
                    >
                      <Pencil size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      class="icon-button mini danger"
                      title="Delete notebook"
                      aria-label="Delete notebook"
                      on:click|stopPropagation={() => askDeleteNotebook(notebook)}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          <div class="nav-row" class:active={filterId === 'trash'}>
            <button class="nav-main" on:click={() => (filterId = 'trash')}>
              <Trash2 size={15} strokeWidth={1.8} />
              <span>Trash</span>
            </button>
            <div class="nav-trailing">
              <span class="nav-count">{trash.length}</span>
            </div>
          </div>
        </nav>
      </aside>

      <aside class="notes" aria-label="Notes">
        <div class="icon-row">
          <button class="icon-button" title="New note" aria-label="New note" on:click={newNote}>
            <FilePlus size={16} strokeWidth={1.8} />
          </button>
          <label class="sr-only" for="note-sort">Sort notes</label>
          <select id="note-sort" class="sort-select" aria-label="Sort notes" bind:value={noteSort} on:change={changeSort}>
            <option value="date-desc">Date</option>
            <option value="az">A-Z</option>
            <option value="za">Z-A</option>
          </select>
        </div>

        <div class="search-row">
          <label class="sr-only" for="note-search">Search notes</label>
          <Search size={14} strokeWidth={1.8} />
          <input
            id="note-search"
            type="search"
            bind:value={searchValue}
            autocomplete="off"
            placeholder="Search notes"
          />
          {#if searchValue}
            <button
              class="icon-button mini"
              title="Clear search"
              aria-label="Clear search"
              type="button"
              on:click={() => (searchValue = '')}
            >
              <X size={13} strokeWidth={1.8} />
            </button>
          {/if}
        </div>

        <p class="sync-line" aria-label={`Sync status: ${syncIndicatorLabel}`}>
          <span class={`status-dot ${syncIndicatorKind}`} aria-hidden="true"></span>
          <span>{syncIndicatorLabel}</span>
          {#if syncIndicatorDetail}
            <span class="sync-detail">{syncIndicatorDetail}</span>
          {/if}
        </p>

        <div class="note-list" class:compact={compactView}>
          {#each visibleNoteGroups as group}
            {#if group.notes.length}
              <div class="date-range">{group.label}</div>
              {#each group.notes as note}
                {@const noteNotebookNames = notebookNamesForNote(note)}
                <div
                  class="note-row"
                  class:active={selectedNote?.id === note.id}
                  class:pending={note.syncStatus === 'pending'}
                  class:conflicted={note.syncStatus === 'conflict'}
                >
                  <button
                    class="note-main"
                    on:click={() => selectNote(note)}
                    on:contextmenu={(event) => openNoteContext(event, note)}
                  >
                    <span class="note-heading">
                      <span
                        class={`status-dot note-status ${note.syncStatus}`}
                        title={noteStatusLabel(note)}
                        aria-label={noteStatusLabel(note)}
                      ></span>
                      <span class="note-title">{noteDisplayTitle(note)}</span>
                      {#if compactView}
                        <time class="note-age" datetime={note.updatedAt}>{relativeAge(note.updatedAt)}</time>
                      {/if}
                    </span>
                    {#if !compactView}
                      <span class="note-preview">{notePreview(note) || 'No text'}</span>
                      {#if noteNotebookNames.length}
                        <span class="note-notebooks">
                          <Notebook size={12} strokeWidth={1.8} />
                          <span>{noteNotebookNames.join(', ')}</span>
                        </span>
                      {/if}
                      <span class="note-context">
                        <time>Updated {formatListDate(note.updatedAt)}</time>
                        <time>Created {formatListDate(note.createdAt)}</time>
                      </span>
                    {/if}
                  </button>

                  <div class="row-actions">
                    {#if note.trashedAt}
                      <button
                        class="icon-button mini"
                        title="Restore note"
                        aria-label="Restore note"
                        on:click|stopPropagation={() => restoreNoteFromRow(note)}
                      >
                        <ArchiveRestore size={14} strokeWidth={1.8} />
                      </button>
                    {:else}
                      <button
                        class="icon-button mini"
                        title="Notebooks"
                        aria-label="Notebooks"
                        on:click|stopPropagation={() =>
                          (linkingNoteId = linkingNoteId === note.id ? null : note.id)}
                      >
                        <FolderSymlink size={14} strokeWidth={1.8} />
                      </button>
                      <button
                        class="icon-button mini danger"
                        title="Move to Trash"
                        aria-label="Move to Trash"
                        on:click|stopPropagation={() => trashNote(note)}
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    {/if}
                  </div>

                  {#if linkingNoteId === note.id && !note.trashedAt}
                    <div class="link-popover" role="menu" aria-label="Note notebooks">
                      <button
                        class:active={noteNotebookIds(note).length === 0}
                        aria-checked={noteNotebookIds(note).length === 0}
                        role="menuitemcheckbox"
                        on:click|stopPropagation={() => assignNotebookForNote(note, null)}
                      >
                        <Inbox size={14} strokeWidth={1.8} />
                        <span>Unfiled</span>
                        {#if noteNotebookIds(note).length === 0}
                          <Check size={13} strokeWidth={1.9} />
                        {/if}
                      </button>
                      {#each notebooks as notebook}
                        <button
                          class:active={noteNotebookIds(note).includes(notebook.id)}
                          aria-checked={noteNotebookIds(note).includes(notebook.id)}
                          role="menuitemcheckbox"
                          on:click|stopPropagation={() => assignNotebookForNote(note, notebook.id)}
                        >
                          <Notebook size={14} strokeWidth={1.8} />
                          <span>{notebook.name}</span>
                          {#if noteNotebookIds(note).includes(notebook.id)}
                            <Check size={13} strokeWidth={1.9} />
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          {/each}
          {#if !visibleNotes.length}
            <p class="empty-list">{searchValue ? 'No matching notes' : 'No notes'}</p>
          {/if}
        </div>
      </aside>
    </div>
  </div>

  <section class="editor-wrap" aria-label="Editor">
    <section class="writer" aria-label="Plain text editor" style={`--editor-zoom: ${editorZoom};`}>
      <input
        class="title-input"
        aria-label="Note title"
        bind:this={titleInput}
        bind:value={titleValue}
        readonly={Boolean(selectedNote?.trashedAt)}
        spellcheck="true"
        on:keydown={handleTitleKeydown}
        on:input={(event) => handleEditorInput(event, 'title')}
      />
      <textarea
        aria-label="Note body"
        bind:this={bodyTextarea}
        bind:value={bodyValue}
        readonly={Boolean(selectedNote?.trashedAt)}
        spellcheck="true"
        on:input={(event) => handleEditorInput(event, 'body')}
      ></textarea>
      <footer class="editor-status" aria-label="Note details">
        <div class="history-controls" aria-label="Editor history">
          <button
            class="icon-button mini"
            title="Undo"
            aria-label="Undo"
            disabled={!canUndoEditor}
            on:mousedown|preventDefault
            on:click={undoEditorHistory}
          >
            <Undo2 size={14} strokeWidth={1.8} />
          </button>
          <button
            class="icon-button mini"
            title="Redo"
            aria-label="Redo"
            disabled={!canRedoEditor}
            on:mousedown|preventDefault
            on:click={redoEditorHistory}
          >
            <Redo2 size={14} strokeWidth={1.8} />
          </button>
        </div>
        <span>{formatClock(currentTime)}</span>
        <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
        <span>History {undoStack.length}/{redoStack.length}</span>
        <span>Zoom {zoomPercent()}</span>
        {#if selectedNote}
          <span>Created {formatDateTime(selectedNote.createdAt)}</span>
          <span>Modified {formatDateTime(selectedNote.updatedAt)} by {deviceName(selectedNote.deviceId)}</span>
        {:else}
          <span>Unsaved draft</span>
        {/if}
      </footer>
    </section>
  </section>
</main>

{#if settingsOpen}
  <div class="settings-layer" role="presentation">
    <div
      class="settings-modal"
      id="profile-settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      bind:this={settingsModal}
      tabindex="-1"
    >
      <header class="settings-header">
        <div class="settings-title">
          <Settings size={16} strokeWidth={1.8} />
          <h2 id="settings-title">Settings</h2>
        </div>
        <button class="icon-button mini" title="Close" aria-label="Close settings" on:click={closeSettings}>
          <X size={14} strokeWidth={1.9} />
        </button>
      </header>

      <div class="settings-actions">
        {#if hasToken}
          <button class="settings-action" disabled={isSyncing} on:click={syncNow}>
            <RefreshCw size={15} strokeWidth={1.8} />
            <span>{isSyncing ? 'Syncing' : 'Sync'}</span>
          </button>
        {:else}
          <button class="settings-action" class:active={loginOpen} on:click={toggleLoginMenu}>
            <LogIn size={15} strokeWidth={1.8} />
            <span>Login</span>
          </button>
        {/if}
        <button class="settings-action" on:click={exportJson}>
          <Download size={15} strokeWidth={1.8} />
          <span>Export JSON</span>
        </button>
        <button class="settings-action" disabled={isImporting} on:click={startJsonImport}>
          <Upload size={15} strokeWidth={1.8} />
          <span>Import JSON</span>
        </button>
        <input
          bind:this={importInput}
          class="file-input"
          type="file"
          accept="application/json,.json"
          aria-label="Choose JSON notes file"
          on:change={handleJsonImport}
        />
        <button
          class="settings-action"
          class:active={compactView}
          aria-pressed={compactView}
          on:click={toggleCompactView}
        >
          <Rows3 size={15} strokeWidth={1.8} />
          <span>Compact notes</span>
        </button>
        <button class="settings-action" on:click={toggleTheme}>
          {#if theme === 'dark'}
            <Sun size={15} strokeWidth={1.8} />
            <span>Light mode</span>
          {:else}
            <Moon size={15} strokeWidth={1.8} />
            <span>Dark mode</span>
          {/if}
        </button>
      </div>

      <div class="settings-zoom">
        <button
          class="icon-button mini"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={editorZoom <= MIN_EDITOR_ZOOM}
          on:click={() => zoomEditor(-1)}
        >
          <ZoomOut size={14} strokeWidth={1.8} />
        </button>
        <span>Zoom {zoomPercent()}</span>
        <button
          class="icon-button mini"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={editorZoom >= MAX_EDITOR_ZOOM}
          on:click={() => zoomEditor(1)}
        >
          <ZoomIn size={14} strokeWidth={1.8} />
        </button>
      </div>

      {#if loginOpen}
        <form class="menu-form login-form" aria-label="Login menu" on:submit|preventDefault={submitLoginMenu}>
          <label class="sr-only" for="sync-username">Sync username</label>
          <input
            id="sync-username"
            type="text"
            bind:value={loginUsernameValue}
            autocomplete="username"
            placeholder="Username"
            autocapitalize="none"
            spellcheck="false"
            on:input={() => (loginError = '')}
          />
          <label class="sr-only" for="sync-password">Sync password</label>
          <div class="field-row">
            <input
              id="sync-password"
              type="password"
              bind:value={loginPasswordValue}
              autocomplete="current-password"
              placeholder="Sync password"
              on:input={() => (loginError = '')}
            />
            <button
              class="icon-button mini"
              type="submit"
              title="Login"
              aria-label="Submit login"
              disabled={isLoggingIn}
            >
              <Check size={14} strokeWidth={1.9} />
            </button>
            <button
              class="icon-button mini"
              type="button"
              title="Close"
              aria-label="Close login menu"
              on:click={() => (loginOpen = false)}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
          </div>
          {#if loginError}
            <p class="form-error">{loginError}</p>
          {/if}
        </form>
      {/if}
    </div>
  </div>
{/if}

{#if contextMenu?.type === 'notebook' && contextNotebook}
  <div
    class="context-menu"
    style={contextMenuStyle(contextMenu)}
    role="menu"
    tabindex="-1"
    aria-label={`${contextNotebook.name} actions`}
    on:contextmenu|preventDefault
  >
    <button role="menuitem" on:click|stopPropagation={() => contextRenameNotebook(contextNotebook)}>
      <Pencil size={14} strokeWidth={1.8} />
      <span>Rename</span>
    </button>
    <button class="danger" role="menuitem" on:click|stopPropagation={() => contextDeleteNotebook(contextNotebook)}>
      <Trash2 size={14} strokeWidth={1.8} />
      <span>Delete</span>
    </button>
  </div>
{/if}

{#if contextMenu?.type === 'note' && contextNote}
  <div
    class="context-menu"
    style={contextMenuStyle(contextMenu)}
    role="menu"
    tabindex="-1"
    aria-label={`${noteDisplayTitle(contextNote)} actions`}
    on:contextmenu|preventDefault
  >
    {#if contextNote.trashedAt}
      <button role="menuitem" on:click|stopPropagation={() => contextRestoreNote(contextNote)}>
        <ArchiveRestore size={14} strokeWidth={1.8} />
        <span>Restore</span>
      </button>
    {:else}
      <button role="menuitem" on:click|stopPropagation={() => contextLinkNote(contextNote)}>
        <FolderSymlink size={14} strokeWidth={1.8} />
        <span>Move to notebook</span>
      </button>
      <button class="danger" role="menuitem" on:click|stopPropagation={() => contextTrashNote(contextNote)}>
        <Trash2 size={14} strokeWidth={1.8} />
        <span>Move to Trash</span>
      </button>
    {/if}
  </div>
{/if}

{#if activeConflict}
  <div class="conflict-backdrop" role="presentation">
    <div class="conflict-dialog" role="dialog" aria-modal="true" aria-label="Sync conflict">
      <header>
        <h1>Sync conflict</h1>
        <p>{conflictMessage(activeConflict)}</p>
      </header>

      <div class="versions">
        <article>
          <strong>{activeConflict.conflict.local.deviceName}</strong>
          <time>{new Date(activeConflict.conflict.local.updatedAt).toLocaleString()}</time>
          <p>{activeConflict.conflict.local.previewText}</p>
        </article>
        <article>
          <strong>{activeConflict.conflict.remote.deviceName}</strong>
          <time>{new Date(activeConflict.conflict.remote.updatedAt).toLocaleString()}</time>
          <p>{activeConflict.conflict.remote.previewText}</p>
        </article>
      </div>

      <div class="conflict-actions">
        <button on:click={() => resolveActiveConflict('keep-newer')}>Keep newer</button>
        <button on:click={() => resolveActiveConflict('keep-older')}>Keep older</button>
        <button on:click={() => resolveActiveConflict('keep-local')}>
          Keep {activeConflict.conflict.local.deviceName}
        </button>
        <button on:click={() => resolveActiveConflict('keep-remote')}>
          Keep {activeConflict.conflict.remote.deviceName}
        </button>
        <button on:click={() => resolveActiveConflict('duplicate-both')}>Duplicate both</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    position: relative;
    min-height: 100vh;
    isolation: isolate;
    background: var(--bg);
  }

  .menu-dock {
    position: fixed;
    z-index: 20;
    top: 0;
    left: 50%;
    width: min(920px, calc(100vw - 40px));
    height: 76px;
    transform: translateX(-50%);
    pointer-events: auto;
  }

  .menu-dock.open,
  .menu-dock:hover,
  .menu-dock:focus-within {
    height: 100vh;
  }

  .dock-buttons {
    position: absolute;
    z-index: 23;
    top: 16px;
    left: 50%;
    display: flex;
    gap: 14px;
    border-radius: 999px;
    padding: 8px;
    background: var(--panel-transparent);
    backdrop-filter: blur(12px);
    transform: translateX(-50%);
    pointer-events: auto;
  }

  .menu-trigger {
    position: relative;
    z-index: 1;
    background: transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .profile-trigger {
    position: relative;
    z-index: 1;
    background: transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .profile-menu {
    position: relative;
    display: grid;
  }

  .profile-hover-card {
    position: absolute;
    z-index: 25;
    top: 54px;
    left: 0;
    display: grid;
    gap: 10px;
    width: 190px;
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 14px;
    background: var(--panel-transparent);
    backdrop-filter: blur(12px);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
    transition:
      opacity 120ms ease,
      transform 120ms ease,
      visibility 120ms ease;
  }

  .profile-menu:hover .profile-hover-card,
  .profile-menu:focus-within .profile-hover-card {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .profile-quick-action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-height: 40px;
    border-color: transparent;
    padding: 0 12px;
    color: var(--muted);
    text-align: left;
  }

  .profile-quick-action span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-quick-action:hover,
  .profile-quick-action:focus-visible {
    border-color: var(--line);
    color: var(--text);
  }

  .menu-panels {
    position: absolute;
    z-index: 2;
    top: 82px;
    left: 0;
    display: grid;
    grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 18px;
    width: 100%;
    height: min(80vh, calc(100vh - 104px));
    padding: 24px;
    overflow: hidden;
    background: var(--panel-transparent);
    backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 28px;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px) scale(0.98);
    transform-origin: top center;
    transition:
      opacity 120ms ease,
      transform 120ms ease,
      visibility 120ms ease;
  }

  .menu-dock.open .menu-panels,
  .menu-dock:hover .menu-panels,
  .menu-dock:focus-within .menu-panels {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scale(1);
  }

  .settings-layer {
    position: fixed;
    z-index: 70;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: var(--bg);
  }

  .settings-modal {
    display: grid;
    gap: 14px;
    width: min(430px, 100%);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 14px;
    background: var(--paper);
    animation: menu-in 120ms ease-out;
  }

  .settings-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
    border-bottom: 1px solid var(--line);
    padding-bottom: 12px;
  }

  .settings-title {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-width: 0;
    color: var(--text);
  }

  .settings-title h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 18px;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-actions {
    display: grid;
    gap: 4px;
  }

  .settings-action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-height: 32px;
    border-color: var(--line);
    padding: 0 9px;
    background: transparent;
    color: var(--muted);
    text-align: left;
  }

  .settings-action span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-action:hover,
  .settings-action:focus-visible,
  .settings-action.active {
    border-color: var(--line-strong);
    background: transparent;
    color: var(--text);
  }

  .settings-zoom {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }

  .settings-zoom span {
    min-width: 0;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  aside {
    min-width: 0;
    overflow: hidden;
    pointer-events: auto;
    border: 0;
    border-radius: 0;
    background: var(--panel-soft-transparent);
    box-shadow: none;
  }

  .notebooks,
  .notes {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 22px;
  }

  .notebooks {
    min-height: 0;
    border-right: 1px solid var(--line);
  }

  .notes {
    min-height: 0;
    background: transparent;
  }

  .icon-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .icon-button {
    display: inline-grid;
    width: 38px;
    min-width: 38px;
    height: 38px;
    min-height: 38px;
    place-items: center;
    padding: 0;
    background: transparent;
    color: var(--muted);
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .icon-button:hover,
  .icon-button:focus-visible,
  .active.icon-button {
    color: var(--text);
    border-color: var(--line-strong);
    background: transparent;
  }

  .icon-button:not(:disabled):hover {
    transform: none;
  }

  .mini {
    width: 32px;
    min-width: 32px;
    height: 32px;
    min-height: 32px;
  }

  .sort-select {
    width: 92px;
    height: 38px;
    margin-left: auto;
    padding: 0 8px;
    color: var(--muted);
    font-size: 12px;
    background: var(--field);
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .sort-select:hover,
  .sort-select:focus-visible {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--field);
  }

  .menu-form {
    display: grid;
    gap: 14px;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 16px;
    background: var(--field);
    box-shadow: none;
    animation: menu-in 120ms ease-out;
  }

  .file-input {
    display: none;
  }

  .search-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 0 12px 0 16px;
    background: var(--field);
    color: var(--muted);
  }

  .search-row input {
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 13px;
  }

  .search-row input:focus-visible {
    outline: 0;
  }

  .search-row input::placeholder {
    color: var(--muted);
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  .menu-form input {
    min-width: 0;
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0 14px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .menu-form input::placeholder {
    color: var(--muted);
  }

  .form-error {
    margin: 0;
    color: var(--danger);
    font-size: 11px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  nav,
  .note-list {
    --nav-trailing-width: 58px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
  }

  nav::-webkit-scrollbar,
  .note-list::-webkit-scrollbar,
  textarea::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .nav-main,
  .notebook-main {
    display: grid;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    min-height: 46px;
    padding: 0 14px;
    background: transparent;
    border-color: transparent;
    font-size: 13px;
    text-align: left;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .nav-main,
  .notebook-main {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .nav-row:hover,
  .nav-row:focus-within,
  .notebook-row:hover,
  .notebook-row:focus-within {
    border-color: var(--line);
  }

  .nav-main span,
  .notebook-main span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-count {
    justify-self: stretch;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
    text-align: right;
    transition: opacity 120ms ease;
  }

  .nav-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--nav-trailing-width);
    align-items: center;
    width: 100%;
    min-width: 0;
    min-height: 46px;
    border: 1px solid transparent;
    border-radius: 16px;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .nav-trailing,
  .notebook-trailing {
    position: relative;
    display: grid;
    width: var(--nav-trailing-width);
    place-items: center stretch;
    padding-right: 14px;
  }

  .notebook-main {
    border: 0;
    box-shadow: none;
  }

  .notebook-actions {
    position: absolute;
    top: 50%;
    right: 14px;
    display: flex;
    gap: 8px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%);
    transition: opacity 120ms ease;
  }

  .notebook-row:hover .notebook-actions,
  .notebook-row:focus-within .notebook-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .notebook-row:hover .notebook-trailing .nav-count,
  .notebook-row:focus-within .notebook-trailing .nav-count {
    opacity: 0;
  }

  .inline-rename {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 8px;
  }

  .inline-rename input {
    min-width: 0;
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0 14px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .notebook-error {
    grid-column: 1 / -1;
    padding: 0 4px 2px;
  }

  .delete-confirm {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    min-height: 46px;
    padding: 8px 8px 8px 14px;
    color: var(--danger);
    font-size: 12px;
  }

  .delete-confirm span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-list {
    flex: 1;
  }

  .date-range {
    padding: 14px 14px 6px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .note-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 116px;
    border: 1px solid transparent;
    border-radius: 18px;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .note-row:hover,
  .note-row:focus-within {
    border-color: var(--line);
  }

  .note-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    min-height: 108px;
    padding: 16px 18px;
    border: 0;
    text-align: left;
  }

  .note-heading {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  .note-title,
  .note-preview,
  .note-age {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-title {
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }

  .note-preview {
    color: var(--muted);
    font-size: 12px;
  }

  .note-notebooks {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px;
    align-items: center;
    min-width: 0;
    color: var(--text);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.25;
  }

  .note-notebooks span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-age {
    color: var(--muted);
    font-size: 11px;
  }

  .note-context {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.25;
    overflow: hidden;
  }

  .note-context time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-context time + time::before {
    margin-right: 6px;
    content: '·';
  }

  .note-main time,
  .sync-line {
    color: var(--muted);
    font-size: 11px;
  }

  .sync-line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 16px;
    margin: -8px 4px 0;
  }

  .sync-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    gap: 10px;
    padding-right: 12px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .note-row:hover .row-actions,
  .note-row:focus-within .row-actions {
    opacity: 1;
  }

  .compact {
    gap: 8px;
  }

  .compact .date-range {
    padding-top: 12px;
  }

  .compact .note-row {
    min-height: 58px;
  }

  .compact .note-main {
    min-height: 54px;
    padding-block: 12px;
  }

  .compact .row-actions {
    align-self: center;
  }

  .link-popover {
    position: absolute;
    z-index: 2;
    top: 70px;
    right: 18px;
    width: min(260px, calc(100% - 36px));
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 14px;
    background: var(--field);
    box-shadow: none;
    animation: menu-in 120ms ease-out;
  }

  .link-popover {
    display: grid;
    gap: 10px;
  }

  .link-popover button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 14px;
    gap: 12px;
    align-items: center;
    min-height: 42px;
    border-color: transparent;
    padding: 0 12px;
    text-align: left;
  }

  .link-popover button:hover,
  .link-popover button:focus-visible {
    border-color: var(--line);
  }

  .link-popover button.active {
    color: var(--text);
    font-weight: 600;
  }

  .link-popover button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active {
    border-color: var(--line-strong);
    background: transparent;
    box-shadow: none;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    min-width: 8px;
    height: 8px;
    border: 0;
    border-radius: 0;
    color: var(--muted);
    background: transparent;
  }

  .status-dot.synced {
    color: var(--text);
    background: var(--text);
  }

  .status-dot.pending,
  .status-dot.syncing {
    color: var(--muted);
    background: var(--muted);
  }

  .status-dot.conflict,
  .status-dot.deleted {
    color: var(--danger);
    background: var(--danger);
  }

  .status-dot.offline {
    color: var(--muted);
  }

  .status-dot.local-only {
    color: var(--muted);
  }

  .note-status {
    width: 7px;
    min-width: 7px;
    height: 7px;
  }

  .conflicted {
    border-color: var(--danger);
  }

  .danger {
    color: var(--danger);
  }

  .empty-list {
    margin: 14px 10px;
    color: var(--muted);
    font-size: 12px;
  }

  .context-menu {
    position: fixed;
    z-index: 60;
    display: grid;
    gap: 2px;
    width: 190px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px;
    background: var(--field);
    box-shadow: none;
  }

  .context-menu button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-height: 30px;
    border-color: transparent;
    padding: 0 8px;
    text-align: left;
  }

  .context-menu button:hover,
  .context-menu button:focus-visible {
    border-color: var(--line);
    background: transparent;
  }

  .editor-wrap {
    display: grid;
    min-width: 0;
    min-height: 100vh;
    background: var(--paper);
  }

  .writer {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(940px, 100%);
    min-width: 0;
    min-height: 100vh;
    justify-self: center;
    padding: clamp(48px, 8vw, 118px);
    background: var(--paper);
  }

  .title-input,
  textarea {
    width: 100%;
    resize: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
    color: var(--text);
    letter-spacing: 0;
  }

  .title-input {
    min-height: 46px;
    margin-bottom: 30px;
    font-size: clamp(
      calc(28px * var(--editor-zoom, 1)),
      calc(4.5vw * var(--editor-zoom, 1)),
      calc(46px * var(--editor-zoom, 1))
    );
    font-weight: 700;
    line-height: 1.04;
  }

  textarea {
    min-height: 0;
    font-size: calc(16px * var(--editor-zoom, 1));
    line-height: 1.6;
    scrollbar-width: none;
  }

  .editor-status {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding-top: 18px;
    text-align: center;
    color: var(--muted);
    font-size: 11px;
  }

  .history-controls {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }

  .title-input:focus-visible,
  textarea:focus-visible {
    outline: 0;
  }

  .conflict-backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: var(--bg);
  }

  .conflict-dialog {
    width: min(720px, 100%);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 18px;
    background: var(--bg);
    box-shadow: none;
  }

  .conflict-dialog h1 {
    margin: 0 0 4px;
    font-size: 16px;
    letter-spacing: 0;
  }

  .conflict-dialog p {
    margin: 0;
    color: var(--muted);
  }

  .versions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 16px 0;
  }

  .versions article {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 12px;
    background: var(--panel-soft);
  }

  .versions strong,
  .versions time {
    display: block;
  }

  .versions time {
    margin: 4px 0 10px;
    color: var(--muted);
    font-size: 11px;
  }

  .versions p {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .conflict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .menu-trigger,
    .profile-trigger,
    .profile-hover-card,
    .profile-quick-action,
    .menu-panels,
    .settings-modal,
    .settings-action,
    .icon-button,
    .nav-row,
    .nav-main,
    .notebook-row,
    .notebook-main,
    .notebook-actions,
    .notebook-trailing .nav-count,
    .note-row,
    .row-actions {
      transition: none;
    }

    .menu-form,
    .settings-modal,
    .link-popover {
      animation: none;
    }

    .icon-button:not(:disabled):hover,
    .nav-row:hover,
    .nav-row:focus-within,
    .notebook-row:hover,
    .notebook-row:focus-within,
    .note-row:hover,
    .note-row:focus-within {
      transform: none;
    }
  }

  @media (max-width: 980px) {
    .app-shell {
      display: block;
    }

    .menu-dock {
      position: fixed;
      top: 0;
      left: 50%;
      width: min(100vw - 18px, 920px);
      height: 76px;
      border-right: 0;
      background: transparent;
      transform: translateX(-50%);
    }

    .menu-dock.open,
    .menu-dock:hover,
    .menu-dock:focus-within {
      height: 100vh;
    }

    .dock-buttons {
      top: 16px;
      left: 50%;
    }

    .menu-trigger {
      position: relative;
      top: 0;
      left: 0;
      z-index: 22;
    }

    .profile-trigger {
      z-index: 22;
    }

    .menu-panels {
      position: absolute;
      z-index: 21;
      top: 82px;
      left: 0;
      grid-template-columns: minmax(150px, 0.42fr) minmax(0, 0.58fr);
      grid-template-rows: minmax(0, 1fr);
      width: 100%;
      height: min(80vh, calc(100vh - 96px));
      padding: 14px;
      background: var(--panel-transparent);
      border: 1px solid var(--line);
      border-radius: 24px;
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-8px) scale(0.98);
      transform-origin: top center;
      transition:
        opacity 120ms ease,
        transform 120ms ease,
        visibility 120ms ease;
    }

    .menu-dock.open .menu-panels,
    .menu-dock:hover .menu-panels,
    .menu-dock:focus-within .menu-panels {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }

    .settings-layer {
      padding: 14px;
    }

    .notebooks,
    .notes {
      gap: 16px;
      padding: 16px;
    }

    .row-actions {
      opacity: 1;
    }

    .editor-wrap,
    .writer {
      min-height: 100vh;
    }

    .writer {
      padding: 38px 30px;
    }

    .title-input {
      font-size: calc(30px * var(--editor-zoom, 1));
    }

    .versions {
      grid-template-columns: 1fr;
    }
  }
</style>
