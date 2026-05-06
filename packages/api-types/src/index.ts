import type { Device, Note, Notebook } from '@author/schema';

export const API_PATHS = {
  health: '/api/health',
  authLogin: '/api/auth/login',
  authSignup: '/api/auth/signup',
  authValidate: '/api/auth/validate',
  authLogout: '/api/auth/logout',
  account: '/api/account',
  accountPassword: '/api/account/password',
  notes: '/api/notes',
  notebooks: '/api/notebooks',
  syncStatus: '/api/sync/status',
  syncPull: '/api/sync/pull',
  syncPush: '/api/sync/push',
  cleanupTrash: '/api/cleanup-trash'
} as const;

export type ApiPath = (typeof API_PATHS)[keyof typeof API_PATHS];

export interface AuthLoginRequest {
  username?: string;
  password: string;
  device: Device;
}

export interface AuthSignupRequest {
  username: string;
  password: string;
  displayName?: string | null;
  device: Device;
}

export interface AuthUser {
  username: string;
  displayName: string | null;
}

export interface AuthLoginResponse {
  token: string;
  user: AuthUser;
  device: Device;
  expiresAt: string;
}

export interface AuthValidateResponse {
  ok: true;
  time: string;
  user: AuthUser;
  expiresAt: string | null;
}

export interface AccountUpdateRequest {
  displayName?: string | null;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export interface DeleteAccountRequest {
  password: string;
}

export interface AccountResponse {
  user: AuthUser;
}

export interface HealthResponse {
  ok: true;
  service: 'author-notes';
  time: string;
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
