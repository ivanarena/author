import type { NoteSort } from '$lib/client/view-model';

const SORT_KEY = 'author-notes-sort';
const COMPACT_VIEW_KEY = 'author-notes-compact-view';
const EDITOR_ZOOM_KEY = 'author-notes-editor-zoom';
const EDITOR_FONT_KEY = 'author-notes-editor-font';
const EDITOR_TEXT_SIZE_KEY = 'author-notes-editor-text-size';
const EDITOR_LINE_HEIGHT_KEY = 'author-notes-editor-line-height';

export const MIN_EDITOR_ZOOM = 0.8;
export const MAX_EDITOR_ZOOM = 1.4;
export const EDITOR_ZOOM_STEP = 0.1;
export const MIN_EDITOR_TEXT_SIZE = 14;
export const MAX_EDITOR_TEXT_SIZE = 22;
export const MIN_EDITOR_LINE_HEIGHT = 1.35;
export const MAX_EDITOR_LINE_HEIGHT = 2.1;

export type EditorFont = 'kedebideri' | 'system-sans' | 'system-serif' | 'mono';

export interface EditorFontOption {
  value: EditorFont;
  label: string;
  css: string;
}

export const EDITOR_FONT_OPTIONS: EditorFontOption[] = [
  {
    value: 'kedebideri',
    label: 'Kedebideri',
    css: 'Kedebideri, ui-sans-serif, system-ui, sans-serif'
  },
  {
    value: 'system-sans',
    label: 'System Sans',
    css: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  {
    value: 'system-serif',
    label: 'System Serif',
    css: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
  },
  {
    value: 'mono',
    label: 'Mono',
    css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  }
];

export function getStoredSort(): NoteSort {
  const stored = localStorage.getItem(SORT_KEY);
  return stored === 'az' || stored === 'za' || stored === 'date-desc'
    ? stored
    : 'date-desc';
}

export function setStoredSort(sort: NoteSort): void {
  localStorage.setItem(SORT_KEY, sort);
}

export function getStoredCompactView(): boolean {
  return localStorage.getItem(COMPACT_VIEW_KEY) === '1';
}

export function setStoredCompactView(compactView: boolean): void {
  localStorage.setItem(COMPACT_VIEW_KEY, compactView ? '1' : '0');
}

export function getStoredEditorZoom(): number {
  const stored = Number(localStorage.getItem(EDITOR_ZOOM_KEY));
  return Number.isFinite(stored) ? clampEditorZoom(stored) : 1;
}

export function setStoredEditorZoom(zoom: number): void {
  localStorage.setItem(EDITOR_ZOOM_KEY, String(zoom));
}

export function getStoredEditorFont(): EditorFont {
  const stored = localStorage.getItem(EDITOR_FONT_KEY);
  return EDITOR_FONT_OPTIONS.some((option) => option.value === stored)
    ? (stored as EditorFont)
    : 'kedebideri';
}

export function setStoredEditorFont(font: EditorFont): void {
  localStorage.setItem(EDITOR_FONT_KEY, font);
}

export function getEditorFontCss(font: EditorFont): string {
  return (
    EDITOR_FONT_OPTIONS.find((option) => option.value === font)?.css ??
    EDITOR_FONT_OPTIONS[0].css
  );
}

export function getStoredEditorTextSize(): number {
  const stored = Number(localStorage.getItem(EDITOR_TEXT_SIZE_KEY));
  return Number.isFinite(stored) ? clampEditorTextSize(stored) : 16;
}

export function setStoredEditorTextSize(size: number): void {
  localStorage.setItem(EDITOR_TEXT_SIZE_KEY, String(clampEditorTextSize(size)));
}

export function getStoredEditorLineHeight(): number {
  const stored = Number(localStorage.getItem(EDITOR_LINE_HEIGHT_KEY));
  return Number.isFinite(stored) ? clampEditorLineHeight(stored) : 1.75;
}

export function setStoredEditorLineHeight(lineHeight: number): void {
  localStorage.setItem(
    EDITOR_LINE_HEIGHT_KEY,
    String(clampEditorLineHeight(lineHeight))
  );
}

export function nextEditorZoom(current: number, direction: -1 | 1): number {
  return clampEditorZoom(
    Number((current + direction * EDITOR_ZOOM_STEP).toFixed(2))
  );
}

export function clampEditorZoom(value: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
}

export function clampEditorTextSize(value: number): number {
  return Math.min(
    MAX_EDITOR_TEXT_SIZE,
    Math.max(MIN_EDITOR_TEXT_SIZE, Math.round(value))
  );
}

export function clampEditorLineHeight(value: number): number {
  return Math.min(
    MAX_EDITOR_LINE_HEIGHT,
    Math.max(MIN_EDITOR_LINE_HEIGHT, Number(value.toFixed(2)))
  );
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
