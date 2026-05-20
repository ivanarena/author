import type { Device } from '@author/schema';
import type { TrustedAuthDevice } from '@author/api-types';
import {
  commitEncryptionKeyMaterial,
  getEncryptionKeyMaterial,
  hasStoredEncryptionKeyMaterial,
  prepareEncryptionPassword
} from '$lib/client/encryption';
import {
  adoptLocalWorkspaceForAccount,
  clearLocalWorkspace,
  clearSyncError,
  getLoginHint,
  getStoredSession,
  preflightReencryptLocalNotes,
  prepareLocalWorkspaceForAccount,
  reencryptLocalNotes,
  recordLastSyncPass,
  renameCurrentDevice,
  setStoredSession
} from '$lib/client/store';
import {
  changePassword,
  deleteAccount as deleteAccountRequest,
  disableTotp,
  enableTotp,
  logout,
  revokeTrustedDevice as revokeTrustedDeviceRequest,
  setupTotp,
  updateAccount
} from '$lib/client/api-client';
import { login, runSync, signup, type SyncProgress } from '$lib/client/sync';
import type { AppNotification, AuthMode } from './notes-controller-models';

const MIN_PASSWORD_LENGTH = 12;

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

export interface NotesAccountActionController {
  accountUsername: string;
  accountEmail: string;
  accountDisplayName: string;
  accountTwoFactorEnabled: boolean;
  accountTrustedDevices: TrustedAuthDevice[];
  accountMessage: string;
  accountError: string;
  accountProfileEditing: boolean;
  accountPasswordEditing: boolean;
  accountTotpEditing: boolean;
  accountTotpSecret: string;
  accountTotpUrl: string;
  accountTotpCodeValue: string;
  accountTotpPasswordValue: string;
  accountDeleteEditing: boolean;
  accountMenuOpen: boolean;
  authMode: AuthMode;
  confirmPasswordValue: string;
  currentDeviceName: string;
  currentPasswordValue: string;
  deletePasswordValue: string;
  deviceNameEditing: boolean;
  deviceNameValue: string;
  deviceNameError: string;
  deviceOtpLoginAvailable: boolean;
  devices: Device[];
  hasToken: boolean;
  isAccountBusy: boolean;
  isLoggingIn: boolean;
  isSyncing: boolean;
  lastSyncPass: LastSyncPass;
  loginOpen: boolean;
  loginUsernameValue: string;
  loginPasswordValue: string;
  loginTotpCodeValue: string;
  loginError: string;
  newPasswordValue: string;
  signupConfirmPasswordValue: string;
  signupEmailRequired: boolean;
  signupEmailValue: string;
  signupEnabled: boolean;
  syncActivityLabel: string;
  syncActivityDetail: string;
  syncMessage: string;

  clearLocalSession: (options?: ClearLocalSessionOptions) => void;
  clearSensitiveWorkspace: () => void;
  flushPendingSave: () => Promise<void>;
  notify: (
    kind: AppNotification['kind'],
    title: string,
    message?: string
  ) => void;
  openDraftNote: () => void;
  refresh: () => Promise<void>;
  refreshAccount: (token?: string | null) => Promise<void>;
  refreshPublicConfig: () => Promise<void>;
  refreshRemoteSyncStatus: (token?: string | null) => Promise<void>;
  syncNow: () => Promise<void>;
  updateSyncProgress: (progress: SyncProgress) => void;
}

function resetLoginForm(controller: NotesAccountActionController): void {
  void controller.refreshPublicConfig();
  controller.loginUsernameValue = getLoginHint();
  controller.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
  controller.loginPasswordValue = '';
  controller.loginTotpCodeValue = '';
  controller.signupEmailValue = '';
  controller.signupConfirmPasswordValue = '';
  controller.loginError = '';
}

export function openLoginSettings(
  controller: NotesAccountActionController
): void {
  controller.loginOpen = true;
  controller.authMode = 'signin';
  resetLoginForm(controller);
  controller.accountMenuOpen = false;
}

