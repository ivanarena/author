import type { TrustedAuthDevice } from '@author/api-types';
import type { Device } from '@author/schema';
import type { SyncProgress } from '$lib/client/sync';
import type { AppNotification, AuthMode } from '../models';

export { MIN_PASSWORD_LENGTH } from '$lib/shared/password-policy';

export interface LastSyncPass {
  completedAt: string | null;
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface ClearLocalSessionOptions {
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
  accountRecoveryCodeValue: string;
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
  signupInvitationValue: string;
  signupEnabled: boolean;
  syncActivityLabel: string;
  syncActivityDetail: string;
  syncMessage: string;

  clearLocalSession: (options?: ClearLocalSessionOptions) => void;
  clearSensitiveWorkspace: () => void;
  downloadBlob: (blob: Blob, fileName: string) => void;
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
  showSignupRecoveryPrompt: (
    recoveryCode: string,
    recoveryKitText: string
  ) => void;
  syncNow: () => Promise<void>;
  updateSyncProgress: (progress: SyncProgress) => void;
}
