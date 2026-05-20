<script lang="ts">
  import {
    ChevronRight,
    Cloud,
    Database,
    Landmark,
    LogOut,
    Palette,
    Settings,
    UserRound,
    X
  } from '@lucide/svelte';
  import SettingsAccountSection from './settings/SettingsAccountSection.svelte';
  import SettingsAppearanceSection from './settings/SettingsAppearanceSection.svelte';
  import SettingsDataSection from './settings/SettingsDataSection.svelte';
  import SettingsLegalSection from './settings/SettingsLegalSection.svelte';
  import SettingsSyncSection from './settings/SettingsSyncSection.svelte';
  import type { SettingsModalModel } from './notes-page-controller.svelte.js';

  let { model }: { model: SettingsModalModel } = $props();
</script>

<div class="settings-layer" role="presentation">
  <div
    class="settings-modal"
    id="profile-settings"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    bind:this={model.settingsModal}
    tabindex="-1"
  >
    <header class="settings-header">
      <div class="settings-title">
        <Settings size={16} strokeWidth={1.8} />
        <h2 id="settings-title">Settings</h2>
      </div>
      <button
        class="icon-button mini"
        title="Close"
        aria-label="Close settings"
        onclick={model.closeSettings}
      >
        <X size={14} strokeWidth={1.9} />
      </button>
    </header>

    <div class="settings-body">
      <nav class="settings-menu" aria-label="Settings sections">
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'account'}
          aria-current={model.settingsSection === 'account'
            ? 'page'
            : undefined}
          onclick={() => model.setSettingsSection('account')}
        >
          <UserRound size={15} strokeWidth={1.8} />
          <span>Account</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'sync'}
          aria-current={model.settingsSection === 'sync' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('sync')}
        >
          <Cloud size={15} strokeWidth={1.8} />
          <span>Sync</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'data'}
          aria-current={model.settingsSection === 'data' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('data')}
        >
          <Database size={15} strokeWidth={1.8} />
          <span>Data</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'appearance'}
          aria-current={model.settingsSection === 'appearance'
            ? 'page'
            : undefined}
          onclick={() => model.setSettingsSection('appearance')}
        >
          <Palette size={15} strokeWidth={1.8} />
          <span>Appearance</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        <button
          class="settings-menu-item"
          class:active={model.settingsSection === 'legal'}
          aria-current={model.settingsSection === 'legal' ? 'page' : undefined}
          onclick={() => model.setSettingsSection('legal')}
        >
          <Landmark size={15} strokeWidth={1.8} />
          <span>Legal</span>
          <ChevronRight size={14} strokeWidth={1.8} />
        </button>
        {#if model.hasToken}
          <button
            class="settings-menu-item settings-menu-action"
            type="button"
            disabled={model.isAccountBusy}
            onclick={(event) => {
              event.stopPropagation();
              void model.logoutAccount();
            }}
          >
            <LogOut size={15} strokeWidth={1.8} />
            <span>Log out and lock</span>
          </button>
        {/if}
      </nav>

      <section class="settings-panel">
        {#if model.settingsSection === 'account'}
          <SettingsAccountSection {model} />
        {:else if model.settingsSection === 'sync'}
          <SettingsSyncSection {model} />
        {:else if model.settingsSection === 'data'}
          <SettingsDataSection {model} />
        {:else if model.settingsSection === 'appearance'}
          <SettingsAppearanceSection {model} />
        {:else}
          <SettingsLegalSection />
        {/if}
      </section>
    </div>

    <input
      bind:this={model.importMarkdownInput}
      class="file-input"
      type="file"
      accept=".md,text/markdown,text/plain"
      aria-label="Choose Markdown notes folder"
      multiple
      webkitdirectory
      onchange={model.handleMarkdownImport}
    />
  </div>
</div>
