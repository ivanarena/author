export type ISODateString = string;

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'deleted';

export interface Note {
  id: string;
  title: string;
  body: string;
  titleHash?: string | null;
  bodyHash?: string | null;
  notebookIds: string[];
  notebookId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
  trashedAt: ISODateString | null;
  isFavorite: boolean;
  deviceId: string;
  version: number;
  syncStatus: SyncStatus;
}

export interface Notebook {
  id: string;
  name: string;
  nameHash?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
  deviceId: string;
  version: number;
  syncStatus: SyncStatus;
}

export interface Device {
  id: string;
  name: string;
}

export interface NoteSnapshot extends Note {
  savedAt: ISODateString;
  reason: 'push' | 'handoff' | 'conflict' | 'cleanup' | 'resolution';
}

export interface NotebookSnapshot extends Notebook {
  savedAt: ISODateString;
  reason: 'push' | 'handoff' | 'conflict' | 'cleanup' | 'resolution';
}

export const NOTE_RETENTION_DAYS = 90;
export const VERSION_SNAPSHOT_RETENTION_DAYS = 365;
/**
 * Server edit-history snapshots ('push' and 'handoff') are coalesced: a record
 * gets at most one new 'push' snapshot per window. History older than
 * VERSION_SNAPSHOT_DENSE_HOURS keeps only the newest snapshot per UTC day, and
 * at most MAX_HISTORY_SNAPSHOTS_PER_RECORD snapshots are kept per record.
 */
export const VERSION_SNAPSHOT_WINDOW_MINUTES = 10;
export const VERSION_SNAPSHOT_DENSE_HOURS = 24;
export const MAX_HISTORY_SNAPSHOTS_PER_RECORD = 100;
