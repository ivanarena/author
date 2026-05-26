<script lang="ts">
  import { Check, Database, Download, Upload, X } from '@lucide/svelte';
  import type { SettingsModalModel } from '../notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
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
      onclick={model.exportMarkdown}
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
</div>
