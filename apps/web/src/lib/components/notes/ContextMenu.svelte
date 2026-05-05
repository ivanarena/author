<script lang="ts">
  import { ArchiveRestore, Pencil, Trash2 } from 'lucide-svelte';
  import { noteDisplayTitle } from '$lib/client/note-utils';
  import NotebookLinkMenu from './NotebookLinkMenu.svelte';
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
      <NotebookLinkMenu
        note={contextNote}
        notebooks={model.notebooks}
        label="Notebook links"
        heading="Notebook"
        variant="context"
        onAssign={model.contextAssignNotebookForNote}
      />
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
