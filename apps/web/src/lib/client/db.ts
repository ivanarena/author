import Dexie, { type Table } from 'dexie';
import type { SyncConflict } from '@author/api-types';
import type { Device, Note, Notebook } from '@author/schema';
import { recordDebugLog } from './debug-log';

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

export type LocalNoteSnapshotReason = 'edit' | 'trash' | 'restore';

export interface LocalNoteSnapshot extends Note {
  snapshotId: string;
  savedAt: string;
  reason: LocalNoteSnapshotReason;
}

export interface LocalSecret {
  key: string;
  value: string;
}

export class NotesLocalDatabase extends Dexie {
  notes!: Table<LocalNote, string>;
  notebooks!: Table<LocalNotebook, string>;
  noteSnapshots!: Table<LocalNoteSnapshot, string>;
  devices!: Table<Device, string>;
  secrets!: Table<LocalSecret, string>;
  syncMeta!: Table<SyncMeta, string>;
  conflicts!: Table<LocalConflict, string>;

  constructor() {
    super('author');
    this.version(1).stores({
      notes:
        'id, notebookId, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
      notebooks:
        'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
      devices: 'id, name',
      syncMeta: 'key',
      conflicts: 'id, entityType, entityId, status, createdAt'
    });
    this.version(2)
      .stores({
        notes:
          'id, notebookId, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
        notebooks:
          'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
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
        notebooks:
          'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
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
    this.version(4).stores({
      notes:
        'id, notebookId, *notebookIds, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
      notebooks:
        'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
      noteSnapshots: 'snapshotId, id, savedAt, reason',
      devices: 'id, name',
      syncMeta: 'key',
      conflicts: 'id, entityType, entityId, status, createdAt'
    });
    this.version(5).stores({
      notes:
        'id, notebookId, *notebookIds, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
      notebooks:
        'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
      noteSnapshots: 'snapshotId, id, savedAt, reason',
      devices: 'id, name',
      secrets: 'key',
      syncMeta: 'key',
      conflicts: 'id, entityType, entityId, status, createdAt'
    });
    this.version(6)
      .stores({
        notes:
          'id, notebookId, *notebookIds, isFavorite, createdAt, updatedAt, deletedAt, trashedAt, deviceId, version, syncStatus, lastSyncedVersion',
        notebooks:
          'id, name, createdAt, updatedAt, deletedAt, deviceId, version, syncStatus, lastSyncedVersion',
        noteSnapshots: 'snapshotId, id, savedAt, reason',
        devices: 'id, name',
        secrets: 'key',
        syncMeta: 'key',
        conflicts: 'id, entityType, entityId, status, createdAt'
      })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((note) => {
            note.isFavorite = Boolean(note.isFavorite);
          });
        await tx
          .table('noteSnapshots')
          .toCollection()
          .modify((snapshot) => {
            snapshot.isFavorite = Boolean(snapshot.isFavorite);
          });
      });
  }
}

export const localDb = new NotesLocalDatabase();

localDb.on('blocked', () => {
  recordDebugLog({
    level: 'warn',
    source: 'IndexedDB',
    message: 'Database upgrade blocked by another open Author tab'
  });
});

localDb.on('versionchange', () => {
  recordDebugLog({
    level: 'info',
    source: 'IndexedDB',
    message: 'Database version changed; closing this connection'
  });
  localDb.close();
});

export async function clearLocalWorkspace(): Promise<void> {
  await localDb.transaction(
    'rw',
    [
      localDb.notes,
      localDb.notebooks,
      localDb.noteSnapshots,
      localDb.devices,
      localDb.secrets,
      localDb.syncMeta,
      localDb.conflicts
    ],
    async () => {
      await Promise.all([
        localDb.notes.clear(),
        localDb.notebooks.clear(),
        localDb.noteSnapshots.clear(),
        localDb.devices.clear(),
        localDb.secrets.clear(),
        localDb.syncMeta.clear(),
        localDb.conflicts.clear()
      ]);
    }
  );
}
