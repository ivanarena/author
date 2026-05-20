<script lang="ts">
  import { KeyRound, X } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../notes-page-controller.svelte.js';
  import PasswordField from './PasswordField.svelte';

  let { model }: { model: SettingsModalModel } = $props();
  const minPasswordLength = 12;

  function setCurrentPassword(value: string): void {
    model.currentPasswordValue = value;
    model.accountError = '';
  }

  function setNewPassword(value: string): void {
    model.newPasswordValue = value;
    model.accountError = '';
  }

  function setConfirmPassword(value: string): void {
    model.confirmPasswordValue = value;
    model.accountError = '';
  }
</script>

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
    <PasswordField
      id="current-password"
      label="Current"
      value={model.currentPasswordValue}
      autocomplete="current-password"
      onValue={setCurrentPassword}
    />
    <div class="field-grid">
      <PasswordField
        id="new-password"
        label="New"
        value={model.newPasswordValue}
        autocomplete="new-password"
        minlength={minPasswordLength}
        onValue={setNewPassword}
      />
      <PasswordField
        id="confirm-password"
        label="Confirm"
        value={model.confirmPasswordValue}
        autocomplete="new-password"
        minlength={minPasswordLength}
        onValue={setConfirmPassword}
      />
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
