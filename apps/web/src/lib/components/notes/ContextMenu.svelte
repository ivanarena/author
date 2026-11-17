<script lang="ts">
  import {
    ArchiveRestore,
    Check,
    FileText,
    FolderPlus,
    History,
    Pencil,
    Share2,
    Trash2,
    X
  } from '@lucide/svelte';
  import { noteDisplayTitle } from '$lib/client/note-utils';
  import NotebookLinkMenu from './NotebookLinkMenu.svelte';
  import type { ContextMenuModel } from './controller/page-controller.svelte.js';

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

  /**
   * Keyboard access for a menu: focus its first item on open, move with the
   * arrow keys, and give focus back to where it came from on close.
   */
  function menuFocus(node: HTMLElement) {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const items = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemcheckbox"]'
        )
      );
    queueMicrotask(() => items()[0]?.focus({ preventScroll: true }));

    const handleKeydown = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const list = items();
      if (!list.length) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? list.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) %
              list.length;
      list[next].focus();
    };
    node.addEventListener('keydown', handleKeydown);

    return {
      destroy() {
        node.removeEventListener('keydown', handleKeydown);
        const active = document.activeElement;
        const focusWasHere =
          !active || active === document.body || node.contains(active);
        if (focusWasHere && previousFocus?.isConnected) {
          previousFocus.focus({ preventScroll: true });
        }
      }
    };
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
    use:menuFocus
  >
    <div class="context-metadata" role="group" aria-label="Notebook metadata">
      {#each model.contextNotebookMetadataRows(contextNotebook) as row}
        <span>
          <strong>{row.label}</strong>
          <small>{row.value}</small>
        </span>
      {/each}
    </div>
    <button
      role="menuitem"
      onclick={(event) => {
        event.stopPropagation();
        model.contextExportManuscript(contextNotebook);
      }}
    >
      <FileText size={14} strokeWidth={1.8} />
      <span>Export manuscript</span>
    </button>
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
    use:menuFocus
  >
    <div class="context-metadata" role="group" aria-label="Note metadata">
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
      <button
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          void model.contextShareNote(contextNote);
        }}
      >
        <Share2 size={14} strokeWidth={1.8} />
        <span>Share note</span>
      </button>
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
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          void model.contextRestorePreviousNoteVersion(contextNote);
        }}
      >
        <History size={14} strokeWidth={1.8} />
        <span>Note history</span>
      </button>
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
