<script lang="ts">
  import { CircleUserRound, LogIn, Menu, Moon, RefreshCw, Settings, Sun } from 'lucide-svelte';
  import NoteListPanel from './NoteListPanel.svelte';
  import NotebookSidebar from './NotebookSidebar.svelte';
  import type { NavigationDockModel } from './notes-page-controller.svelte.js';

  let { model }: { model: NavigationDockModel } = $props();
</script>

<div
  class="menu-dock"
  class:open={model.menusOpen}
  role="navigation"
  aria-label="Navigation"
  onpointerenter={model.openMenus}
  onpointerleave={model.scheduleMenusClose}
  onfocusin={model.openMenus}
  onfocusout={model.closeMenusOnBlur}
>
  <div class="dock-buttons">
    <button
      class="icon-button menu-trigger"
      title="Show menus"
      aria-label="Show menus"
      aria-controls="navigation-menus"
      aria-expanded={model.menusOpen}
      onclick={model.toggleMenus}
    >
      <Menu size={18} strokeWidth={1.8} />
    </button>
    <div class="profile-menu">
      <button
        class="icon-button profile-trigger"
        class:active={model.settingsOpen}
        title="Profile and settings"
        aria-label="Profile and settings"
        aria-controls="profile-settings"
        aria-expanded={model.settingsOpen}
        onclick={model.toggleSettings}
      >
        <CircleUserRound size={18} strokeWidth={1.8} />
      </button>

      <div class="profile-hover-card" role="menu" aria-label="Profile and settings menu">
        <header class="profile-card-header">
          <CircleUserRound size={30} strokeWidth={1.6} />
          <div>
            <strong>{model.hasToken ? 'Sync profile' : 'Local workspace'}</strong>
            <span
              class={`sync-badge ${model.syncIndicator.kind === 'synced' ? 'ok' : 'error'}`}
              aria-label={`Sync status: ${model.syncIndicator.label}`}
            >
              <span aria-hidden="true"></span>
              <span>{model.syncIndicator.label}</span>
            </span>
          </div>
        </header>
        {#if model.syncIndicator.detail}
          <p class="profile-card-detail">{model.syncIndicator.detail}</p>
        {/if}
        <div class="profile-card-actions">
          {#if model.hasToken}
            <button class="profile-quick-action" role="menuitem" disabled={model.isSyncing} onclick={model.syncNow}>
              <RefreshCw size={14} strokeWidth={1.8} />
              <span>{model.isSyncing ? 'Syncing changes' : 'Sync now'}</span>
            </button>
          {:else}
            <button class="profile-quick-action primary" role="menuitem" onclick={model.openLoginSettings}>
              <LogIn size={14} strokeWidth={1.8} />
              <span>Sign in to sync</span>
            </button>
          {/if}
        <button class="profile-quick-action" role="menuitem" onclick={model.toggleTheme}>
          {#if model.theme === 'dark'}
            <Sun size={14} strokeWidth={1.8} />
            <span>Light</span>
          {:else}
            <Moon size={14} strokeWidth={1.8} />
            <span>Dark</span>
          {/if}
        </button>
        <button class="profile-quick-action" role="menuitem" onclick={model.openSettingsModal}>
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
        </div>
      </div>
    </div>
  </div>

  <div class="menu-panels" id="navigation-menus">
    <NotebookSidebar {model} />
    <NoteListPanel {model} />
  </div>
</div>
