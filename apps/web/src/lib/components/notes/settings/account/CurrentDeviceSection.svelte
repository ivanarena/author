<script lang="ts">
  import { Check, MonitorSmartphone, Pencil, X } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<div class="trusted-device-list" aria-label="This device">
  <div class="settings-section-title">
    <MonitorSmartphone size={15} strokeWidth={1.8} />
    <strong>This device</strong>
  </div>
  {#if model.deviceNameEditing}
    <form
      class="menu-form account-form"
      aria-label="Rename this device"
      onsubmit={(event) => {
        event.preventDefault();
        void model.saveDeviceName();
      }}
    >
      <div class="field-row">
        <label for="device-name">Device name</label>
        <input
          id="device-name"
          type="text"
          bind:value={model.deviceNameValue}
          maxlength="80"
          autocomplete="off"
          oninput={() => (model.deviceNameError = '')}
        />
      </div>
      {#if model.deviceNameError}
        <p class="form-error">{model.deviceNameError}</p>
      {/if}
      <div class="login-actions">
        <button
          class="settings-action login-submit"
          type="submit"
          disabled={model.isAccountBusy}
        >
          <Check size={15} strokeWidth={1.9} />
          <span>Save device name</span>
        </button>
        <button
          class="settings-action"
          type="button"
          disabled={model.isAccountBusy}
          onclick={model.cancelDeviceNameEdit}
        >
          <X size={15} strokeWidth={1.9} />
          <span>Cancel</span>
        </button>
      </div>
    </form>
  {:else}
    <div class="trusted-device-row current">
      <MonitorSmartphone size={16} strokeWidth={1.7} />
      <div>
        <strong>{model.currentDeviceName || 'This device'}</strong>
        <span>Shown in sync history and trusted-device lists</span>
      </div>
      <button
        class="icon-button mini trusted-device-remove"
        type="button"
        title="Rename this device"
        aria-label="Rename this device"
        disabled={model.isAccountBusy}
        onclick={model.startDeviceNameEdit}
      >
        <Pencil size={14} strokeWidth={1.8} />
      </button>
    </div>
  {/if}
</div>
