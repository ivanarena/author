<script lang="ts">
  import { ArchiveRestore, Clock3, History, X } from '@lucide/svelte';
  import { noteDisplayTitle } from '$lib/client/note-utils';
  import type { NoteHistoryDialogModel } from './controller/page-controller.svelte.js';
  import { modalFocus } from './modal-focus';

  let { model }: { model: NoteHistoryDialogModel } = $props();

  const selectedSnapshot = $derived(model.selectedHistorySnapshot);

  function formatSnapshotTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function snapshotReasonLabel(reason: string): string {
    if (reason === 'trash') return 'Before trash';
    if (reason === 'restore') return 'Before restore';
    return 'Before edit';
  }

  function snapshotBodyPreview(body: string): string {
    const preview = body.trim().replace(/\s+/g, ' ');
    if (!preview) return 'Empty body';
    return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
  }
</script>

{#if model.historyOpen}
  <div
    class="note-history-layer"
    role="presentation"
    onclick={model.closeNoteHistory}
  >
    <div
      class="note-history-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="note-history-title"
      tabindex="-1"
      bind:this={model.historyModal}
      use:modalFocus
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') model.closeNoteHistory();
      }}
    >
      <header class="note-history-header">
        <span class="note-history-title">
          <History size={17} strokeWidth={1.8} />
          <span>
            <h2 id="note-history-title">Note history</h2>
            <small
              >{model.selectedNote
                ? noteDisplayTitle(model.selectedNote)
                : ''}</small
            >
          </span>
        </span>
        <button
          class="icon-button mini"
          type="button"
          title="Close"
          aria-label="Close note history"
          onclick={model.closeNoteHistory}
        >
          <X size={14} strokeWidth={1.9} />
        </button>
      </header>

      <div class="note-history-body">
        <aside class="note-history-list" aria-label="Local versions">
          {#if model.historyLoading}
            <p class="note-history-empty">Loading history...</p>
          {:else if model.historySnapshots.length === 0}
            <p class="note-history-empty">No local history yet.</p>
          {:else}
            {#each model.historySnapshots as snapshot}
              <button
                class:active={snapshot.snapshotId ===
                  model.selectedHistorySnapshotId}
                type="button"
                aria-pressed={snapshot.snapshotId ===
                  model.selectedHistorySnapshotId}
                onclick={() => model.selectHistorySnapshot(snapshot.snapshotId)}
              >
                <Clock3 size={14} strokeWidth={1.8} />
                <span>
                  <strong>{formatSnapshotTime(snapshot.savedAt)}</strong>
                  <small>{snapshotReasonLabel(snapshot.reason)}</small>
                  <small>{snapshotBodyPreview(snapshot.body)}</small>
                </span>
              </button>
            {/each}
          {/if}
        </aside>

        <article
          class="note-history-preview"
          aria-label="Selected version preview"
        >
          {#if selectedSnapshot}
            <header>
              <small>{formatSnapshotTime(selectedSnapshot.savedAt)}</small>
              <h3>{selectedSnapshot.title || 'Untitled'}</h3>
            </header>
            <div class="note-history-preview-body">
              {selectedSnapshot.body || 'Empty body'}
            </div>
          {:else}
            <p class="note-history-empty">Select a version to preview.</p>
          {/if}
        </article>
      </div>

      <footer class="note-history-actions">
        <button
          class="settings-action"
          type="button"
          disabled={!selectedSnapshot || model.historyLoading}
          onclick={model.restoreSelectedHistorySnapshot}
        >
          <ArchiveRestore size={15} strokeWidth={1.8} />
          <span>Restore version</span>
        </button>
      </footer>
    </div>
  </div>
{/if}
