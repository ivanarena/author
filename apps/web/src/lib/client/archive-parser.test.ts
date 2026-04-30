import { describe, expect, it } from 'vitest';
import { parseNotesJsonImportPayload } from './archive-parser';

describe('notes JSON archive parser', () => {
  it('parses native archive notebooks, note links, labels, and timestamp formats', () => {
    const parsed = parseNotesJsonImportPayload({
      notebooks: [
        {
          id: 'nb-work',
          name: ' Work ',
          created_at: '2026-04-01T09:00:00Z',
          modified: 1_700_000_000_000
        },
        { id: 'nb-archive', title: 'Archive' },
        '',
        { id: 'missing-name' }
      ],
      notes: [
        {
          title: 'Roadmap',
          body: 'Launch plan',
          notebookIds: ['nb-work', 'nb-work'],
          notebookId: 'nb-archive',
          notebookNames: ['Ideas', { name: 'Work' }],
          labels: ['Pinned', { name: 'Ideas' }, 'Pinned'],
          createdTimestampUsec: 1_700_000_000_000_000,
          userEditedTimestampUsec: '1700000000000',
          trashed_at: '2026-04-30T10:00:00Z'
        }
      ]
    });

    expect(parsed.notebooks).toEqual([
      {
        sourceId: 'nb-work',
        name: 'Work',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2023-11-14T22:13:20.000Z'
      },
      {
        sourceId: 'nb-archive',
        name: 'Archive',
        createdAt: null,
        updatedAt: null
      }
    ]);
    expect(parsed.notes).toEqual([
      {
        title: 'Roadmap',
        body: 'Launch plan',
        sourceNotebookIds: ['nb-work', 'nb-archive'],
        sourceNotebookNames: ['Ideas', 'Work', 'Pinned', 'Archive'],
        createdAt: '2023-11-14T22:13:20.000Z',
        updatedAt: '2023-11-14T22:13:20.000Z',
        trashedAt: '2026-04-30T10:00:00.000Z'
      }
    ]);
  });

  it('accepts legacy note arrays and derives titles for plain text notes', () => {
    const parsed = parseNotesJsonImportPayload([
      ' First line\nsecond line ',
      '',
      {
        textContent: 'Loose text',
        folder: 'Inbox',
        modifiedAt: 1_700_000_000
      }
    ]);

    expect(parsed.notebooks).toEqual([]);
    expect(parsed.notes).toEqual([
      {
        title: 'First line',
        body: 'First line\nsecond line',
        sourceNotebookIds: [],
        sourceNotebookNames: [],
        createdAt: null,
        updatedAt: null,
        trashedAt: null
      },
      {
        title: 'Loose text',
        body: 'Loose text',
        sourceNotebookIds: [],
        sourceNotebookNames: ['Inbox'],
        createdAt: null,
        updatedAt: '2023-11-14T22:13:20.000Z',
        trashedAt: null
      }
    ]);
  });

  it('drops malformed top-level collections instead of throwing', () => {
    expect(parseNotesJsonImportPayload(null)).toEqual({ notebooks: [], notes: [] });
    expect(parseNotesJsonImportPayload({ notebooks: 'bad', notes: 'bad' })).toEqual({
      notebooks: [],
      notes: []
    });
  });
});
