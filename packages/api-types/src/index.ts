import type { Device, Note, Notebook } from '@author/schema';

export const SYNC_LIMITS = {
  entityIdBytes: 128,
  deviceIdBytes: 128,
  deviceNameBytes: 256,
  titleBytes: 512 * 1024,
  bodyBytes: 4 * 1024 * 1024,
  notebookNameBytes: 16 * 1024,
  fieldHashBytes: 256,
  timestampBytes: 64,
  notebookAssignments: 128,
  devicesPerAccount: 50,
  pullResponseBytes: 6 * 1024 * 1024
} as const;

// A push conflict may contain both the incoming and current maximum-size note.
export const MAX_API_RESPONSE_BYTES = 12 * 1024 * 1024;

export const API_PATHS = {
  health: '/api/health',
  metrics: '/api/metrics',
  config: '/api/config',
  authChallenge: '/api/auth/challenge',
  authLogin: '/api/auth/login',
  authSignup: '/api/auth/signup',
  authValidate: '/api/auth/validate',
  authLogout: '/api/auth/logout',
  accountTotpSetup: '/api/account/totp/setup',
  accountTotp: '/api/account/totp',
  account: '/api/account',
  accountTrustedDevices: '/api/account/trusted-devices',
  accountPassword: '/api/account/password',
  notes: '/api/notes',
  notebooks: '/api/notebooks',
  syncStatus: '/api/sync/status',
  syncPull: '/api/sync/pull',
  syncPush: '/api/sync/push',
  cleanupTrash: '/api/cleanup-trash'
} as const;

export type ApiPath = (typeof API_PATHS)[keyof typeof API_PATHS];

export type AuthProofPurpose =
  | 'login'
  | 'password_change'
  | 'keyring_update'
  | 'totp'
  | 'delete_account';

export interface AuthKdfParams {
  algorithm: 'argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  keyLength: number;
}

export interface PasswordVerifier {
  algorithm: 'argon2id-scram-sha256';
  salt: string;
  params: AuthKdfParams;
  storedKey: string;
  serverKey: string;
}

export interface AuthProof {
  challengeId: string;
  clientNonce: string;
  proof: string;
}

export interface AuthChallengeRequest {
  username?: string | null;
  purpose: AuthProofPurpose;
  clientNonce: string;
}

export interface AuthChallengeResponse {
  mode: 'proof' | 'bootstrap';
  challengeId: string;
  username: string;
  purpose: AuthProofPurpose;
  clientNonce: string;
  serverNonce: string;
  expiresAt: string;
  salt: string;
  params: AuthKdfParams;
}

export interface AuthLoginRequest {
  username?: string;
  proof?: AuthProof | null;
  passwordVerifier?: PasswordVerifier | null;
  /** Used only to verify the one-time env bootstrap account. */
  bootstrapPassword?: string | null;
  /** @deprecated Client convenience only. Runtime API requests use proof. */
  password?: string | null;
  totpCode?: string | null;
  device: Device;
  deviceTrustSecret?: string | null;
}

export interface AuthSignupRequest {
  username: string;
  email: string;
  invitationCode: string;
  passwordVerifier?: PasswordVerifier | null;
  e2eeKeyring?: string | null;
  /** @deprecated Client convenience only. Runtime API requests use passwordVerifier. */
  password?: string;
  /** @deprecated Display names are accepted only for older clients. */
  displayName?: string | null;
  device: Device;
  deviceTrustSecret?: string | null;
}

export interface AuthUser {
  username: string;
  email: string | null;
  displayName: string | null;
  profileImage: string | null;
  twoFactorEnabled: boolean;
}

