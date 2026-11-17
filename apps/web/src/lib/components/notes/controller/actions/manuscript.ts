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

/** How the export's data relates to other devices. */
export type ExportSyncResult = 'local-only' | 'synced' | 'offline' | 'failed';
export type ManuscriptStage = 'idle' | 'syncing' | 'preparing';

export interface ManuscriptActionController {
  manuscriptNotebookId: string | null;
  manuscriptSession: number;
  manuscriptOptions: ManuscriptOptions;
  manuscriptBusy: boolean;
  manuscriptStage: ManuscriptStage;
  isArchiveBusy: boolean;
  /** Push and pull before exporting when signed in and online. */
  syncForExport: () => Promise<ExportSyncResult>;
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

/** Why the export may not include other devices' latest changes. */
export function exportSyncNotice(result: ExportSyncResult): string {
  if (result === 'offline') {
    return "Offline, so this device's copy was exported.";
  }
  if (result === 'failed') {
    return "Sync didn't finish, so this device's copy was exported.";
  }
  return '';
}

/**
 * Syncs, then runs an export unless the dialog is closed (or reopened)
 * before it is ready: `stillOpen` turns false as soon as that happens.
 */
async function runManuscriptAction(
  controller: ManuscriptActionController,
  action: (
    manuscript: Manuscript,
    stillOpen: () => boolean,
    syncResult: ExportSyncResult
  ) => Promise<void> | void
): Promise<void> {
  if (controller.manuscriptBusy || controller.isArchiveBusy) return;
  const session = controller.manuscriptSession;
  const stillOpen = () => controller.manuscriptSession === session;
  controller.manuscriptBusy = true;
  controller.manuscriptStage = 'syncing';
  try {
    // Pick up edits from other devices (and send this device's) first.
    const syncResult = await controller.syncForExport();
    if (!stillOpen()) return;
    controller.manuscriptStage = 'preparing';
    const manuscript = await compileManuscript(controller);
    if (stillOpen()) await action(manuscript, stillOpen, syncResult);
  } catch (error) {
    controller.notify(
      'error',
      'Manuscript export failed',
      error instanceof Error ? error.message : 'Could not export manuscript'
    );
  } finally {
    controller.manuscriptBusy = false;
    controller.manuscriptStage = 'idle';
  }
}

export async function exportManuscriptDocx(
  controller: ManuscriptActionController
): Promise<void> {
  await runManuscriptAction(controller, (manuscript, _stillOpen, synced) => {
    const fileName = manuscriptFileName(manuscript.title, 'docx');
    controller.downloadBlob(
      buildManuscriptDocx(manuscript, new Date().toISOString()),
      fileName
    );
    controller.closeManuscriptExport();
    const notice = exportSyncNotice(synced);
    controller.notify(
      'success',
      'Manuscript exported',
      notice ? `${fileName}. ${notice}` : fileName
    );
  });
}

export async function printManuscript(
  controller: ManuscriptActionController
): Promise<void> {
  await runManuscriptAction(
    controller,
    async (manuscript, stillOpen, synced) => {
      // Lay out first, while the dialog shows that it is busy; long
      // manuscripts take a moment.
      await renderManuscriptPages(manuscript);
      if (!stillOpen()) {
        removeManuscriptPrint();
        return;
      }
      controller.closeManuscriptExport();
      const notice = exportSyncNotice(synced);
      if (notice)
        controller.notify('info', "Printing this device's copy", notice);
      printManuscriptPages(manuscript.title);
    }
  );
}
