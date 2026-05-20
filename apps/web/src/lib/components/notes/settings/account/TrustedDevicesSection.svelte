<script lang="ts">
  import { MonitorSmartphone, Trash2 } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();

  function formatTrustedDeviceTime(value: string): string {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }
</script>

<div class="trusted-device-list" aria-label="Trusted devices">
  <div class="settings-section-title">
    <MonitorSmartphone size={15} strokeWidth={1.8} />
    <strong>Trusted devices</strong>
  </div>
  <p class="trusted-device-note">
    Removing trust stops future 2FA-code login without a password. It does not
    log out an active session on that device.
  </p>
  {#if model.accountTrustedDevices.length}
    {#each model.accountTrustedDevices as device (device.deviceId)}
      <div class="trusted-device-row" class:current={device.current}>
        <MonitorSmartphone size={16} strokeWidth={1.7} />
        <div>
          <strong>{device.deviceName}</strong>
          <span
            >{device.current ? 'This device' : 'Last used'} - {formatTrustedDeviceTime(
              device.lastUsedAt
            )}</span
          >
        </div>
        <button
          class="icon-button mini trusted-device-remove"
          type="button"
          title="Remove trusted login"
          aria-label={`Remove trusted login for ${device.deviceName}`}
          disabled={model.isAccountBusy}
          onclick={() => void model.revokeTrustedDevice(device.deviceId)}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    {/each}
  {:else}
    <div class="trusted-device-row">
      <MonitorSmartphone size={16} strokeWidth={1.7} />
      <div>
        <strong>No trusted devices</strong>
        <span>Sign in with a password to trust this device</span>
      </div>
    </div>
  {/if}
</div>