export function closeLoginModal(
  controller: NotesAccountActionController
): void {
  if (controller.isLoggingIn) return;
  controller.loginOpen = false;
  controller.loginPasswordValue = '';
  controller.loginTotpCodeValue = '';
  controller.signupConfirmPasswordValue = '';
  controller.loginError = '';
}

export function setAuthMode(
  controller: NotesAccountActionController,
  mode: AuthMode
): void {
  if (controller.isLoggingIn || controller.authMode === mode) return;
  if (mode === 'signup' && !controller.signupEnabled) {
    controller.loginError = 'Signup is disabled';
    return;
  }
  controller.authMode = mode;
  controller.loginError = '';
  controller.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
  controller.loginPasswordValue = '';
  controller.loginTotpCodeValue = '';
  controller.signupConfirmPasswordValue = '';
  if (mode === 'signin') {
    controller.signupEmailValue = '';
    controller.loginUsernameValue = getLoginHint();
  }
}

export function startAccountProfileEdit(
  controller: NotesAccountActionController
): void {
  controller.accountProfileEditing = true;
  controller.accountPasswordEditing = false;
  controller.accountTotpEditing = false;
  controller.accountDeleteEditing = false;
  controller.accountError = '';
  controller.accountMessage = '';
}

export function cancelAccountProfileEdit(
  controller: NotesAccountActionController
): void {
  controller.accountProfileEditing = false;
  controller.accountEmail = getStoredSession()?.user.email ?? '';
  controller.accountError = '';
}

export function startDeviceNameEdit(
  controller: NotesAccountActionController
): void {
  controller.deviceNameEditing = true;
  controller.deviceNameValue = controller.currentDeviceName;
  controller.deviceNameError = '';
  controller.accountMessage = '';
}

export function cancelDeviceNameEdit(
  controller: NotesAccountActionController
): void {
  controller.deviceNameEditing = false;
  controller.deviceNameValue = controller.currentDeviceName;
  controller.deviceNameError = '';
}

export async function saveDeviceName(
  controller: NotesAccountActionController
): Promise<void> {
  const name = controller.deviceNameValue.trim();
  if (!name) {
    controller.deviceNameError = 'Device name required';
    return;
  }
  if (controller.isAccountBusy) return;

  controller.isAccountBusy = true;
  controller.deviceNameError = '';
  controller.accountMessage = '';
  try {
    const device = await renameCurrentDevice(name);
    controller.currentDeviceName = device.name;
    controller.deviceNameValue = device.name;
    controller.devices = [
      device,
      ...controller.devices.filter((candidate) => candidate.id !== device.id)
    ];
    controller.accountTrustedDevices = controller.accountTrustedDevices.map(
      (trusted) =>
        trusted.deviceId === device.id
          ? { ...trusted, deviceName: device.name }
          : trusted
    );
    controller.deviceNameEditing = false;
    controller.accountMessage = 'Device name saved';
    controller.notify('success', 'Device name saved');
    if (controller.hasToken) await controller.syncNow();
    await controller.refreshAccount();
  } catch (error) {
    controller.deviceNameError =
      error instanceof Error ? error.message : 'Could not save device name';
    controller.notify(
      'error',
      'Device update failed',
      controller.deviceNameError
    );
  } finally {
    controller.isAccountBusy = false;
  }
}

export function startAccountPasswordEdit(
  controller: NotesAccountActionController
): void {
  controller.accountPasswordEditing = true;
  controller.accountProfileEditing = false;
  controller.accountTotpEditing = false;
  controller.accountDeleteEditing = false;
  controller.currentPasswordValue = '';
  controller.newPasswordValue = '';
  controller.confirmPasswordValue = '';
  controller.accountError = '';
  controller.accountMessage = '';
}

export function cancelAccountPasswordEdit(
  controller: NotesAccountActionController
): void {
  controller.accountPasswordEditing = false;
  controller.currentPasswordValue = '';
  controller.newPasswordValue = '';
  controller.confirmPasswordValue = '';
  controller.accountError = '';
}

