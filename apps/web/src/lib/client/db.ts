import Dexie, { type Table } from 'dexie';
import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';

export interface LocalNote extends Note {
  lastSyncedVersion: number;
  lastSyncedAt: string | null;
}

export interface LocalNotebook extends Notebook {
  lastSyncedVersion: number;
  lastSyncedAt: string | null;
}

export interface SyncMeta {
  key: string;
  value: string;
}

export interface LocalConflict {
  id: string;
  entityType: 'note' | 'notebook';
  entityId: string;
  status: 'pending' | 'resolved';
  createdAt: string;
  conflict: SyncConflict<Note> | SyncConflict<Notebook>;
}

export class NotesLocalDatabase extends Dexie {
  notes!: Table<LocalNote, string>;
  notebooks!: Table<LocalNotebook, string>;
  devices!: Table<Device, string>;
  syncMeta!: Table<SyncMeta, string>;
  conflicts!: Table<LocalConflict, string>;

  constructor() {
    super('author-notes');
    this.version(1).stores({
      notes:
        'id, notebookId, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
      notebooks: 'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
      devices: 'id, name',
      syncMeta: 'key',
      conflicts: 'id, entityType, entityId, status, createdAt'
    });
    this.version(2)
      .stores({
        notes:
          'id, notebookId, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
        notebooks: 'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
        devices: 'id, name',
        syncMeta: 'key',
        conflicts: 'id, entityType, entityId, status, createdAt'
      })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((note) => {
            if (note.body === undefined) {
              note.body = note.markdownBody ?? '';
            }
            delete note.markdownBody;
          });
      });
    this.version(3)
      .stores({
        notes:
          'id, notebookId, *notebookIds, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
        notebooks: 'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
        devices: 'id, name',
        syncMeta: 'key',
        conflicts: 'id, entityType, entityId, status, createdAt'
      })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((note) => {
            note.notebookIds = Array.isArray(note.notebookIds)
              ? [...new Set(note.notebookIds.filter(Boolean))]
              : note.notebookId
                ? [note.notebookId]
                : [];
            note.notebookId = note.notebookIds[0] ?? null;
          });
      });
  }
}

export const localDb = new NotesLocalDatabase();
