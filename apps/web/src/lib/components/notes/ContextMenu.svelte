<script lang="ts">
  import {
    ArchiveRestore,
    Check,
    FolderPlus,
    Pencil,
    Trash2,
    X
  } from 'lucide-svelte';
  import { noteDisplayTitle } from '$lib/client/note-utils';
  import NotebookLinkMenu from './NotebookLinkMenu.svelte';
  import type { ContextMenuModel } from './notes-page-controller.svelte.js';

  let { model }: { model: ContextMenuModel } = $props();
  let newNotebookOpen = $state(false);
  let newNotebookName = $state('');
  let newNotebookError = $state('');
  let activeContextNoteId = $state<string | null>(null);

  const menuStyle = $derived(
    model.contextMenu
      ? `left: ${model.contextMenu.x}px; top: ${model.contextMenu.y}px;`
      : ''
  );

  $effect(() => {
    const noteId = model.contextNote?.id ?? null;
    if (noteId === activeContextNoteId) return;
    activeContextNoteId = noteId;
    newNotebookOpen = false;
    newNotebookName = '';
    newNotebookError = '';
  });

  async function createContextNotebook(
    note: NonNullable<ContextMenuModel['contextNote']>
  ) {
    const error = await model.contextCreateNotebookForNote(
      note,
      newNotebookName
    );
    if (error) {
      newNotebookError = error;
      return;
    }
    newNotebookOpen = false;
    newNotebookName = '';
    newNotebookError = '';
  }

  function focusOnMount(node: HTMLInputElement) {
    queueMicrotask(() => node.focus());
    return {};
  }
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
    <div class="context-metadata" aria-label="Note metadata">
      {#each model.contextNoteMetadataRows(contextNote) as row}
        <span>
          <strong>{row.label}</strong>
          <small>{row.value}</small>
        </span>
      {/each}
    </div>
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
      <button
        class="danger"
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          void model.contextDeleteNotePermanently(contextNote);
        }}
      >
        <Trash2 size={14} strokeWidth={1.8} />
        <span>Delete permanently</span>
      </button>
    {:else}
      <NotebookLinkMenu
        note={contextNote}
        notebooks={model.notebooks}
        label="Notebook links"
        heading="Notebook"
        variant="context"
        onAssign={model.contextAssignNotebookForNote}
      />
      <div class="context-new-notebook">
        {#if newNotebookOpen}
          <form
            class="context-new-notebook-form"
            aria-label="Create notebook"
            onsubmit={(event) => {
              event.preventDefault();
              void createContextNotebook(contextNote);
            }}
          >
            <label class="sr-only" for={`context-notebook-${contextNote.id}`}>
              Notebook name
            </label>
            <FolderPlus size={14} strokeWidth={1.8} />
            <input
              id={`context-notebook-${contextNote.id}`}
              bind:value={newNotebookName}
              autocomplete="off"
              placeholder="Notebook name"
              use:focusOnMount
              oninput={() => (newNotebookError = '')}
            />
            <button
              class="icon-button mini"
              type="submit"
              title="Create notebook"
              aria-label="Create notebook"
            >
              <Check size={14} strokeWidth={1.9} />
            </button>
            <button
              class="icon-button mini"
              type="button"
              title="Cancel"
              aria-label="Cancel new notebook"
              onclick={(event) => {
                event.stopPropagation();
                newNotebookOpen = false;
                newNotebookName = '';
                newNotebookError = '';
              }}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
            {#if newNotebookError}
              <p class="form-error">{newNotebookError}</p>
            {/if}
          </form>
        {:else}
          <button
            role="menuitem"
            onclick={(event) => {
              event.stopPropagation();
              newNotebookOpen = true;
            }}
          >
            <FolderPlus size={14} strokeWidth={1.8} />
            <span>New notebook</span>
          </button>
        {/if}
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
