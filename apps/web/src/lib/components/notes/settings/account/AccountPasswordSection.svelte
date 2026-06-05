<script lang="ts">
  import { KeyRound, X } from '@lucide/svelte';
  import { MIN_PASSWORD_LENGTH } from '$lib/shared/password-policy';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';
  import PasswordField from './PasswordField.svelte';

  let { model }: { model: SettingsModalModel } = $props();

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

  function formValue(
    formData: FormData,
    name: string,
    fallback: string
  ): string {
    const value = formData.get(name);
    return typeof value === 'string' ? value : fallback;
  }

  function submitPasswordForm(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const formData = new FormData(form);
    model.currentPasswordValue = formValue(
      formData,
      'currentPassword',
      model.currentPasswordValue
    );
    model.newPasswordValue = formValue(
      formData,
      'newPassword',
      model.newPasswordValue
    );
    model.confirmPasswordValue = formValue(
      formData,
      'confirmPassword',
      model.confirmPasswordValue
    );
    void model.changeAccountPassword();
  }
</script>

{#if model.accountPasswordEditing}
  <form
    class="menu-form account-form account-section"
    aria-label="Change password"
    onsubmit={submitPasswordForm}
  >
    <div class="settings-section-title">
      <KeyRound size={15} strokeWidth={1.8} />
      <strong>Password</strong>
    </div>
    <PasswordField
      id="current-password"
      name="currentPassword"
      label="Current"
      value={model.currentPasswordValue}
      autocomplete="current-password"
      onValue={setCurrentPassword}
    />
    <div class="field-grid">
      <PasswordField
        id="new-password"
        name="newPassword"
        label="New"
        value={model.newPasswordValue}
        autocomplete="new-password"
        minlength={MIN_PASSWORD_LENGTH}
        onValue={setNewPassword}
      />
      <PasswordField
        id="confirm-password"
        name="confirmPassword"
        label="Confirm"
        value={model.confirmPasswordValue}
        autocomplete="new-password"
        minlength={MIN_PASSWORD_LENGTH}
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
  <div class="account-section account-action-section">
    <div class="settings-section-title">
      <KeyRound size={15} strokeWidth={1.8} />
      <strong>Password</strong>
    </div>
    <button
      class="settings-action"
      type="button"
      onclick={model.startAccountPasswordEdit}
    >
      <KeyRound size={15} strokeWidth={1.8} />
      <span>Change password</span>
    </button>
  </div>
{/if}
