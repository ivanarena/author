import type { RemoteSyncState, TrustedAuthDevice } from '@author/api-types';
import {
  AuthError,
  SyncHttpError,
  loadAccount,
  loadSyncStatus,
  validateSession
} from '$lib/client/api-client';
import { recordDebugLog } from '$lib/client/debug-log';
import { hasStoredEncryptionKeyMaterial } from '$lib/client/encryption';
import {
  clearSyncError,
  getStoredSession,
  recordLastSyncPass,
  recordSyncError,
  rememberLocalWorkspaceAccount,
  resolveConflict,
  setStoredSession
} from '$lib/client/store';
import { runSync, type SyncProgress } from '$lib/client/sync';
import { syncProgressCopy } from '../copy';
import type { AppNotification, ConflictChoice } from '../models';

// Push responses that reject the content: retrying on a timer would resend
// the same data, so the next attempt waits for an edit, focus, or the regular
// online interval instead.
const REJECTED_SYNC_STATUSES = new Set([400, 409, 413]);
const REJECTED_SYNC_BACKOFF_MS = 60_000;
const MAX_REJECTED_SYNC_BACKOFF_MS = 15 * 60_000;
// The server's push rate limit uses a one-minute window.
const RATE_LIMITED_RETRY_MS = 60_000;
const UNSYNCABLE_DETAIL =
  'A note or notebook name is larger than the server accepts. Split long notes or shorten long notebook names. Changes stay saved on this device.';

interface LastSyncPass {
  completedAt: string | null;
  pushed: number;
  pulled: number;
  conflicts: number;
}

interface ClearLocalSessionOptions {
  accountMessage?: string;
  clearEncryptionKeyMaterial?: boolean;
  openLogin?: boolean;
  syncMessage?: string;
}

export interface NotesSyncActionController {
  accountDisplayName: string;
  accountProfileImage: string;
  accountEmail: string;
  accountTrustedDevices: TrustedAuthDevice[];
  accountTwoFactorEnabled: boolean;
  accountUsername: string;
  activeConflict: { id: string } | null;
  autoSyncTimer: ReturnType<typeof setTimeout> | null;
  /** When the current debounced sync wait began; bounds how long it can slip. */
  autoSyncWaitStartedAt: number | null;
  /** True while the scheduled sync is an immediate request. */
  autoSyncUrgent: boolean;
  hasToken: boolean;
  isArchiveBusy: boolean;
  isBrowserOnline: boolean;
  isSyncing: boolean;
  lastSyncPass: LastSyncPass;
  pendingSyncCount: number;
  remoteStatusTimer: ReturnType<typeof setTimeout> | null;
  remoteSyncEnabled: boolean;
  remoteSyncError: string;
  remoteSyncState: RemoteSyncState | 'unknown';
  retrySyncTimer: ReturnType<typeof setTimeout> | null;
  syncActivityDetail: string;
  syncActivityLabel: string;
  syncMessage: string;
  syncQueued: boolean;
  /** Pending records that were too large to push in the last sync. */
  unsyncableCount: number;
  /** Message of the last push the server rejected, to avoid repeat toasts. */
  lastSyncRejection: string;
  /** Consecutive rejected syncs, for the automatic-sync backoff. */
  syncRejectionCount: number;
  /**
   * Until this time, automatic syncs from the interval, focus, and visibility
   * triggers are skipped after a rejected push. Edits and manual syncs still
   * run.
   */
  syncBackoffUntil: number;

  clearLocalSession: (options?: ClearLocalSessionOptions) => void;
  expireSession: (message?: string) => void;
  flushPendingSave: () => Promise<void>;
  handleSyncError: (
    error: unknown,
    options?: { pullOnly?: boolean }
  ) => Promise<void>;
  notify: (
    kind: AppNotification['kind'],
    title: string,
    message?: string
  ) => void;
  refresh: () => Promise<void>;
  refreshAccount: (token?: string | null) => Promise<void>;
  refreshRemoteSyncStatus: (token?: string | null) => Promise<void>;
  scheduleSync: (delayMs?: number) => void;
  scheduleSyncRetry: (delayMs?: number) => void;
  syncNow: (options?: { pullOnly?: boolean }) => Promise<void>;
  updateSyncProgress: (progress: SyncProgress) => void;
}

