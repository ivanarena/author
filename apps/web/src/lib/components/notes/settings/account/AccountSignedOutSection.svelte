<script lang="ts">
  import { LogIn, UserRound } from '@lucide/svelte';
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<div class="account-empty signed-out-card">
  <UserRound size={22} strokeWidth={1.7} />
  <div>
    <strong>Local workspace</strong>
    <span>Sync is off on this browser</span>
  </div>
</div>
<button
  class="settings-action login-submit"
  type="button"
  onclick={model.toggleLoginMenu}
>
  <LogIn size={15} strokeWidth={1.8} />
  <span>Sign in to sync</span>
</button>
{#if model.accountMessage}
  <p class="form-success" role="status">{model.accountMessage}</p>
{/if}
