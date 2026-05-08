package com.author.notes.ui

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.author.notes.BuildConfig
import com.author.notes.core.AuthException
import com.author.notes.core.AuthUser
import com.author.notes.core.Device
import com.author.notes.core.LocalConflict
import com.author.notes.core.LocalNote
import com.author.notes.core.LocalNotebook
import com.author.notes.core.MarkdownInputFile
import com.author.notes.core.NotesRepository
import com.author.notes.core.StoredSession
import com.author.notes.core.SyncProgress
import com.author.notes.core.SyncProgressPhase
import com.author.notes.core.formatDateTime
import com.author.notes.core.noteNotebookIds
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class NotesController(
  private val repository: NotesRepository,
  private val scope: CoroutineScope
) {
  var notes by mutableStateOf<List<LocalNote>>(emptyList())
  var notebooks by mutableStateOf<List<LocalNotebook>>(emptyList())
  var trash by mutableStateOf<List<LocalNote>>(emptyList())
  var devices by mutableStateOf<List<Device>>(emptyList())
  var conflicts by mutableStateOf<List<LocalConflict>>(emptyList())
  var selectedNote by mutableStateOf<LocalNote?>(null)
  var selectedNoteIds by mutableStateOf<Set<String>>(emptySet())
  var titleValue by mutableStateOf("")
  var bodyValue by mutableStateOf("")
  var filterId by mutableStateOf("all")
  var searchValue by mutableStateOf("")
  var noteSort by mutableStateOf(repository.getSort())
  var compactView by mutableStateOf(repository.getCompactView())
  var editorZoom by mutableStateOf(repository.getEditorZoom())
  var editorFont by mutableStateOf(repository.getEditorFont())
  var editorTextSize by mutableStateOf(repository.getEditorTextSize())
  var editorLineHeight by mutableStateOf(repository.getEditorLineHeight())
  var theme by mutableStateOf(repository.getTheme())
  var currentPage by mutableStateOf("editor")
  var loginOpen by mutableStateOf(false)
  var settingsSection by mutableStateOf("account")
  var newNotebookOpen by mutableStateOf(false)
  var notebookNameValue by mutableStateOf("")
  var notebookError by mutableStateOf("")
  var renamingNotebookId by mutableStateOf<String?>(null)
  var renameNotebookValue by mutableStateOf("")
  var deletingNotebookId by mutableStateOf<String?>(null)
  var authMode by mutableStateOf("signin")
  var loginUsernameValue by mutableStateOf(repository.getLoginHint())
  var loginPasswordValue by mutableStateOf("")
  var signupDisplayNameValue by mutableStateOf("")
  var signupConfirmPasswordValue by mutableStateOf("")
  var loginError by mutableStateOf("")
  var isLoggingIn by mutableStateOf(false)
  var hasToken by mutableStateOf(repository.getStoredSession() != null)
  var accountUsername by mutableStateOf(repository.getStoredSession()?.user?.username ?: "")
  var accountDisplayName by mutableStateOf(repository.getStoredSession()?.user?.displayName ?: "")
  var accountMessage by mutableStateOf("")
  var accountError by mutableStateOf("")
  var accountProfileEditing by mutableStateOf(false)
  var accountPasswordEditing by mutableStateOf(false)
  var accountDeleteEditing by mutableStateOf(false)
  var currentPasswordValue by mutableStateOf("")
  var newPasswordValue by mutableStateOf("")
  var confirmPasswordValue by mutableStateOf("")
  var deletePasswordValue by mutableStateOf("")
  var apiBaseUrl by mutableStateOf(repository.getApiBaseUrl())
  var serverApiBaseUrl by mutableStateOf(BuildConfig.DEFAULT_API_BASE_URL)
  var serverConfigError by mutableStateOf("")
  var serverRemoteDatabaseConfigured by mutableStateOf(false)
  var serverRemoteSyncEnabled by mutableStateOf(false)
  var syncMessage by mutableStateOf(if (hasToken) "All changes saved" else "Sign in to sync")
  var syncActivityLabel by mutableStateOf("")
  var syncActivityDetail by mutableStateOf("")
  var isSyncing by mutableStateOf(false)
  var isWorkspaceLoading by mutableStateOf(true)
  var pendingSyncCount by mutableStateOf(0)
  var lastSyncPassTitle by mutableStateOf("No completed pass yet")
  var lastSyncPassDetail by mutableStateOf("Sync has not completed on this device.")
  var syncDebugTitle by mutableStateOf("No sync errors recorded")
  var syncDebugDetail by mutableStateOf("The last caught sync error will appear here.")
  var syncDebugLog by mutableStateOf("No sync errors recorded on this device.")
  var remoteSyncEnabled by mutableStateOf(false)
  var remoteSyncState by mutableStateOf("unknown")
  var remoteSyncError by mutableStateOf("")
  var notifications by mutableStateOf<List<AppNotification>>(emptyList())
  var undoStack by mutableStateOf<List<Pair<String, String>>>(emptyList())
  var redoStack by mutableStateOf<List<Pair<String, String>>>(emptyList())
  var isArchiveBusy by mutableStateOf(false)
  var importBanner by mutableStateOf("")

  private var saveJob: Job? = null
  private var autoSyncJob: Job? = null
  private var syncQueued = false
  private var lastSnapshot = "" to ""
  private var preparedExport: ByteArray? = null

  fun initialize() {
    scope.launch {
      try {
        refresh()
        isWorkspaceLoading = false
        runCatching {
          repository.ensureLocalNotesEncrypted()
          refresh()
        }.onFailure { repository.recordSyncError(it, "Local workspace") }
        runCatching { refreshServerConfigNow() }
          .onFailure { serverConfigError = it.message ?: "Could not reach sync API" }
        repository.getStoredSession()?.let { resumeSession(it.token) }
      } catch (error: Throwable) {
        isWorkspaceLoading = false
        notify("error", "Startup failed", error.message ?: "Could not open notes")
      }
    }
  }

  fun refreshAsync() {
    scope.launch { refresh() }
  }

  fun navigateTo(page: String) {
    currentPage = page
    if (page == "settings") settingsSection = "menu"
  }

  fun openLogin(mode: String = "signin") {
    authMode = mode
    loginUsernameValue = repository.getLoginHint()
    loginPasswordValue = ""
    signupDisplayNameValue = ""
    signupConfirmPasswordValue = ""
    loginError = ""
    loginOpen = true
  }

  fun chooseAuthMode(mode: String) {
    if (isLoggingIn || authMode == mode) return
    authMode = mode
    loginError = ""
    loginPasswordValue = ""
    signupConfirmPasswordValue = ""
    if (mode == "signin") {
      signupDisplayNameValue = ""
      loginUsernameValue = repository.getLoginHint()
    }
  }

  suspend fun refresh() {
    val selectedId = selectedNote?.id
    val workspace = repository.loadWorkspace()
    notes = workspace.notes
    notebooks = workspace.notebooks
    trash = workspace.trash
    devices = workspace.devices
    conflicts = workspace.conflicts
    pendingSyncCount = workspace.pendingSyncCount
    lastSyncPassTitle = workspace.lastSyncPass.completedAt?.let { formatDateTime(it) } ?: "No completed pass yet"
    lastSyncPassDetail = if (workspace.lastSyncPass.completedAt == null) {
      "Sync has not completed on this device."
    } else {
      "${workspace.lastSyncPass.pushed} pushed, ${workspace.lastSyncPass.pulled} pulled, ${workspace.lastSyncPass.conflicts} conflicts"
    }
    syncDebugTitle = workspace.syncDebugInfo.lastErrorAt?.let { formatDateTime(it) } ?: "No sync errors recorded"
    syncDebugDetail = workspace.syncDebugInfo.lastErrorMessage.ifBlank { "The last caught sync error will appear here." }
    syncDebugLog = formatSyncDebugLog(
      workspace.syncDebugInfo.lastErrorAt,
      workspace.syncDebugInfo.lastErrorMessage,
      workspace.syncDebugInfo.lastErrorStack
    )
    selectedNoteIds = selectedNoteIds.filter { id -> (notes + trash).any { it.id == id } }.toSet()
    if (selectedId != null) {
      val refreshed = (notes + trash).firstOrNull { it.id == selectedId }
      selectedNote = refreshed
      if (saveJob == null && refreshed != null) {
        titleValue = refreshed.title
        bodyValue = refreshed.body
      }
    }
  }

  private fun formatSyncDebugLog(
    lastErrorAt: String?,
    lastErrorMessage: String,
    lastErrorStack: String
  ): String {
    if (lastErrorAt == null && lastErrorMessage.isBlank()) {
      return "No sync errors recorded on this device."
    }

    return listOf(
      "Time: ${lastErrorAt?.let { formatDateTime(it) } ?: "Unknown"}",
      "Message: ${lastErrorMessage.ifBlank { "Sync failed" }}",
      lastErrorStack.takeIf { it.isNotBlank() }?.let { "\n$it" }.orEmpty()
    ).filter { it.isNotBlank() }.joinToString("\n")
  }

  private fun pluralizeSyncCount(value: Int, singular: String): String = "$value $singular${if (value == 1) "" else "s"}"

  private fun updateSyncProgress(progress: SyncProgress) {
    val (label, detail) = when (progress.phase) {
      SyncProgressPhase.PREPARING -> "Preparing sync" to "Checking local changes before the network pass"
      SyncProgressPhase.PUSHING -> {
        val detail = when {
          progress.total == 0 -> "No local changes to push"
          progress.pushed == 0 -> "Sending ${pluralizeSyncCount(progress.total, "local change")}"
          else -> "${progress.pushed} of ${progress.total} local changes pushed"
        }
        "Pushing local changes" to detail
      }
      SyncProgressPhase.PULLING -> {
        val detail = if (progress.pulled == 0) {
          "Checking for remote changes"
        } else {
          "${pluralizeSyncCount(progress.pulled, "remote change")} pulled${if (progress.hasMore) ", checking for more" else ""}"
        }
        "Pulling remote changes" to detail
      }
    }
    syncActivityLabel = label
    syncActivityDetail = detail
    syncMessage = label
  }

  fun deviceName(deviceId: String?): String = deviceId?.let { id -> devices.firstOrNull { it.id == id }?.name ?: id } ?: "Unknown device"

  fun selectNote(note: LocalNote) {
    navigateTo("editor")
    scope.launch {
      flushPendingSave()
      selectedNote = note
      titleValue = note.title
      bodyValue = note.body
      resetHistory()
    }
  }

  fun newNote() {
    navigateTo("editor")
    scope.launch {
      flushPendingSave()
      filterId = "all"
      openDraftNote()
    }
  }

  fun openDraftNote() {
    saveJob?.cancel()
    selectedNote = null
    titleValue = ""
    bodyValue = ""
    resetHistory()
  }

  fun updateEditor(field: String, value: String) {
    val next = if (field == "title") value to bodyValue else titleValue to value
    if (field == "title") titleValue = value else bodyValue = value
    if (lastSnapshot != next) {
      undoStack = (undoStack + lastSnapshot).takeLast(120)
      redoStack = emptyList()
      lastSnapshot = next
    }
    scheduleSave()
  }

  fun undoEditor() {
    val snapshot = undoStack.lastOrNull() ?: return
    redoStack = (redoStack + (titleValue to bodyValue)).takeLast(120)
    undoStack = undoStack.dropLast(1)
    titleValue = snapshot.first
    bodyValue = snapshot.second
    lastSnapshot = snapshot
    scheduleSave()
  }

  fun redoEditor() {
    val snapshot = redoStack.lastOrNull() ?: return
    undoStack = (undoStack + (titleValue to bodyValue)).takeLast(120)
    redoStack = redoStack.dropLast(1)
    titleValue = snapshot.first
    bodyValue = snapshot.second
    lastSnapshot = snapshot
    scheduleSave()
  }

  fun zoomEditor(direction: Int) {
    editorZoom = (editorZoom + direction * 0.1f).coerceIn(0.8f, 1.4f)
    repository.setEditorZoom(editorZoom)
  }

  fun setSort(sort: String) {
    noteSort = sort
    repository.setSort(sort)
  }

  fun toggleCompactView() {
    compactView = !compactView
    repository.setCompactView(compactView)
  }

  fun toggleTheme() {
    theme = if (theme.startsWith("dark")) "light" else "dark"
    repository.setTheme(theme)
  }

  fun setThemeChoice(value: String) {
    theme = value
    repository.setTheme(theme)
  }

  fun chooseEditorFont(value: String) {
    editorFont = value
    repository.setEditorFont(value)
  }

  fun adjustEditorTextSize(delta: Float) {
    editorTextSize = (editorTextSize + delta).coerceIn(14f, 22f)
    repository.setEditorTextSize(editorTextSize)
  }

  fun adjustEditorLineHeight(delta: Float) {
    editorLineHeight = (editorLineHeight + delta).coerceIn(1.35f, 2.1f)
    repository.setEditorLineHeight(editorLineHeight)
  }

  fun toggleSelection(note: LocalNote, selected: Boolean) {
    selectedNoteIds = if (selected) selectedNoteIds + note.id else selectedNoteIds - note.id
  }

  fun toggleAllVisible(selected: Boolean) {
    selectedNoteIds = if (selected) selectedNoteIds + visibleNotes.map { it.id } else selectedNoteIds - visibleNotes.map { it.id }.toSet()
  }

  fun clearSelection() {
    selectedNoteIds = emptySet()
  }

  fun createNotebook() {
    scope.launch {
      val notebook = repository.createNotebook(notebookNameValue)
      if (notebook == null) {
        notebookError = "Name required"
        return@launch
      }
      filterId = notebook.id
      selectedNote?.takeIf { it.trashedAt == null }?.let {
        selectedNote = repository.assignNoteToNotebook(it.id, notebook.id, true)
      }
      notebookNameValue = ""
      notebookError = ""
      newNotebookOpen = false
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  fun startRename(notebook: LocalNotebook) {
    renamingNotebookId = notebook.id
    renameNotebookValue = notebook.name
    deletingNotebookId = null
    newNotebookOpen = false
  }

  fun submitRename(notebook: LocalNotebook) {
    scope.launch {
      val renamed = repository.renameNotebook(notebook.id, renameNotebookValue)
      if (renamed == null) return@launch
      renamingNotebookId = null
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  fun confirmDeleteNotebook(notebook: LocalNotebook) {
    scope.launch {
      repository.deleteNotebook(notebook.id)
      if (filterId == notebook.id) filterId = "all"
      deletingNotebookId = null
      refresh()
      selectedNote?.takeIf { noteNotebookIds(it).contains(notebook.id) }?.let { openDraftNote() }
      scheduleSyncAfterLocalChange()
    }
  }

  fun assignNotebook(note: LocalNote, notebookId: String?) {
    scope.launch {
      val assigned = notebookId != null && !noteNotebookIds(note).contains(notebookId)
      val updated = repository.assignNoteToNotebook(note.id, notebookId, assigned)
      if (selectedNote?.id == note.id) selectedNote = updated
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  fun assignNotebookForSelected(notebookId: String?) {
    scope.launch {
      val active = selectedNotes.filter { it.trashedAt == null }
      val assigned = notebookId != null && !active.all { noteNotebookIds(it).contains(notebookId) }
      active.forEach { repository.assignNoteToNotebook(it.id, notebookId, assigned) }
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  fun trashNote(note: LocalNote) {
    scope.launch {
      flushPendingSave()
      repository.moveNoteToTrash(note.id)
      refresh()
      if (selectedNote?.id == note.id) notes.firstOrNull { it.id != note.id }?.let(::selectNote) ?: openDraftNote()
      scheduleSyncAfterLocalChange()
    }
  }

  fun restoreNote(note: LocalNote) {
    scope.launch {
      repository.restoreNote(note.id)
      filterId = "all"
      refresh()
      notes.firstOrNull { it.id == note.id }?.let(::selectNote)
      scheduleSyncAfterLocalChange()
    }
  }

  fun deleteNotePermanently(note: LocalNote) {
    scope.launch {
      flushPendingSave()
      repository.deleteNotePermanently(note.id)
      selectedNoteIds = selectedNoteIds - note.id
      refresh()
      if (selectedNote?.id == note.id) (if (filterId == "trash") trash.firstOrNull() else notes.firstOrNull())?.let(::selectNote) ?: openDraftNote()
      scheduleSyncAfterLocalChange()
    }
  }

  fun trashSelected() {
    val targets = selectedNotes.filter { it.trashedAt == null }
    if (targets.isEmpty()) return
    scope.launch {
      flushPendingSave()
      val targetIds = targets.map { it.id }.toSet()
      targets.forEach { repository.moveNoteToTrash(it.id) }
      selectedNoteIds = selectedNoteIds - targetIds
      refresh()
      if (selectedNote?.id in targetIds) {
        notes.firstOrNull { it.id !in targetIds }?.let(::selectNote) ?: openDraftNote()
      }
      scheduleSyncAfterLocalChange()
    }
  }

  fun restoreSelected() {
    val targets = selectedNotes.filter { it.trashedAt != null }
    if (targets.isEmpty()) return
    scope.launch {
      val targetIds = targets.map { it.id }.toSet()
      targets.forEach { repository.restoreNote(it.id) }
      selectedNoteIds = selectedNoteIds - targetIds
      filterId = "all"
      refresh()
      targets.firstOrNull()?.let { target -> notes.firstOrNull { it.id == target.id }?.let(::selectNote) }
      scheduleSyncAfterLocalChange()
    }
  }

  fun deleteSelectedPermanently() {
    val targets = selectedNotes.filter { it.trashedAt != null }
    if (targets.isEmpty()) return
    scope.launch {
      flushPendingSave()
      val targetIds = targets.map { it.id }.toSet()
      targets.forEach { repository.deleteNotePermanently(it.id) }
      selectedNoteIds = selectedNoteIds - targetIds
      refresh()
      if (selectedNote?.id in targetIds) {
        (if (filterId == "trash") trash.firstOrNull() else notes.firstOrNull())?.let(::selectNote) ?: openDraftNote()
      }
      scheduleSyncAfterLocalChange()
    }
  }

  fun submitLogin() {
    val username = loginUsernameValue.trim()
    val password = loginPasswordValue
    if (username.isEmpty()) {
      loginError = "Username required"
      return
    }
    if (password.isBlank()) {
      loginError = "Password required"
      return
    }
    if (authMode == "signup" && password != signupConfirmPasswordValue) {
      loginError = "Passwords do not match"
      return
    }
    scope.launch {
      isLoggingIn = true
      loginError = ""
      try {
        val previousUsername = repository.getStoredSession()?.user?.username ?: repository.getLoginHint().ifBlank { null }
        repository.assertLocalWorkspaceCanUseAccount(username, previousUsername)
        val response = if (authMode == "signup") {
          repository.signup(username, password, signupDisplayNameValue.ifBlank { null })
        } else {
          repository.login(username, password)
        }
        repository.rememberPasswordAndAdopt(response.user.username, password, previousUsername)
        repository.setStoredSession(StoredSession(response.token, response.user, response.expiresAt))
        applyUser(response.user)
        loginOpen = false
        hasToken = true
        syncMessage = "Signed in"
        notify("success", if (authMode == "signup") "Account created" else "Signed in", "Syncing local and remote notes.")
        refresh()
        syncNow()
      } catch (error: Throwable) {
        loginError = error.message ?: "Login failed"
        syncMessage = loginError
        notify("error", "Sign-in failed", loginError)
      } finally {
        isLoggingIn = false
      }
    }
  }

  fun syncNow() {
    scope.launch {
      if (isArchiveBusy) {
        syncQueued = true
        syncMessage = "Sync paused during import/export"
        return@launch
      }
      val token = repository.getStoredSession()?.token
      hasToken = token != null
      if (token == null) return@launch
      if (isSyncing) {
        syncQueued = true
        return@launch
      }
      if (!repository.hasStoredEncryptionKeyMaterial()) {
        repository.recordSyncError(IllegalStateException("Sign in again to sync encrypted notes"), "Sync")
        refresh()
        expireSession("Sign in again to sync encrypted notes")
        return@launch
      }
      isSyncing = true
      updateSyncProgress(SyncProgress(SyncProgressPhase.PREPARING))
      var syncCompleted = false
      try {
        flushPendingSave()
        val result = repository.runSync(token) { progress ->
          withContext(Dispatchers.Main) {
            updateSyncProgress(progress)
          }
        }
        syncMessage = if (result.conflicts > 0) "${result.conflicts} conflicts" else "Local changes saved"
        refresh()
        try {
          val remote = repository.loadSyncStatus(token)
          remoteSyncEnabled = remote.enabled
          remoteSyncState = remote.state
          remoteSyncError = remote.lastError ?: ""
          if (!remote.lastError.isNullOrBlank()) {
            repository.recordSyncError(IllegalStateException(remote.lastError), "Remote sync")
            refresh()
          }
        } catch (error: AuthException) {
          repository.recordSyncError(error, "Remote sync status")
          refresh()
          expireSession(error.message ?: "Login expired")
          return@launch
        } catch (error: Throwable) {
          repository.recordSyncError(error, "Remote sync status")
          refresh()
          remoteSyncEnabled = true
          remoteSyncState = "error"
          remoteSyncError = error.message ?: "Could not check remote sync"
        }
        runCatching { refreshServerConfigNow() }
          .onFailure { serverConfigError = it.message ?: "Could not reach sync API" }
        syncCompleted = true
      } catch (error: AuthException) {
        refresh()
        expireSession(error.message ?: "Login expired")
      } catch (error: Throwable) {
        refresh()
        syncMessage = error.message ?: "Sync failed"
        notify("error", "Sync failed", syncMessage)
      } finally {
        isSyncing = false
        syncActivityLabel = ""
        syncActivityDetail = ""
        val shouldSyncAgain = syncCompleted && (syncQueued || pendingSyncCount > 0)
        syncQueued = false
        if (shouldSyncAgain) scheduleSyncAfterLocalChange()
      }
    }
  }

  fun saveAccountProfile() {
    val token = repository.getStoredSession()?.token ?: return
    scope.launch {
      try {
        val user = repository.updateAccount(token, accountDisplayName)
        val session = repository.getStoredSession()
        if (session != null) repository.setStoredSession(session.copy(user = user))
        applyUser(user)
        accountProfileEditing = false
        accountMessage = "Profile saved"
        notify("success", "Profile saved")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not save profile"
      }
    }
  }

  fun changePassword() {
    val token = repository.getStoredSession()?.token ?: return
    if (currentPasswordValue.isBlank()) {
      accountError = "Current password required"
      return
    }
    if (newPasswordValue.isBlank()) {
      accountError = "New password required"
      return
    }
    if (newPasswordValue != confirmPasswordValue) {
      accountError = "Passwords do not match"
      return
    }
    scope.launch {
      try {
        val user = repository.changePassword(token, currentPasswordValue, newPasswordValue)
        clearLocalSession("Password changed. Sign in again to keep syncing.", openLogin = true)
        loginUsernameValue = user.username
        notify("success", "Password changed", "Sign in again to keep syncing.")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not change password"
      }
    }
  }

  fun logout() {
    val token = repository.getStoredSession()?.token
    scope.launch {
      if (token != null) repository.logout(token)
      clearLocalSession("Signed out")
      notify("info", "Signed out", "This device is no longer syncing.")
    }
  }

  fun deleteAccount() {
    val token = repository.getStoredSession()?.token ?: return
    if (deletePasswordValue.isBlank()) {
      accountError = "Password required to delete account"
      return
    }
    scope.launch {
      try {
        flushPendingSave()
        repository.deleteAccount(token, deletePasswordValue)
        clearLocalSession("Account deleted")
        refresh()
        openDraftNote()
        notify("info", "Account deleted")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not delete account"
      }
    }
  }

  fun resolveConflict(choice: String) {
    val conflict = conflicts.firstOrNull() ?: return
    scope.launch {
      repository.resolveConflict(conflict.id, choice)
      refresh()
      syncNow()
    }
  }

  fun prepareMarkdownExport(onReady: (String) -> Unit) {
    scope.launch {
      isArchiveBusy = true
      try {
        val (fileName, bytes) = repository.exportMarkdownZip()
        preparedExport = bytes
        onReady(fileName)
      } catch (error: Throwable) {
        notify("error", "Export failed", error.message ?: "Could not export notes")
      } finally {
        isArchiveBusy = false
      }
    }
  }

  fun completeMarkdownExport(uri: Uri?, resolver: ContentResolver) {
    val bytes = preparedExport ?: return
    preparedExport = null
    if (uri == null) return
    scope.launch {
      runCatching {
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
      }.onSuccess {
        notify("success", "Export complete", "Markdown ZIP saved.")
      }.onFailure {
        notify("error", "Export failed", it.message ?: "Could not write file")
      }
    }
  }

  fun importMarkdownUris(uris: List<Uri>, resolver: ContentResolver) {
    if (uris.isEmpty()) return
    scope.launch {
      isArchiveBusy = true
      try {
        val files = uris.mapNotNull { uri ->
          val text = resolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: return@mapNotNull null
          MarkdownInputFile(displayName(uri, resolver), displayName(uri, resolver), text)
        }
        val result = repository.importMarkdownFiles(files)
        importBanner = result.summary()
        notify("success", "Import succeeded", result.summary())
        refresh()
        result.noteIds.firstOrNull()?.let { id -> notes.firstOrNull { it.id == id }?.let(::selectNote) }
        scheduleSyncAfterLocalChange()
      } catch (error: Throwable) {
        importBanner = error.message ?: "Import failed"
        notify("error", "Import failed", importBanner)
      } finally {
        isArchiveBusy = false
      }
    }
  }

  private fun scheduleSave() {
    if (selectedNote?.trashedAt != null) return
    saveJob?.cancel()
    selectedNote?.let {
      selectedNote = it.copy(title = titleValue.trim(), body = bodyValue, syncStatus = "pending")
    }
    saveJob = scope.launch {
      delay(120)
      saveJob = null
      saveEditorNow()
    }
  }

  private suspend fun flushPendingSave() {
    if (saveJob == null) return
    saveJob?.cancel()
    saveJob = null
    saveEditorNow()
  }

  private suspend fun saveEditorNow() {
    val current = selectedNote
    if (current != null) {
      selectedNote = repository.updateNoteContent(current.id, titleValue, bodyValue)
    } else if (titleValue.trim().isNotEmpty() || bodyValue.trim().isNotEmpty()) {
      selectedNote = repository.createBlankNote(titleValue, bodyValue, draftNotebookId())
    }
    refresh()
    scheduleSyncAfterLocalChange()
  }

  private fun draftNotebookId(): String? = if (filterId in setOf("all", "unfiled", "trash")) null else filterId

  private fun resetHistory() {
    undoStack = emptyList()
    redoStack = emptyList()
    lastSnapshot = titleValue to bodyValue
  }

  private fun scheduleSyncAfterLocalChange() {
    if (!hasToken) return
    if (isArchiveBusy) {
      syncQueued = true
      return
    }
    repository.enqueueBackgroundSync()
    if (isSyncing) {
      syncQueued = true
      return
    }
    autoSyncJob?.cancel()
    autoSyncJob = scope.launch {
      delay(600)
      autoSyncJob = null
      syncNow()
    }
  }

  private suspend fun resumeSession(token: String) {
    if (!repository.hasStoredEncryptionKeyMaterial()) {
      expireSession("Sign in again to sync encrypted notes")
      return
    }
    try {
      val (user, expiresAt) = repository.validateSession(token)
      repository.setStoredSession(StoredSession(token, user, expiresAt))
      applyUser(user)
      hasToken = true
      syncNow()
    } catch (error: AuthException) {
      repository.recordSyncError(error, "Session resume")
      refresh()
      expireSession(error.message ?: "Login expired")
    } catch (error: Throwable) {
      repository.recordSyncError(error, "Session resume")
      refresh()
      syncMessage = error.message ?: "Sync failed"
    }
  }

  private fun applyUser(user: AuthUser) {
    accountUsername = user.username
    accountDisplayName = user.displayName ?: ""
  }

  private fun expireSession(message: String) {
    clearLocalSession(message, openLogin = true)
    notify("error", "Session ended", message)
  }

  private fun clearLocalSession(message: String, openLogin: Boolean = false) {
    repository.clearStoredSession()
    hasToken = false
    accountUsername = ""
    accountDisplayName = ""
    accountMessage = message
    accountError = ""
    loginUsernameValue = repository.getLoginHint()
    loginPasswordValue = ""
    signupConfirmPasswordValue = ""
    loginOpen = openLogin
    syncMessage = if (message.isBlank()) "Sign in to sync" else message
    remoteSyncEnabled = false
    remoteSyncState = "unknown"
    remoteSyncError = ""
    syncQueued = false
    autoSyncJob?.cancel()
    autoSyncJob = null
  }

  fun saveApiBaseUrl() {
    val normalized = apiBaseUrl.trim().trimEnd('/')
    if (!isHttpApiUrl(normalized)) {
      notify("error", "Invalid API URL", "Use the Author HTTP API URL, not a database URL.")
      return
    }
    val previous = repository.getApiBaseUrl().trim().trimEnd('/')
    val changed = normalized != previous
    apiBaseUrl = normalized
    repository.setApiBaseUrl(normalized)
    if (changed && hasToken) {
      clearLocalSession("Sign in to sync with this server.", openLogin = true)
    }
    notify("info", "API URL saved", normalized)
    refreshServerConfig(showNotification = true)
  }

  fun useBuildApiBaseUrl() {
    apiBaseUrl = BuildConfig.DEFAULT_API_BASE_URL
    saveApiBaseUrl()
  }

  fun refreshServerConfig(showNotification: Boolean = false) {
    scope.launch {
      try {
        refreshServerConfigNow()
        if (showNotification) notify("success", "Server config loaded", serverApiBaseUrl)
      } catch (error: Throwable) {
        val message = error.message ?: "Could not reach sync API"
        serverConfigError = message
        if (showNotification) notify("error", "Server config failed", message)
      }
    }
  }

  private suspend fun refreshServerConfigNow() {
    val config = repository.loadServerConfig()
    serverApiBaseUrl = config.apiBaseUrl
    serverRemoteDatabaseConfigured = config.remoteDatabaseConfigured
    serverRemoteSyncEnabled = config.remoteSyncEnabled
    serverConfigError = ""
  }

  private fun isHttpApiUrl(value: String): Boolean = runCatching { java.net.URL(value) }.getOrNull()?.let { parsed ->
    parsed.protocol in setOf("http", "https") && !parsed.host.isNullOrBlank()
  } == true

  fun dismissNotification(id: String) {
    notifications = notifications.filterNot { it.id == id }
  }

  private fun notify(kind: String, title: String, message: String = "") {
    val id = java.util.UUID.randomUUID().toString()
    notifications = (notifications.takeLast(2) + AppNotification(id, kind, title, message))
    scope.launch {
      delay(if (kind == "error") 7000 else 4200)
      dismissNotification(id)
    }
  }

  private fun displayName(uri: Uri, resolver: ContentResolver): String {
    val fromCursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }
    return fromCursor ?: uri.lastPathSegment?.substringAfterLast('/') ?: "note.md"
  }
}