export async function syncNow(
  controller: NotesSyncActionController,
  { pullOnly = false }: { pullOnly?: boolean } = {}
): Promise<void> {
  if (controller.isArchiveBusy) {
    controller.syncQueued = true;
    controller.syncMessage = 'Sync paused during import/export';
    return;
  }
  const token = getStoredSession()?.token ?? null;
  controller.hasToken = Boolean(token);
  if (!token) return;
  if (!hasStoredEncryptionKeyMaterial()) {
    controller.expireSession('Sign in again to sync encrypted notes');
    return;
  }
  if (!controller.isBrowserOnline) {
    controller.syncMessage = 'Offline';
    return;
  }
  if (controller.isSyncing) {
    controller.syncQueued = true;
    return;
  }

  await controller.flushPendingSave();
  recordDebugLog({
    level: 'info',
    source: 'Sync',
    message: 'Sync started'
  });

  // A pull-only sync must not cancel a scheduled full sync: that one still has
  // to push pending edits or retry after a rate limit.
  if (!pullOnly && controller.autoSyncTimer) {
    clearTimeout(controller.autoSyncTimer);
    controller.autoSyncTimer = null;
  }
  if (!pullOnly && controller.retrySyncTimer) {
    clearTimeout(controller.retrySyncTimer);
    controller.retrySyncTimer = null;
  }
  controller.isSyncing = true;
  controller.updateSyncProgress({ phase: 'preparing' });
  let syncCompleted = false;
  try {
    const result = await runSync(
      token,
      controller.updateSyncProgress,
      pullOnly ? { push: false } : {}
    );
    if (!pullOnly) {
      controller.lastSyncRejection = '';
      controller.syncRejectionCount = 0;
      controller.syncBackoffUntil = 0;
    }
    const unsyncableMessage =
      result.unsyncable > 0
        ? `${result.unsyncable} ${result.unsyncable === 1 ? 'change' : 'changes'} can't sync`
        : '';
    controller.syncMessage =
      result.conflicts > 0
        ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
        : (pullOnly && controller.lastSyncRejection) ||
          unsyncableMessage ||
          'Local changes saved';
    if (
      result.unsyncable > 0 &&
      result.unsyncable !== controller.unsyncableCount
    ) {
      controller.notify(
        'error',
        'Some changes are too large to sync',
        UNSYNCABLE_DETAIL
      );
    }
    controller.unsyncableCount = result.unsyncable;
    controller.lastSyncPass = {
      completedAt: new Date().toISOString(),
      pushed: result.pushed,
      pulled: result.pulled,
      conflicts: result.conflicts
    };
    // Keep the recorded rejection while its changes are still held back.
    if (!pullOnly) await clearSyncError();
    await recordLastSyncPass(controller.lastSyncPass);
    await controller.refresh();
    await controller.refreshRemoteSyncStatus(token);
    pollRemoteSyncStatusIfBusy(controller);
    recordDebugLog({
      level: 'info',
      source: 'Sync',
      message: 'Sync completed',
      detail: {
        pushed: result.pushed,
        pulled: result.pulled,
        conflicts: result.conflicts
      }
    });
    syncCompleted = true;
  } catch (error) {
    await controller.handleSyncError(error, { pullOnly });
  } finally {
    controller.isSyncing = false;
    controller.syncActivityLabel = '';
    controller.syncActivityDetail = '';
    // Follow-up syncs are debounced like edits, so continuous typing does not
    // turn into back-to-back pushes. Records too large to push stay pending
    // and must not keep re-triggering syncs on their own.
    // A pull-only sync leaves rejected changes pending on purpose; only a
    // request queued during it (for example a new edit) triggers a push.
    const shouldSyncAgain =
      syncCompleted &&
      (controller.syncQueued ||
        (!pullOnly &&
          controller.pendingSyncCount > controller.unsyncableCount));
    // A request queued during a failed pull-only sync (an edit, or a
    // rate-limit retry that fired) must still push; retry it after a delay.
    const retryQueuedPush = pullOnly && !syncCompleted && controller.syncQueued;
    controller.syncQueued = false;
    if (shouldSyncAgain) {
      controller.scheduleSync();
    } else if (retryQueuedPush) {
      controller.scheduleSyncRetry();
    }
  }
}

export async function resolveActiveConflict(
  controller: NotesSyncActionController,
  choice: ConflictChoice
): Promise<void> {
  if (!controller.activeConflict) return;
  await resolveConflict(controller.activeConflict.id, choice);
  await controller.refresh();
  await controller.syncNow();
}

