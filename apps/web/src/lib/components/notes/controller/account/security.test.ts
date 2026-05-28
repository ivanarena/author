import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesAccountActionController } from './types';

const mocks = vi.hoisted(() => ({
  changePasswordRequest: vi.fn(),
  clearSyncError: vi.fn(),
  getStoredSession: vi.fn(),
  logout: vi.fn(),
  prepareEncryptionPassword: vi.fn(),
  preflightReencryptLocalNotes: vi.fn(),
  recordLastSyncPass: vi.fn(),
  reencryptLocalNotes: vi.fn(),
  runSync: vi.fn(),
  setStoredSession: vi.fn(),
  setupTotp: vi.fn()
}));

vi.mock('$lib/client/encryption', () => ({
  commitEncryptionKeyMaterial: vi.fn(),
  prepareEncryptionPassword: mocks.prepareEncryptionPassword
}));

vi.mock('$lib/client/store', () => ({
  clearSyncError: mocks.clearSyncError,
  getStoredSession: mocks.getStoredSession,
  preflightReencryptLocalNotes: mocks.preflightReencryptLocalNotes,
  reencryptLocalNotes: mocks.reencryptLocalNotes,
  recordLastSyncPass: mocks.recordLastSyncPass,
  setStoredSession: mocks.setStoredSession
}));

vi.mock('$lib/client/api-client', () => ({
  changePassword: mocks.changePasswordRequest,
  disableTotp: vi.fn(),
  enableTotp: vi.fn(),
  logout: mocks.logout,
  setupTotp: mocks.setupTotp
}));

vi.mock('$lib/client/sync', () => ({
  runSync: mocks.runSync
}));

import { changeAccountPassword } from './security';

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
    syncNow: vi.fn(),
    updateSyncProgress: vi.fn(),
    ...overrides
  };
}

describe('account security actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSession.mockReturnValue(null);
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
});
