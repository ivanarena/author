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
    isArchiveBusy: false,
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