export interface TrustedAuthDevice {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface AccountSession {
  /** Present only for clients that explicitly request bearer-session mode. */
  token?: string;
  expiresAt: string;
}

export interface AuthLoginResponse {
  /** Present only for clients that explicitly request bearer-session mode. */
  token?: string;
  user: AuthUser;
  device: Device;
  expiresAt: string;
  serverProof?: string | null;
  e2eeKeyring?: string | null;
}

export interface AuthValidateResponse {
  ok: true;
  time: string;
  user: AuthUser;
  expiresAt: string | null;
}

export interface AccountUpdateRequest {
  /** @deprecated Display names are accepted only for older clients. */
  displayName?: string | null;
  email?: string | null;
  profileImage?: string | null;
  e2eeKeyring?: string | null;
  proof?: AuthProof | null;
  expectedE2eeKeyringHash?: string | null;
}

export interface PasswordChangeRequest {
  proof?: AuthProof | null;
  newPasswordVerifier?: PasswordVerifier | null;
  e2eeKeyring?: string | null;
  /** @deprecated Client convenience only. Runtime API requests use proof. */
  currentPassword?: string;
  /** @deprecated Client convenience only. Runtime API requests use newPasswordVerifier. */
  newPassword?: string;
}

export interface DeleteAccountRequest {
  proof?: AuthProof | null;
  /** @deprecated Client convenience only. Runtime API requests use proof. */
  password?: string;
}

export interface AccountResponse {
  user: AuthUser;
  trustedDevices: TrustedAuthDevice[];
  session?: AccountSession;
  e2eeKeyring?: string | null;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface TotpEnableRequest {
  proof?: AuthProof | null;
  /** @deprecated Client convenience only. Runtime API requests use proof. */
  currentPassword?: string;
  secret: string;
  totpCode: string;
}

export interface TotpDisableRequest {
  proof?: AuthProof | null;
  /** @deprecated Client convenience only. Runtime API requests use proof. */
  currentPassword?: string;
  totpCode?: string | null;
}

export interface HealthResponse {
  ok: true;
  service: 'author';
  time: string;
}

export interface ConfigResponse {
  apiBaseUrl: string;
  remote: {
    enabled: boolean;
    configured: boolean;
  };
  signup: {
    enabled: boolean;
    emailRequired: boolean;
    emailAllowListRequired: boolean;
    invitationRequired: boolean;
  };
}

export interface EntityChange<T> {
  record: T;
  baseVersion: number;
}

export type NoteChange = EntityChange<Note>;
export type NotebookChange = EntityChange<Notebook>;

export interface PullRequest {
  since?: string | null;
  sinceRevision?: number | null;
  limit?: number | null;
}

export interface PullResponse {
  serverTime: string;
  serverRevision: number;
  notes: Note[];
  notebooks: Notebook[];
  devices: Device[];
  deletedNoteIds: string[];
  deletedNotebookIds: string[];
  deletedDeviceIds: string[];
  hasMore?: boolean;
}

export interface PushRequest {
  device: Device;
  notes: NoteChange[];
  notebooks: NotebookChange[];
}

export interface ConflictVersion<T> {
  source: 'local' | 'remote';
  deviceId: string;
  deviceName: string;
  updatedAt: string;
  version: number;
  previewText: string;
  record: T;
}

export interface SyncConflict<T> {
  id: string;
  entityType: 'note' | 'notebook';
  entityId: string;
  reason:
    | 'remote_changed'
    | 'deleted_remotely'
    | 'version_mismatch'
    | 'duplicate_name';
  local: ConflictVersion<T>;
  remote: ConflictVersion<T>;
}

export interface AcceptedChange {
  entityType: 'note' | 'notebook';
  id: string;
  version: number;
  updatedAt: string;
}

export interface PushResponse {
  serverTime: string;
  accepted: AcceptedChange[];
  conflicts: Array<SyncConflict<Note> | SyncConflict<Notebook>>;
}

export type RemoteSyncState =
  | 'disabled'
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'error';

export interface SyncStatusResponse {
  remote: {
    enabled: boolean;
    state: RemoteSyncState;
    pendingSince: string | null;
    lastStartedAt: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  };
}

export interface CleanupResponse {
  deletedNotes: number;
  deletedNotebooks: number;
  cutoff: string;
}
