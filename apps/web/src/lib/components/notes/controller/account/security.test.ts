import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesAccountActionController } from './types';

const mocks = vi.hoisted(() => ({
  changePasswordRequest: vi.fn(),
  clearSyncError: vi.fn(),
  commitEncryptionKeyMaterial: vi.fn(),
  createRecoveryBundle: vi.fn(),
  getEncryptionKeyMaterial: vi.fn(),
  getStoredSession: vi.fn(),
  loadAccount: vi.fn(),
  logout: vi.fn(),
  prepareEncryptionPassword: vi.fn(),
  preflightReencryptLocalNotes: vi.fn(),
  recordLastSyncPass: vi.fn(),
  recordSyncError: vi.fn(),
  recoveryKitFileName: vi.fn(),
  recoveryKitText: vi.fn(),
  reencryptLocalNotes: vi.fn(),
  rewrapKeyringForPassword: vi.fn(),
  runSync: vi.fn(),
  setStoredSession: vi.fn(),
  setupTotp: vi.fn(),
  updateAccount: vi.fn()
}));

vi.mock('$lib/client/encryption', () => ({
  commitEncryptionKeyMaterial: mocks.commitEncryptionKeyMaterial,
  createRecoveryBundle: mocks.createRecoveryBundle,
  getEncryptionKeyMaterial: mocks.getEncryptionKeyMaterial,
  prepareEncryptionPassword: mocks.prepareEncryptionPassword,
  recoveryKitFileName: mocks.recoveryKitFileName,
  recoveryKitText: mocks.recoveryKitText,
  rewrapKeyringForPassword: mocks.rewrapKeyringForPassword
}));

vi.mock('$lib/client/store', () => ({
  clearSyncError: mocks.clearSyncError,
  getStoredSession: mocks.getStoredSession,
  preflightReencryptLocalNotes: mocks.preflightReencryptLocalNotes,
  reencryptLocalNotes: mocks.reencryptLocalNotes,
  recordLastSyncPass: mocks.recordLastSyncPass,
  recordSyncError: mocks.recordSyncError,
  setStoredSession: mocks.setStoredSession
}));

vi.mock('$lib/client/api-client', () => ({
  changePassword: mocks.changePasswordRequest,
  disableTotp: vi.fn(),
  enableTotp: vi.fn(),
  loadAccount: mocks.loadAccount,
  logout: mocks.logout,
  setupTotp: mocks.setupTotp,
  updateAccount: mocks.updateAccount
}));

vi.mock('$lib/client/sync', () => ({
  runSync: mocks.runSync
}));

import { changeAccountPassword, downloadRecoveryKit } from './security';

function controller(
  overrides: Partial<NotesAccountActionController> = {}
): NotesAccountActionController {
  return {
    accountDeleteEditing: false,
    accountDisplayName: '',
    accountEmail: '',
    accountError: '',
    accountMenuOpen: false,
    accountMessage: '',
    accountRecoveryCodeValue: '',
    accountPasswordEditing: false,
    accountProfileEditing: false,
    accountTotpCodeValue: '',
    accountTotpEditing: false,
    accountTotpPasswordValue: '',
    accountTotpSecret: '',
    accountTotpUrl: '',
    accountTrustedDevices: [],
    accountTwoFactorEnabled: false,
    accountUsername: '',
    authMode: 'signin',
    confirmPasswordValue: '',
    currentDeviceName: '',
    currentPasswordValue: '',
    deletePasswordValue: '',
    downloadBlob: vi.fn(),
    deviceNameEditing: false,
    deviceNameError: '',
    deviceNameValue: '',
    deviceOtpLoginAvailable: false,
    devices: [],
    hasToken: false,
    isAccountBusy: false,
    isLoggingIn: false,
    isSyncing: false,
    lastSyncPass: {
      completedAt: null,
      pushed: 0,
      pulled: 0,
      conflicts: 0
    },
    loginError: '',
    loginOpen: false,
    loginPasswordValue: '',
    loginTotpCodeValue: '',
    loginUsernameValue: '',
    newPasswordValue: '',
    signupConfirmPasswordValue: '',
    signupEmailRequired: false,
    signupEmailValue: '',
    signupEnabled: false,
    syncActivityDetail: '',
    syncActivityLabel: '',
    syncMessage: '',
    clearLocalSession: vi.fn(),
    clearSensitiveWorkspace: vi.fn(),
    flushPendingSave: vi.fn(),
    notify: vi.fn(),
    openDraftNote: vi.fn(),
    refresh: vi.fn(),
    refreshAccount: vi.fn(),
    refreshPublicConfig: vi.fn(),
    refreshRemoteSyncStatus: vi.fn(),
    showSignupRecoveryPrompt: vi.fn(),
    syncNow: vi.fn(),
    updateSyncProgress: vi.fn(),
    ...overrides
  };
}

