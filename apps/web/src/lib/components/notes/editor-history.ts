import type { EditorSnapshot } from './ui-types';

export function sameEditorSnapshot(
  a: EditorSnapshot,
  b: EditorSnapshot
): boolean {
  return a.title === b.title && a.body === b.body;
}

export function pushEditorHistory(
  stack: EditorSnapshot[],
  snapshot: EditorSnapshot,
  maxEntries: number
): EditorSnapshot[] {
  const nextStack =
    stack.length && sameEditorSnapshot(stack[stack.length - 1], snapshot)
      ? stack
      : [...stack, snapshot];
  return nextStack.slice(-maxEntries);
}
