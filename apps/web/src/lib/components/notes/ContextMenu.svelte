<script lang="ts">
  import {
    ArchiveRestore,
    Check,
    FolderSymlink,
    Inbox,
    Notebook,
    Pencil,
    Trash2
  } from 'lucide-svelte';
  import { noteDisplayTitle, noteNotebookIds } from '$lib/client/note-utils';
  import type { ContextMenuModel } from './notes-page-controller.svelte.js';

  let { model }: { model: ContextMenuModel } = $props();

  const menuStyle = $derived(
    model.contextMenu
      ? `left: ${model.contextMenu.x}px; top: ${model.contextMenu.y}px;`
      : ''
  );
</script>

{#if model.contextMenu?.type === 'notebook' && model.contextNotebook}
  {@const contextNotebook = model.contextNotebook}
  <div
    class="context-menu"
    style={menuStyle}
    role="menu"
    tabindex="-1"
    aria-label={`${contextNotebook.name} actions`}
    oncontextmenu={(event) => event.preventDefault()}
  >
    <button
      role="menuitem"
      onclick={(event) => {
        event.stopPropagation();
        model.contextRenameNotebook(contextNotebook);
      }}
    >
      <Pencil size={14} strokeWidth={1.8} />
      <span>Rename</span>
    </button>
    <button
      class="danger"
      role="menuitem"
      onclick={(event) => {
        event.stopPropagation();
        model.contextDeleteNotebook(contextNotebook);
      }}
    >
      <Trash2 size={14} strokeWidth={1.8} />
      <span>Delete</span>
    </button>
  </div>
{/if}

{#if (model.contextMenu?.type === 'note' || model.contextMenu?.type === 'editor') && model.contextNote}
  {@const contextNote = model.contextNote}
  <div
    class="context-menu note-context-menu"
    style={menuStyle}
    role="menu"
    tabindex="-1"
    aria-label={`${noteDisplayTitle(contextNote)} actions`}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#if contextNote.trashedAt}
      <button
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          void model.contextRestoreNote(contextNote);
        }}
      >
        <ArchiveRestore size={14} strokeWidth={1.8} />
        <span>Restore</span>
      </button>
    {:else}
      <div class="context-section" aria-label="Notebook links">
        <span class="context-section-title">
          <FolderSymlink size={13} strokeWidth={1.8} />
          <span>Notebook</span>
        </span>
        <button
          class:active={noteNotebookIds(contextNote).length === 0}
          aria-checked={noteNotebookIds(contextNote).length === 0}
          role="menuitemcheckbox"
          onclick={(event) => {
            event.stopPropagation();
            void model.assignNotebookForNote(contextNote, null);
          }}
        >
          <Inbox size={14} strokeWidth={1.8} />
          <span>Unfiled</span>
          {#if noteNotebookIds(contextNote).length === 0}
            <Check size={13} strokeWidth={1.9} />
          {/if}
        </button>
        {#each model.notebooks as notebook}
          <button
            class:active={noteNotebookIds(contextNote).includes(notebook.id)}
            aria-checked={noteNotebookIds(contextNote).includes(notebook.id)}
            role="menuitemcheckbox"
            onclick={(event) => {
              event.stopPropagation();
              void model.assignNotebookForNote(contextNote, notebook.id);
            }}
          >
            <Notebook size={14} strokeWidth={1.8} />
            <span>{notebook.name}</span>
            {#if noteNotebookIds(contextNote).includes(notebook.id)}
              <Check size={13} strokeWidth={1.9} />
            {/if}
          </button>
        {/each}
      </div>
      <button
        class="danger"
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          void model.contextTrashNote(contextNote);
        }}
      >
        <Trash2 size={14} strokeWidth={1.8} />
        <span>Move to Trash</span>
      </button>
    {/if}
  </div>
{/if}
