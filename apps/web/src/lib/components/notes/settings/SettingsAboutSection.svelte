<script lang="ts">
  import { resolve } from '$app/paths';
  import { CodeXml, Info, Landmark, ScrollText } from '@lucide/svelte';
  import { version as appVersion } from '../../../../../package.json' with { type: 'json' };

  const releaseNotesUrl = 'https://github.com/ivanarena/author/releases/latest';
</script>

<header class="settings-panel-header">
  <Info size={16} strokeWidth={1.8} />
  <h3>About</h3>
</header>

<div class="settings-action-group" aria-label="App information">
  <div class="settings-action-group-heading">
    <span>App</span>
  </div>
  <dl class="settings-about-grid">
    <div class="settings-about-card">
      <dt>Version</dt>
      <dd>
        <strong>{appVersion}</strong>
        <small>Web app release</small>
      </dd>
    </div>
    <div class="settings-about-card">
      <dt>Updates</dt>
      <dd>
        <strong>Automatic</strong>
        <small
          >The latest deployed version loads when Author is refreshed.</small
        >
      </dd>
    </div>
  </dl>
</div>

<div class="settings-action-group" aria-label="Release information">
  <div class="settings-action-group-heading">
    <span>Release</span>
  </div>
  <div class="settings-actions">
    <a
      class="settings-action"
      href={releaseNotesUrl}
      rel="noreferrer"
      target="_blank"
    >
      <ScrollText size={15} strokeWidth={1.8} />
      <span>Release notes</span>
    </a>
    <a
      class="settings-action"
      href="https://github.com/ivanarena/author"
      rel="noreferrer"
      target="_blank"
    >
      <CodeXml size={15} strokeWidth={1.8} />
      <span>Source code</span>
    </a>
  </div>
</div>

<div class="settings-action-group" aria-label="Legal documents">
  <div class="settings-action-group-heading">
    <span>Legal</span>
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
