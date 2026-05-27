<script lang="ts">
  import { CheckCircle2, Info, X, XCircle } from '@lucide/svelte';
  import type { NotificationStackModel } from './controller/page-controller.svelte.js';

  let { model }: { model: NotificationStackModel } = $props();
</script>

{#if model.notifications.length}
  <div class="notification-stack" aria-live="polite" aria-relevant="additions">
    {#each model.notifications as notification (notification.id)}
      <section
        class={`notification ${notification.kind}`}
        role={notification.kind === 'error' ? 'alert' : 'status'}
      >
        {#if notification.kind === 'success'}
          <CheckCircle2 size={16} strokeWidth={1.9} />
        {:else if notification.kind === 'error'}
          <XCircle size={16} strokeWidth={1.9} />
        {:else}
          <Info size={16} strokeWidth={1.9} />
        {/if}
        <div>
          <strong>{notification.title}</strong>
          {#if notification.message}
            <span>{notification.message}</span>
          {/if}
        </div>
        <button
          class="icon-button mini"
          type="button"
          title="Dismiss"
          aria-label="Dismiss notification"
          onclick={() => model.dismissNotification(notification.id)}
        >
          <X size={13} strokeWidth={1.9} />
        </button>
      </section>
    {/each}
  </div>
{/if}
