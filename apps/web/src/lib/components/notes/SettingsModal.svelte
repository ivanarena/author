<script lang="ts">
  import { resolve } from '$app/paths';
  import {
    ChevronRight,
    Check,
    Cloud,
    Database,
    Download,
    Eye,
    EyeOff,
    KeyRound,
    Landmark,
    LogIn,
    LogOut,
    MonitorSmartphone,
    Moon,
    Palette,
    Pencil,
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
  } from '@lucide/svelte';
  import { renderSVG } from 'uqr';
  import type {
    SettingsModalModel,
    Theme
  } from './notes-page-controller.svelte.js';
  import type { EditorFont } from './page-preferences';

  let { model }: { model: SettingsModalModel } = $props();
  let currentPasswordVisible = $state(false);
  let newPasswordVisible = $state(false);
  let confirmPasswordVisible = $state(false);
  let totpPasswordVisible = $state(false);
  let deletePasswordVisible = $state(false);
  let fontMenuOpen = $state(false);
  const minPasswordLength = 12;

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: 'light', label: 'Light' },
    { value: 'light-mint', label: 'Mint' },
    { value: 'light-rose', label: 'Rose' },
    { value: 'light-lavender', label: 'Lavender' },
    { value: 'dark', label: 'Dark' },
    { value: 'dark-mint', label: 'Dark mint' },
    { value: 'dark-rose', label: 'Dark rose' },
    { value: 'dark-lavender', label: 'Dark lavender' }
  ];

  const selectedFontOption = $derived(
    model.editorFontOptions.find(
      (option) => option.value === model.editorFont
    ) ?? model.editorFontOptions[0]
  );

  function rangeProgress(value: number, min: number, max: number): string {
    return `${((value - min) / (max - min)) * 100}%`;
  }

  function closeFontMenuOnBlur(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    fontMenuOpen = false;
  }

  function chooseFont(font: EditorFont): void {
    model.setEditorFont(font);
    fontMenuOpen = false;
  }

  function qrCodeDataUrl(value: string): string {
    if (!value) return '';
    const svg = renderSVG(value, {
      border: 3,
      ecc: 'M',
      pixelSize: 4,
      blackColor: '#111111',
      whiteColor: '#ffffff'
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const accountTotpQrCode = $derived(qrCodeDataUrl(model.accountTotpUrl));

  function formatTrustedDeviceTime(value: string): string {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }
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
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'legal'}
          aria-current={model.settingsSection === 'legal' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('legal')}
        >
          <Landmark size={15} strokeWidth={1.8} />
          <span>Legal</span>
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
            <span>Log out and lock</span>
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
            <div class="account-summary account-profile-card">
              <UserRound size={20} strokeWidth={1.7} />
              <div>
                <strong>{model.accountUsername}</strong>
                <span>{model.accountEmail || 'Signed in'}</span>
              </div>
              <button
                class="icon-button mini account-hover-action"
                type="button"
                title="Edit email"
                aria-label="Edit email"
                onclick={model.startAccountProfileEdit}
              >
                <Pencil size={14} strokeWidth={1.8} />
              </button>
            </div>

            {#if model.accountProfileEditing}
              <form
                class="menu-form account-form"
                aria-label="Email"
                onsubmit={(event) => {
                  event.preventDefault();
                  void model.saveAccountProfile();
                }}
              >
                <div class="field-row">
                  <label for="account-email">Email</label>
                  <input
                    id="account-email"
                    type="email"
                    bind:value={model.accountEmail}
                    placeholder="you@example.com"
                    autocomplete="email"
                    oninput={() => {
                      model.accountError = '';
                      model.accountMessage = '';
                    }}
                  />
                </div>
                <div class="login-actions">
                  <button
                    class="settings-action login-submit"
                    type="submit"
                    disabled={model.isAccountBusy}
                  >
                    <Check size={15} strokeWidth={1.9} />
                    <span>Save email</span>
                  </button>
                  <button
                    class="settings-action"
                    type="button"
                    disabled={model.isAccountBusy}
                    onclick={model.cancelAccountProfileEdit}
                  >
                    <X size={15} strokeWidth={1.9} />
                    <span>Cancel</span>
                  </button>
                </div>
              </form>
            {/if}

            <div class="trusted-device-list" aria-label="This device">
              <div class="settings-section-title">
                <MonitorSmartphone size={15} strokeWidth={1.8} />
                <strong>This device</strong>
              </div>
              {#if model.deviceNameEditing}
                <form
                  class="menu-form account-form"
                  aria-label="Rename this device"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void model.saveDeviceName();
                  }}
                >
                  <div class="field-row">
                    <label for="device-name">Device name</label>
                    <input
                      id="device-name"
                      type="text"
                      bind:value={model.deviceNameValue}
                      maxlength="80"
                      autocomplete="off"
                      oninput={() => (model.deviceNameError = '')}
                    />
                  </div>
                  {#if model.deviceNameError}
                    <p class="form-error">{model.deviceNameError}</p>
                  {/if}
                  <div class="login-actions">
                    <button
                      class="settings-action login-submit"
                      type="submit"
                      disabled={model.isAccountBusy}
                    >
                      <Check size={15} strokeWidth={1.9} />
                      <span>Save device name</span>
                    </button>
                    <button
                      class="settings-action"
                      type="button"
                      disabled={model.isAccountBusy}
                      onclick={model.cancelDeviceNameEdit}
                    >
                      <X size={15} strokeWidth={1.9} />
                      <span>Cancel</span>
                    </button>
                  </div>
                </form>
              {:else}
                <div class="trusted-device-row current">
                  <MonitorSmartphone size={16} strokeWidth={1.7} />
                  <div>
                    <strong>{model.currentDeviceName || 'This device'}</strong>
                    <span>Shown in sync history and trusted-device lists</span>
                  </div>
                  <button
                    class="icon-button mini trusted-device-remove"
                    type="button"
                    title="Rename this device"
                    aria-label="Rename this device"
                    disabled={model.isAccountBusy}
                    onclick={model.startDeviceNameEdit}
                  >
                    <Pencil size={14} strokeWidth={1.8} />
                  </button>
                </div>
              {/if}
            </div>

            <div class="trusted-device-list" aria-label="Trusted devices">
              <div class="settings-section-title">
                <MonitorSmartphone size={15} strokeWidth={1.8} />
                <strong>Trusted devices</strong>
              </div>
              <p class="trusted-device-note">
                Removing trust stops future 2FA-code login without a password.
                It does not log out an active session on that device.
              </p>
              {#if model.accountTrustedDevices.length}
                {#each model.accountTrustedDevices as device (device.deviceId)}
                  <div
                    class="trusted-device-row"
                    class:current={device.current}
                  >
                    <MonitorSmartphone size={16} strokeWidth={1.7} />
                    <div>
                      <strong>{device.deviceName}</strong>
                      <span
                        >{device.current ? 'This device' : 'Last used'}
                        - {formatTrustedDeviceTime(device.lastUsedAt)}</span
                      >
                    </div>
                    <button
                      class="icon-button mini trusted-device-remove"
                      type="button"
                      title="Remove trusted login"
                      aria-label={`Remove trusted login for ${device.deviceName}`}
                      disabled={model.isAccountBusy}
                      onclick={() =>
                        void model.revokeTrustedDevice(device.deviceId)}
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                {/each}
              {:else}
                <div class="trusted-device-row">
                  <MonitorSmartphone size={16} strokeWidth={1.7} />
                  <div>
                    <strong>No trusted devices</strong>
                    <span>Sign in with a password to trust this device</span>
                  </div>
                </div>
              {/if}
            </div>

            {#if model.accountPasswordEditing}
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
                  <div class="password-field">
                    <input
                      id="current-password"
                      type={currentPasswordVisible ? 'text' : 'password'}
                      bind:value={model.currentPasswordValue}
                      autocomplete="current-password"
                      oninput={() => (model.accountError = '')}
                    />
                    <button
                      class="icon-button mini password-toggle"
                      type="button"
                      title={currentPasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-label={currentPasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-pressed={currentPasswordVisible}
                      onclick={() =>
                        (currentPasswordVisible = !currentPasswordVisible)}
                    >
                      {#if currentPasswordVisible}
                        <EyeOff size={14} strokeWidth={1.8} />
                      {:else}
                        <Eye size={14} strokeWidth={1.8} />
                      {/if}
                    </button>
                  </div>
                </div>
                <div class="field-grid">
                  <div class="field-row">
                    <label for="new-password">New</label>
                    <div class="password-field">
                      <input
                        id="new-password"
                        type={newPasswordVisible ? 'text' : 'password'}
                        bind:value={model.newPasswordValue}
                        autocomplete="new-password"
                        minlength={minPasswordLength}
                        oninput={() => (model.accountError = '')}
                      />
                      <button
                        class="icon-button mini password-toggle"
                        type="button"
                        title={newPasswordVisible
                          ? 'Hide password'
                          : 'Show password'}
                        aria-label={newPasswordVisible
                          ? 'Hide password'
                          : 'Show password'}
                        aria-pressed={newPasswordVisible}
                        onclick={() =>
                          (newPasswordVisible = !newPasswordVisible)}
                      >
                        {#if newPasswordVisible}
                          <EyeOff size={14} strokeWidth={1.8} />
                        {:else}
                          <Eye size={14} strokeWidth={1.8} />
                        {/if}
                      </button>
                    </div>
                  </div>
                  <div class="field-row">
                    <label for="confirm-password">Confirm</label>
                    <div class="password-field">
                      <input
                        id="confirm-password"
                        type={confirmPasswordVisible ? 'text' : 'password'}
                        bind:value={model.confirmPasswordValue}
                        autocomplete="new-password"
                        minlength={minPasswordLength}
                        oninput={() => (model.accountError = '')}
                      />
                      <button
                        class="icon-button mini password-toggle"
                        type="button"
                        title={confirmPasswordVisible
                          ? 'Hide password'
                          : 'Show password'}
                        aria-label={confirmPasswordVisible
                          ? 'Hide password'
                          : 'Show password'}
                        aria-pressed={confirmPasswordVisible}
                        onclick={() =>
                          (confirmPasswordVisible = !confirmPasswordVisible)}
                      >
                        {#if confirmPasswordVisible}
                          <EyeOff size={14} strokeWidth={1.8} />
                        {:else}
                          <Eye size={14} strokeWidth={1.8} />
                        {/if}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="login-actions">
                  <button
                    class="settings-action"
                    type="submit"
                    disabled={model.isAccountBusy}
                  >
                    <KeyRound size={15} strokeWidth={1.8} />
                    <span>Change password</span>
                  </button>
                  <button
                    class="settings-action"
                    type="button"
                    disabled={model.isAccountBusy}
                    onclick={model.cancelAccountPasswordEdit}
                  >
                    <X size={15} strokeWidth={1.9} />
                    <span>Cancel</span>
                  </button>
                </div>
              </form>
            {:else}
              <button
                class="settings-action"
                type="button"
                onclick={model.startAccountPasswordEdit}
              >
                <KeyRound size={15} strokeWidth={1.8} />
                <span>Change password</span>
              </button>
            {/if}

            {#if model.accountTotpEditing}
              <form
                class="menu-form account-form"
                aria-label="Two-factor authentication"
                onsubmit={(event) => {
                  event.preventDefault();
                  void model.saveAccountTotp();
                }}
              >
                <div class="settings-section-title">
                  <KeyRound size={15} strokeWidth={1.8} />
                  <strong>Authenticator 2FA</strong>
                </div>
                {#if !model.accountTwoFactorEnabled}
                  {#if accountTotpQrCode}
                    <div class="totp-qr-frame">
                      <img
                        class="totp-qr-code"
                        src={accountTotpQrCode}
                        alt="Authenticator setup QR code"
                      />
                    </div>
                  {/if}
                  <div class="field-row">
                    <label for="totp-secret">Authenticator secret</label>
                    <input
                      id="totp-secret"
                      type="text"
                      readonly
                      value={model.accountTotpSecret}
                    />
                  </div>
                  <div class="field-row">
                    <label for="totp-url">Authenticator setup URI</label>
                    <input
                      id="totp-url"
                      type="text"
                      readonly
                      value={model.accountTotpUrl}
                    />
                  </div>
                {/if}
                <div class="field-row">
                  <label for="totp-current-password">Current password</label>
                  <div class="password-field">
                    <input
                      id="totp-current-password"
                      type={totpPasswordVisible ? 'text' : 'password'}
                      bind:value={model.accountTotpPasswordValue}
                      autocomplete="current-password"
                      oninput={() => (model.accountError = '')}
                    />
                    <button
                      class="icon-button mini password-toggle"
                      type="button"
                      title={totpPasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-label={totpPasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-pressed={totpPasswordVisible}
                      onclick={() =>
                        (totpPasswordVisible = !totpPasswordVisible)}
                    >
                      {#if totpPasswordVisible}
                        <EyeOff size={14} strokeWidth={1.8} />
                      {:else}
                        <Eye size={14} strokeWidth={1.8} />
                      {/if}
                    </button>
                  </div>
                </div>
                <div class="field-row">
                  <label for="totp-code">Authenticator code</label>
                  <input
                    id="totp-code"
                    type="text"
                    inputmode="numeric"
                    bind:value={model.accountTotpCodeValue}
                    autocomplete="one-time-code"
                    oninput={() => (model.accountError = '')}
                  />
                </div>
                <div class="login-actions">
                  <button
                    class="settings-action"
                    type="submit"
                    disabled={model.isAccountBusy ||
                      (!model.accountTotpSecret &&
                        !model.accountTwoFactorEnabled)}
                  >
                    <KeyRound size={15} strokeWidth={1.8} />
                    <span
                      >{model.accountTwoFactorEnabled
                        ? 'Disable authenticator 2FA'
                        : 'Enable authenticator 2FA'}</span
                    >
                  </button>
                  <button
                    class="settings-action"
                    type="button"
                    disabled={model.isAccountBusy}
                    onclick={model.cancelAccountTotpEdit}
                  >
                    <X size={15} strokeWidth={1.9} />
                    <span>Cancel</span>
                  </button>
                </div>
              </form>
            {:else}
              <button
                class="settings-action"
                type="button"
                onclick={model.startAccountTotpEdit}
              >
                <KeyRound size={15} strokeWidth={1.8} />
                <span
                  >{model.accountTwoFactorEnabled
                    ? 'Disable authenticator 2FA'
                    : 'Enable authenticator 2FA'}</span
                >
              </button>
            {/if}

            {#if model.accountDeleteEditing}
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
                  <div class="password-field">
                    <input
                      id="delete-password"
                      type={deletePasswordVisible ? 'text' : 'password'}
                      bind:value={model.deletePasswordValue}
                      autocomplete="current-password"
                      oninput={() => (model.accountError = '')}
                    />
                    <button
                      class="icon-button mini password-toggle"
                      type="button"
                      title={deletePasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-label={deletePasswordVisible
                        ? 'Hide password'
                        : 'Show password'}
                      aria-pressed={deletePasswordVisible}
                      onclick={() =>
                        (deletePasswordVisible = !deletePasswordVisible)}
                    >
                      {#if deletePasswordVisible}
                        <EyeOff size={14} strokeWidth={1.8} />
                      {:else}
                        <Eye size={14} strokeWidth={1.8} />
                      {/if}
                    </button>
                  </div>
                </div>
                <div class="login-actions">
                  <button
                    class="settings-action danger-action"
                    type="submit"
                    disabled={model.isAccountBusy}
                  >
                    <Trash2 size={15} strokeWidth={1.8} />
                    <span>Delete account</span>
                  </button>
                  <button
                    class="settings-action"
                    type="button"
                    disabled={model.isAccountBusy}
                    onclick={model.cancelAccountDeleteEdit}
                  >
                    <X size={15} strokeWidth={1.9} />
                    <span>Cancel</span>
                  </button>
                </div>
              </form>
            {:else}
              <button
                class="settings-action danger-action"
                type="button"
                onclick={model.startAccountDeleteEdit}
              >
                <Trash2 size={15} strokeWidth={1.8} />
                <span>Delete account</span>
              </button>
            {/if}

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
            <button
              class="settings-action login-submit"
              type="button"
              onclick={model.toggleLoginMenu}
            >
              <LogIn size={15} strokeWidth={1.8} />
              <span>Sign in to sync</span>
            </button>
            {#if model.accountMessage}
              <p class="form-success" role="status">{model.accountMessage}</p>
            {/if}
          {/if}
        {:else if model.settingsSection === 'sync'}
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

          {#if model.importBanner}
            <div
              class={`import-result-banner ${model.importBanner.kind}`}
              role={model.importBanner.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {#if model.importBanner.kind === 'success'}
                <Check size={15} strokeWidth={1.9} />
              {:else}
                <X size={15} strokeWidth={1.9} />
              {/if}
              <div>
                <strong>{model.importBanner.title}</strong>
                <span>{model.importBanner.message}</span>
              </div>
            </div>
          {/if}

          <div class="settings-action-group" aria-label="Markdown archive">
            <div class="settings-action-group-heading">
              <span>Markdown</span>
            </div>
            <div class="settings-actions">
              <button
                class="settings-action"
                disabled={model.isArchiveBusy}
                onclick={model.exportMarkdown}
              >
                <Download size={15} strokeWidth={1.8} />
                <span>Export MD ZIP</span>
              </button>
              <button
                class="settings-action"
                disabled={model.isArchiveBusy}
                onclick={model.startMarkdownImport}
              >
                <Upload size={15} strokeWidth={1.8} />
                <span>Import MD folder</span>
              </button>
            </div>
          </div>
        {:else if model.settingsSection === 'appearance'}
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
              {#if model.theme.startsWith('dark')}
                <Sun size={15} strokeWidth={1.8} />
                <span>Light mode</span>
              {:else}
                <Moon size={15} strokeWidth={1.8} />
                <span>Dark mode</span>
              {/if}
            </button>
          </div>

          <div class="settings-action-group" aria-label="Theme colors">
            <div class="settings-action-group-heading">
              <span>Themes</span>
            </div>
            <div class="theme-grid">
              {#each themeOptions as option}
                <button
                  type="button"
                  class="theme-choice"
                  class:active={model.theme === option.value}
                  aria-pressed={model.theme === option.value}
                  onclick={() => model.setThemeChoice(option.value)}
                >
                  <span class={`theme-swatch ${option.value}`}></span>
                  <span>{option.label}</span>
                  <Check
                    size={13}
                    strokeWidth={1.8}
                    opacity={model.theme === option.value ? 1 : 0}
                  />
                </button>
              {/each}
            </div>
          </div>

          <div class="settings-action-group" aria-label="Typography">
            <div class="settings-action-group-heading">
              <span>Typography</span>
            </div>
            <div class="settings-select-row settings-font-row">
              <span id="font-select-label">Font</span>
              <div
                class="font-menu"
                role="group"
                aria-labelledby="font-select-label"
                onfocusout={closeFontMenuOnBlur}
              >
                <button
                  class="font-trigger"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={fontMenuOpen}
                  onclick={() => (fontMenuOpen = !fontMenuOpen)}
                >
                  <span style={`font-family: ${selectedFontOption.css}`}
                    >{selectedFontOption.label}</span
                  >
                  <ChevronRight
                    size={14}
                    strokeWidth={1.8}
                    class={fontMenuOpen ? 'open' : undefined}
                  />
                </button>
                {#if fontMenuOpen}
                  <div
                    class="font-popover"
                    role="listbox"
                    aria-labelledby="font-select-label"
                    tabindex="-1"
                  >
                    {#each model.editorFontOptions as option}
                      <button
                        type="button"
                        role="option"
                        aria-selected={model.editorFont === option.value}
                        class:active={model.editorFont === option.value}
                        onclick={() => chooseFont(option.value)}
                      >
                        <span style={`font-family: ${option.css}`}
                          >{option.label}</span
                        >
                        <Check
                          size={13}
                          strokeWidth={1.8}
                          opacity={model.editorFont === option.value ? 1 : 0}
                        />
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            <label class="settings-range-row">
              <span>Text size</span>
              <input
                type="range"
                min={model.minEditorTextSize}
                max={model.maxEditorTextSize}
                step="1"
                value={model.editorTextSize}
                style={`--range-progress: ${rangeProgress(
                  model.editorTextSize,
                  model.minEditorTextSize,
                  model.maxEditorTextSize
                )}`}
                oninput={(event) =>
                  model.setEditorTextSize(
                    Number((event.currentTarget as HTMLInputElement).value)
                  )}
              />
              <output>{model.editorTextSize}px</output>
            </label>
            <label class="settings-range-row">
              <span>Line height</span>
              <input
                type="range"
                min={model.minEditorLineHeight}
                max={model.maxEditorLineHeight}
                step="0.05"
                value={model.editorLineHeight}
                style={`--range-progress: ${rangeProgress(
                  model.editorLineHeight,
                  model.minEditorLineHeight,
                  model.maxEditorLineHeight
                )}`}
                oninput={(event) =>
                  model.setEditorLineHeight(
                    Number((event.currentTarget as HTMLInputElement).value)
                  )}
              />
              <output>{model.editorLineHeight.toFixed(2)}</output>
            </label>
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
        {:else}
          <header class="settings-panel-header">
            <Landmark size={16} strokeWidth={1.8} />
            <h3>Legal</h3>
          </header>

          <div class="settings-action-group" aria-label="Legal documents">
            <div class="settings-action-group-heading">
              <span>Documents</span>
            </div>
            <div class="settings-actions">
              <a
                class="settings-action"
                href={resolve('/privacy')}
                rel="noreferrer"
                target="_blank"
              >
                <Landmark size={15} strokeWidth={1.8} />
                <span>Privacy</span>
              </a>
              <a
                class="settings-action"
                href={resolve('/terms')}
                rel="noreferrer"
                target="_blank"
              >
                <Landmark size={15} strokeWidth={1.8} />
                <span>Terms</span>
              </a>
              <a
                class="settings-action"
                href={resolve('/license')}
                rel="noreferrer"
                target="_blank"
              >
                <Landmark size={15} strokeWidth={1.8} />
                <span>License</span>
              </a>
            </div>
          </div>
        {/if}
      </section>
    </div>

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