export async function startAccountTotpEdit(
  controller: NotesAccountActionController
): Promise<void> {
  const token = getStoredSession()?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  controller.accountTotpEditing = true;
  controller.accountProfileEditing = false;
  controller.accountPasswordEditing = false;
  controller.accountDeleteEditing = false;
  controller.accountTotpCodeValue = '';
  controller.accountTotpPasswordValue = '';
  controller.accountError = '';
  controller.accountMessage = '';
  if (controller.accountTwoFactorEnabled) {
    controller.accountTotpSecret = '';
    controller.accountTotpUrl = '';
    return;
  }

  controller.isAccountBusy = true;
  try {
    const setup = await setupTotp(token);
    controller.accountTotpSecret = setup.secret;
    controller.accountTotpUrl = setup.otpauthUrl;
  } catch (error) {
    controller.accountError =
      error instanceof Error ? error.message : 'Could not start 2FA setup';
    controller.accountTotpEditing = false;
  } finally {
    controller.isAccountBusy = false;
  }
}

export function cancelAccountTotpEdit(
  controller: NotesAccountActionController
): void {
  controller.accountTotpEditing = false;
  controller.accountTotpSecret = '';
  controller.accountTotpUrl = '';
  controller.accountTotpCodeValue = '';
  controller.accountTotpPasswordValue = '';
  controller.accountError = '';
}

export function startAccountDeleteEdit(
  controller: NotesAccountActionController
): void {
  controller.accountDeleteEditing = true;
  controller.accountProfileEditing = false;
  controller.accountPasswordEditing = false;
  controller.accountTotpEditing = false;
  controller.deletePasswordValue = '';
  controller.accountError = '';
  controller.accountMessage = '';
}

export function cancelAccountDeleteEdit(
  controller: NotesAccountActionController
): void {
  controller.accountDeleteEditing = false;
  controller.deletePasswordValue = '';
  controller.accountError = '';
}

