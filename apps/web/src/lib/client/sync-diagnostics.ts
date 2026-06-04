import { localDb, type LocalNote } from './db';
import { hasStoredEncryptionKeyMaterial } from './encryption';
import { recordDebugLog } from './debug-log';
import { noteNotebookIds, primaryNotebookId } from './note-utils';
import { getStoredSession, nowIso } from './local-state';
import {
  ENCRYPTION_AUDIT_META_KEY,
  ENCRYPTION_AUDIT_VERSION,
  LAST_PULL_CURSOR_RESET_KEY,
  LOCAL_WORKSPACE_OWNER_KEY
} from './entity-store-constants';

const VALID_SYNC_STATUSES = new Set([
  'synced',
  'pending',
  'conflict',
  'deleted'
]);

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

export type RepairDiagnosticStatus = 'ok' | 'warning' | 'error';

export interface RepairDiagnosticEntry {
  label: string;
  status: RepairDiagnosticStatus;
  detail: string;
}

export interface RepairDiagnostics {
  checkedAt: string;
  issueCount: number;
  canResetPullCursor: boolean;
  entries: RepairDiagnosticEntry[];
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

export async function loadRepairDiagnostics(): Promise<RepairDiagnostics> {
  const checkedAt = nowIso();
  const [
    notes,
    notebooks,
    noteSnapshots,
    conflicts,
    lastPulledRevision,
    lastPulledAt,
    encryptionAudit,
    workspaceOwner,
    lastCursorReset
  ] = await Promise.all([
    localDb.notes.toArray(),
    localDb.notebooks.toArray(),
    localDb.noteSnapshots.toArray(),
    localDb.conflicts.toArray(),
    localDb.syncMeta.get('lastPulledRevision'),
    localDb.syncMeta.get('lastPulledAt'),
    localDb.syncMeta.get(ENCRYPTION_AUDIT_META_KEY),
    localDb.syncMeta.get(LOCAL_WORKSPACE_OWNER_KEY),
    localDb.syncMeta.get(LAST_PULL_CURSOR_RESET_KEY)
  ]);
  const entries: RepairDiagnosticEntry[] = [];
  const storedSession = getStoredSession();
  const hasKeyMaterial = hasStoredEncryptionKeyMaterial();
  const hasLocalRecords =
    notes.length + notebooks.length + noteSnapshots.length + conflicts.length >
    0;
  const pendingCount =
    notes.filter((note) => note.syncStatus === 'pending').length +
    notebooks.filter((notebook) => notebook.syncStatus === 'pending').length;
  const pendingConflictCount = conflicts.filter(
    (conflict) => conflict.status === 'pending'
  ).length;
  const revisionRaw = lastPulledRevision?.value;
  const revisionValue =
    revisionRaw === undefined || revisionRaw === '' ? 0 : Number(revisionRaw);
  const revisionValid =
    Number.isSafeInteger(revisionValue) && revisionValue >= 0;
  const canResetPullCursor =
    Boolean(lastPulledAt?.value) ||
    (revisionRaw !== undefined && revisionRaw !== '0') ||
    !revisionValid;

  entries.push(
    diagnosticEntry(
      'Encryption key material',
      storedSession && !hasKeyMaterial ? 'error' : 'ok',
      storedSession && !hasKeyMaterial
        ? 'A signed-in browser has no note key material. Sign in again before syncing encrypted notes.'
        : hasKeyMaterial
          ? 'Key material is available for local encryption checks and sync.'
          : 'No account session is stored on this browser; local-only writing remains available.'
    )
  );

  entries.push(
    diagnosticEntry(
      'Encryption audit',
      encryptionAudit?.value === ENCRYPTION_AUDIT_VERSION || !hasLocalRecords
        ? 'ok'
        : 'warning',
      encryptionAudit?.value === ENCRYPTION_AUDIT_VERSION
        ? 'Stored notes, notebooks, recovery snapshots, and conflicts have passed the current local encryption audit.'
        : !hasLocalRecords
          ? 'No local note records need an encryption audit yet.'
          : hasKeyMaterial
            ? 'The next startup or sync will scan encrypted local records and repair current envelopes where possible.'
            : 'The local encryption audit is pending until key material is available.'
    )
  );

  entries.push(
    diagnosticEntry(
      'Pull cursor',
      revisionValid && !(lastPulledAt?.value && revisionValue === 0)
        ? 'ok'
        : 'warning',
      pullCursorDetail({
        revisionRaw,
        revisionValid,
        revisionValue,
        lastPulledAt: lastPulledAt?.value ?? null,
        lastCursorReset: lastCursorReset?.value ?? null
      })
    )
  );

  entries.push(
    diagnosticEntry(
      'Pending local changes',
      'ok',
      pendingCount === 1
        ? '1 local change is queued; local writes stay available while offline.'
        : `${pendingCount} local changes are queued; local writes stay available while offline.`
    )
  );

  entries.push(
    diagnosticEntry(
      'Pending conflicts',
      pendingConflictCount > 0 ? 'warning' : 'ok',
      pendingConflictCount === 0
        ? 'No unresolved sync conflicts are stored locally.'
        : pendingConflictCount === 1
          ? '1 explicit conflict is waiting for a choice; no side will be overwritten silently.'
          : `${pendingConflictCount} explicit conflicts are waiting for choices; no side will be overwritten silently.`
    )
  );

  const invalidRecordCount =
    notes.filter(invalidLocalSyncRecord).length +
    notebooks.filter(invalidLocalSyncRecord).length;
  entries.push(
    diagnosticEntry(
      'Local sync metadata',
      invalidRecordCount > 0 ? 'warning' : 'ok',
      invalidRecordCount === 0
        ? 'Record versions, base versions, and sync states are internally consistent.'
        : `${invalidRecordCount} records have inconsistent local sync metadata; export before manual repair.`
    )
  );

  const notebookLinkIssueCount = notes.filter(invalidNotebookLinks).length;
  entries.push(
    diagnosticEntry(
      'Notebook links',
      notebookLinkIssueCount > 0 ? 'warning' : 'ok',
      notebookLinkIssueCount === 0
        ? 'Note notebook assignments are normalized for sync.'
        : `${notebookLinkIssueCount} notes have denormalized notebook assignments.`
    )
  );

  entries.push(
    diagnosticEntry(
      'Workspace owner',
      'ok',
      workspaceOwner?.value
        ? `Local workspace is bound to ${workspaceOwner.value}.`
        : 'Local workspace is not bound to a remote account yet.'
    )
  );

  return {
    checkedAt,
    issueCount: entries.filter((entry) => entry.status !== 'ok').length,
    canResetPullCursor,
    entries
  };
}

export async function resetPullCursorRecovery(): Promise<void> {
  const resetAt = nowIso();
  await localDb.syncMeta.bulkPut([
    { key: 'lastPulledRevision', value: '0' },
    { key: LAST_PULL_CURSOR_RESET_KEY, value: resetAt }
  ]);
  await localDb.syncMeta.delete('lastPulledAt');
  recordDebugLog({
    level: 'warn',
    source: 'Sync',
    message: 'Pull cursor reset for recovery',
    detail: 'The next sync will request remote changes from revision 0.'
  });
}

function diagnosticEntry(
  label: string,
  status: RepairDiagnosticStatus,
  detail: string
): RepairDiagnosticEntry {
  return { label, status, detail };
}

function pullCursorDetail({
  revisionRaw,
  revisionValid,
  revisionValue,
  lastPulledAt,
  lastCursorReset
}: {
  revisionRaw: string | undefined;
  revisionValid: boolean;
  revisionValue: number;
  lastPulledAt: string | null;
  lastCursorReset: string | null;
}): string {
  if (!revisionValid) {
    return 'The stored pull cursor is invalid; reset it before the next recovery sync.';
  }
  if (lastPulledAt && revisionValue === 0) {
    return 'A legacy timestamp cursor is present without a revision cursor; reset it to force a revision-0 recovery pull.';
  }
  const cursor = revisionRaw === undefined ? 'none' : String(revisionValue);
  const resetCopy = lastCursorReset ? ` Last reset at ${lastCursorReset}.` : '';
  return `Cursor revision ${cursor} is ready for stable incremental pulls.${resetCopy}`;
}

function invalidLocalSyncRecord(record: {
  version: number;
  lastSyncedVersion: number;
  syncStatus: string;
}): boolean {
  if (!VALID_SYNC_STATUSES.has(record.syncStatus)) return true;
  if (!Number.isSafeInteger(record.version) || record.version < 0) return true;
  if (
    !Number.isSafeInteger(record.lastSyncedVersion) ||
    record.lastSyncedVersion < 0
  ) {
    return true;
  }
  if (
    record.syncStatus === 'pending' &&
    record.lastSyncedVersion > 0 &&
    record.version <= record.lastSyncedVersion
  ) {
    return true;
  }
  return (
    record.syncStatus === 'synced' && record.version < record.lastSyncedVersion
  );
}

function invalidNotebookLinks(note: LocalNote): boolean {
  const rawIds = Array.isArray(note.notebookIds)
    ? note.notebookIds.filter(Boolean)
    : note.notebookId
      ? [note.notebookId]
      : [];
  const normalizedIds = [...new Set(rawIds)];
  return (
    rawIds.length !== normalizedIds.length ||
    (note.notebookId ?? null) !== primaryNotebookId(normalizedIds) ||
    noteNotebookIds(note).join('\0') !== normalizedIds.join('\0')
  );
}
