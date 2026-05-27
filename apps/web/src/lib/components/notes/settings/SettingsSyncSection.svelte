<script lang="ts">
  import { Cloud, LogIn, RefreshCw, Trash2 } from '@lucide/svelte';
  import type { SettingsModalModel } from '../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<header class="settings-panel-header">
  <Cloud size={16} strokeWidth={1.8} />
  <h3>Sync</h3>
</header>

<div class="settings-action-group">
  <div class="settings-action-group-heading">
    <span>Sync status</span>
  </div>
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
          ? '1 local change queued'
          : `${model.pendingSyncCount} local changes queued`}
      </small>
    </div>
    <div class="sync-overview-card wide">
      <span>Last sync</span>
      <strong>{model.lastSyncPassTitle}</strong>
      <small>{model.lastSyncPassDetail}</small>
    </div>
    {#if model.remoteSyncEnabled || model.remoteSyncError}
      <div class="sync-overview-card wide">
        <span>Remote worker</span>
        <strong>{model.remoteSyncState}</strong>
        {#if model.remoteSyncError}
          <small>{model.remoteSyncError}</small>
        {:else}
          <small>Remote worker status from the last check</small>
        {/if}
      </div>
    {/if}
  </div>
</div>

<div class="settings-action-group">
  <div class="settings-action-group-heading">
    <span>Troubleshooting</span>
  </div>
  <div class="sync-overview">
    <div class="sync-overview-card wide sync-debug-card">
      <span>Last sync error</span>
      <strong>{model.syncDebugTitle}</strong>
      <small>{model.syncDebugDetail}</small>
      <textarea
        class="sync-debug-log"
        aria-label="Last sync error log"
        readonly
        value={model.syncDebugLog}
      ></textarea>
    </div>
    <div class="sync-overview-card wide sync-debug-card">
      <span>Diagnostics</span>
      <strong>{model.appDebugTitle}</strong>
      <small>{model.appDebugDetail}</small>
      <textarea
        class="sync-debug-log"
        aria-label="Application diagnostic log"
        readonly
        value={model.appDebugLog}
      ></textarea>
      <button
        class="settings-debug-clear"
        type="button"
        onclick={model.clearAppDebugLog}
      >
        <Trash2 size={14} strokeWidth={1.8} />
        <span>Clear log</span>
      </button>
    </div>
  </div>
</div>

<div class="settings-action-group">
  <div class="settings-action-group-heading">
    <span>Actions</span>
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
</div>
