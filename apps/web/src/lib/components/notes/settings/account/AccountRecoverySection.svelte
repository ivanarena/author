<script lang="ts">
  import { Copy, Download, ShieldCheck } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();

  async function copyRecoveryCode(): Promise<void> {
    if (!model.accountRecoveryCodeValue) return;
    await navigator.clipboard.writeText(model.accountRecoveryCodeValue);
    model.accountMessage = 'Recovery code copied';
  }
</script>

<div class="trusted-device-list account-section" aria-label="Recovery">
  <div class="settings-section-title">
    <ShieldCheck size={15} strokeWidth={1.8} />
    <strong>Recovery</strong>
  </div>
  {#if model.accountRecoveryCodeValue}
    <div class="trusted-device-row current">
      <ShieldCheck size={16} strokeWidth={1.7} />
      <div>
        <strong>Recovery code</strong>
        <span>{model.accountRecoveryCodeValue}</span>
      </div>
      <button
        class="icon-button mini trusted-device-remove"
        type="button"
        title="Copy recovery code"
        aria-label="Copy recovery code"
        onclick={copyRecoveryCode}
      >
        <Copy size={14} strokeWidth={1.8} />
      </button>
    </div>
  {/if}
  <button
    class="settings-action"
    type="button"
    disabled={model.isAccountBusy}
    onclick={model.downloadRecoveryKit}
  >
    <Download size={15} strokeWidth={1.8} />
    <span>Download recovery kit</span>
  </button>
</div>
