import type { NoteSort } from '$lib/client/view-model';

const SORT_KEY = 'author-notes-sort';
const COMPACT_VIEW_KEY = 'author-notes-compact-view';
const EDITOR_ZOOM_KEY = 'author-notes-editor-zoom';

export const MIN_EDITOR_ZOOM = 0.8;
export const MAX_EDITOR_ZOOM = 1.4;
export const EDITOR_ZOOM_STEP = 0.1;

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

export function nextEditorZoom(current: number, direction: -1 | 1): number {
  return clampEditorZoom(
    Number((current + direction * EDITOR_ZOOM_STEP).toFixed(2))
  );
}

export function clampEditorZoom(value: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
