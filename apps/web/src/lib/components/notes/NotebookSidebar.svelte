<script lang="ts">
  import {
    Check,
    Files,
    FolderPlus,
    Inbox,
    Notebook,
    Pencil,
    Trash2,
    X
  } from '@lucide/svelte';
  import type { NotebookSidebarModel } from './notes-page-controller.svelte.js';

  let { model }: { model: NotebookSidebarModel } = $props();
</script>

<aside class="notebooks" aria-label="Notebooks">
  <div class="icon-row">
    <button
      class="icon-button"
      class:active={model.filterId === 'all'}
      title="All notes"
      aria-label="All notes"
      onclick={() => (model.filterId = 'all')}
    >
      <Files size={16} strokeWidth={1.8} />
    </button>
    <button
      class="icon-button"
      class:active={model.newNotebookOpen}
      title="New notebook"
      aria-label="New notebook"
      onclick={model.toggleNewNotebookMenu}
    >
      <FolderPlus size={16} strokeWidth={1.8} />
    </button>
  </div>

  {#if model.newNotebookOpen}
    <form
      class="menu-form"
      aria-label="New notebook menu"
      onsubmit={(event) => {
        event.preventDefault();
        void model.submitNewNotebookMenu();
      }}
    >
      <label class="sr-only" for="new-notebook-name">Notebook name</label>
      <div class="field-row">
        <input
          id="new-notebook-name"
          bind:value={model.notebookNameValue}
          autocomplete="off"
          placeholder="Notebook name"
          oninput={() => (model.notebookError = '')}
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
          title="Close"
          aria-label="Close new notebook menu"
          onclick={() => (model.newNotebookOpen = false)}
        >
          <X size={14} strokeWidth={1.9} />
        </button>
      </div>
      {#if model.notebookError}
        <p class="form-error">{model.notebookError}</p>
      {/if}
    </form>
  {/if}

  <nav>
    <div class="nav-row" class:active={model.filterId === 'all'}>
      <button class="nav-main" onclick={() => (model.filterId = 'all')}>
        <Files size={15} strokeWidth={1.8} />
        <span>All notes</span>
      </button>
      <div class="nav-trailing">
        <span class="nav-count">{model.notes.length}</span>
      </div>
    </div>
    <div class="nav-row" class:active={model.filterId === 'unfiled'}>
      <button class="nav-main" onclick={() => (model.filterId = 'unfiled')}>
        <Inbox size={15} strokeWidth={1.8} />
        <span>Unfiled</span>
      </button>
      <div class="nav-trailing">
        <span class="nav-count">{model.unfiledCount}</span>
      </div>
    </div>
    {#if model.notebooks.length}
      <div class="nav-separator" role="separator" aria-hidden="true"></div>
    {/if}
    {#each model.notebooks as notebook}
      <div
        class="nav-row notebook-row"
        class:active={model.filterId === notebook.id}
      >
        {#if model.renamingNotebookId === notebook.id}
          <form
            class="inline-rename"
            aria-label="Rename notebook"
            onsubmit={(event) => {
              event.preventDefault();
              void model.submitRenameNotebook(notebook);
            }}
          >
            <label class="sr-only" for={`rename-notebook-${notebook.id}`}
              >Notebook name</label
            >
            <input
              id={`rename-notebook-${notebook.id}`}
              bind:value={model.renameNotebookValue}
              autocomplete="off"
              oninput={() => (model.renameNotebookError = '')}
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
              onclick={model.cancelRenameNotebook}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
            {#if model.renameNotebookError}
              <p class="form-error notebook-error">
                {model.renameNotebookError}
              </p>
            {/if}
          </form>
        {:else if model.deletingNotebookId === notebook.id}
          <div
            class="delete-confirm"
            aria-label={`Delete ${notebook.name}?`}
            role="group"
          >
            <span>Delete notebook?</span>
            <button
              class="icon-button mini danger"
              title="Delete notebook"
              aria-label="Confirm delete notebook"
              onclick={() => model.confirmDeleteNotebook(notebook)}
            >
              <Check size={14} strokeWidth={1.9} />
            </button>
            <button
              class="icon-button mini"
              title="Cancel delete"
              aria-label="Cancel delete notebook"
              onclick={model.cancelDeleteNotebook}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
          </div>
        {:else}
          <button
            class="notebook-main"
            onclick={() => (model.filterId = notebook.id)}
            oncontextmenu={(event) =>
              model.openNotebookContext(event, notebook)}
          >
            <Notebook size={15} strokeWidth={1.8} />
            <span>{notebook.name}</span>
          </button>
          <div class="nav-trailing notebook-trailing">
            <span class="nav-count"
              >{model.notebookCounts.get(notebook.id) ?? 0}</span
            >
            <div class="notebook-actions">
              <button
                class="icon-button mini"
                title="Rename notebook"
                aria-label="Rename notebook"
                onclick={(event) => {
                  event.stopPropagation();
                  model.startRenameNotebook(notebook);
                }}
              >
                <Pencil size={13} strokeWidth={1.8} />
              </button>
              <button
                class="icon-button mini danger"
                title="Delete notebook"
                aria-label="Delete notebook"
                onclick={(event) => {
                  event.stopPropagation();
                  model.askDeleteNotebook(notebook);
                }}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <div class="nav-separator" role="separator" aria-hidden="true"></div>
    <div class="nav-row" class:active={model.filterId === 'trash'}>
      <button class="nav-main" onclick={() => (model.filterId = 'trash')}>
        <Trash2 size={15} strokeWidth={1.8} />
        <span>Trash</span>
      </button>
      <div class="nav-trailing">
        <span class="nav-count">{model.trash.length}</span>
      </div>
    </div>
  </nav>
</aside>
