<script lang="ts">
  import { Check, FolderSymlink, Inbox, Notebook } from '@lucide/svelte';
  import type { LocalNote, LocalNotebook } from '$lib/client/db';
  import { noteNotebookIds } from '$lib/client/note-utils';
  import type { NotebookAssignmentCallback } from './controller/ui-types';

  let {
    note,
    notebooks,
    label = 'Note notebooks',
    heading = '',
    variant = 'popover',
    onAssign
  }: {
    note: LocalNote;
    notebooks: LocalNotebook[];
    label?: string;
    heading?: string;
    variant?: 'popover' | 'context';
    onAssign: NotebookAssignmentCallback;
  } = $props();

  const notebookIds = $derived(noteNotebookIds(note));

  function assign(event: MouseEvent, notebookId: string | null): void {
    event.stopPropagation();
    void onAssign(note, notebookId);
  }
</script>

<div
  class="notebook-link-menu"
  class:context-section={variant === 'context'}
  class:link-popover={variant === 'popover'}
  role={variant === 'context' ? 'group' : 'menu'}
  aria-label={label}
  tabindex="-1"
  oncontextmenu={(event) => {
    event.preventDefault();
    event.stopPropagation();
  }}
>
  {#if heading}
    <span class="context-section-title">
      <FolderSymlink size={13} strokeWidth={1.8} />
      <span>{heading}</span>
    </span>
  {/if}

  <button
    class:active={notebookIds.length === 0}
    aria-checked={notebookIds.length === 0}
    role="menuitemcheckbox"
    onclick={(event) => assign(event, null)}
  >
    <Inbox size={14} strokeWidth={1.8} />
    <span>Unfiled</span>
    {#if notebookIds.length === 0}
      <Check size={13} strokeWidth={1.9} />
    {/if}
  </button>

  {#each notebooks as notebook}
    {@const active = notebookIds.includes(notebook.id)}
    <button
      class:active
      aria-checked={active}
      role="menuitemcheckbox"
      onclick={(event) => assign(event, notebook.id)}
    >
      <Notebook size={14} strokeWidth={1.8} />
      <span>{notebook.name}</span>
      {#if active}
        <Check size={13} strokeWidth={1.9} />
      {/if}
    </button>
  {/each}
</div>
