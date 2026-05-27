<script lang="ts">
  import type { ConflictDialogModel } from './controller/page-controller.svelte.js';

  let { model }: { model: ConflictDialogModel } = $props();
</script>

{#if model.activeConflict}
  <div class="conflict-backdrop" role="presentation">
    <div
      class="conflict-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Sync conflict"
    >
      <header>
        <h1>Sync conflict</h1>
        <p>{model.conflictMessage(model.activeConflict)}</p>
      </header>

      <div class="versions">
        <article>
          <strong>{model.activeConflict.conflict.local.deviceName}</strong>
          <time
            >{new Date(
              model.activeConflict.conflict.local.updatedAt
            ).toLocaleString()}</time
          >
          <p>{model.activeConflict.conflict.local.previewText}</p>
        </article>
        <article>
          <strong>{model.activeConflict.conflict.remote.deviceName}</strong>
          <time
            >{new Date(
              model.activeConflict.conflict.remote.updatedAt
            ).toLocaleString()}</time
          >
          <p>{model.activeConflict.conflict.remote.previewText}</p>
        </article>
      </div>

      <div class="conflict-actions">
        {#if model.activeConflict.conflict.reason === 'duplicate_name'}
          <button onclick={() => model.resolveActiveConflict('keep-local')}>
            Keep local copy
          </button>
          <button onclick={() => model.resolveActiveConflict('keep-remote')}>
            Keep existing notebook
          </button>
        {:else}
          <button onclick={() => model.resolveActiveConflict('keep-newer')}
            >Keep newer</button
          >
          <button onclick={() => model.resolveActiveConflict('keep-older')}
            >Keep older</button
          >
          <button onclick={() => model.resolveActiveConflict('keep-local')}>
            Keep {model.activeConflict.conflict.local.deviceName}
          </button>
          <button onclick={() => model.resolveActiveConflict('keep-remote')}>
            Keep {model.activeConflict.conflict.remote.deviceName}
          </button>
          <button onclick={() => model.resolveActiveConflict('duplicate-both')}
            >Duplicate both</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}
