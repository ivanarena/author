<script lang="ts">
  import { resolve } from '$app/paths';
  import { Landmark } from '@lucide/svelte';
</script>

<header class="settings-panel-header">
  <Landmark size={16} strokeWidth={1.8} />
  <h3>Legal</h3>
</header>

<div class="settings-action-group" aria-label="Legal documents">
  <div class="settings-action-group-heading">
    <span>Documents</span>
  </div>
  <div class="settings-actions">
    <a
      class="settings-action"
      href={resolve('/privacy')}
      rel="noreferrer"
      target="_blank"
    >
      <Landmark size={15} strokeWidth={1.8} />
      <span>Privacy</span>
    </a>
    <a
      class="settings-action"
      href={resolve('/security')}
      rel="noreferrer"
      target="_blank"
    >
      <Landmark size={15} strokeWidth={1.8} />
      <span>Security model</span>
    </a>
    <a
      class="settings-action"
      href={resolve('/terms')}
      rel="noreferrer"
      target="_blank"
    >
      <Landmark size={15} strokeWidth={1.8} />
      <span>Terms</span>
    </a>
    <a
      class="settings-action"
      href={resolve('/license')}
      rel="noreferrer"
      target="_blank"
    >
      <Landmark size={15} strokeWidth={1.8} />
      <span>License</span>
    </a>
  </div>
</div>
