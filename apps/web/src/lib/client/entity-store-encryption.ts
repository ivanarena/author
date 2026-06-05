import type { SyncConflict } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import {
  localDb,
  type LocalConflict,
  type LocalNote,
  type LocalNoteSnapshot,
  type LocalNotebook
} from './db';
import {
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
import { getOrCreateDevice } from './local-state';
import {
  ENCRYPTION_AUDIT_META_KEY,
  ENCRYPTION_AUDIT_VERSION
} from './entity-store-constants';

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
  const [notes, noteSnapshots, notebooks, conflicts] = await Promise.all([
    localDb.notes.toArray(),
    localDb.noteSnapshots.toArray(),
    localDb.notebooks.toArray(),
    localDb.conflicts.toArray()
  ]);
  assertNotesDoNotNeedLegacyMigration(notes);
  assertNotesDoNotNeedLegacyMigration(noteSnapshots);
  assertNotebooksDoNotNeedLegacyMigration(notebooks);
  for (const conflict of conflicts) {
    assertConflictDoesNotNeedLegacyMigration(conflict);
  }
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
