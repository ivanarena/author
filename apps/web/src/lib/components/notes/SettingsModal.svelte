<script lang="ts">
  import {
    Check,
    Download,
    LogIn,
    Moon,
    RefreshCw,
    Rows3,
    Settings,
    Sun,
    Upload,
    X,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import type { SettingsModalModel } from './notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<div class="settings-layer" role="presentation">
  <div
    class="settings-modal"
    id="profile-settings"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    bind:this={model.settingsModal}
    tabindex="-1"
  >
    <header class="settings-header">
      <div class="settings-title">
        <Settings size={16} strokeWidth={1.8} />
        <h2 id="settings-title">Settings</h2>
      </div>
      <button
        class="icon-button mini"
        title="Close"
        aria-label="Close settings"
        onclick={model.closeSettings}
      >
        <X size={14} strokeWidth={1.9} />
      </button>
    </header>

    <div class="settings-actions">
      {#if model.hasToken}
        <button
          class="settings-action"
          disabled={model.isSyncing}
          onclick={model.syncNow}
        >
          <RefreshCw size={15} strokeWidth={1.8} />
          <span>{model.isSyncing ? 'Syncing' : 'Sync'}</span>
        </button>
      {:else}
        <button
          class="settings-action"
          class:active={model.loginOpen}
          onclick={model.toggleLoginMenu}
        >
          <LogIn size={15} strokeWidth={1.8} />
          <span>Login</span>
        </button>
      {/if}
      <button class="settings-action" onclick={model.exportJson}>
        <Download size={15} strokeWidth={1.8} />
        <span>Export JSON</span>
      </button>
      <button
        class="settings-action"
        disabled={model.isImporting}
        onclick={model.startJsonImport}
      >
        <Upload size={15} strokeWidth={1.8} />
        <span>Import JSON</span>
      </button>
      <input
        bind:this={model.importInput}
        class="file-input"
        type="file"
        accept="application/json,.json"
        aria-label="Choose JSON notes file"
        onchange={model.handleJsonImport}
      />
      <button
        class="settings-action"
        class:active={model.compactView}
        aria-pressed={model.compactView}
        onclick={model.toggleCompactView}
      >
        <Rows3 size={15} strokeWidth={1.8} />
        <span>Compact notes</span>
      </button>
      <button class="settings-action" onclick={model.toggleTheme}>
        {#if model.theme === 'dark'}
          <Sun size={15} strokeWidth={1.8} />
          <span>Light mode</span>
        {:else}
          <Moon size={15} strokeWidth={1.8} />
          <span>Dark mode</span>
        {/if}
      </button>
    </div>

    <div class="settings-zoom">
      <button
        class="icon-button mini"
        title="Zoom out"
        aria-label="Zoom out"
        disabled={model.editorZoom <= model.minEditorZoom}
        onclick={() => model.zoomEditor(-1)}
      >
        <ZoomOut size={14} strokeWidth={1.8} />
      </button>
      <span>Zoom {model.zoomPercent()}</span>
      <button
        class="icon-button mini"
        title="Zoom in"
        aria-label="Zoom in"
        disabled={model.editorZoom >= model.maxEditorZoom}
        onclick={() => model.zoomEditor(1)}
      >
        <ZoomIn size={14} strokeWidth={1.8} />
      </button>
    </div>

    {#if model.loginOpen}
      <form
        class="menu-form login-form"
        aria-label="Login menu"
        onsubmit={(event) => {
          event.preventDefault();
          void model.submitLoginMenu();
        }}
      >
        <div class="login-copy">
          <strong>Sign in to sync</strong>
          <span
            >Connect this browser and keep notes current across devices.</span
          >
        </div>
        <label for="sync-username">Username</label>
        <input
          id="sync-username"
          type="text"
          bind:value={model.loginUsernameValue}
          autocomplete="username"
          placeholder="Username"
          autocapitalize="none"
          spellcheck="false"
          oninput={() => (model.loginError = '')}
        />
        <label for="sync-password">Password</label>
        <input
          id="sync-password"
          type="password"
          bind:value={model.loginPasswordValue}
          autocomplete="current-password"
          placeholder="Sync password"
          oninput={() => (model.loginError = '')}
        />
        {#if model.loginError}
          <p class="form-error">{model.loginError}</p>
        {/if}
        <div class="login-actions">
          <button
            class="settings-action login-submit"
            type="submit"
            disabled={model.isLoggingIn}
          >
            <Check size={15} strokeWidth={1.9} />
            <span>{model.isLoggingIn ? 'Signing in' : 'Sign in'}</span>
          </button>
          <button
            class="settings-action"
            type="button"
            onclick={() => (model.loginOpen = false)}
          >
            <X size={15} strokeWidth={1.9} />
            <span>Cancel</span>
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>
