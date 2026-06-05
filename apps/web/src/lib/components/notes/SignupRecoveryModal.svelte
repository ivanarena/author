<script lang="ts">
  import {
    Check,
    Copy,
    Download,
    Eye,
    EyeOff,
    ShieldCheck
  } from '@lucide/svelte';
  import type { SignupRecoveryModalModel } from './controller/page-controller.svelte.js';

  let { model }: { model: SignupRecoveryModalModel } = $props();
</script>

<div class="login-layer recovery-layer" role="presentation">
  <div
    class="login-modal recovery-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="signup-recovery-title"
    tabindex="-1"
  >
    <header class="settings-header">
      <div class="settings-title">
        <ShieldCheck size={16} strokeWidth={1.8} />
        <h2 id="signup-recovery-title">Save recovery key</h2>
      </div>
    </header>

    <div class="login-modal-body recovery-modal-body">
      <div class="login-copy recovery-copy">
        <span class="login-copy-icon" aria-hidden="true">
          <ShieldCheck size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong>Account created</strong>
          <span>Save this key and recovery kit before continuing.</span>
        </div>
      </div>

      <div class="field-row recovery-key-row">
        <label for="signup-recovery-key">Recovery key</label>
        <div class="password-field">
          <input
            id="signup-recovery-key"
            type={model.signupRecoveryCodeVisible ? 'text' : 'password'}
            readonly
            value={model.signupRecoveryCodeValue}
            autocomplete="off"
            spellcheck="false"
          />
          <button
            class="icon-button mini password-toggle"
            type="button"
            title={model.signupRecoveryCodeVisible
              ? 'Hide recovery key'
              : 'Show recovery key'}
            aria-label={model.signupRecoveryCodeVisible
              ? 'Hide recovery key'
              : 'Show recovery key'}
            aria-pressed={model.signupRecoveryCodeVisible}
            onclick={() =>
              (model.signupRecoveryCodeVisible =
                !model.signupRecoveryCodeVisible)}
          >
            {#if model.signupRecoveryCodeVisible}
              <EyeOff size={14} strokeWidth={1.8} />
            {:else}
              <Eye size={14} strokeWidth={1.8} />
            {/if}
          </button>
        </div>
      </div>

      <div class="login-actions recovery-actions">
        <button
          class="settings-action"
          type="button"
          onclick={() => void model.copySignupRecoveryCode()}
        >
          <Copy size={15} strokeWidth={1.8} />
          <span>Copy recovery key</span>
        </button>
        <button
          class="settings-action"
          type="button"
          onclick={model.downloadSignupRecoveryKit}
        >
          <Download size={15} strokeWidth={1.8} />
          <span>Save recovery kit</span>
        </button>
      </div>

      <label class="settings-toggle-row recovery-confirm">
        <input type="checkbox" bind:checked={model.signupRecoverySaved} />
        <span>
          <strong>I saved the recovery key and kit</strong>
          <small>They are needed together if you lose password access.</small>
        </span>
      </label>

      {#if model.signupRecoveryMessage}
        <p class="form-success" role="status">{model.signupRecoveryMessage}</p>
      {/if}

      <button
        class="settings-action login-submit recovery-done"
        type="button"
        disabled={!model.signupRecoverySaved}
        onclick={model.completeSignupRecoveryPrompt}
      >
        <Check size={15} strokeWidth={1.9} />
        <span>Done</span>
      </button>
    </div>
  </div>
</div>
