import type { SyncConflict } from '@author/api-types';
import type { Device, Note } from '@author/schema';
import {
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNotebook
} from './db';
import {
  decryptConflictForDisplay,
  encryptConflictForStorage,
  reencryptConflictForStorage
} from './conflict-crypto';
import {
  decryptNoteFields,
  encryptNoteFields,
  isEncryptedText,
  reencryptNoteFields
} from './encryption';
import {
  normalizeNotebookName,
  noteNotebookIds,
  primaryNotebookId
} from './note-utils';
import { getOrCreateDevice, newId, nowIso } from './local-state';

const ENCRYPTION_AUDIT_META_KEY = 'localEncryptionAuditVersion';
const ENCRYPTION_AUDIT_VERSION = 'notes-conflicts:v1';

const LOCAL_WORKSPACE_OWNER_KEY = 'localWorkspaceOwner';

function normalizeAccountUsername(username: string): string {
  return username.trim().toLowerCase();
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

  await localDb.notes.put(await encryptNoteFields(note));
  return note;
}

export async function createNotebook(
  name: string
): Promise<LocalNotebook | null> {
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
  await localDb.transaction(
    'rw',
    [localDb.notebooks, localDb.notes],
    async () => {
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
        .filter(
          (note) =>
            !note.deletedAt &&
            !note.trashedAt &&
            noteNotebookIds(note).includes(notebookId)
        )
        .map((note) => {
          const notebookIds = noteNotebookIds(note).filter(
            (id) => id !== notebookId
          );
          return {
            ...note,
            notebookIds,
            notebookId: primaryNotebookId(notebookIds),
            trashedAt: now,
            updatedAt: now,
            deviceId: device.id,
            version: note.version + 1,
            syncStatus: 'pending' as const
          };
        });

      if (updatedNotes.length) {
        await localDb.notes.bulkPut(updatedNotes);
      }
    }
  );
}

export async function notebookNameExists(
  name: string,
  excludeId?: string
): Promise<boolean> {
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

  await localDb.notes.put(await encryptNoteFields(updated));
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

  if (currentIds.join('\0') === notebookIds.join('\0'))
    return decryptNoteFields(note);

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
  return decryptNoteFields(updated);
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

export async function deleteNotePermanently(noteId: string): Promise<void> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return;

  const device = await getOrCreateDevice();
  const now = nowIso();
  await localDb.notes.put({
    ...note,
    deletedAt: now,
    trashedAt: note.trashedAt ?? now,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  });
}

