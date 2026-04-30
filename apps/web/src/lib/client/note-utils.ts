import type { Note } from '@author/schema';

export function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  return firstLine.slice(0, 120);
}

export function noteDisplayTitle(
  note: Pick<Note, 'title' | 'body' | 'trashedAt'>
): string {
  return (
    note.title ||
    deriveTitle(note.body) ||
    (note.trashedAt ? 'Trashed note' : 'Untitled')
  );
}

export function normalizeNotebookName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function noteNotebookIds(
  note: Pick<Note, 'notebookId' | 'notebookIds'>
): string[] {
  const ids = note.notebookIds?.length
    ? note.notebookIds
    : note.notebookId
      ? [note.notebookId]
      : [];
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function primaryNotebookId(ids: string[]): string | null {
  return ids[0] ?? null;
}