describe('account security actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSession.mockReturnValue(null);
    mocks.getEncryptionKeyMaterial.mockReturnValue('keyring-material');
    mocks.loadAccount.mockResolvedValue({ e2eeKeyring: 'old-wrapped' });
    mocks.rewrapKeyringForPassword.mockResolvedValue('new-wrapped');
    mocks.changePasswordRequest.mockResolvedValue({
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      trustedDevices: [],
      session: { token: 'next-token', expiresAt: '2026-05-28T12:00:00.000Z' }
    });
    mocks.runSync.mockResolvedValue({ pushed: 0, pulled: 0, conflicts: 0 });
    mocks.createRecoveryBundle.mockResolvedValue({
      recoveryCode: 'author-recovery-v1-code',
      recoveryKit: { type: 'author-recovery-kit' },
      e2eeKeyring: 'wrapped-with-recovery'
    });
    mocks.recoveryKitText.mockReturnValue('kit-json');
    mocks.recoveryKitFileName.mockReturnValue('author-recovery-kit.json');
  });

  it('does not rotate password-derived note keys without a session username', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: {
        username: '  ',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null
    });
    const model = controller({
      currentPasswordValue: 'current-password',
      newPasswordValue: 'new-password-123',
      confirmPasswordValue: 'new-password-123'
    });

    await changeAccountPassword(model);

    expect(model.accountError).toBe('Sign in again before changing password');
    expect(mocks.prepareEncryptionPassword).not.toHaveBeenCalled();
    expect(mocks.changePasswordRequest).not.toHaveBeenCalled();
  });

  it('rewraps the account keyring instead of rotating note content on password change', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null
    });
    const model = controller({
      currentPasswordValue: 'current-password',
      newPasswordValue: 'new-password-123',
      confirmPasswordValue: 'new-password-123'
    });

    await changeAccountPassword(model);

    expect(mocks.rewrapKeyringForPassword).toHaveBeenCalledWith(
      'keyring-material',
      'owner',
      'new-password-123',
      'old-wrapped'
    );
    expect(mocks.preflightReencryptLocalNotes).toHaveBeenCalledWith(
      'keyring-material',
      'keyring-material'
    );
    expect(mocks.changePasswordRequest).toHaveBeenCalledWith('session-token', {
      currentPassword: 'current-password',
      newPassword: 'new-password-123',
      e2eeKeyring: 'new-wrapped'
    });
    expect(mocks.reencryptLocalNotes).toHaveBeenCalledWith(
      'keyring-material',
      'keyring-material'
    );
    expect(mocks.commitEncryptionKeyMaterial).toHaveBeenCalledWith(
      'keyring-material'
    );
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(model.clearLocalSession).not.toHaveBeenCalled();
    expect(model.accountMessage).toBe('Password changed');
  });

  it('keeps the replacement session and records diagnostics when password-change sync fails', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null
    });
    const syncError = new Error('network down');
    mocks.runSync.mockRejectedValueOnce(syncError);
    const model = controller({
      currentPasswordValue: 'current-password',
      newPasswordValue: 'new-password-123',
      confirmPasswordValue: 'new-password-123'
    });

    await changeAccountPassword(model);

    expect(mocks.setStoredSession).toHaveBeenCalledWith({
      token: 'next-token',
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: '2026-05-28T12:00:00.000Z'
    });
    expect(mocks.commitEncryptionKeyMaterial).toHaveBeenCalledWith(
      'keyring-material'
    );
    expect(mocks.recordSyncError).toHaveBeenCalledWith(
      syncError,
      'Password change sync'
    );
    expect(model.hasToken).toBe(true);
    expect(model.accountPasswordEditing).toBe(false);
    expect(model.syncMessage).toBe('Password changed; sync retry needed');
    expect(model.accountError).toBe(
      'Password changed, but Author could not finish syncing. network down'
    );
    expect(model.clearLocalSession).not.toHaveBeenCalled();
  });

  it('downloads a recovery kit and persists its recovery wrap', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null
    });
    const downloadBlob = vi.fn();
    const model = controller({ downloadBlob });

    await downloadRecoveryKit(model);

    expect(mocks.createRecoveryBundle).toHaveBeenCalledWith('old-wrapped');
    expect(mocks.updateAccount).toHaveBeenCalledWith('session-token', {
      e2eeKeyring: 'wrapped-with-recovery'
    });
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'author-recovery-kit.json'
    );
    expect(model.accountRecoveryCodeValue).toBe('author-recovery-v1-code');
  });
});
