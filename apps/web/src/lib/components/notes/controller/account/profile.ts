import {
  getStoredSession,
  renameCurrentDevice,
  setStoredSession
} from '$lib/client/store';
import {
  revokeTrustedDevice as revokeTrustedDeviceRequest,
  updateAccount
} from '$lib/client/api-client';
import type { NotesAccountActionController } from './types';

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