export async function submitLoginMenu(
  controller: NotesAccountActionController
): Promise<void> {
  const username = controller.loginUsernameValue.trim();
  const password = controller.loginPasswordValue;
  const hasPassword = Boolean(password.trim());
  const canUseDeviceOtpLogin =
    controller.authMode === 'signin' &&
    !hasPassword &&
    hasStoredEncryptionKeyMaterial();
  if (controller.isLoggingIn) return;
  if (!username) {
    controller.loginError = 'Username required';
    return;
  }
  if (!hasPassword && controller.authMode === 'signup') {
    controller.loginError = 'Password required';
    return;
  }
  if (
    controller.authMode === 'signup' &&
    password.length < MIN_PASSWORD_LENGTH
  ) {
    controller.loginError = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    return;
  }
  if (!hasPassword && !canUseDeviceOtpLogin) {
    controller.loginError = 'Password required on first login for this device';
    return;
  }
  if (canUseDeviceOtpLogin && !controller.loginTotpCodeValue.trim()) {
    controller.loginError = '2FA code required';
    return;
  }
  if (
    controller.authMode === 'signup' &&
    password !== controller.signupConfirmPasswordValue
  ) {
    controller.loginError = 'Passwords do not match';
    return;
  }
  if (controller.authMode === 'signup' && !controller.signupEnabled) {
    controller.loginError = 'Signup is disabled';
    return;
  }
  if (
    controller.authMode === 'signup' &&
    controller.signupEmailRequired &&
    !controller.signupEmailValue.trim()
  ) {
    controller.loginError = 'Email required';
    return;
  }

  controller.isLoggingIn = true;
  controller.loginError = '';
  let shouldSync = false;
  try {
    const storedUsername = getStoredSession()?.user.username ?? '';
    const previousUsername =
      storedUsername.trim() || getLoginHint().trim() || null;
    const session =
      controller.authMode === 'signup'
        ? await signup(username, controller.signupEmailValue, password)
        : await login(
            username,
            hasPassword ? password : null,
            controller.loginTotpCodeValue.trim() || null
          );
    let workspaceCleared = false;
    try {
      const workspace = await prepareLocalWorkspaceForAccount(
        session.user.username,
        previousUsername
      );
      workspaceCleared = workspace.cleared;
    } catch (error) {
      await logout(session.token).catch(() => undefined);
      throw error;
    }
    const encryption = hasPassword
      ? await prepareEncryptionPassword(session.user.username, password)
      : {
          previousMaterial: getEncryptionKeyMaterial(),
          nextMaterial: getEncryptionKeyMaterial()
        };
    await adoptLocalWorkspaceForAccount({
      username: session.user.username,
      fallbackOwnerUsername: workspaceCleared ? null : previousUsername,
      previousMaterial: encryption.previousMaterial,
      nextMaterial: encryption.nextMaterial
    });
    commitEncryptionKeyMaterial(encryption.nextMaterial);
    setStoredSession({
      token: session.token,
      user: session.user,
      expiresAt: session.expiresAt
    });
    controller.hasToken = true;
    controller.accountUsername = session.user.username;
    controller.accountEmail = session.user.email ?? '';
    controller.accountDisplayName = session.user.displayName ?? '';
    controller.accountTwoFactorEnabled = session.user.twoFactorEnabled;
    controller.accountTrustedDevices = [
      {
        deviceId: session.device.id,
        deviceName: session.device.name,
        createdAt: '',
        lastUsedAt: '',
        current: true
      }
    ];
    controller.deviceOtpLoginAvailable = hasStoredEncryptionKeyMaterial();
    controller.accountError = '';
    controller.accountMessage =
      controller.authMode === 'signup' ? 'Account created' : 'Signed in';
    controller.loginOpen = false;
    controller.authMode = 'signin';
    controller.loginUsernameValue = session.user.username;
    controller.loginPasswordValue = '';
    controller.loginTotpCodeValue = '';
    controller.signupEmailValue = '';
    controller.signupConfirmPasswordValue = '';
    controller.syncMessage = 'Signed in';
    controller.notify(
      'success',
      controller.accountMessage,
      'Syncing local and remote notes.'
    );
    shouldSync = true;
    void controller.refreshAccount(session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    controller.loginError = message;
    controller.syncMessage = message;
    controller.notify('error', 'Sign-in failed', message);
  } finally {
    controller.isLoggingIn = false;
  }

  if (shouldSync) void controller.syncNow();
}

export async function saveAccountProfile(
  controller: NotesAccountActionController
): Promise<void> {
  const storedSession = getStoredSession();
  const token = storedSession?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  try {
    const response = await updateAccount(token, {
      email: controller.accountEmail || null
    });
    controller.accountUsername = response.user.username;
    controller.accountEmail = response.user.email ?? '';
    controller.accountDisplayName = response.user.displayName ?? '';
    controller.accountTwoFactorEnabled = response.user.twoFactorEnabled;
    controller.accountTrustedDevices = response.trustedDevices ?? [];
    setStoredSession({
      token,
      user: response.user,
      expiresAt: storedSession?.expiresAt ?? null
    });
    controller.accountMessage = 'Email saved';
    controller.accountProfileEditing = false;
    controller.notify('success', 'Email saved');
  } catch (error) {
    controller.accountError =
      error instanceof Error ? error.message : 'Could not save email';
    controller.notify('error', 'Email update failed', controller.accountError);
  } finally {
    controller.isAccountBusy = false;
  }
}

export async function changeAccountPassword(
  controller: NotesAccountActionController
): Promise<void> {
  const token = getStoredSession()?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  if (!controller.currentPasswordValue.trim()) {
    controller.accountError = 'Current password required';
    return;
  }
  if (!controller.newPasswordValue.trim()) {
    controller.accountError = 'New password required';
    return;
  }
  if (controller.newPasswordValue.length < MIN_PASSWORD_LENGTH) {
    controller.accountError = `New password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    return;
  }
  if (controller.newPasswordValue !== controller.confirmPasswordValue) {
    controller.accountError = 'Passwords do not match';
    return;
  }

  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  let passwordChanged = false;
  try {
    const encryption = await prepareEncryptionPassword(
      controller.accountUsername,
      controller.newPasswordValue
    );
    await preflightReencryptLocalNotes(
      encryption.previousMaterial,
      encryption.nextMaterial
    );
    const response = await changePassword(token, {
      currentPassword: controller.currentPasswordValue,
      newPassword: controller.newPasswordValue
    });
    passwordChanged = true;
    if (!response.session) {
      throw new Error(
        'Password changed, but Author could not create a session to sync the re-encrypted notes.'
      );
    }
    await reencryptLocalNotes(
      encryption.previousMaterial,
      encryption.nextMaterial
    );
    commitEncryptionKeyMaterial(encryption.nextMaterial);
    setStoredSession({
      token: response.session.token,
      user: response.user,
      expiresAt: response.session.expiresAt
    });
    controller.hasToken = true;
    controller.accountUsername = response.user.username;
    controller.accountEmail = response.user.email ?? '';
    controller.accountDisplayName = response.user.displayName ?? '';
    controller.accountTwoFactorEnabled = response.user.twoFactorEnabled;
    controller.accountTrustedDevices = response.trustedDevices ?? [];
    controller.currentPasswordValue = '';
    controller.newPasswordValue = '';
    controller.confirmPasswordValue = '';
    controller.accountPasswordEditing = false;
    controller.isSyncing = true;
    controller.syncMessage = 'Syncing password change';
    controller.updateSyncProgress({ phase: 'preparing' });
    const syncResult = await runSync(
      response.session.token,
      controller.updateSyncProgress
    );
    controller.lastSyncPass = {
      completedAt: new Date().toISOString(),
      pushed: syncResult.pushed,
      pulled: syncResult.pulled,
      conflicts: syncResult.conflicts
    };
    await clearSyncError();
    await recordLastSyncPass(controller.lastSyncPass);
    await controller.refresh();
    await controller.refreshRemoteSyncStatus(response.session.token);
    await logout(response.session.token).catch(() => undefined);
    controller.clearSensitiveWorkspace();
    controller.clearLocalSession({
      accountMessage: 'Password changed. Sign in again to unlock notes.',
      clearEncryptionKeyMaterial: true,
      openLogin: true,
      syncMessage: 'Sign in to unlock and sync'
    });
    controller.loginUsernameValue = response.user.username;
    controller.notify(
      'success',
      'Password changed',
      'Sign in again to unlock notes.'
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Could not change password';
    controller.accountError = passwordChanged
      ? `Password changed, but Author could not finish syncing re-encrypted notes. ${detail}`
      : detail;
    controller.notify(
      'error',
      passwordChanged ? 'Password sync incomplete' : 'Password change failed',
      controller.accountError
    );
  } finally {
    controller.isSyncing = false;
    controller.syncActivityLabel = '';
    controller.syncActivityDetail = '';
    controller.isAccountBusy = false;
  }
}

export async function saveAccountTotp(
  controller: NotesAccountActionController
): Promise<void> {
  const storedSession = getStoredSession();
  const token = storedSession?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  if (!controller.accountTotpPasswordValue.trim()) {
    controller.accountError = 'Current password required';
    return;
  }
  if (!controller.accountTotpCodeValue.trim()) {
    controller.accountError = '2FA code required';
    return;
  }

  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  try {
    const response = controller.accountTwoFactorEnabled
      ? await disableTotp(token, {
          currentPassword: controller.accountTotpPasswordValue,
          totpCode: controller.accountTotpCodeValue
        })
      : await enableTotp(token, {
          currentPassword: controller.accountTotpPasswordValue,
          secret: controller.accountTotpSecret,
          totpCode: controller.accountTotpCodeValue
        });
    controller.accountUsername = response.user.username;
    controller.accountEmail = response.user.email ?? '';
    controller.accountDisplayName = response.user.displayName ?? '';
    controller.accountTwoFactorEnabled = response.user.twoFactorEnabled;
    controller.accountTrustedDevices = response.trustedDevices ?? [];
    controller.accountTotpEditing = false;
    controller.accountTotpSecret = '';
    controller.accountTotpUrl = '';
    controller.accountTotpCodeValue = '';
    controller.accountTotpPasswordValue = '';
    controller.clearLocalSession({
      accountMessage: '2FA changed. Sign in again to keep syncing.',
      openLogin: true,
      syncMessage: 'Sign in to sync'
    });
    controller.loginUsernameValue = response.user.username;
    controller.notify(
      'success',
      '2FA changed',
      'Sign in again to keep syncing.'
    );
  } catch (error) {
    controller.accountError =
      error instanceof Error ? error.message : 'Could not update 2FA';
    controller.notify('error', '2FA update failed', controller.accountError);
  } finally {
    controller.isAccountBusy = false;
  }
}

export async function revokeTrustedDevice(
  controller: NotesAccountActionController,
  deviceId: string
): Promise<void> {
  const storedSession = getStoredSession();
  const token = storedSession?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  try {
    const response = await revokeTrustedDeviceRequest(token, deviceId);
    controller.accountUsername = response.user.username;
    controller.accountEmail = response.user.email ?? '';
    controller.accountDisplayName = response.user.displayName ?? '';
    controller.accountTwoFactorEnabled = response.user.twoFactorEnabled;
    controller.accountTrustedDevices = response.trustedDevices ?? [];
    setStoredSession({
      token,
      user: response.user,
      expiresAt: storedSession?.expiresAt ?? null
    });
    controller.deviceOtpLoginAvailable = controller.accountTrustedDevices.some(
      (device) => device.current
    );
    controller.accountMessage = 'Trusted device removed';
    controller.notify('success', 'Trusted device removed');
  } catch (error) {
    controller.accountError =
      error instanceof Error
        ? error.message
        : 'Could not remove trusted device';
    controller.notify(
      'error',
      'Trusted device update failed',
      controller.accountError
    );
  } finally {
    controller.isAccountBusy = false;
  }
}

export async function logoutAccount(
  controller: NotesAccountActionController
): Promise<void> {
  const token = getStoredSession()?.token ?? null;
  if (controller.isAccountBusy) return;
  controller.isAccountBusy = true;
  controller.accountError = '';
  try {
    if (token) await logout(token).catch(() => undefined);
    controller.clearSensitiveWorkspace();
    controller.clearLocalSession({
      accountMessage: 'Signed out and locked',
      clearEncryptionKeyMaterial: true,
      openLogin: true,
      syncMessage: 'Sign in to unlock and sync'
    });
    controller.notify(
      'info',
      'Signed out and locked',
      'Sign in to unlock notes on this browser.'
    );
  } finally {
    controller.isAccountBusy = false;
  }
}

export async function deleteAccount(
  controller: NotesAccountActionController
): Promise<void> {
  const token = getStoredSession()?.token ?? null;
  if (!token || controller.isAccountBusy) return;
  if (!controller.deletePasswordValue.trim()) {
    controller.accountError = 'Password required to delete account';
    return;
  }
  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  try {
    await controller.flushPendingSave();
    await deleteAccountRequest(token, {
      password: controller.deletePasswordValue
    });
    await clearLocalWorkspace();
    await controller.refresh();
    controller.openDraftNote();
    controller.deletePasswordValue = '';
    controller.accountDeleteEditing = false;
    controller.clearLocalSession({
      accountMessage: 'Account deleted',
      clearEncryptionKeyMaterial: true,
      syncMessage: 'Sign in to sync'
    });
    controller.notify('info', 'Account deleted');
  } catch (error) {
    controller.accountError =
      error instanceof Error ? error.message : 'Could not delete account';
    controller.notify(
      'error',
      'Delete account failed',
      controller.accountError
    );
  } finally {
    controller.isAccountBusy = false;
  }
}
