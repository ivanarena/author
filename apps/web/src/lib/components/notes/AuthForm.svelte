<script lang="ts">
  import { Check, LogIn, X } from 'lucide-svelte';
  import type { SettingsModalModel } from './notes-page-controller.svelte.js';

  let {
    model,
    showCancel = false
  }: { model: SettingsModalModel; showCancel?: boolean } = $props();
</script>

<form
  class="menu-form login-form"
  aria-label="Sign in to sync"
  onsubmit={(event) => {
    event.preventDefault();
    void model.submitLoginMenu();
  }}
>
  <div class="login-copy">
    <span class="login-copy-icon" aria-hidden="true">
      <LogIn size={16} strokeWidth={1.8} />
    </span>
    <div>
      <strong>Sign in to sync</strong>
      <span>Connect this browser and keep notes current across devices.</span>
    </div>
  </div>

  <div class="field-grid auth-field-grid">
    <div class="field-row">
      <label for="sync-username">Username</label>
      <input
        id="sync-username"
        type="text"
        bind:value={model.loginUsernameValue}
        autocomplete="username"
        placeholder="owner"
        autocapitalize="none"
        spellcheck="false"
        required
        disabled={model.isLoggingIn}
        oninput={() => (model.loginError = '')}
      />
    </div>
    <div class="field-row">
      <label for="sync-password">Password</label>
      <input
        id="sync-password"
        type="password"
        bind:value={model.loginPasswordValue}
        autocomplete="current-password"
        placeholder="Password"
        required
        disabled={model.isLoggingIn}
        oninput={() => (model.loginError = '')}
      />
    </div>
  </div>

  {#if model.loginError}
    <p class="form-error" role="alert">{model.loginError}</p>
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
    {#if showCancel}
      <button
        class="settings-action"
        type="button"
        disabled={model.isLoggingIn}
        onclick={() => (model.loginOpen = false)}
      >
        <X size={15} strokeWidth={1.9} />
        <span>Cancel</span>
      </button>
    {/if}
  </div>
</form>
