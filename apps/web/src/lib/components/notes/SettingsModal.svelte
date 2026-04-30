<script lang="ts">
  import {
    ChevronRight,
    Check,
    Cloud,
    Database,
    Download,
    LogIn,
    Moon,
    Palette,
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

    <div class="settings-body">
      <nav class="settings-menu" aria-label="Settings sections">
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'sync'}
          aria-current={model.settingsSection === 'sync' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('sync')}
        >
          <Cloud size={15} strokeWidth={1.8} />
          <span>Sync</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'data'}
          aria-current={model.settingsSection === 'data' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('data')}
        >
          <Database size={15} strokeWidth={1.8} />
          <span>Data</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'appearance'}
          aria-current={model.settingsSection === 'appearance'
            ? 'page'
            : undefined}
          onclick={() => model.setSettingsSection('appearance')}
        >
          <Palette size={15} strokeWidth={1.8} />
          <span>Appearance</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
      </nav>

      <section class="settings-panel">
        {#if model.settingsSection === 'sync'}
          <header class="settings-panel-header">
            <Cloud size={16} strokeWidth={1.8} />
            <h3>Sync</h3>
          </header>

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
                      ? 'Syncing'
                      : 'Sync now'}
                </span>
              </button>
            {:else}
              <button
                class="settings-action"
                class:active={model.loginOpen}
                disabled={model.isArchiveBusy}
                onclick={model.toggleLoginMenu}
              >
                <LogIn size={15} strokeWidth={1.8} />
                <span>Login</span>
              </button>
            {/if}
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
                  disabled={model.isLoggingIn || model.isArchiveBusy}
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
        {:else if model.settingsSection === 'data'}
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

          <div class="settings-action-group" aria-label="JSON archive">
            <span>JSON</span>
            <div class="settings-actions">
              <button
                class="settings-action"
                disabled={model.isArchiveBusy || model.isSyncing}
                onclick={model.exportJson}
              >
                <Download size={15} strokeWidth={1.8} />
                <span>Export JSON</span>
              </button>
              <button
                class="settings-action"
                disabled={model.isArchiveBusy || model.isSyncing}
                onclick={model.startJsonImport}
              >
                <Upload size={15} strokeWidth={1.8} />
                <span>Import JSON</span>
              </button>
            </div>
          </div>

          <div class="settings-action-group" aria-label="Markdown archive">
            <span>Markdown</span>
            <div class="settings-actions">
              <button
                class="settings-action"
                disabled={model.isArchiveBusy || model.isSyncing}
                onclick={model.exportMarkdown}
              >
                <Download size={15} strokeWidth={1.8} />
                <span>Export MD ZIP</span>
              </button>
              <button
                class="settings-action"
                disabled={model.isArchiveBusy || model.isSyncing}
                onclick={model.startMarkdownImport}
              >
                <Upload size={15} strokeWidth={1.8} />
                <span>Import MD folder</span>
              </button>
            </div>
          </div>
        {:else}
          <header class="settings-panel-header">
            <Palette size={16} strokeWidth={1.8} />
            <h3>Appearance</h3>
          </header>

          <div class="settings-actions">
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
        {/if}
      </section>
    </div>

    <input
      bind:this={model.importInput}
      class="file-input"
      type="file"
      accept="application/json,.json"
      aria-label="Choose JSON notes file"
      onchange={model.handleJsonImport}
    />
    <input
      bind:this={model.importMarkdownInput}
      class="file-input"
      type="file"
      accept=".md,text/markdown,text/plain"
      aria-label="Choose Markdown notes folder"
      multiple
      webkitdirectory
      onchange={model.handleMarkdownImport}
    />
  </div>
</div>
