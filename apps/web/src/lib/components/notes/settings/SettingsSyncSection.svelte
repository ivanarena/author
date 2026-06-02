<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ArrowLeft,
    ChevronRight,
    Cloud,
    LogIn,
    RefreshCw,
    RotateCcw,
    Trash2
  } from '@lucide/svelte';
  import type { SettingsModalModel } from '../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
  type TroubleshootingPanel = 'repair' | 'sync' | 'app';
  let troubleshootingPanel = $state<TroubleshootingPanel | null>(null);

  onMount(() => {
    void model.refreshRepairDiagnostics();
  });

  const troubleshootingPanelTitle = (panel: TroubleshootingPanel) =>
    panel === 'repair'
      ? 'Repair diagnostics'
      : panel === 'sync'
        ? 'Last sync error'
        : 'Diagnostic log';

  const troubleshootingPanelDetail = (panel: TroubleshootingPanel) =>
    panel === 'repair'
      ? model.repairDiagnosticsDetail
      : panel === 'sync'
        ? model.syncDebugDetail
        : model.appDebugDetail;
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
  {#if troubleshootingPanel === null}
    <div class="settings-detail-menu">
      <button
        class="settings-detail-row"
        type="button"
        onclick={() => (troubleshootingPanel = 'repair')}
      >
        <RotateCcw size={15} strokeWidth={1.8} />
        <span class="settings-detail-copy">
          <strong>Repair diagnostics</strong>
          <small>{model.repairDiagnosticsTitle}</small>
        </span>
        <ChevronRight size={14} strokeWidth={1.8} />
      </button>
      <button
        class="settings-detail-row"
        type="button"
        onclick={() => (troubleshootingPanel = 'sync')}
      >
        <RefreshCw size={15} strokeWidth={1.8} />
        <span class="settings-detail-copy">
          <strong>Last sync error</strong>
          <small>{model.syncDebugTitle}</small>
        </span>
        <ChevronRight size={14} strokeWidth={1.8} />
      </button>
      <button
        class="settings-detail-row"
        type="button"
        onclick={() => (troubleshootingPanel = 'app')}
      >
        <Cloud size={15} strokeWidth={1.8} />
        <span class="settings-detail-copy">
          <strong>Diagnostic log</strong>
          <small>{model.appDebugTitle}</small>
        </span>
        <ChevronRight size={14} strokeWidth={1.8} />
      </button>
    </div>
  {:else}
    <button
      class="settings-detail-back"
      type="button"
      onclick={() => (troubleshootingPanel = null)}
    >
      <ArrowLeft size={14} strokeWidth={1.8} />
      <span>Back to troubleshooting</span>
    </button>
    <div class="sync-overview">
      {#if troubleshootingPanel === 'repair'}
        <div class="sync-overview-card wide sync-debug-card">
          <span>{troubleshootingPanelTitle(troubleshootingPanel)}</span>
          <strong>{model.repairDiagnosticsTitle}</strong>
          <small>{troubleshootingPanelDetail(troubleshootingPanel)}</small>
          <textarea
            class="sync-debug-log"
            aria-label="Repair diagnostics log"
            readonly
            value={model.repairDiagnosticsLog}
          ></textarea>
          {#if model.canResetPullCursor}
            <button
              class="settings-debug-clear"
              type="button"
              disabled={model.isSyncing}
              onclick={model.resetPullCursorRecovery}
            >
              <RotateCcw size={14} strokeWidth={1.8} />
              <span>Reset pull cursor</span>
            </button>
          {/if}
        </div>
      {:else if troubleshootingPanel === 'sync'}
        <div class="sync-overview-card wide sync-debug-card">
          <span>{troubleshootingPanelTitle(troubleshootingPanel)}</span>
          <strong>{model.syncDebugTitle}</strong>
          <small>{troubleshootingPanelDetail(troubleshootingPanel)}</small>
          <textarea
            class="sync-debug-log"
            aria-label="Last sync error log"
            readonly
            value={model.syncDebugLog}
          ></textarea>
        </div>
      {:else}
        <div class="sync-overview-card wide sync-debug-card">
          <span>{troubleshootingPanelTitle(troubleshootingPanel)}</span>
          <strong>{model.appDebugTitle}</strong>
          <small>{troubleshootingPanelDetail(troubleshootingPanel)}</small>
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
      {/if}
    </div>
  {/if}
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
