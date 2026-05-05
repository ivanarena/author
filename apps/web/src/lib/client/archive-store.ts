import { localDb, type LocalNote } from './db';
import type { ParsedImportPayload } from './archive-parser';
import { decryptNoteFields, encryptNoteFields } from './encryption';
import {
  buildNotesMarkdownArchive,
  createZipBlob,
  parseNotesMarkdownImportFiles,
  type MarkdownImportFile
} from './markdown-archive';
import { normalizeNotebookName, primaryNotebookId } from './note-utils';
import { getOrCreateDevice, newId, nowIso } from './local-state';

export interface ImportNotesResult {
  importedNotes: number;
  importedNotebooks: number;
  reusedNotebooks: number;
  skippedNotes: number;
  noteIds: string[];
}

export function importNotesSummary(
  result: Pick<
    ImportNotesResult,
    'importedNotes' | 'importedNotebooks' | 'skippedNotes'
  >
): string {
  const noteText = `${result.importedNotes} ${result.importedNotes === 1 ? 'note' : 'notes'}`;
  const notebookText = result.importedNotebooks
    ? `, ${result.importedNotebooks} new ${result.importedNotebooks === 1 ? 'notebook' : 'notebooks'}`
    : '';
  const skippedText = result.skippedNotes
    ? `, ${result.skippedNotes} blank skipped`
    : '';
  return `Imported ${noteText}${notebookText}${skippedText}`;
}

export const importNotesMarkdownSummary = importNotesSummary;

export async function exportNotesMarkdownZip(): Promise<{
  blob: Blob;
  fileName: string;
  noteCount: number;
}> {
  const [noteRows, notebookRows] = await Promise.all([
    localDb.notes.toArray(),
    localDb.notebooks.toArray()
  ]);
  const decryptedNoteRows = await Promise.all(
    noteRows.map((note) => decryptNoteFields(note))
  );
  const exportedAt = nowIso();
  const archive = buildNotesMarkdownArchive(
    decryptedNoteRows,
    notebookRows,
    exportedAt
  );

  return {
    blob: createZipBlob(archive, exportedAt),
    fileName: `${archive.rootName}.zip`,
    noteCount: archive.files.length
  };
}

export async function importNotesMarkdownFiles(
  files: Iterable<MarkdownImportFile>
): Promise<ImportNotesResult> {
  const payload = await parseNotesMarkdownImportFiles(files);
  return importParsedNotes(payload, 'Markdown folder');
}

async function importParsedNotes(
  { notebooks, notes }: ParsedImportPayload,
  sourceName: string
): Promise<ImportNotesResult> {
  if (!notebooks.length && !notes.length) {
    throw new Error(`${sourceName} does not contain notes or notebooks`);
  }

  const device = await getOrCreateDevice();
  const importedNoteIds: string[] = [];
  let importedNotebooks = 0;
  let reusedNotebooks = 0;
  let skippedNotes = 0;

  await localDb.transaction(
    'rw',
    [localDb.notebooks, localDb.notes],
    async () => {
      const existingNotebooks = await localDb.notebooks.toArray();
      const notebookIdBySourceId = new Map<string, string>();
      const notebookIdByName = new Map<string, string>();

      for (const notebook of existingNotebooks) {
        if (notebook.deletedAt) continue;
        notebookIdByName.set(normalizeNotebookName(notebook.name), notebook.id);
      }

      const ensureNotebook = async (
        name: string,
        sourceId: string | null,
        createdAt: string | null,
        updatedAt: string | null
      ): Promise<string> => {
        const trimmed = name.trim();
        const normalized = normalizeNotebookName(trimmed);
        const existingId = notebookIdByName.get(normalized);
        if (existingId) {
          if (sourceId) notebookIdBySourceId.set(sourceId, existingId);
          reusedNotebooks += 1;
          return existingId;
        }

        const now = nowIso();
        const created = createdAt ?? now;
        const updated = updatedAt ?? created;
        const id = newId();
        await localDb.notebooks.put({
          id,
          name: trimmed,
          createdAt: created,
          updatedAt: updated,
          deletedAt: null,
          deviceId: device.id,
          version: 1,
          syncStatus: 'pending',
          lastSyncedVersion: 0,
          lastSyncedAt: null
        });
        notebookIdByName.set(normalized, id);
        if (sourceId) notebookIdBySourceId.set(sourceId, id);
        importedNotebooks += 1;
        return id;
      };

      for (const notebook of notebooks) {
        await ensureNotebook(
          notebook.name,
          notebook.sourceId,
          notebook.createdAt,
          notebook.updatedAt
        );
      }

      const importedNotes: LocalNote[] = [];
      for (const note of notes) {
        if (!note.title.trim() && !note.body.trim()) {
          skippedNotes += 1;
          continue;
        }

        const notebookIds = new Set<string>();
        for (const sourceNotebookId of note.sourceNotebookIds) {
          const notebookId = notebookIdBySourceId.get(sourceNotebookId);
          if (notebookId) notebookIds.add(notebookId);
        }

        for (const sourceNotebookName of note.sourceNotebookNames) {
          notebookIds.add(
            await ensureNotebook(sourceNotebookName, null, null, null)
          );
        }

        const resolvedNotebookIds = [...notebookIds];

        const now = nowIso();
        const createdAt = note.createdAt ?? note.updatedAt ?? now;
        const updatedAt = note.updatedAt ?? createdAt;
        const id = newId();
        importedNotes.push({
          id,
          title: note.title.trim(),
          body: note.body,
          notebookIds: resolvedNotebookIds,
          notebookId: primaryNotebookId(resolvedNotebookIds),
          createdAt,
          updatedAt,
          deletedAt: null,
          trashedAt: note.trashedAt,
          deviceId: device.id,
          version: 1,
          syncStatus: 'pending',
          lastSyncedVersion: 0,
          lastSyncedAt: null
        });
        importedNoteIds.push(id);
      }

      if (importedNotes.length) {
        await localDb.notes.bulkPut(
          await Promise.all(
            importedNotes.map((note) => encryptNoteFields(note))
          )
        );
      }
    }
  );

  return {
    importedNotes: importedNoteIds.length,
    importedNotebooks,
    reusedNotebooks,
    skippedNotes,
    noteIds: importedNoteIds
  };
}
