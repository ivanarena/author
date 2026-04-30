import { describe, expect, it } from 'vitest';
import type { LocalNote } from './db';
import { noteDisplayTitle, noteNotebookIds } from './note-utils';
import {
  countNotesByNotebook,
  dateRangeLabel,
  filterNotesBySearch,
  filterNotesForView,
  groupNotesByDateRange,
  relativeAge,
  sortNotes,
  syncIndicatorState
} from './view-model';

const baseNote: LocalNote = {
  id: 'note-1',
  title: 'Draft',
  body: 'First body',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-04-20T08:00:00.000Z',
  updatedAt: '2026-04-29T08:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: 'device-a',
  version: 1,
  syncStatus: 'synced',
  lastSyncedVersion: 1,
  lastSyncedAt: '2026-04-29T08:00:00.000Z'
};

function note(overrides: Partial<LocalNote>): LocalNote {
  return { ...baseNote, ...overrides };
}

describe('client note view model', () => {
  it('filters, searches, and sorts note lists without mutating the source', () => {
    const notes = [
      note({
        id: 'b',
        title: 'Beta',
        body: 'Project notes',
        notebookIds: ['work'],
        notebookId: 'work'
      }),
      note({
        id: 'a',
        title: 'Alpha',
        body: 'Shopping list',
        updatedAt: '2026-04-30T08:00:00.000Z'
      }),
      note({
        id: 'c',
        title: '',
        body: 'Loose idea',
        notebookIds: ['personal'],
        notebookId: 'personal'
      })
    ];

    expect(filterNotesForView(notes, [], 'unfiled').map((item) => item.id)).toEqual(['a']);
    expect(filterNotesForView(notes, [], 'work').map((item) => item.id)).toEqual(['b']);
    expect(filterNotesBySearch(notes, 'shop').map((item) => item.id)).toEqual(['a']);
    expect(sortNotes(notes, 'az').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(notes.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('groups date-sorted notes against an explicit clock', () => {
    const now = new Date('2026-04-30T12:00:00.000Z');
    const notes = [
      note({ id: 'today', updatedAt: '2026-04-30T08:00:00.000Z' }),
      note({ id: 'yesterday', updatedAt: '2026-04-29T08:00:00.000Z' }),
      note({ id: 'future', updatedAt: '2026-05-01T08:00:00.000Z' })
    ];

    expect(groupNotesByDateRange(notes, 'date-desc', now).map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Future'
    ]);
    expect(dateRangeLabel('2026-04-10T08:00:00.000Z', now)).toBe('Previous 30 days');
    expect(relativeAge('2026-03-30T08:00:00.000Z', now)).toBe('1mo ago');
  });

  it('normalizes notebook ids and counts multi-notebook notes once per notebook', () => {
    const notes = [
      note({ id: 'one', notebookIds: ['work', 'work', ' personal '], notebookId: 'work' }),
      note({ id: 'two', notebookIds: [], notebookId: null })
    ];

    expect(noteNotebookIds(notes[0])).toEqual(['work', 'personal']);
    expect(countNotesByNotebook(notes)).toEqual(
      new Map([
        ['work', 1],
        ['personal', 1],
        ['', 1]
      ])
    );
  });

  it('derives stable display titles and sync indicator states', () => {
    expect(noteDisplayTitle(note({ title: '', body: '\n  Body title\nsecond line' }))).toBe(
      'Body title'
    );
    expect(
      noteDisplayTitle(note({ title: '', body: '', trashedAt: '2026-04-30T00:00:00.000Z' }))
    ).toBe('Trashed note');

    expect(
      syncIndicatorState({
        isSyncing: false,
        conflictCount: 2,
        isBrowserOnline: true,
        hasSession: true,
        pendingSyncCount: 0,
        syncMessage: 'All changes saved'
      })
    ).toMatchObject({ kind: 'conflict', label: '2 conflicts', detail: '' });

    expect(
      syncIndicatorState({
        isSyncing: false,
        conflictCount: 0,
        isBrowserOnline: true,
        hasSession: true,
        pendingSyncCount: 0,
        syncMessage: 'Login expired'
      })
    ).toMatchObject({ kind: 'synced', label: 'All changes saved', detail: 'Login expired' });
  });
});
