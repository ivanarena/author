package com.author.core

data class Device(val id: String, val name: String)

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
  val lastSyncedAt: String?,
  val isFavorite: Boolean = false,
)

data class LocalNotebook(
  val id: String,
  val name: String,
  val nameHash: String?,
  val createdAt: String,
  val updatedAt: String,
  val deletedAt: String?,
  val deviceId: String,
  val version: Int,
  val syncStatus: String,
  val lastSyncedVersion: Int,
  val lastSyncedAt: String?,
)

data class ConflictVersion<T>(
  val source: String,
  val deviceId: String,
  val deviceName: String,
  val updatedAt: String,
  val version: Int,
  val previewText: String,
  val record: T,
)

data class SyncConflict<T>(
  val id: String,
  val entityType: String,
  val entityId: String,
  val reason: String,
  val local: ConflictVersion<T>,
  val remote: ConflictVersion<T>,
)

data class LocalConflict(
  val id: String,
  val entityType: String,
  val entityId: String,
  val status: String,
  val createdAt: String,
  val noteConflict: SyncConflict<LocalNote>?,
  val notebookConflict: SyncConflict<LocalNotebook>?,
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
  val lastSyncPass: LastSyncPass,
  val syncDebugInfo: SyncDebugInfo,
  val appDebugLogEntries: List<DebugLogEntry>,
)

data class LastSyncPass(
  val completedAt: String?,
  val pushed: Int,
  val pulled: Int,
  val conflicts: Int,
)

data class SyncDebugInfo(
  val lastErrorAt: String?,
  val lastErrorMessage: String,
  val lastErrorStack: String,
)

data class RepairDiagnosticEntry(val label: String, val status: String, val detail: String)

data class RepairDiagnostics(
  val checkedAt: String,
  val issueCount: Int,
  val canResetPullCursor: Boolean,
  val canResetDeviceSync: Boolean,
  val entries: List<RepairDiagnosticEntry>,
)

data class DebugLogEntry(
  val id: String,
  val at: String,
  val level: String,
  val source: String,
  val message: String,
  val detail: String,
)

data class AuthUser(
  val username: String,
  val email: String?,
  val displayName: String?,
  val twoFactorEnabled: Boolean,
)

data class TrustedAuthDevice(
  val deviceId: String,
  val deviceName: String,
  val createdAt: String,
  val lastUsedAt: String,
  val current: Boolean,
)

data class AccountSession(val token: String, val expiresAt: String?)

data class AccountResponse(
  val user: AuthUser,
  val trustedDevices: List<TrustedAuthDevice>,
  val session: AccountSession? = null,
  val e2eeKeyring: String? = null,
)

data class StoredSession(val token: String, val user: AuthUser, val expiresAt: String?)

data class TotpSetup(val secret: String, val otpauthUrl: String)

data class SyncRunResult(val pushed: Int, val pulled: Int, val conflicts: Int)

enum class SyncProgressPhase {
  PREPARING,
  PUSHING,
  PULLING,
}

data class SyncProgress(
  val phase: SyncProgressPhase,
  val pushed: Int = 0,
  val pulled: Int = 0,
  val total: Int = 0,
  val batchSize: Int = 0,
  val pageSize: Int = 0,
  val hasMore: Boolean = false,
)

data class RemoteSyncInfo(val enabled: Boolean, val state: String, val lastError: String?)

data class ServerConfig(
  val apiBaseUrl: String,
  val remoteSyncEnabled: Boolean,
  val remoteDatabaseConfigured: Boolean,
  val signupEnabled: Boolean,
  val signupEmailRequired: Boolean,
)
