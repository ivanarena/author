import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import { chooseConflictVersion, nextVersionAfter, recordsDiffer } from '@author/sync-spec';
import { localDb, type LocalConflict, type LocalNote, type LocalNotebook } from './db';

const DEVICE_KEY = 'author-notes-device-id';
const TOKEN_KEY = 'author-notes-token';
const THEME_KEY = 'author-notes-theme';

export interface NotesJsonNotebook {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotesJsonNote {
  id?: string;
  title: string;
  body: string;
  notebookIds?: string[];
  notebookNames?: string[];
  notebookId: string | null;
  notebookName: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface NotesJsonArchive {
  app: 'author-notes';
  format: 'author-notes-json';
  version: 1;
  exportedAt: string;
  notebooks: NotesJsonNotebook[];
  notes: NotesJsonNote[];
}

export interface ImportNotesJsonResult {
  importedNotes: number;
  importedNotebooks: number;
  reusedNotebooks: number;
  skippedNotes: number;
  noteIds: string[];
}

interface ImportNotebookDraft {
  sourceId: string | null;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ImportNoteDraft {
  title: string;
  body: string;
  sourceNotebookIds: string[];
  sourceNotebookNames: string[];
  createdAt: string | null;
  updatedAt: string | null;
  trashedAt: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  return firstLine.slice(0, 120);
}

export function noteDisplayTitle(note: Pick<Note, 'title' | 'body' | 'trashedAt'>): string {
  return note.title || deriveTitle(note.body) || (note.trashedAt ? 'Trashed note' : 'Untitled');
}

export function normalizeNotebookName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function noteNotebookIds(note: Pick<Note, 'notebookId' | 'notebookIds'>): string[] {
  return [...new Set((note.notebookIds?.length ? note.notebookIds : note.notebookId ? [note.notebookId] : []).filter(Boolean))];
}

function primaryNotebookId(ids: string[]): string | null {
  return ids[0] ?? null;
}

export async function getOrCreateDevice(): Promise<Device> {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(DEVICE_KEY, id);
  }

  const existing = await localDb.devices.get(id);
  if (existing) return existing;

  const device: Device = {
    id,
    name: navigator.userAgent.includes('Android') ? 'Android browser' : 'This browser'
  };
  await localDb.devices.put(device);
  return device;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme: 'light' | 'dark'): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export async function createBlankNote(
  initial: { title?: string; body?: string; notebookId?: string | null } = {}
): Promise<LocalNote> {
  const device = await getOrCreateDevice();
  const now = nowIso();
  const notebookIds = initial.notebookId ? [initial.notebookId] : [];
  const note: LocalNote = {
    id: newId(),
    title: (initial.title ?? '').trim(),
    body: initial.body ?? '',
    notebookIds,
    notebookId: primaryNotebookId(notebookIds),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null
  };

  await localDb.notes.put(note);
  return note;
}

export async function createNotebook(name: string): Promise<LocalNotebook | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (await notebookNameExists(trimmed)) return null;

