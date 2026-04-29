<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArchiveRestore,
    Check,
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
    RefreshCw,
    Sun,
    Trash2,
    X
  } from 'lucide-svelte';
  import type { Device } from '@author/schema';
  import type { LocalConflict, LocalNote, LocalNotebook } from '$lib/client/db';
  import {
    assignNoteToNotebook,
    createBlankNote,
    createNotebook,
    deleteNotebook,
    getTheme,
    getToken,
    loadDevices,
    loadNotes,
    loadNotebooks,
    loadPendingConflicts,
    loadTrash,
    moveNoteToTrash,
    noteDisplayTitle,
    normalizeNotebookName,
    notebookNameExists,
    renameNotebook,
    restoreNote,
    resolveConflict,
    setTheme,
    setToken,
    updateNoteContent
  } from '$lib/client/store';
  import { login, runSync } from '$lib/client/sync';

  type NoteSort = 'date-desc' | 'az' | 'za';
  type NoteGroup = { label: string; notes: LocalNote[] };

  const SORT_KEY = 'author-notes-sort';
  const EMPTY_NOTEBOOK_FILTERS = new Set(['all', 'unfiled', 'trash']);

  let notes: LocalNote[] = [];
  let notebooks: LocalNotebook[] = [];
  let trash: LocalNote[] = [];
  let devices: Device[] = [];
  let conflicts: LocalConflict[] = [];
  let selectedNote: LocalNote | null = null;
  let titleValue = '';
  let bodyValue = '';
  let filterId: 'all' | 'unfiled' | 'trash' | string = 'all';
  let linkingNoteId: string | null = null;
  let syncMessage = 'Offline first';
  let isSyncing = false;
  let isLoggingIn = false;
  let hasToken = false;
  let theme: 'light' | 'dark' = 'light';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let newNotebookOpen = false;
  let notebookNameValue = '';
  let notebookError = '';
  let loginOpen = false;
  let loginPasswordValue = '';
  let loginError = '';
  let renamingNotebookId: string | null = null;
  let renameNotebookValue = '';
  let renameNotebookError = '';
  let deletingNotebookId: string | null = null;
  let noteSort: NoteSort = 'date-desc';
  let currentTime = new Date();
  let titleInput: HTMLInputElement | null = null;
  let bodyTextarea: HTMLTextAreaElement | null = null;
  let menusOpen = false;
  let menuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  $: filteredNotes =
    filterId === 'trash'
      ? trash
      : notes.filter((note) => {
          if (filterId === 'all') return true;
          if (filterId === 'unfiled') return note.notebookId === null;
          return note.notebookId === filterId;
        });
  $: visibleNotes = sortNotes(filteredNotes, noteSort);
  $: visibleNoteGroups = groupNotesByDateRange(visibleNotes, noteSort);
  $: wordCount = countWords(`${titleValue} ${bodyValue}`);
  $: activeConflict = conflicts[0] ?? null;

  onMount(() => {
    const clock = setInterval(() => {
      currentTime = new Date();
    }, 1000);

    void initialize();

    return () => {
      clearInterval(clock);
      if (saveTimer) clearTimeout(saveTimer);
      if (menuCloseTimer) clearTimeout(menuCloseTimer);
    };
  });

  async function initialize() {
    theme = getTheme();
    setTheme(theme);
    noteSort = getStoredSort();
    await refresh();
    openDraftNote();

    const token = getToken();
    hasToken = Boolean(token);
    if (token) {
      await syncNow();
    }
  }

  async function refresh() {
    [notes, notebooks, trash, conflicts, devices] = await Promise.all([
      loadNotes(),
      loadNotebooks(),
      loadTrash(),
      loadPendingConflicts(),
      loadDevices()
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
    void focusEditor('title');
  }

  async function selectNote(note: LocalNote) {
    await flushPendingSave();
    selectedNote = note;
    linkingNoteId = null;
    titleValue = note.title;
    bodyValue = note.body;
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

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void focusEditor('body');
  }

  function openMenus() {
    if (menuCloseTimer) {
      clearTimeout(menuCloseTimer);
      menuCloseTimer = null;
    }
    menusOpen = true;
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

  function changeSort(event: Event) {
    noteSort = (event.currentTarget as HTMLSelectElement).value as NoteSort;
    localStorage.setItem(SORT_KEY, noteSort);
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

  function notebookName(notebookId: string | null): string | null {
    if (!notebookId) return null;
    return notebooks.find((notebook) => notebook.id === notebookId)?.name ?? null;
  }

  function deviceName(deviceId: string | null | undefined): string {
    if (!deviceId) return 'Unknown device';
    return devices.find((device) => device.id === deviceId)?.name ?? deviceId;
  }

  async function assignNotebookForNote(noteId: string, event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const updated = await assignNoteToNotebook(noteId, value || null);
    if (updated && selectedNote?.id === noteId) selectedNote = updated;
    linkingNoteId = null;
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
        const updated = await assignNoteToNotebook(selectedNote.id, notebook.id);
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

    if (selectedNote?.notebookId === notebook.id) {
      selectedNote = { ...selectedNote, notebookId: null };
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

  async function syncNow() {
    const token = getToken();
    if (!token || isSyncing) return;

    isSyncing = true;
    syncMessage = 'Syncing';
    try {
      const result = await runSync(token);
      syncMessage =
        result.conflicts > 0
          ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
          : 'Synced';
      await refresh();
    } catch (error) {
      syncMessage = error instanceof Error ? error.message : 'Sync failed';
    } finally {
      isSyncing = false;
    }
  }

  function toggleLoginMenu() {
    loginOpen = !loginOpen;
    newNotebookOpen = false;
    loginPasswordValue = '';
    loginError = '';
  }

  async function submitLoginMenu() {
    const password = loginPasswordValue.trim();
    if (isLoggingIn) return;
    if (!password) {
      loginError = 'Password required';
      return;
    }

    isLoggingIn = true;
    loginError = '';
    try {
      const token = await login(password);
      setToken(token);
      hasToken = true;
      loginOpen = false;
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
    <button
      class="icon-button menu-trigger"
      title="Show menus"
      aria-label="Show menus"
      aria-controls="navigation-menus"
      aria-expanded={menusOpen}
    >
      <Menu size={18} strokeWidth={1.8} />
    </button>

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
          <button class="icon-button" title="Toggle theme" aria-label="Toggle theme" on:click={toggleTheme}>
            {#if theme === 'dark'}
              <Sun size={16} strokeWidth={1.8} />
            {:else}
              <Moon size={16} strokeWidth={1.8} />
            {/if}
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
          <button class:active={filterId === 'unfiled'} on:click={() => (filterId = 'unfiled')}>
            <Inbox size={15} strokeWidth={1.8} />
            <span>Unfiled</span>
          </button>
          {#each notebooks as notebook}
            <div class="notebook-row" class:active={filterId === notebook.id}>
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
                >
                  <Notebook size={15} strokeWidth={1.8} />
                  <span>{notebook.name}</span>
                </button>
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
              {/if}
            </div>
          {/each}
          <button class:active={filterId === 'trash'} on:click={() => (filterId = 'trash')}>
            <Trash2 size={15} strokeWidth={1.8} />
            <span>Trash</span>
          </button>
        </nav>
      </aside>

      <aside class="notes" aria-label="Notes">
        <div class="icon-row">
          <button class="icon-button" title="New note" aria-label="New note" on:click={newNote}>
            <FilePlus size={16} strokeWidth={1.8} />
          </button>
          {#if hasToken}
            <button
              class="icon-button"
              title="Sync"
              aria-label="Sync"
              disabled={isSyncing}
              on:click={syncNow}
            >
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
          {:else}
            <button
              class="icon-button"
              class:active={loginOpen}
              title="Login"
              aria-label="Login"
              on:click={toggleLoginMenu}
            >
              <LogIn size={16} strokeWidth={1.8} />
            </button>
          {/if}
          <label class="sr-only" for="note-sort">Sort notes</label>
          <select id="note-sort" class="sort-select" aria-label="Sort notes" bind:value={noteSort} on:change={changeSort}>
            <option value="date-desc">Date</option>
            <option value="az">A-Z</option>
            <option value="za">Z-A</option>
          </select>
        </div>

        {#if loginOpen}
          <form class="menu-form" aria-label="Login menu" on:submit|preventDefault={submitLoginMenu}>
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

        <p class="sync-line">{syncMessage}</p>

        <div class="note-list">
          {#each visibleNoteGroups as group}
            {#if group.notes.length}
              <div class="date-range">{group.label}</div>
              {#each group.notes as note}
                <div
                  class="note-row"
                  class:active={selectedNote?.id === note.id}
                  class:pending={note.syncStatus === 'pending'}
                  class:conflicted={note.syncStatus === 'conflict'}
                >
                  <button class="note-main" on:click={() => selectNote(note)}>
                    <span class="note-title">{noteDisplayTitle(note)}</span>
                    <span class="note-preview">{notePreview(note) || 'No text'}</span>
                    <span class="note-context">
                      <time>Updated {formatListDate(note.updatedAt)}</time>
                      <time>Created {formatListDate(note.createdAt)}</time>
                      {#if notebookName(note.notebookId)}
                        <span>{notebookName(note.notebookId)}</span>
                      {/if}
                    </span>
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
                        title="Link notebook"
                        aria-label="Link notebook"
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
                    <div class="link-popover">
                      <select
                        aria-label="Notebook"
                        value={note.notebookId ?? ''}
                        on:change={(event) => assignNotebookForNote(note.id, event)}
                      >
                        <option value="">Unfiled</option>
                        {#each notebooks as notebook}
                          <option value={notebook.id}>{notebook.name}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          {/each}
        </div>
      </aside>
    </div>
  </div>

  <section class="editor-wrap" aria-label="Editor">
    <section class="writer" aria-label="Plain text editor">
      <input
        class="title-input"
        aria-label="Note title"
        bind:this={titleInput}
        bind:value={titleValue}
        readonly={Boolean(selectedNote?.trashedAt)}
        spellcheck="true"
        on:keydown={handleTitleKeydown}
        on:input={scheduleNoteSave}
      />
      <textarea
        aria-label="Note body"
        bind:this={bodyTextarea}
        bind:value={bodyValue}
        readonly={Boolean(selectedNote?.trashedAt)}
        spellcheck="true"
        on:input={scheduleNoteSave}
      ></textarea>
      <footer class="editor-status" aria-label="Note details">
        <span>{formatClock(currentTime)}</span>
        <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
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
    top: 14px;
    left: 14px;
  }

  .menu-trigger {
    position: relative;
    z-index: 3;
    background: var(--panel);
    box-shadow: 0 4px 18px var(--shadow);
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .menu-panels {
    position: fixed;
    z-index: 2;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(180px, 240px) minmax(300px, 430px) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 8px;
    width: 100vw;
    height: 100vh;
    padding: 52px 14px 14px;
    background: var(--overlay);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-6px);
    transition:
      opacity 140ms ease,
      transform 140ms ease,
      visibility 140ms ease;
  }

  .menu-dock.open .menu-panels,
  .menu-dock:hover .menu-panels,
  .menu-dock:focus-within .menu-panels {
    visibility: visible;
    opacity: 1;
    pointer-events: none;
    transform: translateY(0);
  }

  aside {
    min-width: 0;
    overflow: hidden;
    pointer-events: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    box-shadow: 0 12px 36px var(--shadow);
  }

  .notebooks,
  .notes {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
  }

  .notebooks {
    min-height: 0;
  }

  .notes {
    min-height: 0;
    background: var(--panel-soft);
  }

  .icon-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .icon-button {
    display: inline-grid;
    width: 30px;
    min-width: 30px;
    height: 30px;
    min-height: 30px;
    place-items: center;
    padding: 0;
    color: var(--muted);
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .icon-button:hover,
  .icon-button:focus-visible,
  .active.icon-button {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--field);
  }

  .icon-button:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .mini {
    width: 26px;
    min-width: 26px;
    height: 26px;
    min-height: 26px;
  }

  .sort-select {
    width: 72px;
    height: 30px;
    margin-left: auto;
    padding: 0 8px;
    color: var(--muted);
    font-size: 12px;
    background: transparent;
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
    gap: 6px;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    background: var(--field);
    box-shadow: 0 8px 22px var(--shadow);
    animation: menu-in 120ms ease-out;
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  .menu-form input {
    min-width: 0;
    height: 30px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 10px;
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
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  nav > button,
  .notebook-main {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 34px;
    padding: 0 10px;
    border-color: transparent;
    font-size: 13px;
    text-align: left;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }

  nav > button:hover,
  nav > button:focus-visible,
  .notebook-row:hover,
  .notebook-row:focus-within {
    transform: translateX(2px);
  }

  nav > button span,
  .notebook-main span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notebook-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 34px;
    border: 1px solid transparent;
    border-radius: 8px;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .notebook-main {
    border: 0;
    box-shadow: none;
  }

  .notebook-actions {
    display: flex;
    gap: 4px;
    padding-right: 4px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .notebook-row:hover .notebook-actions,
  .notebook-row:focus-within .notebook-actions {
    opacity: 1;
  }

  .inline-rename {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: center;
    min-width: 0;
    padding: 4px;
  }

  .inline-rename input {
    min-width: 0;
    height: 28px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 8px;
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
    gap: 6px;
    align-items: center;
    min-height: 34px;
    padding: 4px 4px 4px 10px;
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
    padding: 9px 10px 4px;
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
    min-height: 74px;
    border: 1px solid transparent;
    border-radius: 8px;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .note-row:hover,
  .note-row:focus-within {
    transform: translateX(2px);
  }

  .note-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    min-height: 70px;
    padding: 8px 10px;
    border: 0;
    text-align: left;
  }

  .note-title,
  .note-preview {
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

  .note-context {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.25;
    overflow: hidden;
  }

  .note-context time,
  .note-context span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-context time + time::before,
  .note-context span::before {
    margin-right: 6px;
    content: '·';
  }

  .note-main time,
  .sync-line {
    color: var(--muted);
    font-size: 11px;
  }

  .sync-line {
    min-height: 16px;
    margin: -4px 2px 0;
  }

  .row-actions {
    display: flex;
    gap: 4px;
    padding-right: 6px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .note-row:hover .row-actions,
  .note-row:focus-within .row-actions {
    opacity: 1;
  }

  .link-popover {
    position: absolute;
    z-index: 2;
    top: 48px;
    right: 8px;
    width: min(190px, calc(100% - 16px));
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px;
    background: var(--field);
    box-shadow: 0 8px 24px var(--shadow);
    animation: menu-in 120ms ease-out;
  }

  .link-popover select {
    width: 100%;
    min-height: 30px;
  }

  .active {
    border-color: var(--line-strong);
    background: var(--field);
    box-shadow: 0 1px 8px var(--shadow);
  }

  .pending .note-title::after {
    color: var(--muted);
    content: ' *';
  }

  .conflicted {
    border-color: var(--danger);
  }

  .danger {
    color: var(--danger);
  }

  .editor-wrap {
    display: grid;
    min-width: 0;
    min-height: 100vh;
    background: var(--bg);
  }

  .writer {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(860px, 100%);
    min-width: 0;
    min-height: 100vh;
    justify-self: center;
    padding: clamp(28px, 6vw, 82px);
  }

  .title-input,
  textarea {
    font-family: "Source Serif 4", ui-serif, Georgia, Cambria, "Times New Roman", serif;
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
    margin-bottom: 16px;
    font-size: clamp(28px, 4.5vw, 46px);
    font-weight: 700;
    line-height: 1.04;
  }

  textarea {
    min-height: 0;
    font-size: 16px;
    line-height: 1.6;
    scrollbar-width: none;
  }

  .editor-status {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    min-width: 0;
    padding-top: 18px;
    color: var(--muted);
    font-size: 11px;
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
    background: rgba(0, 0, 0, 0.26);
  }

  .conflict-dialog {
    width: min(720px, 100%);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 18px;
    background: var(--bg);
    box-shadow: 0 18px 50px var(--shadow);
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
    border-radius: 8px;
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
    .menu-panels,
    .icon-button,
    nav > button,
    .notebook-row,
    .notebook-main,
    .notebook-actions,
    .note-row,
    .row-actions {
      transition: none;
    }

    .menu-form,
    .link-popover {
      animation: none;
    }

    .icon-button:not(:disabled):hover,
    nav > button:hover,
    nav > button:focus-visible,
    .notebook-row:hover,
    .notebook-row:focus-within,
    .note-row:hover,
    .note-row:focus-within {
      transform: none;
    }
  }

  @media (max-width: 980px) {
    .menu-dock {
      top: 10px;
      left: 10px;
    }

    .menu-panels {
      grid-template-columns: minmax(118px, 0.42fr) minmax(0, 0.58fr) 0;
      grid-template-rows: minmax(0, 1fr);
      padding: 48px 10px 10px;
    }

    .notebooks,
    .notes {
      padding: 10px;
    }

    .row-actions {
      opacity: 1;
    }

    .notebook-actions {
      opacity: 1;
    }

    .editor-wrap,
    .writer {
      min-height: 58vh;
    }

    .writer {
      padding: 26px 22px;
    }

    .title-input {
      font-size: 30px;
    }

    .versions {
      grid-template-columns: 1fr;
    }
  }
</style>
