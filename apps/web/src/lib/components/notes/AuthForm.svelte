<script lang="ts">
  import { Check, Eye, EyeOff, LoaderCircle, LogIn, X } from '@lucide/svelte';
  import { MIN_PASSWORD_LENGTH } from '$lib/shared/password-policy';
  import type { SettingsModalModel } from './controller/page-controller.svelte.js';

  let {
    model,
    showCancel = false
  }: { model: SettingsModalModel; showCancel?: boolean } = $props();
  let passwordVisible = $state(false);
  let confirmPasswordVisible = $state(false);

  function submitLabel(): string {
    if (model.isLoggingIn) {
      return model.authMode === 'signup'
        ? 'Creating sync account...'
        : 'Signing in to sync...';
    }

    return model.authMode === 'signup' ? 'Create account' : 'Sign in to sync';
  }

  function formValue(
    formData: FormData,
    name: string,
    fallback: string
  ): string {
    const value = formData.get(name);
    return typeof value === 'string' ? value : fallback;
  }

  function submitAuthForm(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const formData = new FormData(form);
    model.loginUsernameValue = formValue(
      formData,
      'username',
      model.loginUsernameValue
    );
    model.signupEmailValue = formValue(
      formData,
      'email',
      model.signupEmailValue
    );
    model.signupInvitationValue = formValue(
      formData,
      'invitationCode',
      model.signupInvitationValue
    );
    model.loginPasswordValue = formValue(
      formData,
      'password',
      model.loginPasswordValue
    );
    model.signupConfirmPasswordValue = formValue(
      formData,
      'confirmPassword',
      model.signupConfirmPasswordValue
    );
    model.loginTotpCodeValue = formValue(
      formData,
      'totpCode',
      model.loginTotpCodeValue
    );
    void model.submitLoginMenu();
  }
</script>

<form
  class="menu-form login-form"
  aria-label="Sign in to sync"
  onsubmit={submitAuthForm}
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

  {#if model.signupEnabled}
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
  {/if}

  <div class="field-grid auth-field-grid">
    <div class="field-row">
      <label for="sync-username">Username</label>
      <input
        id="sync-username"
        name="username"
        type="text"
        bind:value={model.loginUsernameValue}
        autocomplete="username"
        placeholder={model.authMode === 'signup'
          ? 'owner'
          : 'Username or email'}
        autocapitalize="none"
        spellcheck="false"
        required
        disabled={model.isLoggingIn}
        oninput={() => (model.loginError = '')}
      />
    </div>

    {#if model.authMode === 'signup'}
      <div class="field-row">
        <label for="signup-email">Email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          bind:value={model.signupEmailValue}
          autocomplete="email"
          placeholder="you@example.com"
          required={model.signupEmailRequired}
          disabled={model.isLoggingIn}
          oninput={() => (model.loginError = '')}
        />
      </div>
      <div class="field-row">
        <label for="signup-invitation">Invitation code</label>
        <input
          id="signup-invitation"
          name="invitationCode"
          type="text"
          bind:value={model.signupInvitationValue}
          autocomplete="one-time-code"
          autocapitalize="none"
          spellcheck="false"
          required
          disabled={model.isLoggingIn}
          oninput={() => (model.loginError = '')}
        />
      </div>
    {/if}

    <div class="field-row">
      <label for="sync-password">Password</label>
      <div class="password-field">
        <input
          id="sync-password"
          name="password"
          type={passwordVisible ? 'text' : 'password'}
          bind:value={model.loginPasswordValue}
          autocomplete={model.authMode === 'signup'
            ? 'new-password'
            : 'current-password'}
          placeholder={model.authMode === 'signup' ||
          !model.deviceOtpLoginAvailable
            ? 'Password'
            : 'Optional'}
          required={model.authMode === 'signup' ||
            !model.deviceOtpLoginAvailable}
          minlength={model.authMode === 'signup'
            ? MIN_PASSWORD_LENGTH
            : undefined}
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

    {#if model.authMode === 'signup'}
      <div class="field-row">
        <label for="signup-confirm-password">Confirm password</label>
        <div class="password-field">
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type={confirmPasswordVisible ? 'text' : 'password'}
            bind:value={model.signupConfirmPasswordValue}
            autocomplete="new-password"
            placeholder="Confirm password"
            required
            minlength={MIN_PASSWORD_LENGTH}
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
    {:else}
      <div class="field-row">
        <label for="sync-totp-code">Authenticator code</label>
        <input
          id="sync-totp-code"
          name="totpCode"
          type="text"
          inputmode="numeric"
          bind:value={model.loginTotpCodeValue}
          autocomplete="one-time-code"
          placeholder={model.deviceOtpLoginAvailable ? 'Code' : 'Optional'}
          required={!model.loginPasswordValue.trim() &&
            model.deviceOtpLoginAvailable}
          disabled={model.isLoggingIn}
          oninput={() => (model.loginError = '')}
        />
      </div>
    {/if}
  </div>

  {#if model.loginError}
    <p class="form-error" role="alert">{model.loginError}</p>
  {/if}

  <div class="login-actions">
    <button
      class="settings-action login-submit"
      class:loading={model.isLoggingIn}
      type="submit"
      disabled={model.isLoggingIn || model.isArchiveBusy}
    >
      {#if model.isLoggingIn}
        <LoaderCircle
          class="loading-icon"
          size={15}
          strokeWidth={1.9}
          aria-hidden="true"
        />
      {:else}
        <Check size={15} strokeWidth={1.9} />
      {/if}
      <span>{submitLabel()}</span>
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
