import { describe, expect, it } from 'vitest';
import { SYNC_LIMITS } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import {
  jsonByteLength,
  planPushBatches,
  planSyncPushChanges,
  recordExceedsSyncFieldLimits
} from '../src/index';

const note: Note = {
  id: 'note-1',
  title: 'Title',
  body: 'Body',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  isFavorite: false,
  deviceId: 'device-1',
  version: 1,
  syncStatus: 'pending'
};

const notebook: Notebook = {
  id: 'notebook-1',
  name: 'Drafts',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  deviceId: 'device-1',
  version: 1,
  syncStatus: 'pending'
};

describe('push batch planning', () => {
  it('limits batches by change count', () => {
    const items = Array.from({ length: 45 }, (_, index) => index);
    const plan = planPushBatches(items, () => 10, {
      baseBytes: 50,
      maxChanges: 20,
      maxBytes: 1_000_000
    });
    expect(plan.batches.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(plan.oversized).toEqual([]);
    expect(plan.batches.flat()).toEqual(items);
  });

  it('limits batches by serialized size and keeps order', () => {
    const sizes = [400, 400, 400, 100, 700, 100];
    const plan = planPushBatches(
      sizes.map((size, index) => ({ index, size })),
      (item) => item.size,
      { baseBytes: 100, maxChanges: 20, maxBytes: 1_000 }
    );
    expect(
      plan.batches.map((batch) => batch.map((item) => item.index))
    ).toEqual([
      [0, 1],
      [2, 3],
      [4, 5]
    ]);
    for (const batch of plan.batches) {
      const bytes =
        100 + batch.reduce((total, item) => total + item.size + 1, 0);
      expect(bytes).toBeLessThanOrEqual(1_000);
    }
  });

  it('leaves out items that cannot fit in any request', () => {
    const plan = planPushBatches(
      [
        { id: 'small', size: 100 },
        { id: 'huge', size: 5_000 },
        { id: 'tail', size: 100 }
      ],
      (item) => item.size,
      { baseBytes: 100, maxChanges: 20, maxBytes: 1_000 }
    );
    expect(plan.oversized.map((item) => item.id)).toEqual(['huge']);
    expect(plan.batches).toEqual([
      [
        { id: 'small', size: 100 },
        { id: 'tail', size: 100 }
      ]
    ]);
  });

  it('keeps real push requests within the server body limit', () => {
    const device = { id: 'device-1', name: 'Browser' };
    // Four ~1.4 MB encrypted notes would exceed one 5 MiB request together.
    const changes = Array.from({ length: 4 }, (_, index) => ({
      record: { ...note, id: `note-${index}`, body: 'x'.repeat(1_400_000) },
      baseVersion: 0
    }));
    const plan = planPushBatches(changes, jsonByteLength, {
      baseBytes: jsonByteLength({ device, notes: [], notebooks: [] })
    });
    expect(plan.oversized).toEqual([]);
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(
        jsonByteLength({ device, notes: batch, notebooks: [] })
      ).toBeLessThanOrEqual(SYNC_LIMITS.pushRequestBytes);
    }
  });
});

describe('sync field limits', () => {
  it('flags notes and notebooks the server would reject', () => {
    expect(recordExceedsSyncFieldLimits(note)).toBe(false);
    expect(
      recordExceedsSyncFieldLimits({
        ...note,
        body: 'x'.repeat(SYNC_LIMITS.bodyBytes + 1)
      })
    ).toBe(true);
    expect(
      recordExceedsSyncFieldLimits({
        ...note,
        title: 'x'.repeat(SYNC_LIMITS.titleBytes + 1)
      })
    ).toBe(true);
    expect(recordExceedsSyncFieldLimits(notebook)).toBe(false);
    expect(
      recordExceedsSyncFieldLimits({
        ...notebook,
        name: 'x'.repeat(SYNC_LIMITS.notebookNameBytes + 1)
      })
    ).toBe(true);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const accented = 'è'.repeat(SYNC_LIMITS.bodyBytes / 2 + 1);
    expect(accented.length).toBeLessThan(SYNC_LIMITS.bodyBytes);
    expect(recordExceedsSyncFieldLimits({ ...note, body: accented })).toBe(
      true
    );
  });
});

describe('sync push planning', () => {
  const noteChange = (overrides: Partial<Note>) => ({
    entityType: 'note' as const,
    change: { record: { ...note, ...overrides }, baseVersion: 1 }
  });
  const notebookChange = (overrides: Partial<Notebook>) => ({
    entityType: 'notebook' as const,
    change: { record: { ...notebook, ...overrides }, baseVersion: 1 }
  });
  const ids = (batch: Array<{ change: { record: { id: string } } }>) =>
    batch.map((item) => item.change.record.id);

  it('pushes deletions first, in batches of their own', () => {
    const plan = planSyncPushChanges(
      [
        notebookChange({ id: 'new-notebook' }),
        noteChange({ id: 'new-note', notebookIds: ['new-notebook'] }),
        noteChange({
          id: 'deleted-note',
          deletedAt: '2026-02-01T00:00:00.000Z'
        }),
        notebookChange({
          id: 'deleted-notebook',
          deletedAt: '2026-02-01T00:00:00.000Z'
        })
      ],
      jsonByteLength,
      { baseBytes: 100 }
    );
    expect(plan.batches.map(ids)).toEqual([
      ['deleted-note', 'deleted-notebook'],
      ['new-notebook', 'new-note']
    ]);
    expect(plan.unsyncable).toEqual([]);
  });

  it('holds back live notes assigned to a notebook that is too large to sync', () => {
    const plan = planSyncPushChanges(
      [
        notebookChange({
          id: 'huge-notebook',
          name: 'x'.repeat(SYNC_LIMITS.notebookNameBytes + 1)
        }),
        noteChange({ id: 'in-huge', notebookIds: ['huge-notebook'] }),
        noteChange({
          id: 'deleted-in-huge',
          notebookIds: ['huge-notebook'],
          deletedAt: '2026-02-01T00:00:00.000Z'
        }),
        noteChange({ id: 'unfiled', notebookIds: [] })
      ],
      jsonByteLength,
      { baseBytes: 100 }
    );
    expect(ids(plan.unsyncable)).toEqual(['huge-notebook', 'in-huge']);
    expect(plan.batches.map(ids)).toEqual([['deleted-in-huge'], ['unfiled']]);
  });

  it('reports changes too large for any request as unsyncable', () => {
    const plan = planSyncPushChanges(
      [noteChange({ id: 'big', body: 'x'.repeat(2_000) })],
      jsonByteLength,
      { baseBytes: 100, maxBytes: 1_000 }
    );
    expect(plan.batches).toEqual([]);
    expect(ids(plan.unsyncable)).toEqual(['big']);
  });
});
