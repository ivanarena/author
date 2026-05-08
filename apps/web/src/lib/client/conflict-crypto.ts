import type { SyncConflict } from '@author/api-types';
import type { Note, Notebook } from '@author/schema';
import { previewText } from '@author/sync-spec';
import {
  decryptNoteFields,
  decryptNotebookFields,
  encryptNoteFields,
  encryptNotebookFields
} from './encryption';

type LocalSyncConflict = SyncConflict<Note> | SyncConflict<Notebook>;

function isNoteConflict(
  conflict: LocalSyncConflict
): conflict is SyncConflict<Note> {
  return conflict.entityType === 'note';
}

function isNotebookConflict(
  conflict: LocalSyncConflict
): conflict is SyncConflict<Notebook> {
  return conflict.entityType === 'notebook';
}

export async function encryptConflictForStorage(
  conflict: LocalSyncConflict,
  keyMaterial?: string
): Promise<LocalSyncConflict> {
  if (isNoteConflict(conflict)) {
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

  if (isNotebookConflict(conflict)) {
    const localPlain = await decryptNotebookFields(
      conflict.local.record as Notebook,
      keyMaterial
    );
    const remotePlain = await decryptNotebookFields(
      conflict.remote.record as Notebook,
      keyMaterial
    );
    const localRecord = await encryptNotebookFields(localPlain, keyMaterial);
    const remoteRecord = await encryptNotebookFields(remotePlain, keyMaterial);

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
    } satisfies SyncConflict<Notebook>;
  }

  return conflict;
}

export async function decryptConflictForDisplay(
  conflict: LocalSyncConflict,
  keyMaterial?: string
): Promise<LocalSyncConflict> {
  if (isNoteConflict(conflict)) {
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

  if (isNotebookConflict(conflict)) {
    const localRecord = await decryptNotebookFields(
      conflict.local.record as Notebook,
      keyMaterial
    );
    const remoteRecord = await decryptNotebookFields(
      conflict.remote.record as Notebook,
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
    } satisfies SyncConflict<Notebook>;
  }

  return conflict;
}

export async function reencryptConflictForStorage(
  conflict: LocalSyncConflict,
  previousMaterial: string,
  nextMaterial: string
): Promise<LocalSyncConflict> {
  const decrypted = await decryptConflictForDisplay(conflict, previousMaterial);
  return encryptConflictForStorage(decrypted, nextMaterial);
}
