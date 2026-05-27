import type { RemoteSyncState, TrustedAuthDevice } from '@author/api-types';
import {
  AuthError,
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
  accountEmail: string;
  accountTrustedDevices: TrustedAuthDevice[];
  accountTwoFactorEnabled: boolean;
  accountUsername: string;
  activeConflict: { id: string } | null;
  autoSyncTimer: ReturnType<typeof setTimeout> | null;
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

  clearLocalSession: (options?: ClearLocalSessionOptions) => void;
  expireSession: (message?: string) => void;
  flushPendingSave: () => Promise<void>;
  handleSyncError: (error: unknown) => Promise<void>;
  notify: (
    kind: AppNotification['kind'],
    title: string,
    message?: string
  ) => void;
  refresh: () => Promise<void>;
  refreshAccount: (token?: string | null) => Promise<void>;
  refreshRemoteSyncStatus: (token?: string | null) => Promise<void>;
  scheduleSync: (delayMs?: number) => void;
  scheduleSyncRetry: () => void;
  syncNow: () => Promise<void>;
  updateSyncProgress: (progress: SyncProgress) => void;
}

export async function syncNow(
  controller: NotesSyncActionController
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

  if (controller.autoSyncTimer) {
    clearTimeout(controller.autoSyncTimer);
    controller.autoSyncTimer = null;
  }
  if (controller.retrySyncTimer) {
    clearTimeout(controller.retrySyncTimer);
    controller.retrySyncTimer = null;
  }
  controller.isSyncing = true;
  controller.updateSyncProgress({ phase: 'preparing' });
  let syncCompleted = false;
  try {
    const result = await runSync(token, controller.updateSyncProgress);
    controller.syncMessage =
      result.conflicts > 0
        ? `${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}`
        : 'Local changes saved';
    controller.lastSyncPass = {
      completedAt: new Date().toISOString(),
      pushed: result.pushed,
      pulled: result.pulled,
      conflicts: result.conflicts
    };
    await clearSyncError();
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
    await controller.handleSyncError(error);
  } finally {
    controller.isSyncing = false;
    controller.syncActivityLabel = '';
    controller.syncActivityDetail = '';
    const shouldSyncAgain =
      syncCompleted &&
      (controller.syncQueued || controller.pendingSyncCount > 0);
    controller.syncQueued = false;
    if (shouldSyncAgain) {
      controller.scheduleSync(0);
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

export function scheduleSync(
  controller: NotesSyncActionController,
  delayMs: number
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
  if (controller.autoSyncTimer) return;

  controller.autoSyncTimer = setTimeout(() => {
    controller.autoSyncTimer = null;
    void controller.syncNow();
  }, delayMs);
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
  error: unknown
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

  controller.syncMessage =
    error instanceof Error ? error.message : 'Sync failed';
  controller.notify('error', 'Sync failed', controller.syncMessage);
  controller.scheduleSyncRetry();
}
