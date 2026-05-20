import { clearLocalWorkspace, getStoredSession } from '$lib/client/store';
import {
  deleteAccount as deleteAccountRequest,
  logout
} from '$lib/client/api-client';
import type { NotesAccountActionController } from './types';

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
