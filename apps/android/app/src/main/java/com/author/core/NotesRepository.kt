package com.author.core

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.core.content.edit
import com.author.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val DEVICE_KEY = "author-device-id"
private const val TOKEN_KEY = "author-token"
private const val USERNAME_KEY = "author-username"
private const val LAST_USERNAME_KEY = "author-last-username"
private const val EMAIL_KEY = "author-email"
private const val DISPLAY_NAME_KEY = "author-display-name"
private const val TWO_FACTOR_KEY = "author-two-factor-enabled"
private const val SESSION_EXPIRES_KEY = "author-session-expires-at"
private const val THEME_KEY = "author-theme"
private const val SORT_KEY = "author-sort"
private const val COMPACT_VIEW_KEY = "author-compact-view"
private const val EDITOR_ZOOM_KEY = "author-editor-zoom"
private const val EDITOR_FONT_KEY = "author-editor-font"
private const val EDITOR_TEXT_SIZE_KEY = "author-editor-text-size"
private const val EDITOR_LINE_HEIGHT_KEY = "author-editor-line-height"
private const val API_BASE_URL_KEY = "author-api-base-url"
private const val LOCAL_WORKSPACE_OWNER_KEY = "localWorkspaceOwner"
private const val ENCRYPTION_AUDIT_VERSION_KEY = "localEncryptionAuditVersion"
private const val ENCRYPTION_AUDIT_VERSION = "content-conflicts:v2"
private const val LAST_SYNC_ERROR_AT_KEY = "lastSyncErrorAt"
private const val LAST_SYNC_ERROR_SOURCE_KEY = "lastSyncErrorSource"
private const val LAST_SYNC_ERROR_MESSAGE_KEY = "lastSyncErrorMessage"
private const val LAST_SYNC_ERROR_STACK_KEY = "lastSyncErrorStack"
private const val PUSH_BATCH_SIZE = 250
private const val PULL_BATCH_SIZE = 1000
private val THEMES = setOf(
  "light",
  "light-mint",
  "light-rose",
  "light-lavender",
  "dark",
  "dark-mint",
  "dark-rose",
  "dark-lavender"
)
private val FONTS = setOf("kedebideri", "system-sans", "system-serif", "mono")

class NotesRepository(context: Context) {
  private val appContext = context.applicationContext
  private val prefs: SharedPreferences =
    appContext.getSharedPreferences("author", Context.MODE_PRIVATE)
  private val securePrefs = SecurePreferenceStore(prefs)
  private val db = NotesDatabase(appContext)
  private val crypto = NoteCrypto(prefs, securePrefs)
  private val syncClient = SyncClient { getApiBaseUrl() }

  fun getTheme(): String {
    val stored = prefs.getString(THEME_KEY, null)
    if (stored in THEMES) return stored ?: "light"
    return if ((appContext.resources.configuration.uiMode and 0x30) == 0x20) "dark" else "light"
  }

  fun setTheme(theme: String) {
    prefs.edit { putString(THEME_KEY, if (theme in THEMES) theme else "light") }
  }

  fun getSort(): String = prefs.getString(SORT_KEY, "date-desc") ?: "date-desc"

  fun setSort(sort: String) {
    prefs.edit { putString(SORT_KEY, sort) }
  }

  fun getCompactView(): Boolean = prefs.getBoolean(COMPACT_VIEW_KEY, false)

  fun setCompactView(value: Boolean) {
    prefs.edit { putBoolean(COMPACT_VIEW_KEY, value) }
  }

  fun getEditorZoom(): Float = prefs.getFloat(EDITOR_ZOOM_KEY, 1f).coerceIn(0.8f, 1.4f)

  fun setEditorZoom(value: Float) {
    prefs.edit { putFloat(EDITOR_ZOOM_KEY, value.coerceIn(0.8f, 1.4f)) }
  }

  fun getEditorFont(): String {
    val stored = prefs.getString(EDITOR_FONT_KEY, null)
    return if (stored in FONTS) stored ?: "kedebideri" else "kedebideri"
  }

  fun setEditorFont(value: String) {
    prefs.edit { putString(EDITOR_FONT_KEY, if (value in FONTS) value else "kedebideri") }
  }

  fun getEditorTextSize(): Float = prefs.getFloat(EDITOR_TEXT_SIZE_KEY, 16f).coerceIn(14f, 22f)

  fun setEditorTextSize(value: Float) {
    prefs.edit { putFloat(EDITOR_TEXT_SIZE_KEY, value.coerceIn(14f, 22f)) }
  }

  fun getEditorLineHeight(): Float = prefs.getFloat(EDITOR_LINE_HEIGHT_KEY, 1.75f).coerceIn(1.35f, 2.1f)

  fun setEditorLineHeight(value: Float) {
    prefs.edit { putFloat(EDITOR_LINE_HEIGHT_KEY, value.coerceIn(1.35f, 2.1f)) }
  }

  fun getApiBaseUrl(): String = prefs.getString(API_BASE_URL_KEY, BuildConfig.DEFAULT_API_BASE_URL) ?: BuildConfig.DEFAULT_API_BASE_URL

  fun setApiBaseUrl(value: String) {
    prefs.edit { putString(API_BASE_URL_KEY, value.trim()) }
  }

  fun getLoginHint(): String = prefs.getString(USERNAME_KEY, null)
    ?: prefs.getString(LAST_USERNAME_KEY, null)
    ?: ""

  fun getStoredSession(): StoredSession? {
    val token = securePrefs.getString(TOKEN_KEY) ?: return null
    return StoredSession(
      token = token,
      user = AuthUser(
        username = prefs.getString(USERNAME_KEY, "") ?: "",
        email = prefs.getString(EMAIL_KEY, null),
        displayName = prefs.getString(DISPLAY_NAME_KEY, null),
        twoFactorEnabled = prefs.getBoolean(TWO_FACTOR_KEY, false)
      ),
      expiresAt = prefs.getString(SESSION_EXPIRES_KEY, null)
    )
  }

