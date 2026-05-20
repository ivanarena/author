<script lang="ts">
  import { Cloud, LogIn, RefreshCw } from '@lucide/svelte';
  import type { SettingsModalModel } from '../notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<header class="settings-panel-header">
  <Cloud size={16} strokeWidth={1.8} />
  <h3>Sync</h3>
</header>

<div class="sync-overview" aria-live="polite">
  <div class="sync-overview-card">
    <span>Status</span>
    <strong
      class="sync-card-status"
      class:syncing={model.syncIndicator.kind === 'syncing'}
    >
      {model.syncIndicator.label}
    </strong>
    {#if model.syncIndicator.detail}
      <small>{model.syncIndicator.detail}</small>
    {/if}
  </div>
  <div class="sync-overview-card">
    <span>Pending local changes</span>
    <strong>{model.pendingSyncCount}</strong>
    <small>
      {model.pendingSyncCount === 1
        ? '1 item waiting to sync'
        : `${model.pendingSyncCount} items waiting to sync`}
    </small>
  </div>
  <div class="sync-overview-card wide">
    <span>Last sync pass</span>
    <strong>{model.lastSyncPassTitle}</strong>
    <small>{model.lastSyncPassDetail}</small>
  </div>
  {#if model.remoteSyncEnabled || model.remoteSyncError}
    <div class="sync-overview-card wide">
      <span>Remote sync</span>
      <strong>{model.remoteSyncState}</strong>
      {#if model.remoteSyncError}
        <small>{model.remoteSyncError}</small>
      {:else}
        <small>Remote worker status from the last check</small>
      {/if}
    </div>
  {/if}
  <div class="sync-overview-card wide sync-debug-card">
    <span>Debug</span>
    <strong>{model.syncDebugTitle}</strong>
    <small>{model.syncDebugDetail}</small>
    <textarea
      class="sync-debug-log"
      aria-label="Sync debug log"
      readonly
      value={model.syncDebugLog}
    ></textarea>
  </div>
</div>

<div class="settings-actions">
  {#if model.hasToken}
    <button
      class="settings-action"
      disabled={model.isSyncing || model.isArchiveBusy}
      onclick={model.syncNow}
    >
      <RefreshCw size={15} strokeWidth={1.8} />
      <span>
        {model.isArchiveBusy
          ? 'Sync paused'
          : model.isSyncing
            ? model.syncIndicator.label
            : 'Sync now'}
      </span>
    </button>
  {:else}
    <button
      class="settings-action"
      disabled={model.isArchiveBusy}
      onclick={model.toggleLoginMenu}
    >
      <LogIn size={15} strokeWidth={1.8} />
      <span>Sign in to sync</span>
    </button>
  {/if}
</div>
