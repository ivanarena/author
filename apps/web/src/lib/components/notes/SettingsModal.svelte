<script lang="ts">
  import {
    ChevronRight,
    Check,
    Cloud,
    Database,
    Download,
    KeyRound,
    LogIn,
    LogOut,
    Moon,
    Palette,
    RefreshCw,
    Rows3,
    Settings,
    Sun,
    Trash2,
    Upload,
    UserRound,
    X,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import AuthForm from './AuthForm.svelte';
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
          class:active={model.settingsSection === 'account'}
          aria-current={model.settingsSection === 'account'
            ? 'page'
            : undefined}
          onclick={() => model.setSettingsSection('account')}
        >
          <UserRound size={15} strokeWidth={1.8} />
          <span>Account</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
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
        {#if model.hasToken}
          <button
            class="settings-menu-item settings-menu-action"
            type="button"
            disabled={model.isAccountBusy}
            onclick={(event) => {
              event.stopPropagation();
              void model.logoutAccount();
            }}
          >
            <LogOut size={15} strokeWidth={1.8} />
            <span>Log out</span>
          </button>
        {/if}
      </nav>

      <section class="settings-panel">
        {#if model.settingsSection === 'account'}
          <header class="settings-panel-header">
            <UserRound size={16} strokeWidth={1.8} />
            <h3>Account</h3>
          </header>

          {#if model.hasToken}
            <div class="account-summary">
              <UserRound size={20} strokeWidth={1.7} />
              <div>
                <strong
                  >{model.accountDisplayName || model.accountUsername}</strong
                >
                <span>{model.accountUsername}</span>
              </div>
            </div>

            <form
              class="menu-form account-form"
              aria-label="Profile"
              onsubmit={(event) => {
                event.preventDefault();
                void model.saveAccountProfile();
              }}
            >
              <div class="field-row">
                <label for="account-username">Username</label>
                <input
                  id="account-username"
                  type="text"
                  value={model.accountUsername}
                  readonly
                />
              </div>
              <div class="field-row">
                <label for="account-display-name">Nickname</label>
                <input
                  id="account-display-name"
                  type="text"
                  bind:value={model.accountDisplayName}
                  placeholder="Nickname"
                  autocomplete="nickname"
                  oninput={() => {
                    model.accountError = '';
                    model.accountMessage = '';
                  }}
                />
              </div>
              <button
                class="settings-action login-submit"
                type="submit"
                disabled={model.isAccountBusy}
              >
                <Check size={15} strokeWidth={1.9} />
                <span>Save profile</span>
              </button>
            </form>

            <form
              class="menu-form account-form"
              aria-label="Change password"
              onsubmit={(event) => {
                event.preventDefault();
                void model.changeAccountPassword();
              }}
            >
              <div class="settings-section-title">
                <KeyRound size={15} strokeWidth={1.8} />
                <strong>Password</strong>
              </div>
              <div class="field-row">
                <label for="current-password">Current</label>
                <input
                  id="current-password"
                  type="password"
                  bind:value={model.currentPasswordValue}
                  autocomplete="current-password"
                  oninput={() => (model.accountError = '')}
                />
              </div>
              <div class="field-grid">
                <div class="field-row">
                  <label for="new-password">New</label>
                  <input
                    id="new-password"
                    type="password"
                    bind:value={model.newPasswordValue}
                    autocomplete="new-password"
                    oninput={() => (model.accountError = '')}
                  />
                </div>
                <div class="field-row">
                  <label for="confirm-password">Confirm</label>
                  <input
                    id="confirm-password"
                    type="password"
                    bind:value={model.confirmPasswordValue}
                    autocomplete="new-password"
                    oninput={() => (model.accountError = '')}
                  />
                </div>
              </div>
              <button
                class="settings-action"
                type="submit"
                disabled={model.isAccountBusy}
              >
                <KeyRound size={15} strokeWidth={1.8} />
                <span>Change password</span>
              </button>
            </form>

            <form
              class="menu-form account-form danger-zone"
              aria-label="Delete account"
              onsubmit={(event) => {
                event.preventDefault();
                void model.deleteAccount();
              }}
            >
              <div class="settings-section-title danger-title">
                <Trash2 size={15} strokeWidth={1.8} />
                <strong>Delete account</strong>
              </div>
              <div class="field-row">
                <label for="delete-password">Password</label>
                <input
                  id="delete-password"
                  type="password"
                  bind:value={model.deletePasswordValue}
                  autocomplete="current-password"
                  oninput={() => (model.accountError = '')}
                />
              </div>
              <button
                class="settings-action danger-action"
                type="submit"
                disabled={model.isAccountBusy}
              >
                <Trash2 size={15} strokeWidth={1.8} />
                <span>Delete account</span>
              </button>
            </form>

            {#if model.accountError}
              <p class="form-error" role="alert">{model.accountError}</p>
            {:else if model.accountMessage}
              <p class="form-success" role="status">{model.accountMessage}</p>
            {/if}
          {:else}
            <div class="account-empty signed-out-card">
              <UserRound size={22} strokeWidth={1.7} />
              <div>
                <strong>Local workspace</strong>
                <span>Sync is off for this browser</span>
              </div>
            </div>
            {#if model.accountMessage}
              <p class="form-success" role="status">{model.accountMessage}</p>
            {/if}
            <AuthForm {model} />
          {/if}
        {:else if model.settingsSection === 'sync'}
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
            <AuthForm {model} showCancel />
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