  const device = await getOrCreateDevice();
  const now = nowIso();
  const notebook: LocalNotebook = {
    id: newId(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'pending',
    lastSyncedVersion: 0,
    lastSyncedAt: null
  };

  await localDb.notebooks.put(notebook);
  return notebook;
}

export async function renameNotebook(
  notebookId: string,
  name: string
): Promise<LocalNotebook | null> {
  const trimmed = name.trim();
  if (!trimmed || (await notebookNameExists(trimmed, notebookId))) return null;

  const notebook = await localDb.notebooks.get(notebookId);
  if (!notebook || notebook.deletedAt) return null;
  if (notebook.name === trimmed) return notebook;

  const device = await getOrCreateDevice();
  const updated: LocalNotebook = {
    ...notebook,
    name: trimmed,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: notebook.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notebooks.put(updated);
  return updated;
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  const notebook = await localDb.notebooks.get(notebookId);
  if (!notebook || notebook.deletedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.transaction('rw', [localDb.notebooks, localDb.notes], async () => {
    await localDb.notebooks.put({
      ...notebook,
      deletedAt: now,
      updatedAt: now,
      deviceId: device.id,
      version: notebook.version + 1,
      syncStatus: 'pending'
    });

    const assignedNotes = await localDb.notes.toArray();
    const updatedNotes = assignedNotes
      .filter((note) => !note.deletedAt && noteNotebookIds(note).includes(notebookId))
      .map((note) => {
        const notebookIds = noteNotebookIds(note).filter((id) => id !== notebookId);
        return {
          ...note,
          notebookIds,
          notebookId: primaryNotebookId(notebookIds),
          updatedAt: now,
          deviceId: device.id,
          version: note.version + 1,
          syncStatus: 'pending' as const
        };
      });

    if (updatedNotes.length) {
      await localDb.notes.bulkPut(updatedNotes);
    }
  });
}

export async function notebookNameExists(name: string, excludeId?: string): Promise<boolean> {
  const normalized = normalizeNotebookName(name);
  if (!normalized) return false;

  const notebooks = await localDb.notebooks.toArray();
  return notebooks.some(
    (notebook) =>
      !notebook.deletedAt &&
      notebook.id !== excludeId &&
      normalizeNotebookName(notebook.name) === normalized
  );
}

export async function updateNoteContent(
  noteId: string,
  title: string,
  body: string
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return null;

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    title: title.trim(),
    body,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notes.put(updated);
  return updated;
}

export async function assignNoteToNotebook(
  noteId: string,
  notebookId: string | null,
  assigned: boolean
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return note ?? null;

  const currentIds = noteNotebookIds(note);
  const notebookIds = notebookId
    ? assigned
      ? currentIds.includes(notebookId)
        ? currentIds
        : [...currentIds, notebookId]
      : currentIds.filter((id) => id !== notebookId)
    : [];

  if (currentIds.join('\0') === notebookIds.join('\0')) return note;

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    notebookIds,
    notebookId: primaryNotebookId(notebookIds),
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notes.put(updated);
  return updated;
}

export async function moveNoteToTrash(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.trashedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    trashedAt: now,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function restoreNote(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || !note.trashedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    trashedAt: null,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export async function loadNotes(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  return notes
    .filter((note) => !note.deletedAt && !note.trashedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadTrash(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  return notes
    .filter((note) => !note.deletedAt && Boolean(note.trashedAt))
    .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
}

export async function loadNotebooks(): Promise<LocalNotebook[]> {
  const notebooks = await localDb.notebooks.toArray();
  return notebooks
    .filter((notebook) => !notebook.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadPendingConflicts(): Promise<LocalConflict[]> {
  return localDb.conflicts.where('status').equals('pending').sortBy('createdAt');
}

export async function loadDevices(): Promise<Device[]> {
  return localDb.devices.toArray();
}

export async function exportNotesJson(): Promise<NotesJsonArchive> {
  const [noteRows, notebookRows] = await Promise.all([
    localDb.notes.toArray(),
    localDb.notebooks.toArray()
  ]);
  const notebooks = notebookRows
    .filter((notebook) => !notebook.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt
    }));
  const notebookNameById = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]));
  const notes = noteRows
    .filter((note) => !note.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      notebookIds: noteNotebookIds(note),
      notebookNames: noteNotebookIds(note)
        .map((id) => notebookNameById.get(id))
        .filter((name): name is string => Boolean(name)),
      notebookId: note.notebookId,
      notebookName: note.notebookId ? (notebookNameById.get(note.notebookId) ?? null) : null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      trashedAt: note.trashedAt
    }));

  return {
    app: 'author-notes',
    format: 'author-notes-json',
    version: 1,
    exportedAt: nowIso(),
    notebooks,
    notes
  };
}

export async function importNotesJson(payload: unknown): Promise<ImportNotesJsonResult> {
  const { notebooks, notes } = parseImportPayload(payload);
  if (!notebooks.length && !notes.length) {
    throw new Error('JSON file does not contain notes or notebooks');
  }

  const device = await getOrCreateDevice();
  const importedNoteIds: string[] = [];
  let importedNotebooks = 0;
  let reusedNotebooks = 0;
  let skippedNotes = 0;

  await localDb.transaction('rw', [localDb.notebooks, localDb.notes], async () => {
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
      await ensureNotebook(notebook.name, notebook.sourceId, notebook.createdAt, notebook.updatedAt);
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
        notebookIds.add(await ensureNotebook(sourceNotebookName, null, null, null));
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
      await localDb.notes.bulkPut(importedNotes);
    }
  });

  return {
    importedNotes: importedNoteIds.length,
    importedNotebooks,
    reusedNotebooks,
    skippedNotes,
    noteIds: importedNoteIds
  };
}

function parseImportPayload(payload: unknown): {
  notebooks: ImportNotebookDraft[];
  notes: ImportNoteDraft[];
} {
  const root = asRecord(payload);
  const rawNotebooks = root ? readArray(root, 'notebooks') : [];
  const rawNotes = Array.isArray(payload) ? payload : root ? readArray(root, 'notes') : [];
  const notebooks = rawNotebooks.flatMap((item) => {
    const notebook = parseImportNotebook(item);
    return notebook ? [notebook] : [];
  });
  const notebookNameBySourceId = new Map(
    notebooks
      .filter((notebook): notebook is ImportNotebookDraft & { sourceId: string } =>
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

function parseImportNotebook(item: unknown): ImportNotebookDraft | null {
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
): ImportNoteDraft | null {
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

function readLabelName(value: unknown): string | null {
  return readLabelNames(value)[0] ?? null;
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

export async function saveDevices(devices: Device[]): Promise<void> {
  if (!devices.length) return;
  await localDb.devices.bulkPut(devices);
}

export async function markAcceptedChanges(
  accepted: Array<{ entityType: 'note' | 'notebook'; id: string; version: number; updatedAt: string }>,
  syncedAt: string
): Promise<void> {
  await localDb.transaction('rw', [localDb.notes, localDb.notebooks], async () => {
    for (const change of accepted) {
      if (change.entityType === 'note') {
        const note = await localDb.notes.get(change.id);
        if (note) {
          await localDb.notes.put({
            ...note,
            version: change.version,
            syncStatus: 'synced',
            lastSyncedVersion: change.version,
            lastSyncedAt: syncedAt
          });
        }
      } else {
        const notebook = await localDb.notebooks.get(change.id);
        if (notebook) {
          await localDb.notebooks.put({
            ...notebook,
            version: change.version,
            syncStatus: 'synced',
            lastSyncedVersion: change.version,
            lastSyncedAt: syncedAt
          });
        }
      }
    }
  });
}

export async function saveConflict(
  conflict: SyncConflict<Note> | SyncConflict<Notebook>
): Promise<void> {
  const createdAt = nowIso();
  await localDb.conflicts.put({
    id: conflict.id,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    status: 'pending',
    createdAt,
    conflict
  });

  if (conflict.entityType === 'note') {
    const note = await localDb.notes.get(conflict.entityId);
    if (note) await localDb.notes.put({ ...note, syncStatus: 'conflict' });
  } else {
    const notebook = await localDb.notebooks.get(conflict.entityId);
    if (notebook) await localDb.notebooks.put({ ...notebook, syncStatus: 'conflict' });
  }
}

async function mergeRemoteNote(remote: Note, syncedAt: string): Promise<void> {
  const local = await localDb.notes.get(remote.id);
  const remoteLocal: LocalNote = {
    ...remote,
    syncStatus: 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notes.put(remoteLocal);
    return;
  }

  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(local, remote)
  ) {
    await saveConflict({
      id: newId(),
      entityType: 'note',
      entityId: remote.id,
      reason: 'remote_changed',
      local: {
        source: 'local',
        deviceId: local.deviceId,
        deviceName: (await getOrCreateDevice()).name,
        updatedAt: local.updatedAt,
        version: local.version,
        previewText: local.body.slice(0, 160) || 'Empty note',
        record: local
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: remote.deviceId,
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: remote.body.slice(0, 160) || 'Empty note',
        record: remote
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notes.put(remoteLocal);
  }
}

async function mergeRemoteNotebook(remote: Notebook, syncedAt: string): Promise<void> {
  const local = await localDb.notebooks.get(remote.id);
  const remoteLocal: LocalNotebook = {
    ...remote,
    syncStatus: 'synced',
    lastSyncedVersion: remote.version,
    lastSyncedAt: syncedAt
  };

  if (!local) {
    await localDb.notebooks.put(remoteLocal);
    return;
  }

  if (
    local.syncStatus === 'pending' &&
    local.lastSyncedVersion !== remote.version &&
    recordsDiffer(local, remote)
  ) {
    await saveConflict({
      id: newId(),
      entityType: 'notebook',
      entityId: remote.id,
      reason: 'remote_changed',
      local: {
        source: 'local',
        deviceId: local.deviceId,
        deviceName: (await getOrCreateDevice()).name,
        updatedAt: local.updatedAt,
        version: local.version,
        previewText: local.name,
        record: local
      },
      remote: {
        source: 'remote',
        deviceId: remote.deviceId,
        deviceName: remote.deviceId,
        updatedAt: remote.updatedAt,
        version: remote.version,
        previewText: remote.name,
        record: remote
      }
    });
    return;
  }

  if (local.syncStatus !== 'pending' && local.syncStatus !== 'conflict') {
    await localDb.notebooks.put(remoteLocal);
  }
}

export async function mergeRemoteChanges(
  notes: Note[],
  notebooks: Notebook[],
  syncedAt: string
): Promise<void> {
  for (const notebook of notebooks) {
    await mergeRemoteNotebook(notebook, syncedAt);
  }

  for (const note of notes) {
    await mergeRemoteNote(note, syncedAt);
  }
}

export async function resolveConflict(
  conflictId: string,
  choice: 'keep-newer' | 'keep-older' | 'keep-local' | 'keep-remote' | 'duplicate-both'
): Promise<void> {
  const localConflict = await localDb.conflicts.get(conflictId);
  if (!localConflict || localConflict.status === 'resolved') return;

  const conflict = localConflict.conflict;
  const device = await getOrCreateDevice();
  const now = nowIso();

  if (choice === 'duplicate-both') {
    if (conflict.entityType === 'note') {
      const remote = conflict.remote.record as Note;
      const local = conflict.local.record as Note;
      await localDb.notes.put({
        ...remote,
        syncStatus: 'synced',
        lastSyncedVersion: remote.version,
        lastSyncedAt: now
      });
      await localDb.notes.put({
        ...local,
        id: newId(),
        title: local.title ? `${local.title} copy` : '',
        createdAt: now,
        updatedAt: now,
        deviceId: device.id,
        version: 1,
        syncStatus: 'pending',
        lastSyncedVersion: 0,
        lastSyncedAt: null
      });
    } else {
      const remote = conflict.remote.record as Notebook;
      const local = conflict.local.record as Notebook;
      await localDb.notebooks.put({
        ...remote,
        syncStatus: 'synced',
        lastSyncedVersion: remote.version,
        lastSyncedAt: now
      });
      await localDb.notebooks.put({
        ...local,
        id: newId(),
        name: `${local.name} copy`,
        createdAt: now,
        updatedAt: now,
        deviceId: device.id,
        version: 1,
        syncStatus: 'pending',
        lastSyncedVersion: 0,
        lastSyncedAt: null
      });
    }
  } else {
    if (conflict.entityType === 'note') {
      const noteConflict = conflict as SyncConflict<Note>;
      const selected = chooseConflictVersion(noteConflict, choice);
      const record = selected.record as Note;
      const isRemote = selected.source === 'remote';
      await localDb.notes.put({
        ...record,
        deviceId: isRemote ? record.deviceId : device.id,
        version: isRemote ? noteConflict.remote.version : nextVersionAfter(noteConflict.remote.version),
        syncStatus: isRemote ? 'synced' : 'pending',
        lastSyncedVersion: noteConflict.remote.version,
        lastSyncedAt: isRemote ? now : null
      });
    } else {
      const notebookConflict = conflict as SyncConflict<Notebook>;
      const selected = chooseConflictVersion(notebookConflict, choice);
      const record = selected.record as Notebook;
      const isRemote = selected.source === 'remote';
      await localDb.notebooks.put({
        ...record,
        deviceId: isRemote ? record.deviceId : device.id,
        version: isRemote
          ? notebookConflict.remote.version
          : nextVersionAfter(notebookConflict.remote.version),
        syncStatus: isRemote ? 'synced' : 'pending',
        lastSyncedVersion: notebookConflict.remote.version,
        lastSyncedAt: isRemote ? now : null
      });
    }
  }

  await localDb.conflicts.put({ ...localConflict, status: 'resolved' });
}