export async function refreshAccount(
  controller: NotesSyncActionController,
  token = getStoredSession()?.token ?? null
): Promise<void> {
  if (!token || !controller.hasToken) return;
  try {
    const account = await loadAccount(token);
    const storedSession = getStoredSession();
    controller.accountUsername = account.user.username;
    controller.accountEmail = account.user.email ?? '';
    controller.accountDisplayName = account.user.displayName ?? '';
    controller.accountProfileImage = account.user.profileImage ?? '';
    controller.accountTwoFactorEnabled = account.user.twoFactorEnabled;
    controller.accountTrustedDevices = account.trustedDevices ?? [];
    setStoredSession({
      token,
      user: account.user,
      expiresAt: storedSession?.expiresAt ?? null
    });
  } catch (error) {
    if (error instanceof AuthError) {
      controller.expireSession('Sign in again to sync encrypted notes');
    }
  }
}

export async function resumeOnlineSession(
  controller: NotesSyncActionController,
  token = getStoredSession()?.token ?? null
): Promise<void> {
  if (!token) {
    controller.hasToken = false;
    return;
  }

  if (!hasStoredEncryptionKeyMaterial()) {
    controller.expireSession('Sign in again to sync encrypted notes');
    return;
  }

  try {
    const session = await validateSession(token);
    controller.hasToken = true;
    controller.accountUsername = session.user.username;
    controller.accountEmail = session.user.email ?? '';
    controller.accountDisplayName = session.user.displayName ?? '';
    controller.accountProfileImage = session.user.profileImage ?? '';
    controller.accountTwoFactorEnabled = session.user.twoFactorEnabled;
    setStoredSession({
      token,
      user: session.user,
      expiresAt: session.expiresAt
    });
    await rememberLocalWorkspaceAccount(session.user.username);
    void controller.refreshAccount(token);
    if (!controller.isBrowserOnline) {
      controller.syncMessage = 'Offline';
      return;
    }
    await controller.syncNow();
  } catch (error) {
    await controller.handleSyncError(error);
  }
}

/**
 * Schedules a sync. A delayed request is debounced: another request moves it
 * later, but never past `maxWaitMs` after the first request, so a long
 * editing session still syncs regularly. A zero-delay request runs now.
 */
export function scheduleSync(
  controller: NotesSyncActionController,
  delayMs: number,
  maxWaitMs = delayMs
): void {
  if (!controller.hasToken || !controller.isBrowserOnline) return;
  if (controller.isArchiveBusy) {
    controller.syncQueued = true;
    return;
  }
  if (controller.isSyncing) {
    controller.syncQueued = true;
    return;
  }
  if (controller.retrySyncTimer) return;

  const now = Date.now();
  if (controller.autoSyncTimer) {
    if (controller.autoSyncUrgent) return;
    clearTimeout(controller.autoSyncTimer);
  } else {
    controller.autoSyncWaitStartedAt = now;
  }
  const waitStartedAt = controller.autoSyncWaitStartedAt ?? now;
  const timeoutMs = Math.max(
    0,
    Math.min(delayMs, waitStartedAt + Math.max(delayMs, maxWaitMs) - now)
  );
  controller.autoSyncUrgent = timeoutMs === 0;
  controller.autoSyncTimer = setTimeout(() => {
    controller.autoSyncTimer = null;
    controller.autoSyncWaitStartedAt = null;
    controller.autoSyncUrgent = false;
    void controller.syncNow();
  }, timeoutMs);
}

export function scheduleSyncRetry(
  controller: NotesSyncActionController,
  retryDelayMs: number
): void {
  if (
    !controller.hasToken ||
    !controller.isBrowserOnline ||
    controller.retrySyncTimer
  ) {
    return;
  }
  controller.retrySyncTimer = setTimeout(() => {
    controller.retrySyncTimer = null;
    controller.scheduleSync(0);
  }, retryDelayMs);
}

export function updateSyncProgress(
  controller: NotesSyncActionController,
  progress: SyncProgress
): void {
  const copy = syncProgressCopy(progress);
  controller.syncActivityLabel = copy.label;
  controller.syncActivityDetail = copy.detail;
  controller.syncMessage = copy.label;
}

