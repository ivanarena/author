export type ISODateString = string;

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'deleted';

export interface Note {
  id: string;
  title: string;
  body: string;
  notebookId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
  trashedAt: ISODateString | null;
  deviceId: string;
  version: number;
  syncStatus: SyncStatus;
}

export interface Notebook {
  id: string;
  name: string;
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
  reason: 'push' | 'conflict' | 'cleanup' | 'resolution';
}

export interface NotebookSnapshot extends Notebook {
  savedAt: ISODateString;
  reason: 'push' | 'conflict' | 'cleanup' | 'resolution';
}

export const NOTE_RETENTION_DAYS = 90;
