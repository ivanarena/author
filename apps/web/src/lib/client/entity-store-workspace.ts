import { clearLocalWorkspace, localDb } from './db';
import {
  ENCRYPTION_DECRYPT_FAILED_MESSAGE,
  hasStoredEncryptionKeyMaterial
} from './encryption';
import { LOCAL_WORKSPACE_OWNER_KEY } from './entity-store-constants';
import {
  preflightReencryptLocalNotes,
  reencryptLocalNotes
} from './entity-store-encryption';

function normalizeAccountUsername(username: string): string {
  return username.trim().toLowerCase();
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

export async function localWorkspaceNeedsAccountUnlock(): Promise<boolean> {
  if (hasStoredEncryptionKeyMaterial()) return false;
  const owner = (
    await localDb.syncMeta.get(LOCAL_WORKSPACE_OWNER_KEY)
  )?.value.trim();
  return Boolean(owner && (await localWorkspaceHasUserData()));
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
  const adoptedPreviousMaterial = await preflightLocalWorkspaceAdoption(
    previousMaterial,
    nextMaterial
  );
  await reencryptLocalNotes(adoptedPreviousMaterial, nextMaterial);
  await rememberLocalWorkspaceAccount(normalizedUsername);
}

async function preflightLocalWorkspaceAdoption(
  previousMaterial: string,
  nextMaterial: string
): Promise<string> {
  try {
    await preflightReencryptLocalNotes(previousMaterial, nextMaterial);
    return previousMaterial;
  } catch (error) {
    if (
      previousMaterial !== nextMaterial &&
      error instanceof Error &&
      error.message === ENCRYPTION_DECRYPT_FAILED_MESSAGE
    ) {
      await preflightReencryptLocalNotes(nextMaterial, nextMaterial);
      return nextMaterial;
    }
    throw error;
  }
}