export interface LastSyncPass {
  completedAt: string | null;
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface SyncDebugInfo {
  lastErrorAt: string | null;
  lastErrorMessage: string;
  lastErrorStack: string;
}

export async function recordLastSyncPass(
  stats: Omit<LastSyncPass, 'completedAt'>,
  completedAt = nowIso()
): Promise<void> {
  await localDb.syncMeta.bulkPut([
    { key: 'lastSyncPassAt', value: completedAt },
    { key: 'lastSyncPassPushed', value: String(stats.pushed) },
    { key: 'lastSyncPassPulled', value: String(stats.pulled) },
    { key: 'lastSyncPassConflicts', value: String(stats.conflicts) }
  ]);
}

export async function recordSyncError(
  error: unknown,
  source = 'Sync'
): Promise<void> {
  await localDb.syncMeta.bulkPut([
    { key: 'lastSyncErrorAt', value: nowIso() },
    { key: 'lastSyncErrorSource', value: source },
    { key: 'lastSyncErrorMessage', value: syncErrorMessage(error) },
    { key: 'lastSyncErrorStack', value: syncErrorStack(error) }
  ]);
}

export async function clearSyncError(): Promise<void> {
  await Promise.all([
    localDb.syncMeta.delete('lastSyncErrorAt'),
    localDb.syncMeta.delete('lastSyncErrorSource'),
    localDb.syncMeta.delete('lastSyncErrorMessage'),
    localDb.syncMeta.delete('lastSyncErrorStack')
  ]);
}

function syncMetaNumber(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadLastSyncPass(): Promise<LastSyncPass> {
  const [completedAt, pushed, pulled, conflicts] = await Promise.all([
    localDb.syncMeta.get('lastSyncPassAt'),
    localDb.syncMeta.get('lastSyncPassPushed'),
    localDb.syncMeta.get('lastSyncPassPulled'),
    localDb.syncMeta.get('lastSyncPassConflicts')
  ]);

  return {
    completedAt: completedAt?.value ?? null,
    pushed: syncMetaNumber(pushed?.value),
    pulled: syncMetaNumber(pulled?.value),
    conflicts: syncMetaNumber(conflicts?.value)
  };
}

export async function loadSyncDebugInfo(): Promise<SyncDebugInfo> {
  const [lastErrorAt, source, message, stack] = await Promise.all([
    localDb.syncMeta.get('lastSyncErrorAt'),
    localDb.syncMeta.get('lastSyncErrorSource'),
    localDb.syncMeta.get('lastSyncErrorMessage'),
    localDb.syncMeta.get('lastSyncErrorStack')
  ]);
  const prefix = source?.value ? `${source.value}: ` : '';

  return {
    lastErrorAt: lastErrorAt?.value ?? null,
    lastErrorMessage: message?.value ? `${prefix}${message.value}` : '',
    lastErrorStack: stack?.value ?? ''
  };
}

function syncErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return 'Sync failed';
}

function syncErrorStack(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

export async function loadNotes(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  const decrypted = await Promise.all(
    notes.map((note) => decryptNoteFields(note))
  );
  return decrypted
    .filter((note) => !note.deletedAt && !note.trashedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadTrash(): Promise<LocalNote[]> {
  const notes = await localDb.notes.toArray();
  const decrypted = await Promise.all(
    notes.map((note) => decryptNoteFields(note))
  );
  return decrypted
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
  const conflicts = await localDb.conflicts
    .where('status')
    .equals('pending')
    .sortBy('createdAt');
  return await Promise.all(
    conflicts.map(async (conflict) => ({
      ...conflict,
      conflict: await decryptConflictForDisplay(conflict.conflict)
    }))
  );
}

export async function loadDevices(): Promise<Device[]> {
  return localDb.devices.toArray();
}

export async function loadPendingSyncCount(): Promise<number> {
  const [notes, notebooks] = await Promise.all([
    localDb.notes.where('syncStatus').equals('pending').count(),
    localDb.notebooks.where('syncStatus').equals('pending').count()
  ]);
  return notes + notebooks;
}

export async function localWorkspaceHasUserData(): Promise<boolean> {
  const [notes, notebooks, conflicts] = await Promise.all([
    localDb.notes.count(),
    localDb.notebooks.count(),
    localDb.conflicts.count()
  ]);
  return notes + notebooks + conflicts > 0;
}

export async function rememberLocalWorkspaceAccount(
  username: string
): Promise<void> {
  const normalized = normalizeAccountUsername(username);
  if (!normalized) return;
  await localDb.syncMeta.put({
    key: LOCAL_WORKSPACE_OWNER_KEY,
    value: normalized
  });
}

async function localWorkspaceOwnerConflict(
  username: string,
  fallbackOwnerUsername?: string | null
): Promise<string | null> {
  const normalizedUsername = normalizeAccountUsername(username);
  const storedOwner =
    (await localDb.syncMeta.get(LOCAL_WORKSPACE_OWNER_KEY))?.value ?? null;
  const fallbackOwner = fallbackOwnerUsername
    ? normalizeAccountUsername(fallbackOwnerUsername)
    : null;
  const currentOwner = storedOwner ?? fallbackOwner;

  if (
    currentOwner &&
    currentOwner !== normalizedUsername &&
    (await localWorkspaceHasUserData())
  ) {
    return currentOwner;
  }

  return null;
}

export async function assertLocalWorkspaceCanUseAccount(
  username: string,
  fallbackOwnerUsername?: string | null
): Promise<void> {
  const conflictingOwner = await localWorkspaceOwnerConflict(
    username,
    fallbackOwnerUsername
  );
  if (!conflictingOwner) return;

  throw new Error(
    `This browser has local notes for ${conflictingOwner}. Sign in as ${conflictingOwner} before switching accounts.`
  );
}

export async function adoptLocalWorkspaceForAccount({
  username,
  fallbackOwnerUsername,
  previousMaterial,
  nextMaterial
}: {
  username: string;
  fallbackOwnerUsername?: string | null;
  previousMaterial: string;
  nextMaterial: string;
}): Promise<void> {
  const normalizedUsername = normalizeAccountUsername(username);
  await assertLocalWorkspaceCanUseAccount(username, fallbackOwnerUsername);
  await reencryptLocalNotes(previousMaterial, nextMaterial);
  await rememberLocalWorkspaceAccount(normalizedUsername);
}

export async function ensureLocalNotesEncrypted(): Promise<void> {
  const currentAudit = await localDb.syncMeta.get(ENCRYPTION_AUDIT_META_KEY);
  if (currentAudit?.value === ENCRYPTION_AUDIT_VERSION) return;

  const notes = await localDb.notes.toArray();
  const notesNeedingEncryption = notes.filter(
    (note) =>
      !isEncryptedText(note.title) ||
      !isEncryptedText(note.body) ||
      !note.titleHash ||
      !note.bodyHash
  );
  if (notesNeedingEncryption.length) {
    await saveEncryptionChanges(
      await Promise.all(
        notesNeedingEncryption.map(async (note) => ({
          before: note,
          after: await encryptNoteFields(await decryptNoteFields(note))
        }))
      )
    );
  }

  await ensureLocalConflictsEncrypted();
  await markEncryptionAuditCurrent();
}

export async function reencryptLocalNotes(
  previousMaterial: string,
  nextMaterial: string
): Promise<void> {
  if (previousMaterial === nextMaterial) return;

  const notes = await localDb.notes.toArray();
  if (notes.length) {
    await saveEncryptionChanges(
      await Promise.all(
        notes.map(async (note) => ({
          before: note,
          after: await reencryptNoteFields(note, previousMaterial, nextMaterial)
        }))
      )
    );
  }

  await reencryptLocalConflicts(previousMaterial, nextMaterial);
  await markEncryptionAuditCurrent();
}

async function markEncryptionAuditCurrent(): Promise<void> {
  await localDb.syncMeta.put({
    key: ENCRYPTION_AUDIT_META_KEY,
    value: ENCRYPTION_AUDIT_VERSION
  });
}

function encryptedFieldsChanged(before: LocalNote, after: LocalNote): boolean {
  return (
    before.title !== after.title ||
    before.body !== after.body ||
    (before.titleHash ?? null) !== (after.titleHash ?? null) ||
    (before.bodyHash ?? null) !== (after.bodyHash ?? null)
  );
}

async function saveEncryptionChanges(
  changes: Array<{ before: LocalNote; after: LocalNote }>
): Promise<void> {
  const changed = changes.filter(({ before, after }) =>
    encryptedFieldsChanged(before, after)
  );
  if (!changed.length) return;

  const device = await getOrCreateDevice();
  await localDb.notes.bulkPut(
    changed.map(({ before, after }) => ({
      ...after,
      deviceId: device.id,
      version: before.version + 1,
      syncStatus:
        before.syncStatus === 'conflict' || before.syncStatus === 'deleted'
          ? before.syncStatus
          : 'pending'
    }))
  );
}

function isNoteConflict(
  conflict: LocalConflict
): conflict is LocalConflict & { conflict: SyncConflict<Note> } {
  return (
    conflict.entityType === 'note' && conflict.conflict.entityType === 'note'
  );
}

function noteConflictNeedsEncryption(conflict: SyncConflict<Note>): boolean {
  const local = conflict.local.record;
  const remote = conflict.remote.record;
  return (
    conflict.local.previewText !== '' ||
    conflict.remote.previewText !== '' ||
    !isEncryptedText(local.title) ||
    !isEncryptedText(local.body) ||
    !local.titleHash ||
    !local.bodyHash ||
    !isEncryptedText(remote.title) ||
    !isEncryptedText(remote.body) ||
    !remote.titleHash ||
    !remote.bodyHash
  );
}

function conflictEncryptedFieldsChanged(
  before: LocalConflict,
  after: LocalConflict['conflict']
): boolean {
  if (
    before.entityType !== 'note' ||
    before.conflict.entityType !== 'note' ||
    after.entityType !== 'note'
  ) {
    return false;
  }
  const beforeConflict = before.conflict as SyncConflict<Note>;
  const afterConflict = after as SyncConflict<Note>;
  return (
    beforeConflict.local.previewText !== afterConflict.local.previewText ||
    beforeConflict.remote.previewText !== afterConflict.remote.previewText ||
    encryptedFieldsChanged(
      beforeConflict.local.record as LocalNote,
      afterConflict.local.record as LocalNote
    ) ||
    encryptedFieldsChanged(
      beforeConflict.remote.record as LocalNote,
      afterConflict.remote.record as LocalNote
    )
  );
}

async function saveConflictEncryptionChanges(
  changes: Array<{ before: LocalConflict; after: LocalConflict['conflict'] }>
): Promise<void> {
  const changed = changes.filter(({ before, after }) =>
    conflictEncryptedFieldsChanged(before, after)
  );
  if (!changed.length) return;

  await localDb.conflicts.bulkPut(
    changed.map(({ before, after }) => ({
      ...before,
      conflict: after
    }))
  );
}

async function ensureLocalConflictsEncrypted(): Promise<void> {
  const conflicts = await localDb.conflicts.toArray();
  const noteConflicts = conflicts.filter(
    (conflict) =>
      isNoteConflict(conflict) && noteConflictNeedsEncryption(conflict.conflict)
  );
  if (!noteConflicts.length) return;

  await saveConflictEncryptionChanges(
    await Promise.all(
      noteConflicts.map(async (conflict) => ({
        before: conflict,
        after: await encryptConflictForStorage(conflict.conflict)
      }))
    )
  );
}

async function reencryptLocalConflicts(
  previousMaterial: string,
  nextMaterial: string
): Promise<void> {
  const conflicts = (await localDb.conflicts.toArray()).filter(isNoteConflict);
  if (!conflicts.length) return;

  await saveConflictEncryptionChanges(
    await Promise.all(
      conflicts.map(async (conflict) => ({
        before: conflict,
        after: await reencryptConflictForStorage(
          conflict.conflict,
          previousMaterial,
          nextMaterial
        )
      }))
    )
  );
}
