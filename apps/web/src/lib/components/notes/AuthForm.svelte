<script lang="ts">
  import { Check, Eye, EyeOff, LogIn, X } from 'lucide-svelte';
  import type { SettingsModalModel } from './notes-page-controller.svelte.js';

  let {
    model,
    showCancel = false
  }: { model: SettingsModalModel; showCancel?: boolean } = $props();
  let passwordVisible = $state(false);
  let confirmPasswordVisible = $state(false);
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
      <strong
        >{model.authMode === 'signup'
          ? 'Create account'
          : 'Sign in to sync'}</strong
      >
      <span>
        {model.authMode === 'signup'
          ? 'Set up sync for this browser and future devices.'
          : 'Connect this browser and keep notes current across devices.'}
      </span>
    </div>
  </div>

  <div class="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
    <button
      type="button"
      role="tab"
      aria-selected={model.authMode === 'signin'}
      class:active={model.authMode === 'signin'}
      disabled={model.isLoggingIn}
      onclick={() => model.setAuthMode('signin')}
    >
      Sign in
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={model.authMode === 'signup'}
      class:active={model.authMode === 'signup'}
      disabled={model.isLoggingIn}
      onclick={() => model.setAuthMode('signup')}
    >
      Sign up
    </button>
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
      <div class="password-field">
        <input
          id="sync-password"
          type={passwordVisible ? 'text' : 'password'}
          bind:value={model.loginPasswordValue}
          autocomplete="current-password"
          placeholder="Password"
          required
          disabled={model.isLoggingIn}
          oninput={() => (model.loginError = '')}
        />
        <button
          class="icon-button mini password-toggle"
          type="button"
          title={passwordVisible ? 'Hide password' : 'Show password'}
          aria-label={passwordVisible ? 'Hide password' : 'Show password'}
          aria-pressed={passwordVisible}
          disabled={model.isLoggingIn}
          onclick={() => (passwordVisible = !passwordVisible)}
        >
          {#if passwordVisible}
            <EyeOff size={14} strokeWidth={1.8} />
          {:else}
            <Eye size={14} strokeWidth={1.8} />
          {/if}
        </button>
      </div>
    </div>
  </div>

  {#if model.authMode === 'signup'}
    <div class="field-grid auth-field-grid">
      <div class="field-row">
        <label for="signup-display-name">Nickname</label>
        <input
          id="signup-display-name"
          type="text"
          bind:value={model.signupDisplayNameValue}
          autocomplete="nickname"
          placeholder="Optional"
          disabled={model.isLoggingIn}
          oninput={() => (model.loginError = '')}
        />
      </div>
      <div class="field-row">
        <label for="signup-confirm-password">Confirm password</label>
        <div class="password-field">
          <input
            id="signup-confirm-password"
            type={confirmPasswordVisible ? 'text' : 'password'}
            bind:value={model.signupConfirmPasswordValue}
            autocomplete="new-password"
            placeholder="Confirm password"
            required
            disabled={model.isLoggingIn}
            oninput={() => (model.loginError = '')}
          />
          <button
            class="icon-button mini password-toggle"
            type="button"
            title={confirmPasswordVisible ? 'Hide password' : 'Show password'}
            aria-label={confirmPasswordVisible
              ? 'Hide password'
              : 'Show password'}
            aria-pressed={confirmPasswordVisible}
            disabled={model.isLoggingIn}
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
  {/if}

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
      <span>
        {model.isLoggingIn
          ? model.authMode === 'signup'
            ? 'Creating account'
            : 'Signing in'
          : model.authMode === 'signup'
            ? 'Create account'
            : 'Sign in'}
      </span>
    </button>
    {#if showCancel}
      <button
        class="settings-action"
        type="button"
        disabled={model.isLoggingIn}
        onclick={model.closeLoginModal}
      >
        <X size={15} strokeWidth={1.9} />
        <span>Cancel</span>
      </button>
    {/if}
  </div>
</form>
