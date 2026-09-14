import { describe, expect, it } from 'vitest';
import type { LocalNote } from '$lib/client/db';
import { adjacentNote, noteSwipeDirection } from './note-navigation';

const notes = ['first', 'second', 'third'].map((id) => ({ id }) as LocalNote);

describe('note gesture navigation', () => {
  it('finds adjacent notes without wrapping the visible order', () => {
    expect(adjacentNote(notes, 'second', -1)?.id).toBe('first');
    expect(adjacentNote(notes, 'second', 1)?.id).toBe('third');
    expect(adjacentNote(notes, 'first', -1)).toBeNull();
    expect(adjacentNote(notes, 'third', 1)).toBeNull();
    expect(adjacentNote(notes, 'missing', 1)).toBeNull();
  });

  it('accepts deliberate horizontal swipes and rejects short or vertical movement', () => {
    expect(noteSwipeDirection(-90, 12)).toBe(1);
    expect(noteSwipeDirection(90, 12)).toBe(-1);
    expect(noteSwipeDirection(40, 2)).toBeNull();
    expect(noteSwipeDirection(90, 80)).toBeNull();
  });
});
