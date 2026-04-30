import { deriveTitle } from './note-utils';

export interface ParsedImportNotebook {
  sourceId: string | null;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParsedImportNote {
  title: string;
  body: string;
  sourceNotebookIds: string[];
  sourceNotebookNames: string[];
  createdAt: string | null;
  updatedAt: string | null;
  trashedAt: string | null;
}

export interface ParsedImportPayload {
  notebooks: ParsedImportNotebook[];
  notes: ParsedImportNote[];
}

export function parseNotesJsonImportPayload(payload: unknown): ParsedImportPayload {
  const root = asRecord(payload);
  const rawNotebooks = root ? readArray(root, 'notebooks') : [];
  const rawNotes = Array.isArray(payload) ? payload : root ? readArray(root, 'notes') : [];
  const notebooks = rawNotebooks.flatMap((item) => {
    const notebook = parseImportNotebook(item);
    return notebook ? [notebook] : [];
  });
  const notebookNameBySourceId = new Map(
    notebooks
      .filter((notebook): notebook is ParsedImportNotebook & { sourceId: string } =>
        Boolean(notebook.sourceId)
      )
      .map((notebook) => [notebook.sourceId, notebook.name])
  );
  const notes = rawNotes.flatMap((item) => {
    const note = parseImportNote(item, notebookNameBySourceId);
    return note ? [note] : [];
  });

  return { notebooks, notes };
}

function parseImportNotebook(item: unknown): ParsedImportNotebook | null {
  if (typeof item === 'string') {
    const name = item.trim();
    return name ? { sourceId: null, name, createdAt: null, updatedAt: null } : null;
  }

  const record = asRecord(item);
  if (!record) return null;

  const name = (readString(record, 'name') ?? readString(record, 'title') ?? '').trim();
  if (!name) return null;

  return {
    sourceId: readString(record, 'id'),
    name,
    createdAt: readDate(record, ['createdAt', 'created_at', 'created', 'createdDate']),
    updatedAt: readDate(record, ['updatedAt', 'updated_at', 'updated', 'modifiedAt', 'modified'])
  };
}

function parseImportNote(
  item: unknown,
  notebookNameBySourceId: Map<string, string>
): ParsedImportNote | null {
  if (typeof item === 'string') {
    const body = item.trim();
    return body
      ? {
          title: deriveTitle(body),
          body,
          sourceNotebookIds: [],
          sourceNotebookNames: [],
          createdAt: null,
          updatedAt: null,
          trashedAt: null
        }
      : null;
  }

  const record = asRecord(item);
  if (!record) return null;

  const body =
    readString(record, 'body') ??
    readString(record, 'text') ??
    readString(record, 'textContent') ??
    readString(record, 'content') ??
    '';
  const title = readString(record, 'title') ?? readString(record, 'name') ?? deriveTitle(body);
  const sourceNotebookIds = readStringArray(record, ['notebookIds', 'folderIds', 'parentIds']);
  const singleNotebookId =
    readString(record, 'notebookId') ?? readString(record, 'folderId') ?? readString(record, 'parentId');
  if (singleNotebookId) sourceNotebookIds.push(singleNotebookId);

  const sourceNotebookNames = readStringArray(record, ['notebookNames', 'notebooks', 'folders']);
  const singleNotebookName =
    readString(record, 'notebookName') ??
    readString(record, 'notebook') ??
    readString(record, 'folder');
  if (singleNotebookName) sourceNotebookNames.push(singleNotebookName);
  sourceNotebookNames.push(...readLabelNames(record.labels));
  for (const sourceNotebookId of sourceNotebookIds) {
    const name = notebookNameBySourceId.get(sourceNotebookId);
    if (name) sourceNotebookNames.push(name);
  }

  return {
    title,
    body,
    sourceNotebookIds: [...new Set(sourceNotebookIds)],
    sourceNotebookNames: [...new Set(sourceNotebookNames)],
    createdAt: readDate(record, [
      'createdAt',
      'created_at',
      'created',
      'createdDate',
      'createdTimestampUsec'
    ]),
    updatedAt: readDate(record, [
      'updatedAt',
      'updated_at',
      'updated',
      'modifiedAt',
      'modified',
      'userEditedTimestampUsec'
    ]),
    trashedAt: readDate(record, ['trashedAt', 'trashed_at'])
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) values.push(item.trim());
        const nested = asRecord(item);
        const nestedName = nested ? readString(nested, 'name') ?? readString(nested, 'id') : null;
        if (nestedName) values.push(nestedName);
      }
    } else if (typeof value === 'string' && value.trim()) {
      values.push(value.trim());
    }
  }
  return [...new Set(values)];
}

function readLabelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];

  for (const label of value) {
    if (typeof label === 'string' && label.trim()) {
      names.push(label.trim());
      continue;
    }
    const record = asRecord(label);
    const name = record ? readString(record, 'name') : null;
    if (name) names.push(name);
  }

  return [...new Set(names)];
}

function readDate(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const parsed = parseDateValue(record[key]);
    if (parsed) return parsed;
  }

  return null;
}

function parseDateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return dateFromNumber(value);
  }

  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^\d+$/.test(trimmed)) {
    return dateFromNumber(numeric);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateFromNumber(value: number): string | null {
  let timestamp = value;
  if (value > 1_000_000_000_000_000) {
    timestamp = value / 1000;
  } else if (value < 10_000_000_000) {
    timestamp = value * 1000;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
