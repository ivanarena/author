import type { LocalNote, LocalNotebook } from '$lib/client/db';

export type EditorSnapshot = { title: string; body: string };

export type ContextMenuState =
  | { type: 'note'; noteId: string; x: number; y: number }
  | { type: 'notebook'; notebookId: string; x: number; y: number }
  | null;

export type MaybePromise<T = void> = T | Promise<T>;

export type NoteCallback = (note: LocalNote) => MaybePromise;
export type NotebookCallback = (notebook: LocalNotebook) => MaybePromise;
