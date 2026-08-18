<script lang="ts">
  import type { ConflictDialogModel } from './controller/page-controller.svelte.js';
  import { modalFocus } from './modal-focus';

  let { model }: { model: ConflictDialogModel } = $props();
  let resolving = $state(false);

  async function resolve(
    choice: Parameters<typeof model.resolveActiveConflict>[0]
  ) {
    if (resolving) return;
    resolving = true;
    try {
      await model.resolveActiveConflict(choice);
    } finally {
      resolving = false;
    }
  }
</script>

{#if model.activeConflict}
  <div class="conflict-backdrop" role="presentation">
    <div
      class="conflict-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Sync conflict"
      tabindex="-1"
      use:modalFocus
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

      <div class="conflict-actions" aria-busy={resolving}>
        {#if model.activeConflict.conflict.reason === 'duplicate_name'}
          <button disabled={resolving} onclick={() => resolve('keep-local')}>
            Keep local copy
          </button>
          <button disabled={resolving} onclick={() => resolve('keep-remote')}>
            Keep existing notebook
          </button>
        {:else}
          <button disabled={resolving} onclick={() => resolve('keep-newer')}
            >Keep newer</button
          >
          <button disabled={resolving} onclick={() => resolve('keep-older')}
            >Keep older</button
          >
          <button disabled={resolving} onclick={() => resolve('keep-local')}>
            Keep {model.activeConflict.conflict.local.deviceName}
          </button>
          <button disabled={resolving} onclick={() => resolve('keep-remote')}>
            Keep {model.activeConflict.conflict.remote.deviceName}
          </button>
          <button disabled={resolving} onclick={() => resolve('duplicate-both')}
            >Duplicate both</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}
