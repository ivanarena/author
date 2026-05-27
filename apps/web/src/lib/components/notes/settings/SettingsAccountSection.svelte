<script lang="ts">
  import { UserRound } from '@lucide/svelte';
  import type { SettingsModalModel } from '../controller/page-controller.svelte.js';
  import AccountDeleteSection from './account/AccountDeleteSection.svelte';
  import AccountPasswordSection from './account/AccountPasswordSection.svelte';
  import AccountProfileSection from './account/AccountProfileSection.svelte';
  import AccountSignedOutSection from './account/AccountSignedOutSection.svelte';
  import AccountStatusMessage from './account/AccountStatusMessage.svelte';
  import AccountTotpSection from './account/AccountTotpSection.svelte';
  import CurrentDeviceSection from './account/CurrentDeviceSection.svelte';
  import TrustedDevicesSection from './account/TrustedDevicesSection.svelte';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<header class="settings-panel-header">
  <UserRound size={16} strokeWidth={1.8} />
  <h3>Account</h3>
</header>

{#if model.hasToken}
  <AccountProfileSection {model} />
  <CurrentDeviceSection {model} />
  <TrustedDevicesSection {model} />
  <AccountPasswordSection {model} />
  <AccountTotpSection {model} />
  <AccountDeleteSection {model} />
  <AccountStatusMessage {model} />
{:else}
  <AccountSignedOutSection {model} />
{/if}