  fun setStoredSession(session: StoredSession) {
    securePrefs.putString(TOKEN_KEY, session.token)
    prefs.edit {
      putString(USERNAME_KEY, session.user.username)
      putString(LAST_USERNAME_KEY, session.user.username)
      putNullableString(EMAIL_KEY, session.user.email)
      putNullableString(DISPLAY_NAME_KEY, session.user.displayName)
      putBoolean(TWO_FACTOR_KEY, session.user.twoFactorEnabled)
      putNullableString(SESSION_EXPIRES_KEY, session.expiresAt)
    }
  }

  fun clearStoredSession(clearEncryptionKeyMaterial: Boolean = false) {
    prefs.edit {
      remove(USERNAME_KEY)
      remove(EMAIL_KEY)
      remove(DISPLAY_NAME_KEY)
      remove(TWO_FACTOR_KEY)
      remove(SESSION_EXPIRES_KEY)
    }
    securePrefs.remove(TOKEN_KEY)
    if (clearEncryptionKeyMaterial) crypto.clearStoredEncryptionKeyMaterial()
  }

  fun hasStoredEncryptionKeyMaterial(): Boolean = crypto.hasStoredEncryptionKeyMaterial()

  fun enqueueBackgroundSync() {
    SyncWorker.enqueue(appContext)
  }

  suspend fun getOrCreateDevice(): Device = withContext(Dispatchers.IO) {
    var id = prefs.getString(DEVICE_KEY, null)
    if (id == null) {
      id = newId()
      prefs.edit { putString(DEVICE_KEY, id) }
    }
    db.getDevice(id) ?: Device(id, deviceName()).also { db.putDevice(it) }
  }

  suspend fun createBlankNote(
    title: String = "",
    body: String = "",
    notebookId: String? = null
  ): LocalNote = withContext(Dispatchers.IO) {
    val device = getOrCreateDevice()
    val now = nowIso()
    val notebookIds = notebookId?.let { listOf(it) } ?: emptyList()
    val note = LocalNote(
      id = newId(),
      title = title.trim(),
      body = body,
      titleHash = null,
      bodyHash = null,
      notebookIds = notebookIds,
      notebookId = primaryNotebookId(notebookIds),
      createdAt = now,
      updatedAt = now,
      deletedAt = null,
      trashedAt = null,
      deviceId = device.id,
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null
    )
    db.putNote(crypto.encryptNoteFields(note))
    note
  }

  suspend fun updateNoteContent(noteId: String, title: String, body: String): LocalNote? = withContext(Dispatchers.IO) {
    val note = db.getNote(noteId) ?: return@withContext null
    if (note.deletedAt != null) return@withContext null
    val device = getOrCreateDevice()
    val updated = note.copy(
      title = title.trim(),
      body = body,
      updatedAt = nowIso(),
      deviceId = device.id,
      version = note.version + 1,
      syncStatus = "pending"
    )
    db.putNote(crypto.encryptNoteFields(updated))
    db.getNote(noteId)?.let { crypto.decryptNoteFields(it) }
  }

  suspend fun createNotebook(name: String): LocalNotebook? = withContext(Dispatchers.IO) {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return@withContext null
    val device = getOrCreateDevice()
    val now = nowIso()
    val notebook = LocalNotebook(
      id = newId(),
      name = trimmed,
      nameHash = null,
      createdAt = now,
      updatedAt = now,
      deletedAt = null,
      deviceId = device.id,
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null
    )
    db.putNotebook(crypto.encryptNotebookFields(notebook))
    notebook
  }

  suspend fun renameNotebook(notebookId: String, name: String): LocalNotebook? = withContext(Dispatchers.IO) {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return@withContext null
    val notebook = db.getNotebook(notebookId) ?: return@withContext null
    if (notebook.deletedAt != null) return@withContext null
    val plainNotebook = crypto.decryptNotebookFields(notebook)
    if (plainNotebook.name == trimmed) return@withContext plainNotebook
    val device = getOrCreateDevice()
    val updated = plainNotebook.copy(
      name = trimmed,
      updatedAt = nowIso(),
      deviceId = device.id,
      version = notebook.version + 1,
      syncStatus = "pending"
    )
    db.putNotebook(crypto.encryptNotebookFields(updated))
    updated
  }

  suspend fun deleteNotebook(notebookId: String) = withContext(Dispatchers.IO) {
    val notebook = db.getNotebook(notebookId) ?: return@withContext
    if (notebook.deletedAt != null) return@withContext
    val device = getOrCreateDevice()
    val now = nowIso()
    db.putNotebook(
      notebook.copy(
        deletedAt = now,
        updatedAt = now,
        deviceId = device.id,
        version = notebook.version + 1,
        syncStatus = "pending"
      )
    )
    db.allNotes()
      .filter { it.deletedAt == null && it.trashedAt == null && noteNotebookIds(it).contains(notebookId) }
      .forEach { note ->
        val ids = noteNotebookIds(note).filter { it != notebookId }
        db.putNote(
          note.copy(
            notebookIds = ids,
            notebookId = primaryNotebookId(ids),
            trashedAt = now,
            updatedAt = now,
            deviceId = device.id,
            version = note.version + 1,
            syncStatus = "pending"
          )
        )
      }
  }

  suspend fun assignNoteToNotebook(
    noteId: String,
    notebookId: String?,
    assigned: Boolean
  ): LocalNote? = withContext(Dispatchers.IO) {
    val note = db.getNote(noteId) ?: return@withContext null
    if (note.deletedAt != null) return@withContext crypto.decryptNoteFields(note)
    val currentIds = noteNotebookIds(note)
    val notebookIds = if (notebookId != null) {
      if (assigned) {
        if (currentIds.contains(notebookId)) currentIds else currentIds + notebookId
      } else {
        currentIds.filter { it != notebookId }
      }
    } else {
      emptyList()
    }
    if (currentIds == notebookIds) return@withContext crypto.decryptNoteFields(note)
    val device = getOrCreateDevice()
    val updated = note.copy(
      notebookIds = notebookIds,
      notebookId = primaryNotebookId(notebookIds),
      updatedAt = nowIso(),
      deviceId = device.id,
      version = note.version + 1,
      syncStatus = "pending"
    )
    db.putNote(updated)
    crypto.decryptNoteFields(updated)
  }

