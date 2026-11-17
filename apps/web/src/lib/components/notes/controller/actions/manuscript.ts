import {
  buildManuscript,
  buildManuscriptDocx,
  manuscriptFileName,
  type Manuscript,
  type ManuscriptOptions
} from '$lib/client/manuscript';
import {
  printManuscriptPages,
  removeManuscriptPrint,
  renderManuscriptPages
} from '$lib/client/manuscript-print';
import { loadNotebookManuscriptSource } from '$lib/client/store';
import type { AppNotification } from '../models';

export interface ManuscriptActionController {
  manuscriptNotebookId: string | null;
  manuscriptSession: number;
  manuscriptOptions: ManuscriptOptions;
  manuscriptBusy: boolean;
  isArchiveBusy: boolean;
  closeManuscriptExport: () => void;
  downloadBlob: (blob: Blob, fileName: string) => void;
  flushPendingSave: () => Promise<void>;
  notify: (
    kind: AppNotification['kind'],
    title: string,
    message?: string
  ) => void;
}

async function compileManuscript(
  controller: ManuscriptActionController
): Promise<Manuscript> {
  const notebookId = controller.manuscriptNotebookId;
  if (!notebookId) throw new Error('Choose a notebook to export');
  // The editor may still hold unsaved text from the last few hundred ms.
  await controller.flushPendingSave();
  const source = await loadNotebookManuscriptSource(notebookId);
  const manuscript = buildManuscript(
    source.title,
    source.notes,
    controller.manuscriptOptions
  );
  if (!manuscript.sections.length) {
    throw new Error('This notebook has no notes to export');
  }
  return manuscript;
}

/**
 * Runs an export unless the dialog is closed (or reopened) before it is
 * ready: `stillOpen` turns false as soon as that happens.
 */
async function runManuscriptAction(
  controller: ManuscriptActionController,
  action: (
    manuscript: Manuscript,
    stillOpen: () => boolean
  ) => Promise<void> | void
): Promise<void> {
  if (controller.manuscriptBusy || controller.isArchiveBusy) return;
  const session = controller.manuscriptSession;
  const stillOpen = () => controller.manuscriptSession === session;
  controller.manuscriptBusy = true;
  try {
    const manuscript = await compileManuscript(controller);
    if (stillOpen()) await action(manuscript, stillOpen);
  } catch (error) {
    controller.notify(
      'error',
      'Manuscript export failed',
      error instanceof Error ? error.message : 'Could not export manuscript'
    );
  } finally {
    controller.manuscriptBusy = false;
  }
}

export async function exportManuscriptDocx(
  controller: ManuscriptActionController
): Promise<void> {
  await runManuscriptAction(controller, (manuscript) => {
    const fileName = manuscriptFileName(manuscript.title, 'docx');
    controller.downloadBlob(
      buildManuscriptDocx(manuscript, new Date().toISOString()),
      fileName
    );
    controller.closeManuscriptExport();
    controller.notify('success', 'Manuscript exported', fileName);
  });
}

export async function printManuscript(
  controller: ManuscriptActionController
): Promise<void> {
  await runManuscriptAction(controller, async (manuscript, stillOpen) => {
    // Lay out first, while the dialog shows that it is busy; long
    // manuscripts take a moment.
    await renderManuscriptPages(manuscript);
    if (!stillOpen()) {
      removeManuscriptPrint();
      return;
    }
    controller.closeManuscriptExport();
    printManuscriptPages(manuscript.title);
  });
}
