<script lang="ts">
  import {
    ArchiveRestore,
    FilePlus,
    FolderSymlink,
    Inbox,
    Notebook,
    Search,
    Check,
    ChevronDown,
    ArrowDownAZ,
    ArrowDownZA,
    Clock3,
    Trash2,
    X
  } from 'lucide-svelte';
  import { noteDisplayTitle } from '$lib/client/note-utils';
  import {
    formatListDate,
    notePreview,
    relativeAge
  } from '$lib/client/view-model';
  import type { NoteSort } from '$lib/client/view-model';
  import NotebookLinkMenu from './NotebookLinkMenu.svelte';
  import type { NoteListPanelModel } from './notes-page-controller.svelte.js';

  let { model }: { model: NoteListPanelModel } = $props();
  let sortMenuOpen = $state(false);

  const sortOptions: Array<{
    value: NoteSort;
    label: string;
    shortLabel: string;
    icon: typeof Clock3;
  }> = [
    {
      value: 'date-desc',
      label: 'Newest first',
      shortLabel: 'Date',
      icon: Clock3
    },
    { value: 'az', label: 'A-Z', shortLabel: 'A-Z', icon: ArrowDownAZ },
    { value: 'za', label: 'Z-A', shortLabel: 'Z-A', icon: ArrowDownZA }
  ];

  const activeSort = $derived(
    sortOptions.find((option) => option.value === model.noteSort) ??
      sortOptions[0]
  );

  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return {
      update(nextValue: boolean) {
        node.indeterminate = nextValue;
      }
    };
  }

  function closeSortMenuOnBlur(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    sortMenuOpen = false;
  }

  function pickSort(sort: NoteSort) {
    model.setNoteSort(sort);
    sortMenuOpen = false;
  }
</script>

