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

  return {
    AuthError,
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
    accountEmail: '',
    accountTrustedDevices: [] as TrustedAuthDevice[],
    accountTwoFactorEnabled: false,
    accountUsername: '',
    activeConflict: null,
    autoSyncTimer: null,
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
    mocks.runSync.mockResolvedValue({ pushed: 1, pulled: 2, conflicts: 0 });
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
      model.updateSyncProgress
    );
    expect(mocks.clearSyncError).toHaveBeenCalled();
    expect(mocks.recordLastSyncPass).toHaveBeenCalledWith(
      expect.objectContaining({ pushed: 1, pulled: 2, conflicts: 0 })
    );
    expect(model.refresh).toHaveBeenCalled();
    expect(model.refreshRemoteSyncStatus).toHaveBeenCalledWith('session-token');
    expect(model.scheduleSync).toHaveBeenCalledWith(0);
    expect(model.isSyncing).toBe(false);
    expect(model.syncMessage).toBe('Local changes saved');
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

  it('does not let pending-change effects bypass the retry delay', () => {
    const retryTimer = setTimeout(() => undefined, 1_000);
    const model = controller({ retrySyncTimer: retryTimer });

    scheduleSync(model, 10);

    expect(model.autoSyncTimer).toBeNull();
    clearTimeout(retryTimer);
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
