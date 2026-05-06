import type { SyncConflict } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import { previewText } from '@author/sync-spec';
import { decryptNoteFields, encryptNoteFields } from './encryption';

type LocalSyncConflict = SyncConflict<Note> | SyncConflict<Notebook>;

function isNoteConflict(
  conflict: LocalSyncConflict
): conflict is SyncConflict<Note> {
  return conflict.entityType === 'note';
}

export async function encryptConflictForStorage(
  conflict: LocalSyncConflict,
  keyMaterial?: string
): Promise<LocalSyncConflict> {
  if (!isNoteConflict(conflict)) return conflict;

  const localPlain = await decryptNoteFields(
    conflict.local.record as Note,
    keyMaterial
  );
  const remotePlain = await decryptNoteFields(
    conflict.remote.record as Note,
    keyMaterial
  );
  const localRecord = await encryptNoteFields(localPlain, keyMaterial);
  const remoteRecord = await encryptNoteFields(remotePlain, keyMaterial);

  return {
    ...conflict,
    local: {
      ...conflict.local,
      previewText: '',
      record: localRecord
    },
    remote: {
      ...conflict.remote,
      previewText: '',
      record: remoteRecord
    }
  } satisfies SyncConflict<Note>;
}

export async function decryptConflictForDisplay(
  conflict: LocalSyncConflict,
  keyMaterial?: string
): Promise<LocalSyncConflict> {
  if (!isNoteConflict(conflict)) return conflict;

  const localRecord = await decryptNoteFields(
    conflict.local.record as Note,
    keyMaterial
  );
  const remoteRecord = await decryptNoteFields(
    conflict.remote.record as Note,
    keyMaterial
  );

  return {
    ...conflict,
    local: {
      ...conflict.local,
      previewText: previewText(localRecord),
      record: localRecord
    },
    remote: {
      ...conflict.remote,
      previewText: previewText(remoteRecord),
      record: remoteRecord
    }
  } satisfies SyncConflict<Note>;
}

export async function reencryptConflictForStorage(
  conflict: LocalSyncConflict,
  previousMaterial: string,
  nextMaterial: string
): Promise<LocalSyncConflict> {
  if (!isNoteConflict(conflict)) return conflict;

  const decrypted = await decryptConflictForDisplay(conflict, previousMaterial);
  return encryptConflictForStorage(decrypted, nextMaterial);
}
