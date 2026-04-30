<script lang="ts">
  import {
    ArchiveRestore,
    Check,
    FilePlus,
    FolderSymlink,
    Inbox,
    Notebook,
    Search,
    Trash2,
    X
  } from 'lucide-svelte';
  import { noteDisplayTitle, noteNotebookIds } from '$lib/client/note-utils';
  import {
    formatListDate,
    notePreview,
    noteStatusLabel,
    relativeAge
  } from '$lib/client/view-model';
  import type { NoteListPanelModel } from './notes-page-controller.svelte.js';

  let { model }: { model: NoteListPanelModel } = $props();
</script>

<aside class="notes" aria-label="Notes">
  <div class="icon-row">
    <button class="icon-button" title="New note" aria-label="New note" onclick={model.newNote}>
      <FilePlus size={16} strokeWidth={1.8} />
    </button>
    <label class="sr-only" for="note-sort">Sort notes</label>
    <select
      id="note-sort"
      class="sort-select"
      aria-label="Sort notes"
      bind:value={model.noteSort}
      onchange={model.changeSort}
    >
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

  <p class="sync-line" aria-label={`Sync status: ${model.syncIndicator.label}`}>
    <span class={`status-dot ${model.syncIndicator.kind}`} aria-hidden="true"></span>
    <span>{model.syncIndicator.label}</span>
    {#if model.syncIndicator.detail}
      <span class="sync-detail">{model.syncIndicator.detail}</span>
    {/if}
  </p>

  <div class="note-list" class:compact={model.compactView}>
    {#each model.visibleNoteGroups as group}
      {#if group.notes.length}
        <div class="date-range">{group.label}</div>
        {#each group.notes as note}
          {@const noteNotebookNames = model.notebookNamesForNote(note)}
          <div
            class="note-row"
            class:active={model.selectedNote?.id === note.id}
            class:pending={note.syncStatus === 'pending'}
            class:conflicted={note.syncStatus === 'conflict'}
          >
            <button
              class="note-main"
              onclick={() => model.selectNote(note)}
              oncontextmenu={(event) => model.openNoteContext(event, note)}
            >
              <span class="note-heading">
                <span
                  class={`status-dot note-status ${note.syncStatus}`}
                  title={noteStatusLabel(note)}
                  aria-label={noteStatusLabel(note)}
                ></span>
                <span class="note-title">{noteDisplayTitle(note)}</span>
                {#if model.compactView}
                  <time class="note-age" datetime={note.updatedAt}>{relativeAge(note.updatedAt, model.currentTime)}</time>
                {/if}
              </span>
              {#if !model.compactView}
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
                  onclick={(event) => {
                    event.stopPropagation();
                    void model.restoreNoteFromRow(note);
                  }}
                >
                  <ArchiveRestore size={14} strokeWidth={1.8} />
                </button>
              {:else}
                <button
                  class="icon-button mini"
                  title="Notebooks"
                  aria-label="Notebooks"
                  onclick={(event) => {
                    event.stopPropagation();
                    model.linkingNoteId = model.linkingNoteId === note.id ? null : note.id;
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
              <div class="link-popover" role="menu" aria-label="Note notebooks">
                <button
                  class:active={noteNotebookIds(note).length === 0}
                  aria-checked={noteNotebookIds(note).length === 0}
                  role="menuitemcheckbox"
                  onclick={(event) => {
                    event.stopPropagation();
                    void model.assignNotebookForNote(note, null);
                  }}
                >
                  <Inbox size={14} strokeWidth={1.8} />
                  <span>Unfiled</span>
                  {#if noteNotebookIds(note).length === 0}
                    <Check size={13} strokeWidth={1.9} />
                  {/if}
                </button>
                {#each model.notebooks as notebook}
                  <button
                    class:active={noteNotebookIds(note).includes(notebook.id)}
                    aria-checked={noteNotebookIds(note).includes(notebook.id)}
                    role="menuitemcheckbox"
                    onclick={(event) => {
                      event.stopPropagation();
                      void model.assignNotebookForNote(note, notebook.id);
                    }}
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
    {#if !model.visibleNotes.length}
      <p class="empty-list">{model.searchValue ? 'No matching notes' : 'No notes'}</p>
    {/if}
  </div>
</aside>