  suspend fun moveNoteToTrash(noteId: String) = withContext(Dispatchers.IO) {
    val note = db.getNote(noteId) ?: return@withContext
    if (note.trashedAt != null) return@withContext
    val device = getOrCreateDevice()
    val now = nowIso()
    db.putNote(
      note.copy(
        trashedAt = now,
        updatedAt = now,
        deviceId = device.id,
        version = note.version + 1,
        syncStatus = "pending"
      )
    )
  }

  suspend fun restoreNote(noteId: String) = withContext(Dispatchers.IO) {
    val note = db.getNote(noteId) ?: return@withContext
    if (note.trashedAt == null) return@withContext
    val device = getOrCreateDevice()
    val now = nowIso()
    db.putNote(
      note.copy(
        trashedAt = null,
        updatedAt = now,
        deviceId = device.id,
        version = note.version + 1,
        syncStatus = "pending"
      )
    )
  }

  suspend fun deleteNotePermanently(noteId: String) = withContext(Dispatchers.IO) {
    val note = db.getNote(noteId) ?: return@withContext
    if (note.deletedAt != null) return@withContext
    val device = getOrCreateDevice()
    val now = nowIso()
    db.putNote(
      note.copy(
        deletedAt = now,
        trashedAt = note.trashedAt ?: now,
        updatedAt = now,
        deviceId = device.id,
        version = note.version + 1,
        syncStatus = "pending"
      )
    )
  }

  suspend fun loadWorkspace(): Workspace = withContext(Dispatchers.IO) {
    val notes = db.allNotes().map { crypto.decryptNoteFields(it) }
    val notebooks = db.allNotebooks().map { crypto.decryptNotebookFields(it) }
    val activeNotes = notes.filter { it.deletedAt == null && it.trashedAt == null }
      .sortedByDescending { it.updatedAt }
    val trash = notes.filter { it.deletedAt == null && it.trashedAt != null }
      .sortedByDescending { it.trashedAt ?: "" }
    Workspace(
      notes = activeNotes,
      notebooks = notebooks.filter { it.deletedAt == null }.sortedBy { it.name.lowercase() },
      trash = trash,
      devices = db.allDevices(),
      conflicts = loadPendingConflictsInternal(),
      pendingSyncCount = db.pendingSyncCount(),
      lastSyncPass = loadLastSyncPassInternal(),
      syncDebugInfo = loadSyncDebugInfoInternal()
    )
  }

  suspend fun ensureLocalNotesEncrypted() = withContext(Dispatchers.IO) {
    if (db.getMeta(ENCRYPTION_AUDIT_VERSION_KEY) == ENCRYPTION_AUDIT_VERSION) return@withContext
    val notes = db.allNotes()
    val changed = notes.filter {
      !crypto.isEncryptedText(it.title) ||
        !crypto.isEncryptedText(it.body) ||
        it.titleHash == null ||
        it.bodyHash == null
    }
    if (changed.isNotEmpty()) {
      val device = getOrCreateDevice()
      db.putNotes(
        changed.map { before ->
          crypto.encryptNoteFields(crypto.decryptNoteFields(before)).copy(
            deviceId = device.id,
            version = before.version + 1,
            syncStatus = if (before.syncStatus == "conflict" || before.syncStatus == "deleted") before.syncStatus else "pending"
          )
        }
      )
    }
    val notebooks = db.allNotebooks()
    val changedNotebooks = notebooks.filter {
      !crypto.isEncryptedText(it.name) || it.nameHash == null
    }
    if (changedNotebooks.isNotEmpty()) {
      val device = getOrCreateDevice()
      db.putNotebooks(
        changedNotebooks.map { before ->
          crypto.encryptNotebookFields(crypto.decryptNotebookFields(before)).copy(
            deviceId = device.id,
            version = before.version + 1,
            syncStatus = if (before.syncStatus == "conflict" || before.syncStatus == "deleted") before.syncStatus else "pending"
          )
        }
      )
    }
    ensureLocalConflictsEncryptedInternal()
    db.putMeta(ENCRYPTION_AUDIT_VERSION_KEY, ENCRYPTION_AUDIT_VERSION)
  }

  suspend fun login(username: String, password: String, totpCode: String?): LoginResponse = withContext(Dispatchers.IO) {
    syncClient.login(username, password, totpCode, getOrCreateDevice())
  }

  suspend fun signup(username: String, email: String, password: String, displayName: String?): LoginResponse = withContext(Dispatchers.IO) {
    syncClient.signup(username, email, password, displayName, getOrCreateDevice())
  }

  suspend fun assertLocalWorkspaceCanUseAccount(username: String, previousUsername: String?) = withContext(Dispatchers.IO) {
    assertLocalWorkspaceCanUseAccountInternal(username, previousUsername)
  }

  suspend fun rememberPasswordAndAdopt(username: String, password: String, previousUsername: String?) = withContext(Dispatchers.IO) {
    assertLocalWorkspaceCanUseAccountInternal(username, previousUsername)
    val (previous, next) = crypto.rememberEncryptionPassword(username, password)
    reencryptLocalNotesInternal(previous, next)
    rememberLocalWorkspaceAccount(username)
  }

  suspend fun adoptWithStoredKey(username: String, previousUsername: String?) = withContext(Dispatchers.IO) {
    assertLocalWorkspaceCanUseAccountInternal(username, previousUsername)
    val material = crypto.getEncryptionKeyMaterial()
    reencryptLocalNotesInternal(material, material)
    rememberLocalWorkspaceAccount(username)
  }

  suspend fun validateSession(token: String): Pair<AuthUser, String?> = withContext(Dispatchers.IO) {
    syncClient.validateSession(token)
  }

  suspend fun loadServerConfig(): ServerConfig = withContext(Dispatchers.IO) {
    syncClient.loadServerConfig()
  }

  suspend fun loadSyncStatus(token: String): RemoteSyncInfo = withContext(Dispatchers.IO) {
    syncClient.loadSyncStatus(token)
  }

  suspend fun recordSyncError(error: Throwable, source: String = "Sync") = withContext(Dispatchers.IO) {
    if (error is CancellationException) throw error
    recordSyncErrorInternal(error, source)
  }

  suspend fun clearSyncError() = withContext(Dispatchers.IO) {
    clearSyncErrorInternal()
  }