<aside class="notes" aria-label="Notes">
  <div class="icon-row">
    <button
      class="icon-button"
      title="New note"
      aria-label="New note"
      onclick={model.newNote}
    >
      <FilePlus size={16} strokeWidth={1.8} />
    </button>
    <label class="select-all-control">
      <input
        type="checkbox"
        checked={model.allVisibleNotesSelected}
        disabled={!model.visibleNotes.length}
        aria-label={model.allVisibleNotesSelected
          ? 'Deselect all visible notes'
          : 'Select all visible notes'}
        use:indeterminate={model.someVisibleNotesSelected &&
          !model.allVisibleNotesSelected}
        onchange={(event) =>
          model.toggleAllVisibleNotes(
            (event.currentTarget as HTMLInputElement).checked
          )}
        onclick={(event) => event.stopPropagation()}
      />
      <span
        >{model.allVisibleNotesSelected ? 'Deselect all' : 'Select all'}</span
      >
    </label>
    {#if model.selectedNoteCount}
      <div
        class="batch-actions"
        role="group"
        aria-label="Selected note actions"
      >
        {#if model.selectedActiveNoteCount}
          <button
            class="icon-button mini"
            type="button"
            title="Move selected to notebook"
            aria-label="Move selected to notebook"
            aria-expanded={model.selectedNotebookMenuOpen}
            onclick={model.toggleSelectedNotebookMenu}
          >
            <FolderSymlink size={14} strokeWidth={1.8} />
          </button>
          <button
            class="icon-button mini danger"
            type="button"
            title="Move selected to Trash"
            aria-label="Move selected to Trash"
            onclick={() => void model.trashSelectedNotes()}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        {/if}
        {#if model.selectedTrashedNoteCount}
          <button
            class="icon-button mini"
            type="button"
            title="Restore selected"
            aria-label="Restore selected"
            onclick={() => void model.restoreSelectedNotes()}
          >
            <ArchiveRestore size={14} strokeWidth={1.8} />
          </button>
          <button
            class="icon-button mini danger"
            type="button"
            title="Delete selected permanently"
            aria-label="Delete selected permanently"
            onclick={() => void model.deleteSelectedNotesPermanently()}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        {/if}
      </div>
      <button
        class="selection-clear"
        type="button"
        title="Clear selected notes"
        aria-label="Clear selected notes"
        onclick={model.clearSelectedNotes}
      >
        <X size={13} strokeWidth={1.8} />
        <span>{model.selectedNoteCount} selected</span>
      </button>
    {/if}
    <p class="sync-line">
      <span
        class={`sync-state ${model.syncIndicator.tone}`}
        class:syncing={model.syncIndicator.kind === 'syncing'}
        aria-label={`Sync status: ${model.syncIndicator.label}`}
        >{model.syncIndicator.label}</span
      >
      {#if model.syncIndicator.detail}
        <span class="sync-detail">{model.syncIndicator.detail}</span>
      {/if}
    </p>
    <div
      class="sort-menu"
      role="group"
      aria-label="Sort notes"
      onfocusout={closeSortMenuOnBlur}
    >
      <button
        class="sort-trigger"
        type="button"
        aria-label={`Sort notes: ${activeSort.label}`}
        aria-haspopup="menu"
        aria-expanded={sortMenuOpen}
        onclick={() => (sortMenuOpen = !sortMenuOpen)}
      >
        <activeSort.icon size={14} strokeWidth={1.8} />
        <span>{activeSort.shortLabel}</span>
        <ChevronDown size={13} strokeWidth={1.8} />
      </button>
      {#if sortMenuOpen}
        <div class="sort-popover" role="menu" aria-label="Sort notes">
          {#each sortOptions as option}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={model.noteSort === option.value}
              class:active={model.noteSort === option.value}
              onclick={() => pickSort(option.value)}
            >
              <option.icon size={14} strokeWidth={1.8} />
              <span>{option.label}</span>
              <Check
                size={13}
                strokeWidth={1.8}
                opacity={model.noteSort === option.value ? 1 : 0}
              />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="search-row">
    <label class="sr-only" for="note-search">Search notes</label>
    <Search size={14} strokeWidth={1.8} />
    <input
      id="note-search"
      type="search"
      bind:value={model.searchValue}
      autocomplete="off"
      placeholder="Search notes"
    />
    {#if model.searchValue}
      <button
        class="icon-button mini"
        title="Clear search"
        aria-label="Clear search"
        type="button"
        onclick={() => (model.searchValue = '')}
      >
        <X size={13} strokeWidth={1.8} />
      </button>
    {/if}
  </div>

  <div class="note-list" class:compact={model.compactView}>
    {#each model.visibleNoteGroups as group}
      {#if group.notes.length}
        <div class="date-range">{group.label}</div>
        {#each group.notes as note}
          {@const noteNotebookNames = model.notebookNamesForNote(note)}
          <div
            class="note-row"
            class:active={model.selectedNote?.id === note.id}
            class:selected={model.selectedNoteIds.has(note.id)}
            class:pending={note.syncStatus === 'pending'}
            class:conflicted={note.syncStatus === 'conflict'}
            role="listitem"
            oncontextmenu={(event) => model.openNoteContext(event, note)}
          >
            <label
              class="note-select-cell"
              title="Select note"
              aria-label={`Select ${noteDisplayTitle(note)}`}
            >
              <input
                type="checkbox"
                checked={model.selectedNoteIds.has(note.id)}
                onclick={(event) => event.stopPropagation()}
                onchange={(event) =>
                  model.toggleNoteSelection(
                    note,
                    (event.currentTarget as HTMLInputElement).checked
                  )}
              />
            </label>
            <button class="note-main" onclick={() => model.selectNote(note)}>
              <span class="note-heading">
                <span class="note-title">{noteDisplayTitle(note)}</span>
                {#if model.compactView}
                  <time class="note-age" datetime={note.updatedAt}
                    >{relativeAge(note.updatedAt, model.currentTime)}</time
                  >
                {/if}
              </span>
              {#if !model.compactView}
                <span class="note-preview"
                  >{notePreview(note) || 'No text'}</span
                >
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
                  onclick={(event) => {
                    event.stopPropagation();
                    void model.restoreNoteFromRow(note);
                  }}
                >
                  <ArchiveRestore size={14} strokeWidth={1.8} />
                </button>
                <button
                  class="icon-button mini danger"
                  title="Delete permanently"
                  aria-label="Delete permanently"
                  onclick={(event) => {
                    event.stopPropagation();
                    void model.deleteNotePermanentlyFromRow(note);
                  }}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              {:else}
                <button
                  class="icon-button mini"
                  title="Notebooks"
                  aria-label="Notebooks"
                  onclick={(event) => {
                    event.stopPropagation();
                    model.toggleNotebookMenuForNote(note);
                  }}
                >
                  <FolderSymlink size={14} strokeWidth={1.8} />
                </button>
                <button
                  class="icon-button mini danger"
                  title="Move to Trash"
                  aria-label="Move to Trash"
                  onclick={(event) => {
                    event.stopPropagation();
                    void model.trashNote(note);
                  }}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              {/if}
            </div>

            {#if model.linkingNoteId === note.id && !note.trashedAt}
              <NotebookLinkMenu
                {note}
                notebooks={model.notebooks}
                onAssign={model.assignNotebookForNote}
              />
            {/if}
          </div>
        {/each}
      {/if}
    {/each}
    {#if !model.visibleNotes.length}
      <p class="empty-list">
        {model.searchValue ? 'No matching notes' : 'No notes'}
      </p>
    {/if}
  </div>

  {#if model.selectedNotebookMenuOpen && model.selectedActiveNoteCount}
    <div
      class="batch-popover"
      role="menu"
      aria-label="Selected note notebooks"
      tabindex="-1"
      oncontextmenu={(event) => event.preventDefault()}
    >
      <button
        role="menuitemcheckbox"
        aria-checked={model.selectedNotesHaveNotebook(null)}
        onclick={() => void model.assignNotebookForSelected(null)}
      >
        <Inbox size={14} strokeWidth={1.8} />
        <span>Unfiled</span>
      </button>
      {#each model.notebooks as notebook}
        <button
          role="menuitemcheckbox"
          aria-checked={model.selectedNotesHaveNotebook(notebook.id)}
          onclick={() => void model.assignNotebookForSelected(notebook.id)}
        >
          <Notebook size={14} strokeWidth={1.8} />
          <span>{notebook.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</aside>
