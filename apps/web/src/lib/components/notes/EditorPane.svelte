<script lang="ts">
  import { onDestroy } from 'svelte';
  import { History, Redo2, Undo2, ZoomIn, ZoomOut } from '@lucide/svelte';
  import type { EditorPaneModel } from './controller/page-controller.svelte.js';
  import { noteSwipeDirection } from './note-navigation';

  let { model }: { model: EditorPaneModel } = $props();
  let swipeStart: { pointerId: number; x: number; y: number } | null = null;
  let wheelDeltaX = 0;
  let wheelGestureLocked = false;
  let wheelResetTimer: ReturnType<typeof setTimeout> | null = null;

  function revealMetadata(event: PointerEvent) {
    const strip = event.currentTarget as HTMLElement;
    if (strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' });
  }

  function resetMetadataScroll(event: PointerEvent) {
    (event.currentTarget as HTMLElement).scrollTo({
      left: 0,
      behavior: 'smooth'
    });
  }

  function startNoteSwipe(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    swipeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
  }

  function finishNoteSwipe(event: PointerEvent) {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const direction = noteSwipeDirection(
      event.clientX - swipeStart.x,
      event.clientY - swipeStart.y
    );
    swipeStart = null;
    if (direction) void model.navigateAdjacentNote(direction);
  }

  function cancelNoteSwipe() {
    swipeStart = null;
  }

  function scheduleWheelReset() {
    if (wheelResetTimer) clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(() => {
      wheelDeltaX = 0;
      wheelGestureLocked = false;
      wheelResetTimer = null;
    }, 220);
  }

  function handleNoteWheel(event: WheelEvent) {
    const scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerWidth
          : 1;
    const deltaX = event.deltaX * scale;
    const deltaY = event.deltaY * scale;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;

    event.preventDefault();
    scheduleWheelReset();
    if (wheelGestureLocked) return;

    wheelDeltaX += deltaX;
    const direction = noteSwipeDirection(-wheelDeltaX, 0, 90);
    if (!direction) return;

    wheelDeltaX = 0;
    wheelGestureLocked = true;
    void model.navigateAdjacentNote(direction);
  }

  onDestroy(() => {
    if (wheelResetTimer) clearTimeout(wheelResetTimer);
  });
</script>

<section
  class="editor-wrap"
  aria-label="Editor"
  oncontextmenu={model.openEditorContext}
  onpointerdown={startNoteSwipe}
  onpointerup={finishNoteSwipe}
  onpointercancel={cancelNoteSwipe}
  onwheel={handleNoteWheel}
>
  <section
    class="writer"
    aria-label="Plain text editor"
    style={`--editor-zoom: ${model.editorZoom}; --editor-font: ${model.editorFontCss}; --editor-text-size: ${model.editorTextSize}px; --editor-line-height: ${model.editorLineHeight};`}
  >
    <div
      class="editor-meta-strip"
      role="group"
      aria-label="Note metadata"
      onpointerenter={revealMetadata}
      onpointerleave={resetMetadataScroll}
    >
      {#each model.editorMetadataRows as row}
        <span class:sync-ok={row.label === 'Status' && row.value === 'Synced'}
          >{row.value}</span
        >
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
          <button
            class="icon-button mini"
            title="Note history"
            aria-label="Note history"
            disabled={!model.selectedNote ||
              Boolean(model.selectedNote.trashedAt)}
            onmousedown={(event) => event.preventDefault()}
            onclick={model.openNoteHistory}
          >
            <History size={14} strokeWidth={1.8} />
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
