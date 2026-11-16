import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSyncState, TrustedAuthDevice } from '@author/api-types';
import type { NotesSyncActionController } from './sync';

const mocks = vi.hoisted(() => {
  class AuthError extends Error {
    constructor(message = 'Sign-in expired') {
      super(message);
      this.name = 'AuthError';
    }
  }

  class SyncHttpError extends Error {
    constructor(
      readonly status: number,
      message = `Sync failed: ${status}`
    ) {
      super(message);
      this.name = 'SyncHttpError';
    }
  }

  return {
    AuthError,
    SyncHttpError,
    clearSyncError: vi.fn(),
    getStoredSession: vi.fn(),
    hasStoredEncryptionKeyMaterial: vi.fn(),
    loadAccount: vi.fn(),
    loadSyncStatus: vi.fn(),
    recordDebugLog: vi.fn(),
    recordLastSyncPass: vi.fn(),
    recordSyncError: vi.fn(),
    rememberLocalWorkspaceAccount: vi.fn(),
    resolveConflict: vi.fn(),
    runSync: vi.fn(),
    setStoredSession: vi.fn(),
    validateSession: vi.fn()
  };
});

vi.mock('$lib/client/api-client', () => ({
  AuthError: mocks.AuthError,
  SyncHttpError: mocks.SyncHttpError,
  loadAccount: mocks.loadAccount,
  loadSyncStatus: mocks.loadSyncStatus,
  validateSession: mocks.validateSession
}));

vi.mock('$lib/client/debug-log', () => ({
  recordDebugLog: mocks.recordDebugLog
}));

vi.mock('$lib/client/encryption', () => ({
  hasStoredEncryptionKeyMaterial: mocks.hasStoredEncryptionKeyMaterial
}));

vi.mock('$lib/client/store', () => ({
  clearSyncError: mocks.clearSyncError,
  getStoredSession: mocks.getStoredSession,
  recordLastSyncPass: mocks.recordLastSyncPass,
  recordSyncError: mocks.recordSyncError,
  rememberLocalWorkspaceAccount: mocks.rememberLocalWorkspaceAccount,
  resolveConflict: mocks.resolveConflict,
  setStoredSession: mocks.setStoredSession
}));

vi.mock('$lib/client/sync', () => ({
  runSync: mocks.runSync
}));

import {
  handleSyncError,
  refreshAccount,
  refreshRemoteSyncStatus,
  resolveActiveConflict,
  resumeOnlineSession,
  scheduleSync,
  scheduleSyncRetry,
  syncNow,
  updateSyncProgress
} from './sync';

function controller(
  overrides: Partial<NotesSyncActionController> = {}
): NotesSyncActionController {
  return {
    accountDisplayName: '',
    accountProfileImage: '',
    accountEmail: '',
    accountTrustedDevices: [] as TrustedAuthDevice[],
    accountTwoFactorEnabled: false,
    accountUsername: '',
    activeConflict: null,
    autoSyncTimer: null,
    autoSyncWaitStartedAt: null,
    autoSyncUrgent: false,
    hasToken: true,
    isArchiveBusy: false,
    isBrowserOnline: true,
    isSyncing: false,
    lastSyncPass: {
      completedAt: null,
      pushed: 0,
      pulled: 0,
      conflicts: 0
    },
    pendingSyncCount: 0,
    remoteStatusTimer: null,
    remoteSyncEnabled: false,
    remoteSyncError: '',
    remoteSyncState: 'disabled' as RemoteSyncState,
    retrySyncTimer: null,
    syncActivityDetail: '',
    syncActivityLabel: '',
    syncMessage: '',
    syncQueued: false,
    unsyncableCount: 0,
    lastSyncRejection: '',
    syncRejectionCount: 0,
    syncBackoffUntil: 0,
    clearLocalSession: vi.fn(),
    expireSession: vi.fn(),
    flushPendingSave: vi.fn(),
    handleSyncError: vi.fn(),
    notify: vi.fn(),
    refresh: vi.fn(),
    refreshAccount: vi.fn(),
    refreshRemoteSyncStatus: vi.fn(),
    scheduleSync: vi.fn(),
    scheduleSyncRetry: vi.fn(),
    syncNow: vi.fn(),
    updateSyncProgress: vi.fn(),
    ...overrides
  };
}

