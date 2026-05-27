<script lang="ts">
  import {
    Check,
    ChevronRight,
    Moon,
    Palette,
    Rows3,
    Sun,
    ZoomIn,
    ZoomOut
  } from '@lucide/svelte';
  import type {
    SettingsModalModel,
    Theme
  } from '../controller/page-controller.svelte.js';
  import type { EditorFont } from '../controller/page-preferences';

  let { model }: { model: SettingsModalModel } = $props();
  let fontMenuOpen = $state(false);

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'light-mint', label: 'Light mint' },
    { value: 'light-rose', label: 'Light rose' },
    { value: 'light-lavender', label: 'Light lavender' },
    { value: 'dark', label: 'Dark' },
    { value: 'dark-mint', label: 'Dark mint' },
    { value: 'dark-rose', label: 'Dark rose' },
    { value: 'dark-lavender', label: 'Dark lavender' }
  ];

  const selectedFontOption = $derived(
    model.editorFontOptions.find(
      (option) => option.value === model.editorFont
    ) ?? model.editorFontOptions[0]
  );

  function rangeProgress(value: number, min: number, max: number): string {
    return `${((value - min) / (max - min)) * 100}%`;
  }

  function closeFontMenuOnBlur(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    fontMenuOpen = false;
  }

  function chooseFont(font: EditorFont): void {
    model.setEditorFont(font);
    fontMenuOpen = false;
  }
</script>

<header class="settings-panel-header">
  <Palette size={16} strokeWidth={1.8} />
  <h3>Appearance</h3>
</header>

<div class="settings-actions">
  <button
    class="settings-action"
    class:active={model.compactView}
    aria-pressed={model.compactView}
    onclick={model.toggleCompactView}
  >
    <Rows3 size={15} strokeWidth={1.8} />
    <span>Compact notes</span>
  </button>
  <button class="settings-action" onclick={model.toggleTheme}>
    {#if model.resolvedTheme.startsWith('dark')}
      <Sun size={15} strokeWidth={1.8} />
      <span>Light mode</span>
    {:else}
      <Moon size={15} strokeWidth={1.8} />
      <span>Dark mode</span>
    {/if}
  </button>
</div>

<div class="settings-action-group" aria-label="Theme colors">
  <div class="settings-action-group-heading">
    <span>Themes</span>
  </div>
  <div class="theme-grid">
    {#each themeOptions as option}
      <button
        type="button"
        class="theme-choice"
        class:active={model.theme === option.value}
        aria-pressed={model.theme === option.value}
        onclick={() => model.setThemeChoice(option.value)}
      >
        <span class={`theme-swatch ${option.value}`}></span>
        <span>{option.label}</span>
        <Check
          size={13}
          strokeWidth={1.8}
          opacity={model.theme === option.value ? 1 : 0}
        />
      </button>
    {/each}
  </div>
</div>

<div class="settings-action-group" aria-label="Typography">
  <div class="settings-action-group-heading">
    <span>Typography</span>
  </div>
  <div class="settings-select-row settings-font-row">
    <span id="font-select-label">Font</span>
    <div
      class="font-menu"
      role="group"
      aria-labelledby="font-select-label"
      onfocusout={closeFontMenuOnBlur}
    >
      <button
        class="font-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={fontMenuOpen}
        onclick={() => (fontMenuOpen = !fontMenuOpen)}
      >
        <span style={`font-family: ${selectedFontOption.css}`}
          >{selectedFontOption.label}</span
        >
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          class={fontMenuOpen ? 'open' : undefined}
        />
      </button>
      {#if fontMenuOpen}
        <div
          class="font-popover"
          role="listbox"
          aria-labelledby="font-select-label"
          tabindex="-1"
        >
          {#each model.editorFontOptions as option}
            <button
              type="button"
              role="option"
              aria-selected={model.editorFont === option.value}
              class:active={model.editorFont === option.value}
              onclick={() => chooseFont(option.value)}
            >
              <span style={`font-family: ${option.css}`}>{option.label}</span>
              <Check
                size={13}
                strokeWidth={1.8}
                opacity={model.editorFont === option.value ? 1 : 0}
              />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <label class="settings-range-row">
    <span>Text size</span>
    <input
      type="range"
      min={model.minEditorTextSize}
      max={model.maxEditorTextSize}
      step="1"
      value={model.editorTextSize}
      style={`--range-progress: ${rangeProgress(
        model.editorTextSize,
        model.minEditorTextSize,
        model.maxEditorTextSize
      )}`}
      oninput={(event) =>
        model.setEditorTextSize(
          Number((event.currentTarget as HTMLInputElement).value)
        )}
    />
    <output>{model.editorTextSize}px</output>
  </label>
  <label class="settings-range-row">
    <span>Line height</span>
    <input
      type="range"
      min={model.minEditorLineHeight}
      max={model.maxEditorLineHeight}
      step="0.05"
      value={model.editorLineHeight}
      style={`--range-progress: ${rangeProgress(
        model.editorLineHeight,
        model.minEditorLineHeight,
        model.maxEditorLineHeight
      )}`}
      oninput={(event) =>
        model.setEditorLineHeight(
          Number((event.currentTarget as HTMLInputElement).value)
        )}
    />
    <output>{model.editorLineHeight.toFixed(2)}</output>
  </label>
</div>

<div class="settings-zoom">
  <button
    class="icon-button mini"
    title="Zoom out"
    aria-label="Zoom out"
    disabled={model.editorZoom <= model.minEditorZoom}
    onclick={() => model.zoomEditor(-1)}
  >
    <ZoomOut size={14} strokeWidth={1.8} />
  </button>
  <span>Zoom {model.zoomPercent()}</span>
  <button
    class="icon-button mini"
    title="Zoom in"
    aria-label="Zoom in"
    disabled={model.editorZoom >= model.maxEditorZoom}
    onclick={() => model.zoomEditor(1)}
  >
    <ZoomIn size={14} strokeWidth={1.8} />
  </button>
</div>
