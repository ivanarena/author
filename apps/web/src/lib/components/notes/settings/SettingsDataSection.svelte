<script lang="ts">
  import {
    Check,
    Database,
    Download,
    Notebook,
    Upload,
    X
  } from '@lucide/svelte';
  import type { SettingsModalModel } from '../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
  let exportScopeOpen = $state(false);
  let exportAll = $state(true);
  let selectedNotebookIds = $state<string[]>([]);
  const activeNotebooks = $derived(
    model.notebooks
      .filter((notebook) => !notebook.deletedAt)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
  );

  function selectAllNotebooks() {
    exportAll = true;
    selectedNotebookIds = [];
  }

  function toggleNotebook(notebookId: string) {
    exportAll = false;
    selectedNotebookIds = selectedNotebookIds.includes(notebookId)
      ? selectedNotebookIds.filter((id) => id !== notebookId)
      : [...selectedNotebookIds, notebookId];
  }

  function submitExport() {
    const notebookIds = exportAll ? undefined : selectedNotebookIds;
    exportScopeOpen = false;
    void model.exportMarkdown(notebookIds);
  }
</script>

<header class="settings-panel-header">
  <Database size={16} strokeWidth={1.8} />
  <h3>Data</h3>
</header>

{#if model.archiveOperation}
  <div class="settings-progress" role="status" aria-live="polite">
    <div>
      <strong>{model.archiveOperation.label}</strong>
      <span>{model.archiveOperation.detail}</span>
    </div>
    <div
      class="settings-progress-track"
      aria-hidden="true"
      style={`--progress: ${model.archiveOperation.progress}%`}
    >
      <span></span>
    </div>
  </div>
{/if}

{#if model.importBanner}
  <div
    class={`import-result-banner ${model.importBanner.kind}`}
    role={model.importBanner.kind === 'error' ? 'alert' : 'status'}
    aria-live="polite"
  >
    {#if model.importBanner.kind === 'success'}
      <Check size={15} strokeWidth={1.9} />
    {:else}
      <X size={15} strokeWidth={1.9} />
    {/if}
    <div>
      <strong>{model.importBanner.title}</strong>
      <span>{model.importBanner.message}</span>
    </div>
  </div>
{/if}

<div class="settings-action-group" aria-label="Markdown archive">
  <div class="settings-action-group-heading">
    <span>Markdown</span>
  </div>
  <div class="settings-actions">
    <button
      class="settings-action"
      disabled={model.isArchiveBusy}
      onclick={() => (exportScopeOpen = !exportScopeOpen)}
      aria-expanded={exportScopeOpen}
    >
      <Download size={15} strokeWidth={1.8} />
      <span>Export Markdown ZIP</span>
    </button>
    <button
      class="settings-action"
      disabled={model.isArchiveBusy}
      onclick={model.startMarkdownImport}
    >
      <Upload size={15} strokeWidth={1.8} />
      <span>Import Markdown folder</span>
    </button>
  </div>
  {#if exportScopeOpen}
    <div class="export-scope-picker" aria-label="Choose notebooks to export">
      <button
        class:active={exportAll}
        aria-pressed={exportAll}
        onclick={selectAllNotebooks}
      >
        <Notebook size={15} strokeWidth={1.8} />
        <span>
          <strong>All notebooks</strong>
          <small>Includes unfiled notes</small>
        </span>
        {#if exportAll}<Check size={15} strokeWidth={2} />{/if}
      </button>
      {#if activeNotebooks.length}
        <span class="export-scope-label">Selected notebooks</span>
        {#each activeNotebooks as notebook (notebook.id)}
          {@const selected =
            !exportAll && selectedNotebookIds.includes(notebook.id)}
          <button
            class:active={selected}
            aria-pressed={selected}
            onclick={() => toggleNotebook(notebook.id)}
          >
            <Notebook size={15} strokeWidth={1.8} />
            <span><strong>{notebook.name || 'Untitled notebook'}</strong></span>
            {#if selected}<Check size={15} strokeWidth={2} />{/if}
          </button>
        {/each}
      {/if}
      <div class="export-scope-actions">
        <button type="button" onclick={() => (exportScopeOpen = false)}>
          Cancel
        </button>
        <button
          type="button"
          class="primary"
          disabled={!exportAll && selectedNotebookIds.length === 0}
          onclick={submitExport}
        >
          Export
        </button>
      </div>
    </div>
  {/if}
</div>
