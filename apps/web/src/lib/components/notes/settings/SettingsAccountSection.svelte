<script lang="ts">
  import {
    Check,
    Eye,
    EyeOff,
    KeyRound,
    LogIn,
    MonitorSmartphone,
    Pencil,
    Trash2,
    UserRound,
    X
  } from '@lucide/svelte';
  import { renderSVG } from 'uqr';
  import type { SettingsModalModel } from '../notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
  let currentPasswordVisible = $state(false);
  let newPasswordVisible = $state(false);
  let confirmPasswordVisible = $state(false);
  let totpPasswordVisible = $state(false);
  let deletePasswordVisible = $state(false);
  const minPasswordLength = 12;

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
      Removing trust stops future 2FA-code login without a password. It does not
      log out an active session on that device.
    </p>
    {#if model.accountTrustedDevices.length}
      {#each model.accountTrustedDevices as device (device.deviceId)}
        <div class="trusted-device-row" class:current={device.current}>
          <MonitorSmartphone size={16} strokeWidth={1.7} />
          <div>
            <strong>{device.deviceName}</strong>
            <span
              >{device.current ? 'This device' : 'Last used'} - {formatTrustedDeviceTime(
                device.lastUsedAt
              )}</span
            >
          </div>
          <button
            class="icon-button mini trusted-device-remove"
            type="button"
            title="Remove trusted login"
            aria-label={`Remove trusted login for ${device.deviceName}`}
            disabled={model.isAccountBusy}
            onclick={() => void model.revokeTrustedDevice(device.deviceId)}
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
            title={currentPasswordVisible ? 'Hide password' : 'Show password'}
            aria-label={currentPasswordVisible
              ? 'Hide password'
              : 'Show password'}
            aria-pressed={currentPasswordVisible}
            onclick={() => (currentPasswordVisible = !currentPasswordVisible)}
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
              title={newPasswordVisible ? 'Hide password' : 'Show password'}
              aria-label={newPasswordVisible
                ? 'Hide password'
                : 'Show password'}
              aria-pressed={newPasswordVisible}
              onclick={() => (newPasswordVisible = !newPasswordVisible)}
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
              title={confirmPasswordVisible ? 'Hide password' : 'Show password'}
              aria-label={confirmPasswordVisible
                ? 'Hide password'
                : 'Show password'}
              aria-pressed={confirmPasswordVisible}
              onclick={() => (confirmPasswordVisible = !confirmPasswordVisible)}
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
            title={totpPasswordVisible ? 'Hide password' : 'Show password'}
            aria-label={totpPasswordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={totpPasswordVisible}
            onclick={() => (totpPasswordVisible = !totpPasswordVisible)}
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
            (!model.accountTotpSecret && !model.accountTwoFactorEnabled)}
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
            title={deletePasswordVisible ? 'Hide password' : 'Show password'}
            aria-label={deletePasswordVisible
              ? 'Hide password'
              : 'Show password'}
            aria-pressed={deletePasswordVisible}
            onclick={() => (deletePasswordVisible = !deletePasswordVisible)}
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
