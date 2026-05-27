import {
  commitEncryptionKeyMaterial,
  getEncryptionKeyMaterial,
  hasStoredEncryptionKeyMaterial,
  prepareEncryptionPassword
} from '$lib/client/encryption';
import {
  adoptLocalWorkspaceForAccount,
  getLoginHint,
  getStoredSession,
  prepareLocalWorkspaceForAccount,
  setStoredSession
} from '$lib/client/store';
import { logout } from '$lib/client/api-client';
import { login, signup } from '$lib/client/sync';
import type { AuthMode } from '../models';
import {
  MIN_PASSWORD_LENGTH,
  type NotesAccountActionController
} from './types';

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
      : (() => {
          const previousMaterial = getEncryptionKeyMaterial();
          return {
            previousMaterial,
            nextMaterial: previousMaterial
          };
        })();
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
