<script lang="ts">
  import { Trash2, X } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';
  import PasswordField from './PasswordField.svelte';

  let { model }: { model: SettingsModalModel } = $props();

  function setDeletePassword(value: string): void {
    model.deletePasswordValue = value;
    model.accountError = '';
  }
</script>

{#if model.accountDeleteEditing}
  <form
    class="menu-form account-form account-section danger-zone"
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
    <PasswordField
      id="delete-password"
      label="Password"
      value={model.deletePasswordValue}
      autocomplete="current-password"
      onValue={setDeletePassword}
    />
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
  <div class="account-section account-action-section danger-zone">
    <div class="settings-section-title danger-title">
      <Trash2 size={15} strokeWidth={1.8} />
      <strong>Delete account</strong>
    </div>
    <button
      class="settings-action danger-action"
      type="button"
      onclick={model.startAccountDeleteEdit}
    >
      <Trash2 size={15} strokeWidth={1.8} />
      <span>Delete account</span>
    </button>
  </div>
{/if}
