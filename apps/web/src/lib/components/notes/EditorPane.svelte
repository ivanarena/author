<script lang="ts">
  import { Redo2, Undo2, ZoomIn, ZoomOut } from '@lucide/svelte';
  import type { EditorPaneModel } from './controller/page-controller.svelte.js';

  let { model }: { model: EditorPaneModel } = $props();
</script>

<section
  class="editor-wrap"
  aria-label="Editor"
  oncontextmenu={model.openEditorContext}
>
  <section
    class="writer"
    aria-label="Plain text editor"
    style={`--editor-zoom: ${model.editorZoom}; --editor-font: ${model.editorFontCss}; --editor-text-size: ${model.editorTextSize}px; --editor-line-height: ${model.editorLineHeight};`}
  >
    <div class="editor-meta-strip" aria-label="Note metadata">
      {#each model.editorMetadataRows as row}
        <span>{row.value}</span>
      {/each}
    </div>
    <input
      class="title-input"
      aria-label="Note title"
      bind:this={model.titleInput}
      bind:value={model.titleValue}
      placeholder="Title"
      readonly={Boolean(model.selectedNote?.trashedAt)}
      spellcheck="true"
      onkeydown={model.handleTitleKeydown}
      oninput={(event) => model.handleEditorInput(event, 'title')}
    />
    <textarea
      aria-label="Note body"
      bind:this={model.bodyTextarea}
      bind:value={model.bodyValue}
      placeholder="Body"
      readonly={Boolean(model.selectedNote?.trashedAt)}
      spellcheck="true"
      oninput={(event) => model.handleEditorInput(event, 'body')}
    ></textarea>
    <footer class="editor-status" aria-label="Editor controls">
      <div class="editor-tool-group history-tool" aria-label="Editor history">
        <div class="tool-buttons">
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
      </div>
      <div class="editor-tool-group zoom-tool" aria-label="Editor zoom">
        <div class="tool-buttons">
          <button
            class="icon-button mini"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={model.editorZoom <= model.minEditorZoom}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => model.zoomEditor(-1)}
          >
            <ZoomOut size={14} strokeWidth={1.8} />
          </button>
          <span class="zoom-readout">{model.zoomPercent()}</span>
          <button
            class="icon-button mini"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={model.editorZoom >= model.maxEditorZoom}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => model.zoomEditor(1)}
          >
            <ZoomIn size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </footer>
  </section>
</section>
