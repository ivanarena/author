import {
  commitEncryptionKeyMaterial,
  createRecoveryBundle,
  getEncryptionKeyMaterial,
  recoveryKitFileName,
  recoveryKitText,
  rewrapKeyringForPassword
} from '$lib/client/encryption';
import {
  clearSyncError,
  getStoredSession,
  preflightReencryptLocalNotes,
  reencryptLocalNotes,
  recordLastSyncPass,
  recordSyncError,
  setStoredSession
} from '$lib/client/store';
import {
  changePassword,
  disableTotp,
  enableTotp,
  loadAccount,
  setupTotp,
  updateAccount
} from '$lib/client/api-client';
import { runSync } from '$lib/client/sync';
import { passwordMeetsMinimumLength } from '$lib/shared/password-policy';
import {
  MIN_PASSWORD_LENGTH,
  type NotesAccountActionController
} from './types';

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

export async function downloadRecoveryKit(
  controller: NotesAccountActionController
): Promise<void> {
  const session = getStoredSession();
  if (!session || controller.isAccountBusy) return;
  controller.isAccountBusy = true;
  controller.accountError = '';
  controller.accountMessage = '';
  try {
    const account = await loadAccount(session.token);
    const bundle = await createRecoveryBundle(account.e2eeKeyring);
    if (bundle.e2eeKeyring) {
      await updateAccount(session.token, { e2eeKeyring: bundle.e2eeKeyring });
    }
    controller.downloadBlob(
      new Blob([recoveryKitText(bundle.recoveryKit)], {
        type: 'application/json'
      }),
      recoveryKitFileName()
    );
    controller.accountRecoveryCodeValue = bundle.recoveryCode;
    controller.accountMessage = 'Recovery kit downloaded. Save the code.';
    controller.notify('success', 'Recovery kit downloaded', 'Save the code.');
  } catch (error) {
    controller.accountError =
      error instanceof Error ? error.message : 'Could not create recovery kit';
    controller.notify('error', 'Recovery kit failed', controller.accountError);
  } finally {
    controller.isAccountBusy = false;
  }
}

export async function changeAccountPassword(
  controller: NotesAccountActionController
): Promise<void> {
  const session = getStoredSession();
  if (!session || controller.isAccountBusy) return;
  const token = session.token;
  const username = session.user.username.trim();
  if (!username) {
    controller.accountError = 'Sign in again before changing password';
    return;
  }
  if (!controller.currentPasswordValue.trim()) {
    controller.accountError = 'Current password required';
    return;
  }
  if (!controller.newPasswordValue.trim()) {
    controller.accountError = 'New password required';
    return;
  }
  if (!passwordMeetsMinimumLength(controller.newPasswordValue)) {
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
    const currentMaterial = getEncryptionKeyMaterial();
    const account = await loadAccount(token);
    const e2eeKeyring = await rewrapKeyringForPassword(
      currentMaterial,
      username,
      controller.newPasswordValue,
      account.e2eeKeyring
    );
    await preflightReencryptLocalNotes(currentMaterial, currentMaterial);
    const response = await changePassword(token, {
      currentPassword: controller.currentPasswordValue,
      newPassword: controller.newPasswordValue,
      e2eeKeyring
    });
    passwordChanged = true;
    if (!response.session) {
      throw new Error(
        'Password changed, but Author could not create a replacement session.'
      );
    }
    await reencryptLocalNotes(currentMaterial, currentMaterial);
    commitEncryptionKeyMaterial(currentMaterial);
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
    controller.accountMessage = 'Password changed';
    controller.syncMessage = 'Local changes saved';
    controller.notify(
      'success',
      'Password changed',
      'Your encrypted notes stayed on the same data key.'
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Could not change password';
    if (passwordChanged) {
      await recordSyncError(error, 'Password change sync');
      controller.syncMessage = 'Password changed; sync retry needed';
    }
    controller.accountError = passwordChanged
      ? `Password changed, but Author could not finish syncing. ${detail}`
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
