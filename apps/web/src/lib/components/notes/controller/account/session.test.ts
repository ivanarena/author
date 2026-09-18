import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesAccountActionController } from './types';

const mocks = vi.hoisted(() => ({
  clearLocalWorkspace: vi.fn(),
  deleteAccountRequest: vi.fn(),
  getStoredSession: vi.fn(),
  logout: vi.fn()
}));

vi.mock('$lib/client/store', () => ({
  clearLocalWorkspace: mocks.clearLocalWorkspace,
  getStoredSession: mocks.getStoredSession
}));

vi.mock('$lib/client/api-client', () => ({
  deleteAccount: mocks.deleteAccountRequest,
  logout: mocks.logout
}));

import {
  cancelAccountDeleteEdit,
  deleteAccount,
  logoutAccount,
  startAccountDeleteEdit
} from './session';

function controller(
  overrides: Partial<NotesAccountActionController> = {}
): NotesAccountActionController {
  return {
    accountDeleteEditing: false,
    accountDisplayName: '',
    accountProfileImage: '',
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
    signupInvitationValue: '',
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

describe('account session actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSession.mockReturnValue(null);
    mocks.logout.mockResolvedValue(undefined);
  });

  it('starts and cancels account deletion edits', () => {
    const model = controller({
      accountError: 'old error',
      accountMessage: 'old message',
      accountPasswordEditing: true,
      accountProfileEditing: true,
      accountTotpEditing: true,
      deletePasswordValue: 'typed password'
    });

    startAccountDeleteEdit(model);
    expect(model.accountDeleteEditing).toBe(true);
    expect(model.accountPasswordEditing).toBe(false);
    expect(model.accountProfileEditing).toBe(false);
    expect(model.accountTotpEditing).toBe(false);
    expect(model.deletePasswordValue).toBe('');
    expect(model.accountError).toBe('');
    expect(model.accountMessage).toBe('');

    model.deletePasswordValue = 'typed again';
    model.accountError = 'still bad';
    cancelAccountDeleteEdit(model);
    expect(model.accountDeleteEditing).toBe(false);
    expect(model.deletePasswordValue).toBe('');
    expect(model.accountError).toBe('');
  });

  it('logs out locally and asks the API to revoke the session when possible', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: { username: 'owner' },
      expiresAt: null
    });
    const model = controller();

    await logoutAccount(model);

    expect(mocks.logout).toHaveBeenCalledWith('session-token');
    expect(model.clearSensitiveWorkspace).toHaveBeenCalled();
    expect(model.clearLocalSession).toHaveBeenCalledWith({
      accountMessage: 'Signed out and locked',
      clearEncryptionKeyMaterial: true,
      openLogin: true,
      syncMessage: 'Sign in to unlock and sync'
    });
    expect(model.notify).toHaveBeenCalledWith(
      'info',
      'Signed out and locked',
      'Sign in to unlock notes on this browser.'
    );
    expect(model.isAccountBusy).toBe(false);
  });

  it('requires a signed-in session and password before deleting an account', async () => {
    const model = controller();

    await deleteAccount(model);
    expect(mocks.deleteAccountRequest).not.toHaveBeenCalled();

    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: { username: 'owner' },
      expiresAt: null
    });
    await deleteAccount(model);
    expect(model.accountError).toBe('Password required to delete account');
    expect(mocks.deleteAccountRequest).not.toHaveBeenCalled();
  });

  it('deletes the account, clears local data, and locks the workspace', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: { username: 'owner' },
      expiresAt: null
    });
    const model = controller({
      accountDeleteEditing: true,
      deletePasswordValue: 'test-password'
    });

    await deleteAccount(model);

    expect(model.flushPendingSave).toHaveBeenCalled();
    expect(mocks.deleteAccountRequest).toHaveBeenCalledWith('session-token', {
      password: 'test-password'
    });
    expect(mocks.clearLocalWorkspace).toHaveBeenCalled();
    expect(model.refresh).toHaveBeenCalled();
    expect(model.openDraftNote).toHaveBeenCalled();
    expect(model.clearLocalSession).toHaveBeenCalledWith({
      accountMessage: 'Account deleted',
      clearEncryptionKeyMaterial: true,
      syncMessage: 'Sign in to sync'
    });
    expect(model.notify).toHaveBeenCalledWith('info', 'Account deleted');
    expect(model.deletePasswordValue).toBe('');
    expect(model.accountDeleteEditing).toBe(false);
    expect(model.isAccountBusy).toBe(false);
  });

  it('surfaces delete failures without leaving the controller busy', async () => {
    mocks.getStoredSession.mockReturnValue({
      token: 'session-token',
      user: { username: 'owner' },
      expiresAt: null
    });
    mocks.deleteAccountRequest.mockRejectedValueOnce(new Error('Nope'));
    const model = controller({ deletePasswordValue: 'test-password' });

    await deleteAccount(model);

    expect(model.accountError).toBe('Nope');
    expect(model.notify).toHaveBeenCalledWith(
      'error',
      'Delete account failed',
      'Nope'
    );
    expect(model.isAccountBusy).toBe(false);
  });
});
