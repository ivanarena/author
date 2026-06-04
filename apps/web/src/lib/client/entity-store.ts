import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import {
  clearLocalWorkspace,
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNoteSnapshot,
  type LocalNoteSnapshotReason,
  type LocalNotebook
} from './db';
import {
  decryptConflictForDisplay,
  encryptConflictForStorage,
  reencryptConflictForStorage
} from './conflict-crypto';
import {
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE,
  assertSupportedEncryptionKeyMaterial,
  canDecryptEncryptedTextWithPrimaryMaterial,
  decryptNoteFields,
  decryptNotebookFields,
  encryptNoteFields,
  encryptNotebookFields,
  isCurrentEncryptedText,
  isCurrentFieldHash,
  isUnsupportedEncryptedText,
  notebookNameContext,
  reencryptNoteFields,
  reencryptNotebookFields
} from './encryption';
import {
  normalizeNotebookName,
  noteNotebookIds,
  primaryNotebookId
} from './note-utils';
import { getOrCreateDevice, newId, nowIso } from './local-state';
import {
  ENCRYPTION_AUDIT_META_KEY,
  ENCRYPTION_AUDIT_VERSION,
  LOCAL_WORKSPACE_OWNER_KEY
} from './entity-store-constants';

const MAX_LOCAL_NOTE_SNAPSHOTS_PER_NOTE = 50;

export * from './sync-diagnostics';

function normalizeAccountUsername(username: string): string {
  return username.trim().toLowerCase();
}