  suspend fun updateAccount(token: String, displayName: String?, email: String?): AuthUser = withContext(Dispatchers.IO) {
    syncClient.updateAccount(token, displayName, email)
  }

  suspend fun changePassword(token: String, currentPassword: String, newPassword: String): AuthUser = withContext(Dispatchers.IO) {
    val user = syncClient.changePassword(token, currentPassword, newPassword)
    val (previous, next) = crypto.rememberEncryptionPassword(user.username, newPassword)
    reencryptLocalNotesInternal(previous, next)
    user
  }

  suspend fun setupTotp(token: String): TotpSetup = withContext(Dispatchers.IO) {
    syncClient.setupTotp(token)
  }

  suspend fun enableTotp(token: String, currentPassword: String, secret: String, totpCode: String): AuthUser = withContext(Dispatchers.IO) {
    syncClient.enableTotp(token, currentPassword, secret, totpCode)
  }

  suspend fun disableTotp(token: String, currentPassword: String, totpCode: String?): AuthUser = withContext(Dispatchers.IO) {
    syncClient.disableTotp(token, currentPassword, totpCode)
  }

  suspend fun logout(token: String) = withContext(Dispatchers.IO) {
    runCatching { syncClient.logout(token) }
  }

  suspend fun deleteAccount(token: String, password: String) = withContext(Dispatchers.IO) {
    syncClient.deleteAccount(token, password)
    db.clearAll()
  }

