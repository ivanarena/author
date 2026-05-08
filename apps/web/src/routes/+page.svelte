<script lang="ts">
  import ConflictDialog from '$lib/components/notes/ConflictDialog.svelte';
  import ContextMenu from '$lib/components/notes/ContextMenu.svelte';
  import EditorPane from '$lib/components/notes/EditorPane.svelte';
  import LoginModal from '$lib/components/notes/LoginModal.svelte';
  import NavigationDock from '$lib/components/notes/NavigationDock.svelte';
  import NotificationStack from '$lib/components/notes/NotificationStack.svelte';
  import SettingsModal from '$lib/components/notes/SettingsModal.svelte';
  import { createNotesPageController } from '$lib/components/notes/notes-page-controller.svelte.js';
  import '$lib/components/notes/notes-page.css';

  const controller = createNotesPageController();
</script>

<svelte:head>
  <title>Notes</title>
</svelte:head>

<svelte:window
  on:keydown={controller.handleGlobalKeydown}
  on:click={controller.handleWindowClick}
  on:online={controller.handleOnline}
  on:offline={controller.handleOffline}
/>

<main class="app-shell" class:settings-open={controller.settingsOpen}>
  <NavigationDock model={controller} />
  <EditorPane model={controller} />
</main>

{#if controller.settingsOpen}
  <SettingsModal model={controller} />
{/if}

{#if controller.loginOpen}
  <LoginModal model={controller} />
{/if}

<ContextMenu model={controller} />
<ConflictDialog model={controller} />
<NotificationStack model={controller} />
