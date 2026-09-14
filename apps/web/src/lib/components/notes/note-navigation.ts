import type { LocalNote } from '$lib/client/db';

export type NoteNavigationDirection = -1 | 1;

export function adjacentNote(
  notes: LocalNote[],
  selectedNoteId: string | null,
  direction: NoteNavigationDirection
): LocalNote | null {
  if (!selectedNoteId) return null;
  const selectedIndex = notes.findIndex((note) => note.id === selectedNoteId);
  if (selectedIndex < 0) return null;
  return notes[selectedIndex + direction] ?? null;
}

export function noteSwipeDirection(
  deltaX: number,
  deltaY: number,
  threshold = 72
): NoteNavigationDirection | null {
  const horizontalDistance = Math.abs(deltaX);
  if (
    horizontalDistance < threshold ||
    horizontalDistance <= Math.abs(deltaY) * 1.25
  ) {
    return null;
  }
  return deltaX < 0 ? 1 : -1;
}