  suspend fun runSync(
    token: String,
    onProgress: suspend (SyncProgress) -> Unit = {}
  ): SyncRunResult = withContext(Dispatchers.IO) {
    try {
      if (!crypto.hasStoredEncryptionKeyMaterial()) {
        throw IllegalStateException("Sign in again to sync encrypted notes")
      }
      onProgress(SyncProgress(SyncProgressPhase.PREPARING))
      val device = getOrCreateDevice()
      ensureLocalNotesEncrypted()
      val pendingNotes = db.pendingNotes().map { it to it.lastSyncedVersion }.toMutableList()
      val pendingNotebooks = db.pendingNotebooks().map { it to it.lastSyncedVersion }.toMutableList()
      val totalPushCount = pendingNotes.size + pendingNotebooks.size
      var conflicts = 0
      var pushed = 0

      var noteBatchStart = 0
      var notebookBatchStart = 0
      while (noteBatchStart < pendingNotes.size || notebookBatchStart < pendingNotebooks.size) {
        val notesBatchEnd = minOf(noteBatchStart + PUSH_BATCH_SIZE, pendingNotes.size)
        val notebooksBatchEnd = minOf(notebookBatchStart + PUSH_BATCH_SIZE, pendingNotebooks.size)
        val notesBatch = pendingNotes.subList(noteBatchStart, notesBatchEnd)
        val notebooksBatch = pendingNotebooks.subList(notebookBatchStart, notebooksBatchEnd)
        noteBatchStart = notesBatchEnd
        notebookBatchStart = notebooksBatchEnd
        val batchSize = notesBatch.size + notebooksBatch.size
        onProgress(
          SyncProgress(
            phase = SyncProgressPhase.PUSHING,
            pushed = pushed,
            total = totalPushCount,
            batchSize = batchSize
          )
        )
        val response = syncClient.pushSyncChanges(token, device, notesBatch, notebooksBatch)
        pushed += batchSize
        onProgress(
          SyncProgress(
            phase = SyncProgressPhase.PUSHING,
            pushed = pushed,
            total = totalPushCount,
            batchSize = batchSize
          )
        )
        markAcceptedChanges(response.accepted, response.serverTime, notesBatch, notebooksBatch)
        response.noteConflicts.forEach {
          conflicts += 1
          saveNoteConflict(it)
        }
        response.notebookConflicts.forEach {
          conflicts += 1
          saveNotebookConflict(it)
        }
      }

      var lastPulledAt = db.getMeta("lastPulledAt")
      var cursor = db.getMeta("lastPulledRevision")?.toLongOrNull()?.takeIf { it >= 0 } ?: 0L
      var pulled = 0
      var hasMore = true
      var resetPullCursor = false
      while (hasMore) {
        onProgress(
          SyncProgress(
            phase = SyncProgressPhase.PULLING,
            pulled = pulled,
            hasMore = true
          )
        )
        val response = syncClient.pullSyncChanges(token, lastPulledAt, cursor, PULL_BATCH_SIZE)
        if (response.serverRevision < cursor && !resetPullCursor) {
          resetPullCursor = true
          cursor = 0L
          lastPulledAt = null
          db.putMeta("lastPulledRevision", "0")
          db.deleteMeta("lastPulledAt")
          continue
        }
        val nextCursor = safeRevisionCursor(response.serverRevision, cursor, response.hasMore)
        db.putDevices(response.devices)
        applyRemoteDeletes(response.deletedNoteIds, response.deletedNotebookIds, response.deletedDeviceIds)
        mergeRemoteChanges(response.notes, response.notebooks, response.serverTime)
        db.putMeta("lastPulledAt", response.serverTime)
        db.putMeta("lastPulledRevision", nextCursor.toString())
        val pageSize = response.notes.size + response.notebooks.size +
          response.deletedNoteIds.size + response.deletedNotebookIds.size
        pulled += pageSize
        hasMore = response.hasMore
        onProgress(
          SyncProgress(
            phase = SyncProgressPhase.PULLING,
            pulled = pulled,
            pageSize = pageSize,
            hasMore = hasMore
          )
        )
        cursor = nextCursor
      }

      SyncRunResult(pushed, pulled, conflicts).also {
        recordLastSyncPass(it)
        clearSyncErrorInternal()
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      recordSyncErrorInternal(error, "Sync")
      throw error
    }
  }

  suspend fun resolveConflict(conflictId: String, choice: String) = withContext(Dispatchers.IO) {
    val raw = db.rawConflict(conflictId) ?: return@withContext
    if (raw.status == "resolved") return@withContext
    val device = getOrCreateDevice()
    val now = nowIso()

    if (raw.entityType == "note") {
      val conflict = decryptNoteConflictForDisplay(noteConflictFromJson(JSONObject(raw.conflictJson)))
      if (choice == "duplicate-both") {
        val remote = conflict.remote.record
        val local = conflict.local.record
        db.putNote(crypto.encryptNoteFields(remote.copy(syncStatus = "synced", lastSyncedVersion = remote.version, lastSyncedAt = now)))
        db.putNote(
          crypto.encryptNoteFields(
            local.copy(
              id = newId(),
              title = if (local.title.isNotBlank()) "${local.title} copy" else "",
              createdAt = now,
              updatedAt = now,
              deviceId = device.id,
              version = 1,
              syncStatus = "pending",
              lastSyncedVersion = 0,
              lastSyncedAt = null
            )
          )
        )
      } else {
        val selected = chooseConflictVersion(conflict, choice)
        val record = selected.record
        val isRemote = selected.source == "remote"
        db.putNote(
          crypto.encryptNoteFields(
            record.copy(
              deviceId = if (isRemote) record.deviceId else device.id,
              version = if (isRemote) conflict.remote.version else conflict.remote.version + 1,
              syncStatus = if (isRemote) "synced" else "pending",
              lastSyncedVersion = conflict.remote.version,
              lastSyncedAt = if (isRemote) now else null
            )
          )
        )
      }
    } else {
      val conflict = decryptNotebookConflictForDisplay(notebookConflictFromJson(JSONObject(raw.conflictJson)))
      if (choice == "duplicate-both") {
        val remote = conflict.remote.record
        val local = conflict.local.record
        db.putNotebook(crypto.encryptNotebookFields(remote.copy(syncStatus = "synced", lastSyncedVersion = remote.version, lastSyncedAt = now)))
        db.putNotebook(
          crypto.encryptNotebookFields(
            local.copy(
              id = newId(),
              name = "${local.name} copy",
              nameHash = null,
              createdAt = now,
              updatedAt = now,
              deviceId = device.id,
              version = 1,
              syncStatus = "pending",
              lastSyncedVersion = 0,
              lastSyncedAt = null
            )
          )
        )
      } else {
        val selected = chooseConflictVersion(conflict, choice)
        val record = selected.record
        val isRemote = selected.source == "remote"
        db.putNotebook(
          crypto.encryptNotebookFields(
            record.copy(
              deviceId = if (isRemote) record.deviceId else device.id,
              version = if (isRemote) conflict.remote.version else conflict.remote.version + 1,
              syncStatus = if (isRemote) "synced" else "pending",
              lastSyncedVersion = conflict.remote.version,
              lastSyncedAt = if (isRemote) now else null
            )
          )
        )
      }
    }
    db.putConflict(raw.id, raw.entityType, raw.entityId, "resolved", raw.createdAt, raw.conflictJson)
  }

  suspend fun exportMarkdownZip(): Pair<String, ByteArray> = withContext(Dispatchers.IO) {
    val notes = db.allNotes().map { crypto.decryptNoteFields(it) }.filter { it.deletedAt == null }
    val notebooks = db.allNotebooks().map { crypto.decryptNotebookFields(it) }
    buildMarkdownZip(notes, notebooks)
  }

  suspend fun importMarkdownFiles(files: List<MarkdownInputFile>): ImportNotesResult = withContext(Dispatchers.IO) {
    importMarkdownFilesInternal(files)
  }

  private fun loadPendingConflictsInternal(): List<LocalConflict> = db.rawConflicts("pending").mapNotNull { raw ->
    if (raw.entityType == "note") {
      val conflict = decryptNoteConflictForDisplay(noteConflictFromJson(JSONObject(raw.conflictJson)))
      LocalConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, conflict, null)
    } else {
      val conflict = decryptNotebookConflictForDisplay(notebookConflictFromJson(JSONObject(raw.conflictJson)))
      LocalConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, null, conflict)
    }
  }

  private fun loadLastSyncPassInternal(): LastSyncPass = LastSyncPass(
    completedAt = db.getMeta("lastSyncPassAt"),
    pushed = db.getMeta("lastSyncPassPushed")?.toIntOrNull() ?: 0,
    pulled = db.getMeta("lastSyncPassPulled")?.toIntOrNull() ?: 0,
    conflicts = db.getMeta("lastSyncPassConflicts")?.toIntOrNull() ?: 0
  )

  private fun loadSyncDebugInfoInternal(): SyncDebugInfo {
    val source = db.getMeta(LAST_SYNC_ERROR_SOURCE_KEY)
    val message = db.getMeta(LAST_SYNC_ERROR_MESSAGE_KEY).orEmpty()
    val prefix = source?.takeIf { it.isNotBlank() }?.let { "$it: " }.orEmpty()
    return SyncDebugInfo(
      lastErrorAt = db.getMeta(LAST_SYNC_ERROR_AT_KEY),
      lastErrorMessage = if (message.isBlank()) "" else "$prefix$message",
      lastErrorStack = db.getMeta(LAST_SYNC_ERROR_STACK_KEY).orEmpty()
    )
  }

  private fun recordLastSyncPass(result: SyncRunResult) {
    val now = nowIso()
    db.putMeta("lastSyncPassAt", now)
    db.putMeta("lastSyncPassPushed", result.pushed.toString())
    db.putMeta("lastSyncPassPulled", result.pulled.toString())
    db.putMeta("lastSyncPassConflicts", result.conflicts.toString())
  }

  private fun recordSyncErrorInternal(error: Throwable, source: String) {
    db.putMeta(LAST_SYNC_ERROR_AT_KEY, nowIso())
    db.putMeta(LAST_SYNC_ERROR_SOURCE_KEY, source)
    db.putMeta(LAST_SYNC_ERROR_MESSAGE_KEY, syncErrorMessage(error))
    db.putMeta(LAST_SYNC_ERROR_STACK_KEY, error.stackTraceToString())
  }

  private fun clearSyncErrorInternal() {
    db.deleteMeta(LAST_SYNC_ERROR_AT_KEY)
    db.deleteMeta(LAST_SYNC_ERROR_SOURCE_KEY)
    db.deleteMeta(LAST_SYNC_ERROR_MESSAGE_KEY)
    db.deleteMeta(LAST_SYNC_ERROR_STACK_KEY)
  }

  private fun syncErrorMessage(error: Throwable): String = error.message?.takeIf { it.isNotBlank() }
    ?: error::class.java.simpleName.takeIf { it.isNotBlank() }
    ?: "Sync failed"

  private fun markAcceptedChanges(
    accepted: List<AcceptedChange>,
    syncedAt: String,
    pushedNotes: List<Pair<LocalNote, Int>>,
    pushedNotebooks: List<Pair<LocalNotebook, Int>>
  ) {
    val pushedNoteById = pushedNotes.associate { it.first.id to it.first }
    val pushedNotebookById = pushedNotebooks.associate { it.first.id to it.first }
    for (change in accepted) {
      if (change.entityType == "note") {
        val note = db.getNote(change.id) ?: continue
        val pushed = pushedNoteById[change.id]
        val stillMatches = pushed == null || (note.version == pushed.version && note.updatedAt == pushed.updatedAt)
        db.putNote(
          note.copy(
            version = if (stillMatches) change.version else note.version,
            syncStatus = if (stillMatches) "synced" else "pending",
            lastSyncedVersion = change.version,
            lastSyncedAt = syncedAt
          )
        )
      } else {
        val notebook = db.getNotebook(change.id) ?: continue
        val pushed = pushedNotebookById[change.id]
        val stillMatches = pushed == null || (notebook.version == pushed.version && notebook.updatedAt == pushed.updatedAt)
        db.putNotebook(
          notebook.copy(
            version = if (stillMatches) change.version else notebook.version,
            syncStatus = if (stillMatches) "synced" else "pending",
            lastSyncedVersion = change.version,
            lastSyncedAt = syncedAt
          )
        )
      }
    }
  }

  private fun applyRemoteDeletes(noteIds: List<String>, notebookIds: List<String>, deviceIds: List<String>) {
    noteIds.distinct().forEach { id ->
      val note = db.getNote(id)
      if (note != null && note.syncStatus != "pending" && note.syncStatus != "conflict") db.deleteNote(id)
    }
    notebookIds.distinct().forEach { id ->
      val notebook = db.getNotebook(id)
      if (notebook != null && notebook.syncStatus != "pending" && notebook.syncStatus != "conflict") {
        db.deleteNotebookRow(id)
      }
    }
    deviceIds.distinct().forEach { db.deleteDevice(it) }
  }

  private fun mergeRemoteChanges(notes: List<LocalNote>, notebooks: List<LocalNotebook>, syncedAt: String) {
    notebooks.forEach { mergeRemoteNotebook(it, syncedAt) }
    notes.forEach { mergeRemoteNote(it, syncedAt) }
  }

  private fun mergeRemoteNote(remote: LocalNote, syncedAt: String) {
    val local = db.getNote(remote.id)
    val remotePlain = crypto.decryptNoteFields(remote)
    val remoteStored = crypto.encryptNoteFields(remotePlain)
    val shouldRepublish = !crypto.isEncryptedText(remote.title) ||
      !crypto.isEncryptedText(remote.body) ||
      remote.titleHash != remoteStored.titleHash ||
      remote.bodyHash != remoteStored.bodyHash
    val remoteLocal = remoteStored.copy(
      syncStatus = if (shouldRepublish) "pending" else "synced",
      lastSyncedVersion = remote.version,
      lastSyncedAt = syncedAt
    )
    if (local == null) {
      db.putNote(remoteLocal)
      return
    }
    val localPlain = crypto.decryptNoteFields(local)
    if (local.syncStatus == "pending" && local.lastSyncedVersion != remote.version && recordsDiffer(localPlain, remotePlain)) {
      if (remote.deviceId == prefs.getString(DEVICE_KEY, null)) {
        if (remote.version > local.lastSyncedVersion) {
          db.putNote(local.copy(lastSyncedVersion = remote.version, lastSyncedAt = syncedAt))
        }
        return
      }
      saveNoteConflict(
        SyncConflict(
          id = newId(),
          entityType = "note",
          entityId = remote.id,
          reason = "remote_changed",
          local = ConflictVersion("local", local.deviceId, deviceName(local.deviceId), local.updatedAt, local.version, previewText(localPlain), localPlain),
          remote = ConflictVersion("remote", remote.deviceId, deviceName(remote.deviceId), remote.updatedAt, remote.version, previewText(remotePlain), remotePlain)
        )
      )
      return
    }
    if (local.syncStatus != "pending" && local.syncStatus != "conflict") db.putNote(remoteLocal)
  }

  private fun mergeRemoteNotebook(remote: LocalNotebook, syncedAt: String) {
    val local = db.getNotebook(remote.id)
    val remotePlain = crypto.decryptNotebookFields(remote)
    val remoteStored = crypto.encryptNotebookFields(remotePlain)
    val shouldRepublish = !crypto.isEncryptedText(remote.name) ||
      remote.nameHash != remoteStored.nameHash
    val remoteLocal = remoteStored.copy(
      syncStatus = if (shouldRepublish) "pending" else "synced",
      lastSyncedVersion = remote.version,
      lastSyncedAt = syncedAt
    )
    if (local == null) {
      db.putNotebook(remoteLocal)
      return
    }
    val localPlain = crypto.decryptNotebookFields(local)
    if (local.syncStatus == "pending" && local.lastSyncedVersion != remote.version && recordsDiffer(localPlain, remotePlain)) {
      if (remote.deviceId == prefs.getString(DEVICE_KEY, null)) {
        if (remote.version > local.lastSyncedVersion) {
          db.putNotebook(local.copy(lastSyncedVersion = remote.version, lastSyncedAt = syncedAt))
        }
        return
      }
      saveNotebookConflict(
        SyncConflict(
          id = newId(),
          entityType = "notebook",
          entityId = remote.id,
          reason = "remote_changed",
          local = ConflictVersion("local", local.deviceId, deviceName(local.deviceId), local.updatedAt, local.version, previewText(localPlain), localPlain),
          remote = ConflictVersion("remote", remote.deviceId, deviceName(remote.deviceId), remote.updatedAt, remote.version, previewText(remotePlain), remotePlain)
        )
      )
      return
    }
    if (local.syncStatus != "pending" && local.syncStatus != "conflict") db.putNotebook(remoteLocal)
  }

  private fun saveNoteConflict(conflict: SyncConflict<LocalNote>) {
    val stored = encryptNoteConflictForStorage(conflict)
    db.putConflict(stored.id, stored.entityType, stored.entityId, "pending", nowIso(), noteConflictToJson(stored).toString())
    db.getNote(stored.entityId)?.let { db.putNote(it.copy(syncStatus = "conflict")) }
  }

  private fun saveNotebookConflict(conflict: SyncConflict<LocalNotebook>) {
    val stored = encryptNotebookConflictForStorage(conflict)
    db.putConflict(stored.id, stored.entityType, stored.entityId, "pending", nowIso(), notebookConflictToJson(stored).toString())
    db.getNotebook(stored.entityId)?.let { db.putNotebook(it.copy(syncStatus = "conflict")) }
  }

  private fun encryptNoteConflictForStorage(conflict: SyncConflict<LocalNote>, keyMaterial: String = crypto.getEncryptionKeyMaterial()): SyncConflict<LocalNote> {
    val localPlain = crypto.decryptNoteFields(conflict.local.record, keyMaterial)
    val remotePlain = crypto.decryptNoteFields(conflict.remote.record, keyMaterial)
    return conflict.copy(
      local = conflict.local.copy(previewText = "", record = crypto.encryptNoteFields(localPlain, keyMaterial)),
      remote = conflict.remote.copy(previewText = "", record = crypto.encryptNoteFields(remotePlain, keyMaterial))
    )
  }

  private fun decryptNoteConflictForDisplay(conflict: SyncConflict<LocalNote>, keyMaterial: String = crypto.getEncryptionKeyMaterial()): SyncConflict<LocalNote> {
    val local = crypto.decryptNoteFields(conflict.local.record, keyMaterial)
    val remote = crypto.decryptNoteFields(conflict.remote.record, keyMaterial)
    return conflict.copy(
      local = conflict.local.copy(previewText = previewText(local), record = local),
      remote = conflict.remote.copy(previewText = previewText(remote), record = remote)
    )
  }

  private fun encryptNotebookConflictForStorage(conflict: SyncConflict<LocalNotebook>, keyMaterial: String = crypto.getEncryptionKeyMaterial()): SyncConflict<LocalNotebook> {
    val localPlain = crypto.decryptNotebookFields(conflict.local.record, keyMaterial)
    val remotePlain = crypto.decryptNotebookFields(conflict.remote.record, keyMaterial)
    return conflict.copy(
      local = conflict.local.copy(previewText = "", record = crypto.encryptNotebookFields(localPlain, keyMaterial)),
      remote = conflict.remote.copy(previewText = "", record = crypto.encryptNotebookFields(remotePlain, keyMaterial))
    )
  }

  private fun decryptNotebookConflictForDisplay(conflict: SyncConflict<LocalNotebook>, keyMaterial: String = crypto.getEncryptionKeyMaterial()): SyncConflict<LocalNotebook> {
    val local = crypto.decryptNotebookFields(conflict.local.record, keyMaterial)
    val remote = crypto.decryptNotebookFields(conflict.remote.record, keyMaterial)
    return conflict.copy(
      local = conflict.local.copy(previewText = previewText(local), record = local),
      remote = conflict.remote.copy(previewText = previewText(remote), record = remote)
    )
  }

  private fun <T> chooseConflictVersion(conflict: SyncConflict<T>, choice: String): ConflictVersion<T> {
    if (choice == "keep-local") return conflict.local
    if (choice == "keep-remote") return conflict.remote
    val order = compareConflictVersions(conflict.local, conflict.remote)
    return if (choice == "keep-newer") {
      if (order >= 0) conflict.local else conflict.remote
    } else {
      if (order <= 0) conflict.local else conflict.remote
    }
  }

  private fun <T> compareConflictVersions(local: ConflictVersion<T>, remote: ConflictVersion<T>): Int {
    val localTime = runCatching { java.time.Instant.parse(local.updatedAt).toEpochMilli() }.getOrNull()
    val remoteTime = runCatching { java.time.Instant.parse(remote.updatedAt).toEpochMilli() }.getOrNull()
    if (localTime != null && remoteTime != null && localTime != remoteTime) return localTime.compareTo(remoteTime)
    if ((localTime != null) != (remoteTime != null)) return if (localTime != null) 1 else -1
    return local.version.compareTo(remote.version)
  }

  private fun safeRevisionCursor(serverRevision: Long, previousRevision: Long, hasMore: Boolean): Long {
    if (previousRevision < 0 || serverRevision < 0 || serverRevision < previousRevision || (hasMore && serverRevision == previousRevision)) {
      throw IllegalStateException("Sync pull cursor did not advance (previous $previousRevision, server $serverRevision, hasMore $hasMore)")
    }
    return serverRevision
  }

  private fun assertLocalWorkspaceCanUseAccountInternal(username: String, fallbackOwnerUsername: String?) {
    val normalized = username.trim().lowercase()
    val storedOwner = db.getMeta(LOCAL_WORKSPACE_OWNER_KEY)
    val fallback = fallbackOwnerUsername?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
    val currentOwner = storedOwner ?: fallback
    val hasData = db.allNotes().isNotEmpty() || db.allNotebooks().isNotEmpty() || db.rawConflicts().isNotEmpty()
    if (currentOwner != null && currentOwner != normalized && hasData) {
      throw IllegalStateException("This device has local notes for $currentOwner. Sign in as $currentOwner before switching accounts.")
    }
  }

  private fun rememberLocalWorkspaceAccount(username: String) {
    val normalized = username.trim().lowercase()
    if (normalized.isNotEmpty()) db.putMeta(LOCAL_WORKSPACE_OWNER_KEY, normalized)
  }

  private fun reencryptLocalNotesInternal(previousMaterial: String, nextMaterial: String) {
    if (previousMaterial == nextMaterial) return
    val device = runCatching { db.getDevice(prefs.getString(DEVICE_KEY, "") ?: "") }.getOrNull()
    val deviceId = device?.id ?: prefs.getString(DEVICE_KEY, null) ?: newId()
    db.allNotes().forEach { note ->
      val updated = crypto.reencryptNoteFields(note, previousMaterial, nextMaterial).copy(
        deviceId = deviceId,
        version = note.version + 1,
        syncStatus = if (note.syncStatus == "conflict" || note.syncStatus == "deleted") note.syncStatus else "pending"
      )
      db.putNote(updated)
    }
    db.allNotebooks().forEach { notebook ->
      val updated = crypto.reencryptNotebookFields(notebook, previousMaterial, nextMaterial).copy(
        deviceId = deviceId,
        version = notebook.version + 1,
        syncStatus = if (notebook.syncStatus == "conflict" || notebook.syncStatus == "deleted") notebook.syncStatus else "pending"
      )
      db.putNotebook(updated)
    }
    reencryptLocalConflictsInternal(previousMaterial, nextMaterial)
    db.putMeta(ENCRYPTION_AUDIT_VERSION_KEY, ENCRYPTION_AUDIT_VERSION)
  }

  private fun reencryptLocalConflictsInternal(previousMaterial: String, nextMaterial: String) {
    db.rawConflicts().forEach { raw ->
      when (raw.entityType) {
        "note" -> {
          val decrypted = decryptNoteConflictForDisplay(
            noteConflictFromJson(JSONObject(raw.conflictJson)),
            previousMaterial
          )
          val stored = encryptNoteConflictForStorage(decrypted, nextMaterial)
          db.putConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, noteConflictToJson(stored).toString())
        }
        "notebook" -> {
          val decrypted = decryptNotebookConflictForDisplay(
            notebookConflictFromJson(JSONObject(raw.conflictJson)),
            previousMaterial
          )
          val stored = encryptNotebookConflictForStorage(decrypted, nextMaterial)
          db.putConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, notebookConflictToJson(stored).toString())
        }
      }
    }
  }

  private fun ensureLocalConflictsEncryptedInternal() {
    db.rawConflicts().forEach { raw ->
      when (raw.entityType) {
        "note" -> {
          val stored = encryptNoteConflictForStorage(
            decryptNoteConflictForDisplay(noteConflictFromJson(JSONObject(raw.conflictJson)))
          )
          db.putConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, noteConflictToJson(stored).toString())
        }
        "notebook" -> {
          val stored = encryptNotebookConflictForStorage(
            decryptNotebookConflictForDisplay(notebookConflictFromJson(JSONObject(raw.conflictJson)))
          )
          db.putConflict(raw.id, raw.entityType, raw.entityId, raw.status, raw.createdAt, notebookConflictToJson(stored).toString())
        }
      }
    }
  }

  private fun deviceName(deviceId: String): String = db.getDevice(deviceId)?.name ?: deviceId

  private fun deviceName(): String = if (Build.MODEL.isNullOrBlank()) "Android device" else Build.MODEL

  private fun importMarkdownFilesInternal(files: List<MarkdownInputFile>): ImportNotesResult {
    val payload = parseNotesMarkdownImportFiles(files)
    if (payload.notebooks.isEmpty() && payload.notes.isEmpty()) {
      throw IllegalStateException("Markdown import does not contain notes or notebooks")
    }

    val deviceId = prefs.getString(DEVICE_KEY, null) ?: newId().also {
      prefs.edit { putString(DEVICE_KEY, it) }
    }
    val device = db.getDevice(deviceId) ?: Device(deviceId, deviceName()).also { db.putDevice(it) }
    val notebookIdByName = db.allNotebooks().map { crypto.decryptNotebookFields(it) }
      .filter { it.deletedAt == null }
      .associateBy { normalizedNotebookName(it.name) }
      .toMutableMap()
    val importedNoteIds = mutableListOf<String>()
    var importedNotebooks = 0
    var reusedNotebooks = 0
    var skippedNotes = 0

    fun ensureNotebook(name: String, createdAt: String? = null, updatedAt: String? = null): String {
      val trimmed = name.trim()
      val normalized = normalizedNotebookName(trimmed)
      notebookIdByName[normalized]?.let {
        reusedNotebooks += 1
        return it.id
      }
      val now = nowIso()
      val notebook = LocalNotebook(
        id = newId(),
        name = trimmed,
        nameHash = null,
        createdAt = createdAt ?: now,
        updatedAt = updatedAt ?: createdAt ?: now,
        deletedAt = null,
        deviceId = device.id,
        version = 1,
        syncStatus = "pending",
        lastSyncedVersion = 0,
        lastSyncedAt = null
      )
      db.putNotebook(crypto.encryptNotebookFields(notebook))
      notebookIdByName[normalized] = notebook
      importedNotebooks += 1
      return notebook.id
    }

    payload.notebooks.forEach { ensureNotebook(it.name, it.createdAt, it.updatedAt) }
    payload.notes.forEach { parsed ->
      if (parsed.title.isBlank() && parsed.body.isBlank()) {
        skippedNotes += 1
        return@forEach
      }
      val notebookIds = parsed.sourceNotebookNames.map { ensureNotebook(it) }.distinct()
      val now = nowIso()
      val createdAt = parsed.createdAt ?: parsed.updatedAt ?: now
      val updatedAt = parsed.updatedAt ?: createdAt
      val note = LocalNote(
        id = newId(),
        title = parsed.title.trim(),
        body = parsed.body,
        titleHash = null,
        bodyHash = null,
        notebookIds = notebookIds,
        notebookId = primaryNotebookId(notebookIds),
        createdAt = createdAt,
        updatedAt = updatedAt,
        deletedAt = null,
        trashedAt = parsed.trashedAt,
        deviceId = device.id,
        version = 1,
        syncStatus = "pending",
        lastSyncedVersion = 0,
        lastSyncedAt = null
      )
      db.putNote(crypto.encryptNoteFields(note))
      importedNoteIds.add(note.id)
    }

    return ImportNotesResult(
      importedNotes = importedNoteIds.size,
      importedNotebooks = importedNotebooks,
      reusedNotebooks = reusedNotebooks,
      skippedNotes = skippedNotes,
      noteIds = importedNoteIds
    )
  }
}

private fun SharedPreferences.Editor.putNullableString(key: String, value: String?): SharedPreferences.Editor = if (value == null) remove(key) else putString(key, value)
