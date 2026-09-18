import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesAccountActionController } from './types';

const mocks = vi.hoisted(() => ({
  adoptLocalWorkspaceForAccount: vi.fn(),
  commitEncryptionKeyMaterial: vi.fn(),
  getEncryptionKeyMaterial: vi.fn(),
  getLoginHint: vi.fn(),
  getStoredSession: vi.fn(),
  hasStoredEncryptionKeyMaterial: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  prepareEncryptionPassword: vi.fn(),
  prepareLocalWorkspaceForAccount: vi.fn(),
  recoveryKitText: vi.fn(),
  setStoredSession: vi.fn(),
  signup: vi.fn()
}));

vi.mock('$lib/client/encryption', () => ({
  commitEncryptionKeyMaterial: mocks.commitEncryptionKeyMaterial,
  getEncryptionKeyMaterial: mocks.getEncryptionKeyMaterial,
  hasStoredEncryptionKeyMaterial: mocks.hasStoredEncryptionKeyMaterial,
  prepareEncryptionPassword: mocks.prepareEncryptionPassword,
  recoveryKitText: mocks.recoveryKitText
}));

vi.mock('$lib/client/store', () => ({
  adoptLocalWorkspaceForAccount: mocks.adoptLocalWorkspaceForAccount,
  getLoginHint: mocks.getLoginHint,
  getStoredSession: mocks.getStoredSession,
  prepareLocalWorkspaceForAccount: mocks.prepareLocalWorkspaceForAccount,
  setStoredSession: mocks.setStoredSession
}));

vi.mock('$lib/client/api-client', () => ({
  logout: mocks.logout
}));

vi.mock('$lib/client/sync', () => ({
  login: mocks.login,
  signup: mocks.signup
}));

import { submitLoginMenu } from './auth';

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
    loginOpen: true,
    loginPasswordValue: '',
    loginTotpCodeValue: '',
    loginUsernameValue: '',
    newPasswordValue: '',
    signupConfirmPasswordValue: '',
    signupEmailRequired: false,
    signupEmailValue: '',
    signupInvitationValue: '',
    signupEnabled: true,
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

describe('account auth actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSession.mockReturnValue(null);
    mocks.getLoginHint.mockReturnValue('');
    mocks.getEncryptionKeyMaterial.mockReturnValue('old-local-material');
    mocks.hasStoredEncryptionKeyMaterial.mockReturnValue(true);
    mocks.prepareLocalWorkspaceForAccount.mockResolvedValue({ cleared: false });
    mocks.adoptLocalWorkspaceForAccount.mockResolvedValue(undefined);
    mocks.recoveryKitText.mockReturnValue('original-kit-json');
  });

  it('signs in a trusted device with an authenticator code and no password', async () => {
    mocks.login.mockResolvedValue({
      token: 'trusted-device-session-token',
      user: {
        username: 'owner',
        email: null,
        displayName: null,
        twoFactorEnabled: true
      },
      device: { id: 'device-1', name: 'This browser' },
      expiresAt: '2026-05-29T12:00:00.000Z'
    });
    const model = controller({
      loginUsernameValue: 'owner',
      loginTotpCodeValue: '123456'
    });

    await submitLoginMenu(model);

    expect(mocks.login).toHaveBeenCalledWith('owner', null, '123456');
    expect(mocks.prepareEncryptionPassword).not.toHaveBeenCalled();
    expect(mocks.adoptLocalWorkspaceForAccount).toHaveBeenCalledWith({
      username: 'owner',
      fallbackOwnerUsername: null,
      previousMaterial: 'old-local-material',
      nextMaterial: 'old-local-material'
    });
    expect(mocks.commitEncryptionKeyMaterial).toHaveBeenCalledWith(
      'old-local-material'
    );
    expect(mocks.setStoredSession).toHaveBeenCalledWith({
      token: 'trusted-device-session-token',
      user: expect.objectContaining({
        username: 'owner',
        twoFactorEnabled: true
      }),
      expiresAt: '2026-05-29T12:00:00.000Z'
    });
    expect(model.loginOpen).toBe(false);
    expect(model.accountMessage).toBe('Signed in');
    expect(model.syncNow).toHaveBeenCalled();
  });

  it('shows the original signup recovery code and kit after account creation', async () => {
    const recoveryKit = {
      type: 'author-recovery-kit',
      version: 1,
      createdAt: '2026-05-28T12:00:00.000Z',
      recoveryWrap: {
        alg: 'AES-256-GCM',
        kdf: 'sha256',
        context: 'recovery',
        iv: 'iv',
        ciphertext: 'ciphertext'
      },
      keyHint: 'active-key'
    };
    mocks.signup.mockResolvedValue({
      token: 'signup-session-token',
      user: {
        username: 'owner',
        email: 'owner@example.com',
        displayName: null,
        twoFactorEnabled: false
      },
      device: { id: 'device-1', name: 'This browser' },
      expiresAt: '2026-05-29T12:00:00.000Z',
      e2eeKeyring: 'wrapped-keyring',
      encryptionKeyMaterial: 'account-key-material',
      recoveryCode: 'author-recovery-v1-code',
      recoveryKit
    });
    const model = controller({
      authMode: 'signup',
      loginUsernameValue: 'owner',
      loginPasswordValue: 'signup-password-123',
      signupConfirmPasswordValue: 'signup-password-123',
      signupEmailValue: 'owner@example.com',
      signupInvitationValue: 'invite-code'
    });

    await submitLoginMenu(model);

    expect(mocks.signup).toHaveBeenCalledWith(
      'owner',
      'owner@example.com',
      'invite-code',
      'signup-password-123'
    );
    expect(mocks.recoveryKitText).toHaveBeenCalledWith(recoveryKit);
    expect(model.accountRecoveryCodeValue).toBe('author-recovery-v1-code');
    expect(model.showSignupRecoveryPrompt).toHaveBeenCalledWith(
      'author-recovery-v1-code',
      'original-kit-json'
    );
    expect(model.loginOpen).toBe(false);
    expect(model.syncNow).toHaveBeenCalled();
  });
});
