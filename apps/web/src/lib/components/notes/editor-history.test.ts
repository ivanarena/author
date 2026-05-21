import { describe, expect, it } from 'vitest';
import { pushEditorHistory, sameEditorSnapshot } from './editor-history';
import type { EditorSnapshot } from './ui-types';

describe('editor history helpers', () => {
  it('compares snapshots by plain text title and body', () => {
    expect(
      sameEditorSnapshot(
        { title: 'Draft', body: 'Keep it local' },
        { title: 'Draft', body: 'Keep it local' }
      )
    ).toBe(true);

    expect(
      sameEditorSnapshot(
        { title: 'Draft', body: 'Keep it local' },
        { title: 'Draft', body: 'Keep it local.' }
      )
    ).toBe(false);
  });

  it('deduplicates the latest snapshot and keeps the newest entries', () => {
    const first: EditorSnapshot = { title: 'One', body: 'Alpha' };
    const second: EditorSnapshot = { title: 'Two', body: 'Beta' };
    const third: EditorSnapshot = { title: 'Three', body: 'Gamma' };

    expect(pushEditorHistory([first], first, 5)).toEqual([first]);
    expect(pushEditorHistory([first, second], third, 2)).toEqual([
      second,
      third
    ]);
  });
});
