package com.author.notes.core

data class Device(
  val id: String,
  val name: String
)

data class LocalNote(
  val id: String,
  val title: String,
  val body: String,
  val titleHash: String?,
  val bodyHash: String?,
  val notebookIds: List<String>,
  val notebookId: String?,
  val createdAt: String,
  val updatedAt: String,
  val deletedAt: String?,
  val trashedAt: String?,
  val deviceId: String,
  val version: Int,
  val syncStatus: String,
  val lastSyncedVersion: Int,
  val lastSyncedAt: String?
)

data class LocalNotebook(
  val id: String,
  val name: String,
  val createdAt: String,
  val updatedAt: String,
  val deletedAt: String?,
  val deviceId: String,
  val version: Int,
  val syncStatus: String,
  val lastSyncedVersion: Int,
  val lastSyncedAt: String?
)

data class ConflictVersion<T>(
  val source: String,
  val deviceId: String,
  val deviceName: String,
  val updatedAt: String,
  val version: Int,
  val previewText: String,
  val record: T
)

data class SyncConflict<T>(
  val id: String,
  val entityType: String,
  val entityId: String,
  val reason: String,
  val local: ConflictVersion<T>,
  val remote: ConflictVersion<T>
)

data class LocalConflict(
  val id: String,
  val entityType: String,
  val entityId: String,
  val status: String,
  val createdAt: String,
  val noteConflict: SyncConflict<LocalNote>?,
  val notebookConflict: SyncConflict<LocalNotebook>?
) {
  val reason: String
    get() = noteConflict?.reason ?: notebookConflict?.reason ?: ""
}

data class Workspace(
  val notes: List<LocalNote>,
  val notebooks: List<LocalNotebook>,
  val trash: List<LocalNote>,
  val devices: List<Device>,
  val conflicts: List<LocalConflict>,
  val pendingSyncCount: Int,
  val lastSyncPass: LastSyncPass
)

data class LastSyncPass(
  val completedAt: String?,
  val pushed: Int,
  val pulled: Int,
  val conflicts: Int
)

data class AuthUser(
  val username: String,
  val displayName: String?
)

data class StoredSession(
  val token: String,
  val user: AuthUser,
  val expiresAt: String?
)

data class SyncRunResult(
  val pushed: Int,
  val pulled: Int,
  val conflicts: Int
)

data class RemoteSyncInfo(
  val enabled: Boolean,
  val state: String,
  val lastError: String?
)

