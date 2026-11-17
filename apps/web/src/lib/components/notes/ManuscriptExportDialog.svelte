<script lang="ts">
  import { FileDown, FileText, Printer, X } from '@lucide/svelte';
  import {
    MANUSCRIPT_PAGE_SIZES,
    type ManuscriptOrder,
    type ManuscriptPageSize,
    type ManuscriptPreset
  } from '$lib/client/manuscript';
  import type { ManuscriptExportDialogModel } from './controller/page-controller.svelte.js';
  import { modalFocus } from './modal-focus';

  let { model }: { model: ManuscriptExportDialogModel } = $props();

  const presets: Array<{
    value: ManuscriptPreset;
    label: string;
    hint: string;
  }> = [
    {
      value: 'poetry',
      label: 'Poetry',
      hint: 'Line breaks kept, each poem on a new page.'
    },
    {
      value: 'prose',
      label: 'Prose',
      hint: 'Double-spaced, indented paragraphs, each chapter on a new page.'
    }
  ];
  const orders: Array<{ value: ManuscriptOrder; label: string }> = [
    { value: 'title', label: 'Title' },
    { value: 'created', label: 'Created' }
  ];
  const pageSizes = (['a4', 'a5', 'letter'] as ManuscriptPageSize[]).map(
    (value) => ({ value, label: MANUSCRIPT_PAGE_SIZES[value].label })
  );

  const busy = $derived(model.manuscriptBusy || model.isArchiveBusy);
  const presetHint = $derived(
    presets.find((preset) => preset.value === model.manuscriptOptions.preset)
      ?.hint ?? ''
  );
  const summary = $derived(
    `${model.manuscriptNoteCount} ${model.manuscriptNoteCount === 1 ? 'note' : 'notes'} · ${model.manuscriptWordCount.toLocaleString()} ${model.manuscriptWordCount === 1 ? 'word' : 'words'}`
  );
</script>

{#if model.manuscriptNotebook}
  {@const notebook = model.manuscriptNotebook}
  <div
    class="manuscript-layer"
    role="presentation"
    onclick={model.closeManuscriptExport}
  >
    <div
      class="manuscript-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manuscript-title"
      aria-describedby="manuscript-summary"
      tabindex="-1"
      bind:this={model.manuscriptModal}
      use:modalFocus
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') model.closeManuscriptExport();
      }}
    >
      <header class="manuscript-header">
        <span class="manuscript-heading">
          <FileText size={17} strokeWidth={1.8} />
          <span>
            <h2 id="manuscript-title">Export manuscript</h2>
            <small id="manuscript-summary"
              >{notebook.name || 'Untitled notebook'} · {summary}</small
            >
          </span>
        </span>
        <button
          class="icon-button mini"
          type="button"
          title="Close"
          aria-label="Close manuscript export"
          onclick={model.closeManuscriptExport}
        >
          <X size={14} strokeWidth={1.9} />
        </button>
      </header>

      <div class="manuscript-body">
        <fieldset class="manuscript-field">
          <legend>Layout</legend>
          <div class="manuscript-segments">
            {#each presets as preset}
              <label>
                <input
                  type="radio"
                  name="manuscript-preset"
                  value={preset.value}
                  checked={model.manuscriptOptions.preset === preset.value}
                  onchange={() =>
                    model.setManuscriptOption('preset', preset.value)}
                />
                <span>{preset.label}</span>
              </label>
            {/each}
          </div>
          <small>{presetHint}</small>
        </fieldset>

        <fieldset class="manuscript-field">
          <legend>Order</legend>
          <div class="manuscript-segments">
            {#each orders as order}
              <label>
                <input
                  type="radio"
                  name="manuscript-order"
                  value={order.value}
                  checked={model.manuscriptOptions.order === order.value}
                  onchange={() =>
                    model.setManuscriptOption('order', order.value)}
                />
                <span>{order.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset class="manuscript-field">
          <legend>Page</legend>
          <div class="manuscript-segments">
            {#each pageSizes as size}
              <label>
                <input
                  type="radio"
                  name="manuscript-page-size"
                  value={size.value}
                  checked={model.manuscriptOptions.pageSize === size.value}
                  onchange={() =>
                    model.setManuscriptOption('pageSize', size.value)}
                />
                <span>{size.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <label class="manuscript-field">
          <span class="manuscript-label">Running header</span>
          <input
            class="manuscript-header-input"
            value={model.manuscriptOptions.header}
            placeholder="No header"
            autocomplete="off"
            spellcheck="false"
            oninput={(event) =>
              model.setManuscriptOption(
                'header',
                (event.currentTarget as HTMLInputElement).value
              )}
          />
        </label>

        <div class="manuscript-toggles">
          <label class="settings-toggle-row">
            <input
              type="checkbox"
              checked={model.manuscriptOptions.pageNumbers}
              onchange={(event) =>
                model.setManuscriptOption(
                  'pageNumbers',
                  (event.currentTarget as HTMLInputElement).checked
                )}
            />
            <span><strong>Page numbers</strong></span>
          </label>
          <label class="settings-toggle-row">
            <input
              type="checkbox"
              checked={model.manuscriptOptions.titlePage}
              onchange={(event) =>
                model.setManuscriptOption(
                  'titlePage',
                  (event.currentTarget as HTMLInputElement).checked
                )}
            />
            <span><strong>Title page</strong></span>
          </label>
        </div>
      </div>

      <footer class="manuscript-actions">
        <small>For a PDF, choose “Save to PDF” in the print dialog.</small>
        <button
          class="settings-action"
          type="button"
          disabled={busy || model.manuscriptNoteCount === 0}
          onclick={model.printManuscript}
        >
          <Printer size={15} strokeWidth={1.8} />
          <span>Print or save PDF</span>
        </button>
        <button
          class="settings-action primary"
          type="button"
          disabled={busy || model.manuscriptNoteCount === 0}
          onclick={model.exportManuscriptDocx}
        >
          <FileDown size={15} strokeWidth={1.8} />
          <span>Download DOCX</span>
        </button>
      </footer>
    </div>
  </div>
{/if}
