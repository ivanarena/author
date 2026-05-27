<script lang="ts">
  import type { SettingsModalModel } from '../../controller/page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

{#if model.accountError}
  <p class="form-error" role="alert">{model.accountError}</p>
{:else if model.accountMessage}
  <p class="form-success" role="status">{model.accountMessage}</p>
{/if}