function isLocalOnlyRecord(record: {
  lastSyncedVersion?: number | null;
}): boolean {
  return Number(record.lastSyncedVersion) === 0;
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
    isFavorite: false,
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

  await localDb.notebooks.put(await encryptNotebookFields(notebook));
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
  const plainNotebook = await decryptNotebookFields(notebook);
  if (plainNotebook.name === trimmed) return plainNotebook;

  const device = await getOrCreateDevice();
  const updated: LocalNotebook = {
    ...plainNotebook,
    name: trimmed,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: notebook.version + 1,
    syncStatus: 'pending'
  };

  await localDb.notebooks.put(await encryptNotebookFields(updated));
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
      if (isLocalOnlyRecord(notebook)) {
        await localDb.notebooks.delete(notebookId);
      } else {
        await localDb.notebooks.put({
          ...notebook,
          deletedAt: now,
          updatedAt: now,
          deviceId: device.id,
          version: notebook.version + 1,
          syncStatus: 'pending'
        });
      }

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

  const notebooks = await Promise.all(
    (await localDb.notebooks.toArray()).map((notebook) =>
      decryptNotebookFields(notebook)
    )
  );
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

  const plainNote = await decryptNoteFields(note);
  const trimmedTitle = title.trim();
  if (plainNote.title === trimmedTitle && plainNote.body === body) {
    return plainNote;
  }

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    title: trimmedTitle,
    body,
    updatedAt: nowIso(),
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await recordLocalNoteSnapshot(note, 'edit');
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

export async function setNoteFavorite(
  noteId: string,
  isFavorite: boolean
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt) return note ?? null;
  if (Boolean(note.isFavorite) === isFavorite) {
    return decryptNoteFields(note);
  }

  const device = await getOrCreateDevice();
  const updated: LocalNote = {
    ...note,
    isFavorite,
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
  await recordLocalNoteSnapshot(note, 'trash');
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
  await recordLocalNoteSnapshot(note, 'restore');
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

  await deleteLocalNoteSnapshots(noteId);
  if (isLocalOnlyRecord(note)) {
    await localDb.notes.delete(noteId);
    return;
  }

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

export async function loadNoteSnapshots(
  noteId: string,
  limit = 20
): Promise<LocalNoteSnapshot[]> {
  const snapshots = await localDb.noteSnapshots
    .where('id')
    .equals(noteId)
    .toArray();
  const sorted = sortLocalNoteSnapshots(snapshots).slice(0, limit);
  return Promise.all(sorted.map((snapshot) => decryptNoteFields(snapshot)));
}

export async function restoreLatestNoteSnapshot(
  noteId: string
): Promise<LocalNote | null> {
  const [snapshot] = await loadNoteSnapshots(noteId, 1);
  if (!snapshot) return null;
  return restoreLoadedNoteSnapshot(noteId, snapshot);
}

export async function restoreNoteSnapshot(
  noteId: string,
  snapshotId: string
): Promise<LocalNote | null> {
  const storedSnapshot = await localDb.noteSnapshots.get(snapshotId);
  if (!storedSnapshot || storedSnapshot.id !== noteId) return null;
  const snapshot = await decryptNoteFields(storedSnapshot);
  return restoreLoadedNoteSnapshot(noteId, snapshot);
}

async function restoreLoadedNoteSnapshot(
  noteId: string,
  snapshot: LocalNoteSnapshot
): Promise<LocalNote | null> {
  const note = await localDb.notes.get(noteId);
  if (!note || note.deletedAt || note.trashedAt) return null;

  const device = await getOrCreateDevice();
  const now = nowIso();
  const updated: LocalNote = {
    ...note,
    title: snapshot.title,
    body: snapshot.body,
    updatedAt: now,
    deviceId: device.id,
    version: note.version + 1,
    syncStatus: 'pending'
  };

  await recordLocalNoteSnapshot(note, 'restore');
  await localDb.notes.put(await encryptNoteFields(updated));
  return updated;
}

async function recordLocalNoteSnapshot(
  note: LocalNote,
  reason: LocalNoteSnapshotReason
): Promise<void> {
  if (note.deletedAt) return;

  const savedAt = nowIso();
  const snapshot: LocalNoteSnapshot = {
    ...note,
    snapshotId: newId(),
    savedAt,
    reason
  };
  await localDb.noteSnapshots.put(await encryptNoteFields(snapshot));
  await pruneLocalNoteSnapshots(note.id);
}

async function pruneLocalNoteSnapshots(noteId: string): Promise<void> {
  const snapshots = await localDb.noteSnapshots
    .where('id')
    .equals(noteId)
    .toArray();
  const expired = sortLocalNoteSnapshots(snapshots).slice(
    MAX_LOCAL_NOTE_SNAPSHOTS_PER_NOTE
  );
  if (!expired.length) return;
  await localDb.noteSnapshots.bulkDelete(
    expired.map((snapshot) => snapshot.snapshotId)
  );
}

async function deleteLocalNoteSnapshots(noteId: string): Promise<void> {
  await localDb.noteSnapshots.where('id').equals(noteId).delete();
}

function sortLocalNoteSnapshots(
  snapshots: LocalNoteSnapshot[]
): LocalNoteSnapshot[] {
  return [...snapshots].sort(
    (a, b) =>
      b.savedAt.localeCompare(a.savedAt) ||
      b.snapshotId.localeCompare(a.snapshotId)
  );
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
  const decrypted = await Promise.all(
    notebooks.map((notebook) => decryptNotebookFields(notebook))
  );
  return decrypted
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
  const [notes, notebooks, noteSnapshots, conflicts] = await Promise.all([
    localDb.notes.count(),
    localDb.notebooks.count(),
    localDb.noteSnapshots.count(),
    localDb.conflicts.count()
  ]);
  return notes + notebooks + noteSnapshots + conflicts > 0;
}

async function localWorkspaceHasUnsyncedUserData(): Promise<boolean> {
  const [notes, notebooks, noteSnapshots, conflicts] = await Promise.all([
    localDb.notes.toArray(),
    localDb.notebooks.toArray(),
    localDb.noteSnapshots.toArray(),
    localDb.conflicts.toArray()
  ]);
  return (
    noteSnapshots.length > 0 ||
    notes.some((note) => note.syncStatus !== 'synced') ||
    notebooks.some((notebook) => notebook.syncStatus !== 'synced') ||
    conflicts.some((conflict) => conflict.status !== 'resolved')
  );
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
  if (!(await localWorkspaceHasUnsyncedUserData())) return;

  throw new Error(
    `Local notes in this browser belong to ${conflictingOwner}. Sign in as ${conflictingOwner} to sync or export them before using another account here. If this is only test data, clear this site's local data first.`
  );
}

export async function prepareLocalWorkspaceForAccount(
  username: string,
  fallbackOwnerUsername?: string | null
): Promise<{ cleared: boolean; previousOwner: string | null }> {
  const conflictingOwner = await localWorkspaceOwnerConflict(
    username,
    fallbackOwnerUsername
  );
  if (!conflictingOwner) return { cleared: false, previousOwner: null };

  await assertLocalWorkspaceCanUseAccount(username, fallbackOwnerUsername);
  await clearLocalWorkspace();
  return { cleared: true, previousOwner: conflictingOwner };
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
  assertSupportedEncryptionKeyMaterial();
  const currentAudit = await localDb.syncMeta.get(ENCRYPTION_AUDIT_META_KEY);
  if (currentAudit?.value === ENCRYPTION_AUDIT_VERSION) return;

  const notes = await localDb.notes.toArray();
  assertNotesDoNotNeedLegacyMigration(notes);
  const noteEncryptionChecks = await Promise.all(
    notes.map(async (note) => ({
      note,
      titleDecrypts: await canDecryptEncryptedTextWithPrimaryMaterial(
        note.title,
        undefined,
        `note:${note.id}:title`
      ),
      bodyDecrypts: await canDecryptEncryptedTextWithPrimaryMaterial(
        note.body,
        undefined,
        `note:${note.id}:body`
      )
    }))
  );
  const notesNeedingEncryption = noteEncryptionChecks
    .filter(
      ({ note, titleDecrypts, bodyDecrypts }) =>
        !isCurrentEncryptedText(note.title) ||
        !titleDecrypts ||
        !isCurrentEncryptedText(note.body) ||
        !bodyDecrypts ||
        !isCurrentFieldHash(note.titleHash) ||
        !isCurrentFieldHash(note.bodyHash)
    )
    .map(({ note }) => note);
  if (notesNeedingEncryption.length) {
    await saveNoteEncryptionChanges(
      await Promise.all(
        notesNeedingEncryption.map(async (note) => ({
          before: note,
          after: await encryptNoteFields(await decryptNoteFields(note))
        }))
      )
    );
  }

  const noteSnapshots = await localDb.noteSnapshots.toArray();
  assertNotesDoNotNeedLegacyMigration(noteSnapshots);
  const noteSnapshotEncryptionChecks = await Promise.all(
    noteSnapshots.map(async (snapshot) => ({
      snapshot,
      titleDecrypts: await canDecryptEncryptedTextWithPrimaryMaterial(
        snapshot.title,
        undefined,
        `note:${snapshot.id}:title`
      ),
      bodyDecrypts: await canDecryptEncryptedTextWithPrimaryMaterial(
        snapshot.body,
        undefined,
        `note:${snapshot.id}:body`
      )
    }))
  );
  const noteSnapshotsNeedingEncryption = noteSnapshotEncryptionChecks
    .filter(
      ({ snapshot, titleDecrypts, bodyDecrypts }) =>
        !isCurrentEncryptedText(snapshot.title) ||
        !titleDecrypts ||
        !isCurrentEncryptedText(snapshot.body) ||
        !bodyDecrypts ||
        !isCurrentFieldHash(snapshot.titleHash) ||
        !isCurrentFieldHash(snapshot.bodyHash)
    )
    .map(({ snapshot }) => snapshot);
  if (noteSnapshotsNeedingEncryption.length) {
    await saveNoteSnapshotEncryptionChanges(
      await Promise.all(
        noteSnapshotsNeedingEncryption.map(async (snapshot) => ({
          before: snapshot,
          after: await encryptNoteFields(await decryptNoteFields(snapshot))
        }))
      )
    );
  }

  const notebooks = await localDb.notebooks.toArray();
  assertNotebooksDoNotNeedLegacyMigration(notebooks);
  const notebookEncryptionChecks = await Promise.all(
    notebooks.map(async (notebook) => ({
      notebook,
      nameDecrypts: await canDecryptEncryptedTextWithPrimaryMaterial(
        notebook.name,
        undefined,
        notebookNameContext(notebook)
      )
    }))
  );
  const notebooksNeedingEncryption = notebookEncryptionChecks
    .filter(
      ({ notebook, nameDecrypts }) =>
        !isCurrentEncryptedText(notebook.name) ||
        !nameDecrypts ||
        !isCurrentFieldHash(notebook.nameHash)
    )
    .map(({ notebook }) => notebook);
  if (notebooksNeedingEncryption.length) {
    await saveNotebookEncryptionChanges(
      await Promise.all(
        notebooksNeedingEncryption.map(async (notebook) => ({
          before: notebook,
          after: await encryptNotebookFields(
            await decryptNotebookFields(notebook)
          )
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
    await saveNoteEncryptionChanges(
      await Promise.all(
        notes.map(async (note) => ({
          before: note,
          after: await reencryptNoteFields(note, previousMaterial, nextMaterial)
        }))
      )
    );
  }

  const noteSnapshots = await localDb.noteSnapshots.toArray();
  if (noteSnapshots.length) {
    await saveNoteSnapshotEncryptionChanges(
      await Promise.all(
        noteSnapshots.map(async (snapshot) => ({
          before: snapshot,
          after: await reencryptNoteFields(
            snapshot,
            previousMaterial,
            nextMaterial
          )
        }))
      )
    );
  }

  const notebooks = await localDb.notebooks.toArray();
  if (notebooks.length) {
    await saveNotebookEncryptionChanges(
      await Promise.all(
        notebooks.map(async (notebook) => ({
          before: notebook,
          after: await reencryptNotebookFields(
            notebook,
            previousMaterial,
            nextMaterial
          )
        }))
      )
    );
  }

  await reencryptLocalConflicts(previousMaterial, nextMaterial);
  await markEncryptionAuditCurrent();
}

export async function preflightReencryptLocalNotes(
  previousMaterial: string,
  nextMaterial: string
): Promise<void> {
  if (previousMaterial === nextMaterial) return;

  const [notes, noteSnapshots, notebooks, conflicts] = await Promise.all([
    localDb.notes.toArray(),
    localDb.noteSnapshots.toArray(),
    localDb.notebooks.toArray(),
    localDb.conflicts.toArray()
  ]);
  await Promise.all(
    notes.map((note) =>
      reencryptNoteFields(note, previousMaterial, nextMaterial)
    )
  );
  await Promise.all(
    noteSnapshots.map((snapshot) =>
      reencryptNoteFields(snapshot, previousMaterial, nextMaterial)
    )
  );
  await Promise.all(
    notebooks.map((notebook) =>
      reencryptNotebookFields(notebook, previousMaterial, nextMaterial)
    )
  );
  await Promise.all(
    conflicts
      .filter(
        (conflict) => isNoteConflict(conflict) || isNotebookConflict(conflict)
      )
      .map((conflict) =>
        reencryptConflictForStorage(
          conflict.conflict,
          previousMaterial,
          nextMaterial
        )
      )
  );
}

async function markEncryptionAuditCurrent(): Promise<void> {
  await localDb.syncMeta.put({
    key: ENCRYPTION_AUDIT_META_KEY,
    value: ENCRYPTION_AUDIT_VERSION
  });
}

function noteEncryptedFieldsChanged(before: Note, after: Note): boolean {
  return (
    before.title !== after.title ||
    before.body !== after.body ||
    (before.titleHash ?? null) !== (after.titleHash ?? null) ||
    (before.bodyHash ?? null) !== (after.bodyHash ?? null)
  );
}

function notebookEncryptedFieldsChanged(
  before: LocalNotebook,
  after: LocalNotebook
): boolean {
  return (
    before.name !== after.name ||
    (before.nameHash ?? null) !== (after.nameHash ?? null)
  );
}

async function saveNoteEncryptionChanges(
  changes: Array<{ before: LocalNote; after: LocalNote }>
): Promise<void> {
  const changed = changes.filter(({ before, after }) =>
    noteEncryptedFieldsChanged(before, after)
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

async function saveNoteSnapshotEncryptionChanges(
  changes: Array<{ before: LocalNoteSnapshot; after: LocalNoteSnapshot }>
): Promise<void> {
  const changed = changes.filter(({ before, after }) =>
    noteEncryptedFieldsChanged(before, after)
  );
  if (!changed.length) return;

  await localDb.noteSnapshots.bulkPut(changed.map(({ after }) => after));
}

async function saveNotebookEncryptionChanges(
  changes: Array<{ before: LocalNotebook; after: LocalNotebook }>
): Promise<void> {
  const changed = changes.filter(({ before, after }) =>
    notebookEncryptedFieldsChanged(before, after)
  );
  if (!changed.length) return;

  const device = await getOrCreateDevice();
  await localDb.notebooks.bulkPut(
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

function isNotebookConflict(
  conflict: LocalConflict
): conflict is LocalConflict & { conflict: SyncConflict<Notebook> } {
  return (
    conflict.entityType === 'notebook' &&
    conflict.conflict.entityType === 'notebook'
  );
}

function noteConflictNeedsEncryption(conflict: SyncConflict<Note>): boolean {
  const local = conflict.local.record;
  const remote = conflict.remote.record;
  return (
    conflict.local.previewText !== '' ||
    conflict.remote.previewText !== '' ||
    !isCurrentEncryptedText(local.title) ||
    !isCurrentEncryptedText(local.body) ||
    !isCurrentFieldHash(local.titleHash) ||
    !isCurrentFieldHash(local.bodyHash) ||
    !isCurrentEncryptedText(remote.title) ||
    !isCurrentEncryptedText(remote.body) ||
    !isCurrentFieldHash(remote.titleHash) ||
    !isCurrentFieldHash(remote.bodyHash)
  );
}

function notebookConflictNeedsEncryption(
  conflict: SyncConflict<Notebook>
): boolean {
  const local = conflict.local.record;
  const remote = conflict.remote.record;
  return (
    conflict.local.previewText !== '' ||
    conflict.remote.previewText !== '' ||
    !isCurrentEncryptedText(local.name) ||
    !isCurrentFieldHash(local.nameHash) ||
    !isCurrentEncryptedText(remote.name) ||
    !isCurrentFieldHash(remote.nameHash)
  );
}

function assertSupportedEncryptedText(value: string): void {
  if (isUnsupportedEncryptedText(value)) {
    throw new Error(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE);
  }
}

function assertNotesDoNotNeedLegacyMigration(notes: Note[]): void {
  for (const note of notes) {
    assertSupportedEncryptedText(note.title);
    assertSupportedEncryptedText(note.body);
  }
}

function assertNotebooksDoNotNeedLegacyMigration(
  notebooks: LocalNotebook[]
): void {
  for (const notebook of notebooks) {
    assertSupportedEncryptedText(notebook.name);
  }
}

function assertConflictDoesNotNeedLegacyMigration(
  conflict: LocalConflict
): void {
  if (isNoteConflict(conflict)) {
    assertSupportedEncryptedText(conflict.conflict.local.record.title);
    assertSupportedEncryptedText(conflict.conflict.local.record.body);
    assertSupportedEncryptedText(conflict.conflict.remote.record.title);
    assertSupportedEncryptedText(conflict.conflict.remote.record.body);
    return;
  }
  if (isNotebookConflict(conflict)) {
    assertSupportedEncryptedText(conflict.conflict.local.record.name);
    assertSupportedEncryptedText(conflict.conflict.remote.record.name);
  }
}

function conflictEncryptedFieldsChanged(
  before: LocalConflict,
  after: LocalConflict['conflict']
): boolean {
  if (before.entityType === 'note') {
    if (before.conflict.entityType !== 'note' || after.entityType !== 'note') {
      return false;
    }
    const beforeConflict = before.conflict as SyncConflict<Note>;
    const afterConflict = after as SyncConflict<Note>;
    return (
      beforeConflict.local.previewText !== afterConflict.local.previewText ||
      beforeConflict.remote.previewText !== afterConflict.remote.previewText ||
      noteEncryptedFieldsChanged(
        beforeConflict.local.record as LocalNote,
        afterConflict.local.record as LocalNote
      ) ||
      noteEncryptedFieldsChanged(
        beforeConflict.remote.record as LocalNote,
        afterConflict.remote.record as LocalNote
      )
    );
  }

  if (before.entityType === 'notebook') {
    if (
      before.conflict.entityType !== 'notebook' ||
      after.entityType !== 'notebook'
    ) {
      return false;
    }
    const beforeConflict = before.conflict as SyncConflict<Notebook>;
    const afterConflict = after as SyncConflict<Notebook>;
    return (
      beforeConflict.local.previewText !== afterConflict.local.previewText ||
      beforeConflict.remote.previewText !== afterConflict.remote.previewText ||
      notebookEncryptedFieldsChanged(
        beforeConflict.local.record as LocalNotebook,
        afterConflict.local.record as LocalNotebook
      ) ||
      notebookEncryptedFieldsChanged(
        beforeConflict.remote.record as LocalNotebook,
        afterConflict.remote.record as LocalNotebook
      )
    );
  }

  return false;
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
  for (const conflict of conflicts) {
    assertConflictDoesNotNeedLegacyMigration(conflict);
  }
  const conflictsNeedingEncryption = conflicts.filter(
    (conflict) =>
      (isNoteConflict(conflict) &&
        noteConflictNeedsEncryption(conflict.conflict)) ||
      (isNotebookConflict(conflict) &&
        notebookConflictNeedsEncryption(conflict.conflict))
  );
  if (!conflictsNeedingEncryption.length) return;

  await saveConflictEncryptionChanges(
    await Promise.all(
      conflictsNeedingEncryption.map(async (conflict) => ({
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
  const conflicts = (await localDb.conflicts.toArray()).filter(
    (conflict) => isNoteConflict(conflict) || isNotebookConflict(conflict)
  );
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
