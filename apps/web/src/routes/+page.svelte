<script lang="ts">
  import ConflictDialog from '$lib/components/notes/ConflictDialog.svelte';
  import ContextMenu from '$lib/components/notes/ContextMenu.svelte';
  import EditorPane from '$lib/components/notes/EditorPane.svelte';
  import LoginModal from '$lib/components/notes/LoginModal.svelte';
  import NavigationDock from '$lib/components/notes/NavigationDock.svelte';
  import NoteHistoryDialog from '$lib/components/notes/NoteHistoryDialog.svelte';
  import NotificationStack from '$lib/components/notes/NotificationStack.svelte';
  import SettingsModal from '$lib/components/notes/SettingsModal.svelte';
  import SignupRecoveryModal from '$lib/components/notes/SignupRecoveryModal.svelte';
  import { createNotesPageController } from '$lib/components/notes/controller/page-controller.svelte.js';
  import '$lib/components/notes/styles/page.css';

  const controller = createNotesPageController();
</script>

<svelte:head>
  <title>Author</title>
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

{#if controller.signupRecoveryOpen}
  <SignupRecoveryModal model={controller} />
{/if}

<ContextMenu model={controller} />
<NoteHistoryDialog model={controller} />
<ConflictDialog model={controller} />
<NotificationStack model={controller} />
