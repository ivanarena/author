<script lang="ts">
  import { Check, Pencil, UserRound, X } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

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
