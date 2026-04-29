import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import { chooseConflictVersion, nextVersionAfter, recordsDiffer } from '@author/sync-spec';
import { localDb, type LocalConflict, type LocalNote, type LocalNotebook } from './db';

const DEVICE_KEY = 'author-notes-device-id';
const TOKEN_KEY = 'author-notes-token';
const THEME_KEY = 'author-notes-theme';

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
  const note: LocalNote = {
    id: newId(),
    title: (initial.title ?? '').trim(),
    body: initial.body ?? '',
    notebookId: initial.notebookId ?? null,
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

    const assignedNotes = await localDb.notes.where('notebookId').equals(notebookId).toArray();
    const updatedNotes = assignedNotes
      .filter((note) => !note.deletedAt)
      .map((note) => ({
        ...note,
        notebookId: null,
        updatedAt: now,
        deviceId: device.id,
        version: note.version + 1,
        syncStatus: 'pending' as const
      }));

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
  notebookId: string | null
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt || note.notebookId === notebookId) return note ?? null;

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    notebookId,
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