describe('sync actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: { username: 'owner', displayName: null },
      expiresAt: null
    });
    mocks.hasStoredEncryptionKeyMaterial.mockReturnValue(true);
    mocks.runSync.mockResolvedValue({
      pushed: 1,
      pulled: 2,
      conflicts: 0,
      unsyncable: 0
    });
    mocks.clearSyncError.mockResolvedValue(undefined);
    mocks.recordLastSyncPass.mockResolvedValue(undefined);
    mocks.recordSyncError.mockResolvedValue(undefined);
    mocks.rememberLocalWorkspaceAccount.mockResolvedValue(undefined);
    mocks.resolveConflict.mockResolvedValue(undefined);
    mocks.loadSyncStatus.mockResolvedValue({
      state: 'synced',
      remote: {
        enabled: true,
        state: 'synced',
        lastError: null
      }
    });
    mocks.loadAccount.mockResolvedValue({
      user: {
        username: 'owner',
        email: 'owner@example.com',
        displayName: 'Owner',
        twoFactorEnabled: true
      },
      trustedDevices: [{ deviceId: 'device-1', deviceName: 'Laptop' }]
    });
    mocks.validateSession.mockResolvedValue({
      token: 'session-token',
      expiresAt: '2026-05-29T12:00:00.000Z',
      user: {
        username: 'owner',
        email: 'owner@example.com',
        displayName: 'Owner',
        twoFactorEnabled: false
      }
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('pauses sync during archive operations without touching pending records', async () => {
    const model = controller({ isArchiveBusy: true });

    await syncNow(model);

    expect(model.syncQueued).toBe(true);
    expect(model.syncMessage).toBe('Sync paused during import/export');
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it('expires the session before sync when encrypted key material is missing', async () => {
    mocks.hasStoredEncryptionKeyMaterial.mockReturnValue(false);
    const model = controller();

    await syncNow(model);

    expect(model.expireSession).toHaveBeenCalledWith(
      'Sign in again to sync encrypted notes'
    );
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it('flushes pending saves, records the pass, refreshes, and schedules queued sync', async () => {
    const model = controller({
      pendingSyncCount: 1,
      remoteSyncEnabled: true,
      remoteSyncState: 'synced'
    });

    await syncNow(model);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(mocks.runSync).toHaveBeenCalledWith(
      'session-token',
      model.updateSyncProgress,
      {}
    );
    expect(mocks.clearSyncError).toHaveBeenCalled();
    expect(mocks.recordLastSyncPass).toHaveBeenCalledWith(
      expect.objectContaining({ pushed: 1, pulled: 2, conflicts: 0 })
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.refreshRemoteSyncStatus).toHaveBeenCalledWith('session-token');
    expect(model.scheduleSync).toHaveBeenCalledWith();
    expect(model.isSyncing).toBe(false);
    expect(model.syncMessage).toBe('Local changes saved');
  });

  it('reports notes too large to sync once and does not loop on them', async () => {
    mocks.runSync.mockResolvedValue({
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      unsyncable: 1
    });
    const model = controller({ pendingSyncCount: 1 });

    await syncNow(model);

    expect(model.syncMessage).toBe("1 change can't sync");
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'Some changes are too large to sync',
      expect.stringContaining('Changes stay saved on this device.')
    );
    expect(model.unsyncableCount).toBe(1);
    expect(model.scheduleSync).not.toHaveBeenCalled();

    await syncNow(model);

    expect(model.notify).toHaveBeenCalledTimes(1);
    expect(model.scheduleSync).not.toHaveBeenCalled();
  });

  it('resolves active conflicts, refreshes, and immediately syncs', async () => {
    const model = controller({ activeConflict: { id: 'conflict-1' } });

    await resolveActiveConflict(model, 'keep-local');

    expect(mocks.resolveConflict).toHaveBeenCalledWith(
      'conflict-1',
      'keep-local'
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.syncNow).toHaveBeenCalled();
  });

  it('refreshes account metadata into controller state and stored session', async () => {
    const model = controller();

    await refreshAccount(model, 'session-token');

    expect(model.accountUsername).toBe('owner');
    expect(model.accountEmail).toBe('owner@example.com');
    expect(model.accountDisplayName).toBe('Owner');
    expect(model.accountTwoFactorEnabled).toBe(true);
    expect(model.accountTrustedDevices).toEqual([
      { deviceId: 'device-1', deviceName: 'Laptop' }
    ]);
    expect(mocks.setStoredSession).toHaveBeenCalledWith({
      token: 'session-token',
      user: expect.objectContaining({ username: 'owner' }),
      expiresAt: null
    });
  });

  it('resumes a valid online session and remembers the local workspace account', async () => {
    const model = controller();

    await resumeOnlineSession(model, 'session-token');

    expect(model.hasToken).toBe(true);
    expect(model.accountUsername).toBe('owner');
    expect(mocks.rememberLocalWorkspaceAccount).toHaveBeenCalledWith('owner');
    expect(model.refreshAccount).toHaveBeenCalledWith('session-token');
    expect(model.syncNow).toHaveBeenCalled();
  });

  it('records remote worker errors and exposes them in controller state', async () => {
    mocks.loadSyncStatus.mockRejectedValueOnce(new Error('Mirror stalled'));
    const model = controller();

    await refreshRemoteSyncStatus(model, 'session-token');

    expect(mocks.recordSyncError).toHaveBeenCalledWith(
      expect.any(Error),
      'Remote worker status'
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.remoteSyncEnabled).toBe(true);
    expect(model.remoteSyncState).toBe('error');
    expect(model.remoteSyncError).toBe('Mirror stalled');
  });

  it('turns auth sync errors into a local session expiry', async () => {
    const model = controller();

    await handleSyncError(model, new mocks.AuthError('Unauthorized'));

    expect(mocks.recordSyncError).toHaveBeenCalledWith(
      expect.any(mocks.AuthError),
      'Sync'
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.expireSession).toHaveBeenCalledWith('Unauthorized');
  });

  it('updates progress copy and schedules sync timers only when useful', () => {
    const model = controller();

    updateSyncProgress(model, {
      phase: 'pushing',
      pushed: 1,
      total: 3,
      batchSize: 20
    });
    expect(model.syncActivityLabel).toBe('Pushing local changes');
    expect(model.syncMessage).toBe('Pushing local changes');

    scheduleSync(model, 10);
    expect(model.autoSyncTimer).not.toBeNull();
    if (model.autoSyncTimer) clearTimeout(model.autoSyncTimer);

    scheduleSyncRetry(model, 10);
    expect(model.retrySyncTimer).not.toBeNull();
    if (model.retrySyncTimer) clearTimeout(model.retrySyncTimer);
  });

  it('debounces delayed syncs but bounds the total wait', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
      const model = controller();

      scheduleSync(model, 2_000, 5_000);
      vi.advanceTimersByTime(1_500);
      scheduleSync(model, 2_000, 5_000);
      vi.advanceTimersByTime(1_500);
      expect(model.syncNow).not.toHaveBeenCalled();

      scheduleSync(model, 2_000, 5_000);
      vi.advanceTimersByTime(1_500);
      expect(model.syncNow).not.toHaveBeenCalled();
      scheduleSync(model, 2_000, 5_000);
      // The wait started 4.5 s ago, so the 5 s bound wins over the debounce.
      vi.advanceTimersByTime(499);
      expect(model.syncNow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(model.syncNow).toHaveBeenCalledTimes(1);
      expect(model.autoSyncTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs immediate syncs now and does not postpone them', () => {
    vi.useFakeTimers();
    try {
      const model = controller();

      scheduleSync(model, 2_000, 20_000);
      scheduleSync(model, 0);
      scheduleSync(model, 2_000, 20_000);
      vi.advanceTimersByTime(0);

      expect(model.syncNow).toHaveBeenCalledTimes(1);
      expect(model.autoSyncUrgent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let pending-change effects bypass the retry delay', () => {
    const retryTimer = setTimeout(() => undefined, 1_000);
    const model = controller({ retrySyncTimer: retryTimer });

    scheduleSync(model, 10);

    expect(model.autoSyncTimer).toBeNull();
    clearTimeout(retryTimer);
  });

  it('reports rejected pushes once and waits for the next edit instead of a timed retry', async () => {
    const model = controller();
    const rejected = new mocks.SyncHttpError(
      409,
      'Server storage limit estimate reached for this account.'
    );

    await handleSyncError(model, rejected);
    await handleSyncError(model, rejected);

    expect(model.notify).toHaveBeenCalledTimes(1);
    expect(model.syncMessage).toBe(
      'Server storage limit estimate reached for this account.'
    );
    expect(model.scheduleSyncRetry).not.toHaveBeenCalled();
    // Automatic syncs back off: 1 minute, then 2 minutes.
    expect(model.syncRejectionCount).toBe(2);
    expect(model.syncBackoffUntil - Date.now()).toBeGreaterThan(110_000);
    expect(model.syncBackoffUntil - Date.now()).toBeLessThanOrEqual(120_000);
  });

  it('retries quietly after the push rate limit window', async () => {
    const model = controller();

    await handleSyncError(
      model,
      new mocks.SyncHttpError(429, 'Too many sync pushes.')
    );

    expect(model.notify).not.toHaveBeenCalled();
    expect(model.scheduleSyncRetry).toHaveBeenCalledWith(60_000);
  });

  it('only pulls during the backoff and keeps the rejection state', async () => {
    const backoffUntil = Date.now() + 60_000;
    const model = controller({
      pendingSyncCount: 3,
      lastSyncRejection: 'Server storage limit estimate reached.',
      syncRejectionCount: 1,
      syncBackoffUntil: backoffUntil
    });

    await syncNow(model, { pullOnly: true });

    expect(mocks.runSync).toHaveBeenCalledWith(
      'session-token',
      model.updateSyncProgress,
      { push: false }
    );
    expect(model.syncMessage).toBe('Server storage limit estimate reached.');
    expect(model.lastSyncRejection).toBe(
      'Server storage limit estimate reached.'
    );
    expect(model.syncBackoffUntil).toBe(backoffUntil);
    // The pending changes were deliberately not pushed; no follow-up push.
    expect(model.scheduleSync).not.toHaveBeenCalled();
  });

  it('does not cancel a scheduled full sync when it only pulls', async () => {
    const debounce = setTimeout(() => undefined, 2_000);
    const retry = setTimeout(() => undefined, 12_000);
    const model = controller({
      autoSyncTimer: debounce,
      retrySyncTimer: retry,
      syncBackoffUntil: Date.now() + 60_000
    });
    try {
      await syncNow(model, { pullOnly: true });

      expect(model.autoSyncTimer).toBe(debounce);
      expect(model.retrySyncTimer).toBe(retry);
      expect(mocks.clearSyncError).not.toHaveBeenCalled();
    } finally {
      clearTimeout(debounce);
      clearTimeout(retry);
    }
  });

  it('passes pull-only failures on without a timed retry or toast', async () => {
    const failure = new Error('Network timeout');
    mocks.runSync.mockRejectedValueOnce(failure);
    const model = controller();

    await syncNow(model, { pullOnly: true });

    expect(model.handleSyncError).toHaveBeenCalledWith(failure, {
      pullOnly: true
    });

    await handleSyncError(model, failure, { pullOnly: true });
    expect(model.notify).not.toHaveBeenCalled();
    expect(model.scheduleSyncRetry).not.toHaveBeenCalled();
  });

  it('still pushes an edit queued during a pull-only sync that failed', async () => {
    const model = controller();
    mocks.runSync.mockImplementationOnce(async () => {
      // An edit arrives while the pull runs.
      model.syncQueued = true;
      throw new Error('Network timeout');
    });

    await syncNow(model, { pullOnly: true });

    expect(model.syncQueued).toBe(false);
    expect(model.scheduleSyncRetry).toHaveBeenCalledTimes(1);
  });

  it('clears the rejection backoff after a successful sync', async () => {
    const model = controller({
      lastSyncRejection: 'Rejected',
      syncRejectionCount: 3,
      syncBackoffUntil: Date.now() + 60_000
    });

    await syncNow(model);

    expect(model.lastSyncRejection).toBe('');
    expect(model.syncRejectionCount).toBe(0);
    expect(model.syncBackoffUntil).toBe(0);
  });

  it('notifies and retries after non-auth sync failures while online', async () => {
    const model = controller();

    await handleSyncError(model, new Error('Network timeout'));

    expect(model.syncMessage).toBe('Network timeout');
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'Sync failed',
      'Network timeout'
    );
    expect(model.scheduleSyncRetry).toHaveBeenCalled();
  });
});
