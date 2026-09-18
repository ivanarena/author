<script lang="ts">
  import { Camera, Pencil, Trash2, X, Check } from '@lucide/svelte';
  import ProfileAvatar from '../../ProfileAvatar.svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
  let profileImageInput: HTMLInputElement;
</script>

<div class="account-summary account-profile-card account-section">
  <button
    class="profile-image-trigger"
    type="button"
    title={model.accountProfileImage
      ? 'Change profile picture'
      : 'Upload profile picture'}
    aria-label={model.accountProfileImage
      ? 'Change profile picture'
      : 'Upload profile picture'}
    disabled={model.isAccountBusy}
    onclick={() => profileImageInput.click()}
  >
    <ProfileAvatar src={model.accountProfileImage} size={48} iconSize={24} />
  </button>
  <input
    bind:this={profileImageInput}
    class="sr-only"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    aria-label="Upload profile picture file"
    onchange={(event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (file) void model.uploadAccountProfileImage(file);
    }}
  />
  <div>
    <strong>{model.accountUsername}</strong>
    <span>{model.accountEmail || 'Signed in'}</span>
  </div>
  <div class="account-profile-actions">
    <button
      class="icon-button mini account-hover-action"
      type="button"
      title="Upload profile picture"
      aria-label="Upload profile picture"
      disabled={model.isAccountBusy}
      onclick={() => profileImageInput.click()}
    >
      <Camera size={14} strokeWidth={1.8} />
    </button>
    {#if model.accountProfileImage}
      <button
        class="icon-button mini account-hover-action"
        type="button"
        title="Remove profile picture"
        aria-label="Remove profile picture"
        disabled={model.isAccountBusy}
        onclick={() => void model.removeAccountProfileImage()}
      >
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    {/if}
    <button
      class="icon-button mini account-hover-action"
      type="button"
      title="Edit email"
      aria-label="Edit email"
      disabled={model.isAccountBusy}
      onclick={model.startAccountProfileEdit}
    >
      <Pencil size={14} strokeWidth={1.8} />
    </button>
  </div>
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
