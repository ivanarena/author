<script lang="ts">
  import { LogIn, X } from 'lucide-svelte';
  import AuthForm from './AuthForm.svelte';
  import type { SettingsModalModel } from './notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<div
  class="login-layer"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) model.closeLoginModal();
  }}
>
  <div
    class="login-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="login-title"
  >
    <header class="settings-header">
      <div class="settings-title">
        <LogIn size={16} strokeWidth={1.8} />
        <h2 id="login-title">
          {model.authMode === 'signup' ? 'Create account' : 'Sign in'}
        </h2>
      </div>
      <button
        class="icon-button mini"
        title="Close"
        aria-label="Close sign in"
        disabled={model.isLoggingIn}
        onclick={model.closeLoginModal}
      >
        <X size={14} strokeWidth={1.9} />
      </button>
    </header>

    <div class="login-modal-body">
      <AuthForm {model} showCancel />
    </div>
  </div>
</div>
