import type { Device, Note, Notebook } from '@author/schema';

export interface AuthLoginRequest {
  username?: string;
  password: string;
  device: Device;
}

export interface AuthUser {
  username: string;
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
}

export interface PullResponse {
  serverTime: string;
  notes: Note[];
  notebooks: Notebook[];
  devices: Device[];
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
  reason: 'remote_changed' | 'deleted_remotely' | 'version_mismatch' | 'duplicate_name';
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

export interface CleanupResponse {
  deletedNotes: number;
  deletedNotebooks: number;
  cutoff: string;
}
