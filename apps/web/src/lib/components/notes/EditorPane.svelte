<script lang="ts">
  import { Redo2, Undo2 } from 'lucide-svelte';
  import { formatClock, formatDateTime } from '$lib/client/view-model';
  import type { EditorPaneModel } from './notes-page-controller.svelte.js';

  let { model }: { model: EditorPaneModel } = $props();
</script>

<section class="editor-wrap" aria-label="Editor">
  <section class="writer" aria-label="Plain text editor" style={`--editor-zoom: ${model.editorZoom};`}>
    <input
      class="title-input"
      aria-label="Note title"
      bind:this={model.titleInput}
      bind:value={model.titleValue}
      readonly={Boolean(model.selectedNote?.trashedAt)}
      spellcheck="true"
      onkeydown={model.handleTitleKeydown}
      oninput={(event) => model.handleEditorInput(event, 'title')}
    />
    <textarea
      aria-label="Note body"
      bind:this={model.bodyTextarea}
      bind:value={model.bodyValue}
      readonly={Boolean(model.selectedNote?.trashedAt)}
      spellcheck="true"
      oninput={(event) => model.handleEditorInput(event, 'body')}
    ></textarea>
    <footer class="editor-status" aria-label="Note details">
      <div class="history-controls" aria-label="Editor history">
        <button
          class="icon-button mini"
          title="Undo"
          aria-label="Undo"
          disabled={!model.canUndoEditor}
          onmousedown={(event) => event.preventDefault()}
          onclick={model.undoEditorHistory}
        >
          <Undo2 size={14} strokeWidth={1.8} />
        </button>
        <button
          class="icon-button mini"
          title="Redo"
          aria-label="Redo"
          disabled={!model.canRedoEditor}
          onmousedown={(event) => event.preventDefault()}
          onclick={model.redoEditorHistory}
        >
          <Redo2 size={14} strokeWidth={1.8} />
        </button>
      </div>
      <span>{formatClock(model.currentTime)}</span>
      <span>{model.wordCount} {model.wordCount === 1 ? 'word' : 'words'}</span>
      <span>History {model.undoStack.length}/{model.redoStack.length}</span>
      <span>Zoom {model.zoomPercent()}</span>
      {#if model.selectedNote}
        <span>Created {formatDateTime(model.selectedNote.createdAt)}</span>
        <span>Modified {formatDateTime(model.selectedNote.updatedAt)} by {model.selectedDeviceName}</span>
      {:else}
        <span>Unsaved draft</span>
      {/if}
    </footer>
  </section>
</section>
