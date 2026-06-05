<script lang="ts">
  import { KeyRound, X } from '@lucide/svelte';
  import { renderSVG } from 'uqr';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';
  import PasswordField from './PasswordField.svelte';

  let { model }: { model: SettingsModalModel } = $props();

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

  function setTotpPassword(value: string): void {
    model.accountTotpPasswordValue = value;
    model.accountError = '';
  }
</script>

{#if model.accountTotpEditing}
  <form
    class="menu-form account-form account-section"
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
    <PasswordField
      id="totp-current-password"
      label="Current password"
      value={model.accountTotpPasswordValue}
      autocomplete="current-password"
      onValue={setTotpPassword}
    />
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
  <div
    class="account-section account-action-section"
    aria-label="Authenticator 2FA"
  >
    <div class="settings-section-title">
      <KeyRound size={15} strokeWidth={1.8} />
      <strong>Authenticator 2FA</strong>
    </div>
    <div class="trusted-device-row">
      <KeyRound size={16} strokeWidth={1.7} />
      <div>
        <strong>{model.accountTwoFactorEnabled ? 'Enabled' : 'Disabled'}</strong
        >
        <span
          >{model.accountTwoFactorEnabled
            ? 'Authenticator code required after password sign-in'
            : 'Add an authenticator app for account sign-in'}</span
        >
      </div>
    </div>
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
  </div>
{/if}