export async function refreshRemoteSyncStatus(
  controller: NotesSyncActionController,
  token = getStoredSession()?.token ?? null
): Promise<void> {
  if (!token || !controller.isBrowserOnline) return;
  try {
    const status = await loadSyncStatus(token);
    controller.remoteSyncEnabled = status.remote.enabled;
    controller.remoteSyncState = status.remote.state;
    controller.remoteSyncError = status.remote.lastError ?? '';
    if (status.remote.lastError) {
      recordDebugLog({
        level: 'warn',
        source: 'Remote worker',
        message: 'Remote worker reported an error',
        detail: status.remote.lastError
      });
      await recordSyncError(status.remote.lastError, 'Remote worker');
      await controller.refresh();
    } else {
      recordDebugLog({
        level: 'debug',
        source: 'Remote worker',
        message: 'Remote worker status checked',
        detail: {
          enabled: status.remote.enabled,
          state: status.remote.state
        }
      });
    }
  } catch (error) {
    recordDebugLog({
      level: 'error',
      source: 'Remote worker',
      message: 'Could not check remote worker status',
      detail: error
    });
    await recordSyncError(error, 'Remote worker status');
    await controller.refresh();
    if (error instanceof AuthError) {
      controller.expireSession(error.message);
      return;
    }
    controller.remoteSyncEnabled = true;
    controller.remoteSyncState = 'error';
    controller.remoteSyncError =
      error instanceof Error ? error.message : 'Could not check remote sync';
  }
}

export function pollRemoteSyncStatusIfBusy(
  controller: NotesSyncActionController
): void {
  if (controller.remoteStatusTimer) {
    clearTimeout(controller.remoteStatusTimer);
    controller.remoteStatusTimer = null;
  }
  if (
    !controller.hasToken ||
    !controller.remoteSyncEnabled ||
    (controller.remoteSyncState !== 'queued' &&
      controller.remoteSyncState !== 'syncing')
  ) {
    return;
  }

  controller.remoteStatusTimer = setTimeout(async () => {
    controller.remoteStatusTimer = null;
    await controller.refreshRemoteSyncStatus();
    pollRemoteSyncStatusIfBusy(controller);
  }, 1500);
}

export function expireSession(
  controller: NotesSyncActionController,
  message = 'Sign-in expired'
): void {
  const displayMessage =
    message.toLowerCase() === 'unauthorized' ? 'Sign-in expired' : message;
  controller.clearLocalSession({
    accountMessage: displayMessage,
    openLogin: true,
    syncMessage: displayMessage
  });
  controller.notify('error', 'Session ended', displayMessage);
}

export async function handleSyncError(
  controller: NotesSyncActionController,
  error: unknown,
  { pullOnly = false }: { pullOnly?: boolean } = {}
): Promise<void> {
  recordDebugLog({
    level: 'error',
    source: 'Sync',
    message: 'Sync failed',
    detail: error
  });
  await recordSyncError(error, 'Sync');
  await controller.refresh();

  if (error instanceof AuthError) {
    controller.expireSession(error.message);
    return;
  }

  if (!navigator.onLine) {
    controller.isBrowserOnline = false;
    controller.syncMessage = 'Offline';
    return;
  }

  if (pullOnly) {
    // A background pull during the rejection backoff failed. Keep showing the
    // rejection; the next automatic sync pulls again. Retrying on a timer
    // would run a full sync and resend the rejected data early.
    return;
  }

  controller.syncMessage =
    error instanceof Error ? error.message : 'Sync failed';
  if (error instanceof SyncHttpError && error.status === 429) {
    // Rate limited: retry quietly once the server's limit window has passed.
    controller.scheduleSyncRetry(RATE_LIMITED_RETRY_MS);
    return;
  }
  if (
    error instanceof SyncHttpError &&
    REJECTED_SYNC_STATUSES.has(error.status)
  ) {
    if (controller.lastSyncRejection !== controller.syncMessage) {
      controller.notify('error', 'Sync failed', controller.syncMessage);
    }
    controller.lastSyncRejection = controller.syncMessage;
    controller.syncBackoffUntil =
      Date.now() +
      Math.min(
        MAX_REJECTED_SYNC_BACKOFF_MS,
        REJECTED_SYNC_BACKOFF_MS * 2 ** controller.syncRejectionCount
      );
    controller.syncRejectionCount += 1;
    return;
  }
  controller.notify('error', 'Sync failed', controller.syncMessage);
  controller.scheduleSyncRetry();
}
