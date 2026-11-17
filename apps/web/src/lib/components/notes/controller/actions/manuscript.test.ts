import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MANUSCRIPT_OPTIONS } from '$lib/client/manuscript';
import type { ManuscriptActionController } from './manuscript';

const mocks = vi.hoisted(() => ({
  loadNotebookManuscriptSource: vi.fn(),
  renderManuscriptPages: vi.fn(),
  printManuscriptPages: vi.fn(),
  removeManuscriptPrint: vi.fn()
}));

vi.mock('$lib/client/store', () => ({
  loadNotebookManuscriptSource: mocks.loadNotebookManuscriptSource
}));

vi.mock('$lib/client/manuscript-print', () => ({
  renderManuscriptPages: mocks.renderManuscriptPages,
  printManuscriptPages: mocks.printManuscriptPages,
  removeManuscriptPrint: mocks.removeManuscriptPrint
}));

import { exportManuscriptDocx, printManuscript } from './manuscript';

function controller(
  overrides: Partial<ManuscriptActionController> = {}
): ManuscriptActionController {
  const state: ManuscriptActionController = {
    manuscriptNotebookId: 'notebook-1',
    manuscriptSession: 1,
    manuscriptOptions: { ...DEFAULT_MANUSCRIPT_OPTIONS, header: 'Poems' },
    manuscriptBusy: false,
    manuscriptStage: 'idle',
    isArchiveBusy: false,
    syncForExport: vi.fn(async () => 'synced' as const),
    closeManuscriptExport: vi.fn(() => {
      state.manuscriptSession += 1;
      state.manuscriptNotebookId = null;
    }),
    downloadBlob: vi.fn(),
    flushPendingSave: vi.fn(async () => {}),
    notify: vi.fn(),
    ...overrides
  };
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadNotebookManuscriptSource.mockResolvedValue({
    title: 'Poems',
    notes: [
      {
        id: 'a',
        title: 'One',
        body: 'first line',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  });
  mocks.renderManuscriptPages.mockResolvedValue(undefined);
});

describe('manuscript export actions', () => {
  it('syncs before reading the notebook', async () => {
    const order: string[] = [];
    const state = controller({
      syncForExport: vi.fn(async () => {
        order.push(`sync:${state.manuscriptStage}`);
        return 'synced' as const;
      })
    });
    mocks.loadNotebookManuscriptSource.mockImplementationOnce(async () => {
      order.push(`load:${state.manuscriptStage}`);
      return {
        title: 'Poems',
        notes: [{ id: 'a', title: 'One', body: 'x', createdAt: '2026-01-01' }]
      };
    });
    await exportManuscriptDocx(state);

    expect(order).toEqual(['sync:syncing', 'load:preparing']);
    expect(state.manuscriptStage).toBe('idle');
    expect(state.notify).toHaveBeenCalledWith(
      'success',
      'Manuscript exported',
      'Poems.docx'
    );
  });

  it("says when the export used this device's copy", async () => {
    const offline = controller({
      syncForExport: vi.fn(async () => 'offline' as const)
    });
    await exportManuscriptDocx(offline);
    expect(offline.notify).toHaveBeenCalledWith(
      'success',
      'Manuscript exported',
      "Poems.docx. Offline, so this device's copy was exported."
    );

    const failed = controller({
      syncForExport: vi.fn(async () => 'failed' as const)
    });
    await printManuscript(failed);
    expect(failed.notify).toHaveBeenCalledWith(
      'info',
      "Printing this device's copy",
      "Sync didn't finish, so this device's copy was exported."
    );
    expect(mocks.printManuscriptPages).toHaveBeenCalled();
  });

  it('stops when the dialog closes during the sync', async () => {
    const state = controller();
    state.syncForExport = vi.fn(async () => {
      state.manuscriptSession += 1;
      return 'synced' as const;
    });
    await printManuscript(state);

    expect(mocks.loadNotebookManuscriptSource).not.toHaveBeenCalled();
    expect(mocks.renderManuscriptPages).not.toHaveBeenCalled();
    expect(state.manuscriptBusy).toBe(false);
    expect(state.manuscriptStage).toBe('idle');
  });

  it('saves pending edits, downloads the DOCX and closes the dialog', async () => {
    const state = controller();
    await exportManuscriptDocx(state);

    expect(state.flushPendingSave).toHaveBeenCalled();
    expect(mocks.loadNotebookManuscriptSource).toHaveBeenCalledWith(
      'notebook-1'
    );
    expect(state.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'Poems.docx'
    );
    expect(state.closeManuscriptExport).toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledWith(
      'success',
      'Manuscript exported',
      'Poems.docx'
    );
    expect(state.manuscriptBusy).toBe(false);
  });

  it('lays out pages before closing the dialog and printing', async () => {
    const state = controller();
    await printManuscript(state);

    expect(mocks.renderManuscriptPages).toHaveBeenCalled();
    expect(state.closeManuscriptExport).toHaveBeenCalled();
    expect(mocks.printManuscriptPages).toHaveBeenCalledWith('Poems');
  });

  it('cancels printing when the dialog closes while pages are prepared', async () => {
    const state = controller();
    mocks.renderManuscriptPages.mockImplementation(async () => {
      // Closed and reopened for the same notebook during layout.
      state.manuscriptSession += 2;
    });
    await printManuscript(state);

    expect(mocks.printManuscriptPages).not.toHaveBeenCalled();
    expect(mocks.removeManuscriptPrint).toHaveBeenCalled();
    expect(state.manuscriptBusy).toBe(false);
  });

  it('does nothing when the dialog closes while notes are loading', async () => {
    const state = controller();
    mocks.loadNotebookManuscriptSource.mockImplementation(async () => {
      state.manuscriptSession += 1;
      return { title: 'Poems', notes: [] };
    });
    await exportManuscriptDocx(state);
    await printManuscript(state);

    expect(state.downloadBlob).not.toHaveBeenCalled();
    expect(mocks.renderManuscriptPages).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalledWith(
      'success',
      expect.anything(),
      expect.anything()
    );
  });

  it('reports empty notebooks and ignores clicks while busy', async () => {
    mocks.loadNotebookManuscriptSource.mockResolvedValue({
      title: 'Empty',
      notes: [{ id: 'a', title: '', body: '  ', createdAt: '2026-01-01' }]
    });
    const state = controller();
    await exportManuscriptDocx(state);
    expect(state.notify).toHaveBeenCalledWith(
      'error',
      'Manuscript export failed',
      'This notebook has no notes to export'
    );

    const busy = controller({ manuscriptBusy: true });
    await printManuscript(busy);
    await exportManuscriptDocx(controller({ isArchiveBusy: true }));
    expect(mocks.loadNotebookManuscriptSource).toHaveBeenCalledTimes(1);
  });
});
