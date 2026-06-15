package com.author.ui.state

import android.content.ContentResolver
import android.net.Uri
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.author.BuildConfig
import com.author.core.AuthException
import com.author.core.AuthUser
import com.author.core.DebugLogEntry
import com.author.core.DebugLogStore
import com.author.core.Device
import com.author.core.LocalConflict
import com.author.core.LocalNote
import com.author.core.LocalNotebook
import com.author.core.MarkdownInputFile
import com.author.core.NOTE_DATE_FILTERS
import com.author.core.NOTE_FILTER_FAVORITES_ID
import com.author.core.NOTE_FILTER_UNFILED_ID
import com.author.core.NotesRepository
import com.author.core.RepairDiagnostics
import com.author.core.StoredSession
import com.author.core.SyncProgress
import com.author.core.SyncProgressPhase
import com.author.core.TrustedAuthDevice
import com.author.core.formatDateTime
import com.author.core.normalizedNotebookName
import com.author.core.noteNotebookIds
import com.author.core.readBoundedUtf8
import com.author.ui.app.AppNotification
import com.author.ui.theme.resolveThemeChoice
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield

class NotesController(private val repository: NotesRepository, private val scope: CoroutineScope) :
  AutoCloseable {
  private companion object {
    const val MIN_PASSWORD_LENGTH = 15
    const val MAX_MARKDOWN_IMPORT_FILE_BYTES = 2L * 1024L * 1024L
    const val MAX_MARKDOWN_IMPORT_TOTAL_BYTES = 20L * 1024L * 1024L
    const val UNDO_SNAPSHOT_INTERVAL_MS = 1_500L

    fun passwordMeetsMinimumLength(password: String): Boolean =
      password.codePointCount(0, password.length) >= MIN_PASSWORD_LENGTH
  }

  private val initialSession = repository.getStoredSession()
  private var pageBackStack by mutableStateOf<List<String>>(emptyList())

  var notes by mutableStateOf<List<LocalNote>>(emptyList())
  var notebooks by mutableStateOf<List<LocalNotebook>>(emptyList())
  var trash by mutableStateOf<List<LocalNote>>(emptyList())
  var devices by mutableStateOf<List<Device>>(emptyList())
  var conflicts by mutableStateOf<List<LocalConflict>>(emptyList())
  var selectedNote by mutableStateOf<LocalNote?>(null)
  var noteSelectionMode by mutableStateOf(false)
  var selectedNoteIds by mutableStateOf<Set<String>>(emptySet())
  var titleValue by mutableStateOf("")
  var bodyValue by mutableStateOf("")
  var filterId by mutableStateOf("all")
  var searchValue by mutableStateOf("")
  var noteSort by mutableStateOf(repository.getSort())
  var noteGroup by mutableStateOf(repository.getGroup())
  var noteFilterNotebookIds by mutableStateOf<Set<String>>(emptySet())
  var noteFilterDateRanges by mutableStateOf<Set<String>>(emptySet())
  var compactView by mutableStateOf(repository.getCompactView())
  var editorZoom by mutableFloatStateOf(repository.getEditorZoom())
  var editorFont by mutableStateOf(repository.getEditorFont())
  var editorTextSize by mutableFloatStateOf(repository.getEditorTextSize())
  var editorLineHeight by mutableFloatStateOf(repository.getEditorLineHeight())
  var theme by mutableStateOf(repository.getTheme())
  var appLockAvailable by mutableStateOf(repository.isAppLockAvailable())
  var appLockEnabled by mutableStateOf(repository.getAppLockEnabled())
  var appLocked by mutableStateOf(repository.getAppLockEnabled())
  var appLockMessage by mutableStateOf("")
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
  var deviceOtpLoginAvailable by mutableStateOf(repository.hasStoredEncryptionKeyMaterial())
  var loginUsernameValue by mutableStateOf(repository.getLoginHint())
  var loginPasswordValue by mutableStateOf("")
  var loginTotpCodeValue by mutableStateOf("")
  var signupEmailValue by mutableStateOf("")
  var signupConfirmPasswordValue by mutableStateOf("")
  var signupEnabled by mutableStateOf(false)
  var signupEmailRequired by mutableStateOf(true)
  var loginError by mutableStateOf("")
  var isLoggingIn by mutableStateOf(false)
  var hasToken by mutableStateOf(initialSession != null)
  var accountUsername by mutableStateOf(initialSession?.user?.username ?: "")
  var accountEmail by mutableStateOf(initialSession?.user?.email ?: "")
  var accountDisplayName by mutableStateOf(initialSession?.user?.displayName ?: "")
  var accountTwoFactorEnabled by mutableStateOf(initialSession?.user?.twoFactorEnabled ?: false)
  var accountTrustedDevices by mutableStateOf<List<TrustedAuthDevice>>(emptyList())
  var accountMessage by mutableStateOf("")
  var accountError by mutableStateOf("")
  var signupRecoveryOpen by mutableStateOf(false)
  var signupRecoveryCodeValue by mutableStateOf("")
  var signupRecoveryKitText by mutableStateOf("")
  var signupRecoveryCodeVisible by mutableStateOf(true)
  var signupRecoverySaved by mutableStateOf(false)
  var signupRecoveryMessage by mutableStateOf("")
  var accountPanel by mutableStateOf<String?>(null)
  var accountProfileEditing by mutableStateOf(false)
  var accountPasswordEditing by mutableStateOf(false)
  var accountTotpEditing by mutableStateOf(false)
  var accountTotpSecret by mutableStateOf("")
  var accountTotpUrl by mutableStateOf("")
  var accountTotpCodeValue by mutableStateOf("")
  var accountTotpPasswordValue by mutableStateOf("")
  var accountDeleteEditing by mutableStateOf(false)
  var currentDeviceName by mutableStateOf("")
  var deviceNameEditing by mutableStateOf(false)
  var deviceNameValue by mutableStateOf("")
  var deviceNameError by mutableStateOf("")
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
  var pendingSyncCount by mutableIntStateOf(0)
  var lastSyncPassTitle by mutableStateOf("No completed pass yet")
  var lastSyncPassDetail by mutableStateOf("No sync pass has completed on this device.")
  var syncDebugTitle by mutableStateOf("No sync errors yet")
  var syncDebugDetail by mutableStateOf("The most recent sync error will appear here.")
  var syncDebugLog by mutableStateOf("No sync errors recorded on this device.")
  var repairDiagnosticsTitle by mutableStateOf(formatRepairDiagnosticsTitle(null))
  var repairDiagnosticsDetail by mutableStateOf(formatRepairDiagnosticsDetail(null))
  var repairDiagnosticsLog by mutableStateOf(formatRepairDiagnosticsLog(null))
  var canResetPullCursor by mutableStateOf(false)
  var appDebugTitle by mutableStateOf(formatAppDebugTitle(emptyList()))
  var appDebugDetail by mutableStateOf(formatAppDebugDetail(emptyList()))
  var appDebugLog by mutableStateOf(DebugLogStore.format(emptyList()))
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
  private var lastUndoSnapshotAt = 0L
  private var lastUndoSnapshotField = ""
  private var preparedExport: ByteArray? = null
  private var preparedSignupRecoveryKit: ByteArray? = null
  private var notificationActions = emptyMap<String, () -> Unit>()
  private var closed = false

  override fun close() {
    if (closed) return
    closed = true
    try {
      runBlocking { flushPendingSave() }
    } catch (error: Throwable) {
      runCatching {
        repository.recordDebugLog(
          "error",
          "App",
          "Could not flush pending save before closing",
          error.stackTraceToString(),
        )
      }
    } finally {
      autoSyncJob?.cancel()
      autoSyncJob = null
      repository.close()
    }
  }

  fun openAccountPanel(panel: String) {
    accountPanel = panel
    accountError = ""
    accountMessage = ""
    accountProfileEditing = panel == "email"
    accountPasswordEditing = panel == "password"
    accountDeleteEditing = panel == "delete"
    if (panel != "device") deviceNameEditing = false
    if (panel == "totp") {
      startTotpEdit()
    } else {
      cancelTotpEdit()
    }
  }

  fun closeAccountPanel() {
    accountPanel = null
    accountError = ""
    accountMessage = ""
    accountProfileEditing = false
    accountPasswordEditing = false
    accountDeleteEditing = false
    currentPasswordValue = ""
    newPasswordValue = ""
    confirmPasswordValue = ""
    deletePasswordValue = ""
    cancelTotpEdit()
    cancelDeviceNameEdit()
  }

  fun initialize() {
    scope.launch {
      try {
        refresh(preview = true)
        yield()
        repository.recordDebugLog("info", "App", "Opening workspace")
        runCatching {
            repository.ensureLocalNotesEncrypted()
            refresh()
          }
          .onFailure { repository.recordSyncError(it, "Local workspace") }
        runCatching { refreshServerConfigNow() }
          .onFailure { serverConfigError = it.message ?: "Could not reach sync API" }
        refreshAppLockState()
        repository.getStoredSession()?.let { resumeSession(it.token) }
        repository.recordDebugLog("info", "App", "Workspace opened")
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        repository.recordDebugLog("error", "App", "Startup failed", error.stackTraceToString())
        notify("error", "Startup failed", error.message ?: "Could not open notes")
      }
    }
  }

  fun refreshAsync() {
    scope.launch { refresh() }
  }

  val canHandleBack: Boolean
    get() =
      loginOpen ||
        signupRecoveryOpen ||
        noteSelectionMode ||
        selectedNoteIds.isNotEmpty() ||
        (currentPage == "settings" && settingsSection != "menu") ||
        pageBackStack.isNotEmpty() ||
        currentPage != "editor"

  fun navigateTo(page: String, addToBackStack: Boolean = true) {
    if (page == currentPage) return
    if (addToBackStack) pageBackStack = (pageBackStack + currentPage).takeLast(24)
    currentPage = page
    if (page == "settings") settingsSection = "menu"
  }

  fun handleBack() {
    if (signupRecoveryOpen) return
    if (loginOpen) {
      if (!isLoggingIn) loginOpen = false
      return
    }
    if (noteSelectionMode || selectedNoteIds.isNotEmpty()) {
      clearSelection()
      return
    }
    if (currentPage == "settings" && settingsSection != "menu") {
      settingsSection = "menu"
      return
    }

    val previous = pageBackStack.lastOrNull()
    if (previous != null) {
      pageBackStack = pageBackStack.dropLast(1)
      currentPage = previous
      if (previous == "settings") settingsSection = "menu"
      return
    }

    if (currentPage != "editor") {
      currentPage = "editor"
    }
  }

  fun openLogin(mode: String = "signin") {
    authMode = if (mode == "signup" && signupEnabled) "signup" else "signin"
    loginUsernameValue = repository.getLoginHint()
    deviceOtpLoginAvailable = repository.hasStoredEncryptionKeyMaterial()
    loginPasswordValue = ""
    loginTotpCodeValue = ""
    signupEmailValue = ""
    signupConfirmPasswordValue = ""
    loginError = ""
    loginOpen = true
  }

  fun refreshAppLockState() {
    appLockAvailable = repository.isAppLockAvailable()
    if (!appLockAvailable) repository.setAppLockEnabled(false)
    appLockEnabled = repository.getAppLockEnabled()
    if (!appLockEnabled) appLocked = false
    if (!appLockAvailable && appLockMessage.isBlank()) {
      appLockMessage = "Device screen lock is unavailable."
    }
  }

  fun toggleAppLock() {
    refreshAppLockState()
    if (appLockEnabled) {
      repository.setAppLockEnabled(false)
      appLockEnabled = false
      appLocked = false
      appLockMessage = "App lock disabled."
      notify("success", "App lock disabled", "Author will stay open after leaving the app.")
      return
    }

    if (!appLockAvailable) {
      appLockMessage = "Set a device screen lock before enabling Author app lock."
      notify("error", "Screen lock unavailable", appLockMessage)
      return
    }

    repository.setAppLockEnabled(true)
    appLockEnabled = true
    appLockMessage = "App lock enabled."
    notify(
      "success",
      "App lock enabled",
      "Author will ask for this device's screen lock when reopened.",
    )
  }

  fun lockAppIfEnabled() {
    refreshAppLockState()
    if (!appLockEnabled) return
    scope.launch { flushPendingSave() }
    loginOpen = false
    appLocked = true
    appLockMessage = "Use this device's screen lock to reopen notes."
  }

  fun prepareAppUnlock() {
    appLockMessage = "Waiting for device unlock."
  }

  fun unlockApp() {
    appLocked = false
    appLockMessage = ""
  }

  fun appLockAuthenticationFailed() {
    if (appLocked) appLockMessage = "Unlock canceled."
  }

  fun appLockUnavailable() {
    appLockMessage = "Device screen lock is unavailable."
    notify("error", "Screen lock unavailable", appLockMessage)
    repository.setAppLockEnabled(false)
    appLockEnabled = false
    appLocked = false
  }

  fun chooseAuthMode(mode: String) {
    if (isLoggingIn || authMode == mode) return
    if (mode == "signup" && !signupEnabled) {
      loginError = "Signup is disabled"
      return
    }
    authMode = mode
    loginError = ""
    deviceOtpLoginAvailable = repository.hasStoredEncryptionKeyMaterial()
    loginPasswordValue = ""
    loginTotpCodeValue = ""
    signupConfirmPasswordValue = ""
    if (mode == "signin") {
      signupEmailValue = ""
      loginUsernameValue = repository.getLoginHint()
    }
  }

  suspend fun refresh(preview: Boolean = false) {
    val selectedId = selectedNote?.id
    val workspace = if (preview) repository.loadWorkspacePreview() else repository.loadWorkspace()
    val currentDevice = if (preview) null else repository.getOrCreateDevice()
    notes = workspace.notes
    notebooks = workspace.notebooks
    trash = workspace.trash
    devices =
      if (currentDevice == null) workspace.devices
      else if (workspace.devices.any { it.id == currentDevice.id }) workspace.devices
      else listOf(currentDevice) + workspace.devices
    if (currentDevice != null) {
      currentDeviceName = currentDevice.name
      if (!deviceNameEditing) deviceNameValue = currentDevice.name
    }
    conflicts = workspace.conflicts
    pendingSyncCount = workspace.pendingSyncCount
    lastSyncPassTitle =
      workspace.lastSyncPass.completedAt?.let { formatDateTime(it) } ?: "No completed pass yet"
    lastSyncPassDetail =
      if (workspace.lastSyncPass.completedAt == null) {
        "No sync pass has completed on this device."
      } else {
        "${workspace.lastSyncPass.pushed} pushed, ${workspace.lastSyncPass.pulled} pulled, ${workspace.lastSyncPass.conflicts} conflicts"
      }
    syncDebugTitle =
      workspace.syncDebugInfo.lastErrorAt?.let { formatDateTime(it) } ?: "No sync errors yet"
    syncDebugDetail =
      workspace.syncDebugInfo.lastErrorMessage.ifBlank {
        "The most recent sync error will appear here."
      }
    syncDebugLog =
      formatSyncDebugLog(
        workspace.syncDebugInfo.lastErrorAt,
        workspace.syncDebugInfo.lastErrorMessage,
        workspace.syncDebugInfo.lastErrorStack,
      )
    appDebugTitle = formatAppDebugTitle(workspace.appDebugLogEntries)
    appDebugDetail = formatAppDebugDetail(workspace.appDebugLogEntries)
    appDebugLog = DebugLogStore.format(workspace.appDebugLogEntries)
    val validNotebookFilterIds =
      notebooks.filter { it.deletedAt == null }.map { it.id }.toSet() + NOTE_FILTER_UNFILED_ID
    noteFilterNotebookIds = noteFilterNotebookIds.filter { it in validNotebookFilterIds }.toSet()
    noteFilterDateRanges = noteFilterDateRanges.filter { it in NOTE_DATE_FILTERS }.toSet()
    selectedNoteIds = selectedNoteIds.filter { id -> (notes + trash).any { it.id == id } }.toSet()
    if (!preview && selectedId != null) {
      val refreshed = (notes + trash).firstOrNull { it.id == selectedId }
      selectedNote = refreshed
      if (saveJob == null && refreshed != null) {
        titleValue = refreshed.title
        bodyValue = refreshed.body
      }
    }
  }

  fun clearDebugLog() {
    repository.clearDebugLog()
    appDebugTitle = formatAppDebugTitle(emptyList())
    appDebugDetail = formatAppDebugDetail(emptyList())
    appDebugLog = DebugLogStore.format(emptyList())
  }

  fun resetPullCursorRecovery() {
    scope.launch {
      try {
        repository.resetPullCursorRecovery()
        syncMessage = "Pull cursor reset"
        refreshRepairDiagnosticsNow()
        notify(
          "success",
          "Pull cursor reset",
          "The next sync will verify remote changes from revision 0.",
        )
      } catch (error: Throwable) {
        repository.recordDebugLog(
          "error",
          "Sync",
          "Could not reset pull cursor",
          error.stackTraceToString(),
        )
        notify("error", "Repair failed", error.message ?: "Could not reset pull cursor")
      }
    }
  }

  fun refreshRepairDiagnostics() {
    scope.launch {
      try {
        refreshRepairDiagnosticsNow()
      } catch (error: Throwable) {
        repository.recordDebugLog(
          "error",
          "Database",
          "Could not load repair diagnostics",
          error.stackTraceToString(),
        )
        notify("error", "Diagnostics failed", error.message ?: "Could not load repair diagnostics")
      }
    }
  }

  private fun formatSyncDebugLog(
    lastErrorAt: String?,
    lastErrorMessage: String,
    lastErrorStack: String,
  ): String {
    if (lastErrorAt == null && lastErrorMessage.isBlank()) {
      return "No sync errors recorded on this device."
    }

    return listOf(
        "Time: ${lastErrorAt?.let { formatDateTime(it) } ?: "Unknown"}",
        "Message: ${lastErrorMessage.ifBlank { "Sync failed" }}",
        lastErrorStack.takeIf { it.isNotBlank() }?.let { "\n$it" }.orEmpty(),
      )
      .filter { it.isNotBlank() }
      .joinToString("\n")
  }

  private fun formatAppDebugTitle(entries: List<DebugLogEntry>?): String =
    entries?.lastOrNull()?.at?.let { formatDateTime(it) } ?: "No diagnostic logs recorded"

  private fun formatAppDebugDetail(entries: List<DebugLogEntry>?): String =
    if (entries.isNullOrEmpty()) {
      "App, database, sync, and worker logs will appear here."
    } else {
      "${entries.size} entries saved locally"
    }

  private fun formatRepairDiagnosticsTitle(diagnostics: RepairDiagnostics?): String =
    when {
      diagnostics == null -> "Not checked yet"
      diagnostics.issueCount == 0 -> "No repair issues found"
      diagnostics.issueCount == 1 -> "1 repair issue found"
      else -> "${diagnostics.issueCount} repair issues found"
    }

  private fun formatRepairDiagnosticsDetail(diagnostics: RepairDiagnostics?): String =
    diagnostics?.checkedAt?.let { "Last checked ${formatDateTime(it)}" }
      ?: "Local sync, encryption, and recovery checks will appear here."

  private fun formatRepairDiagnosticsLog(diagnostics: RepairDiagnostics?): String =
    diagnostics?.entries?.joinToString("\n\n") {
      "[${it.status.uppercase()}] ${it.label}\n${it.detail}"
    } ?: "Repair diagnostics have not run yet."

  private suspend fun refreshRepairDiagnosticsNow() {
    val diagnostics = repository.loadRepairDiagnostics()
    repairDiagnosticsTitle = formatRepairDiagnosticsTitle(diagnostics)
    repairDiagnosticsDetail = formatRepairDiagnosticsDetail(diagnostics)
    repairDiagnosticsLog = formatRepairDiagnosticsLog(diagnostics)
    canResetPullCursor = diagnostics.canResetPullCursor
  }

  private fun pluralizeSyncCount(value: Int, singular: String): String =
    "$value $singular${if (value == 1) "" else "s"}"

  private fun updateSyncProgress(progress: SyncProgress) {
    val (label, detail) =
      when (progress.phase) {
        SyncProgressPhase.PREPARING ->
          "Preparing sync" to "Checking local changes before the network pass"
        SyncProgressPhase.PUSHING -> {
          val detail =
            when {
              progress.total == 0 -> "No local changes to push"
              progress.pushed == 0 ->
                "Sending ${pluralizeSyncCount(progress.total, "local change")}"
              else -> "${progress.pushed} of ${progress.total} local changes pushed"
            }
          "Pushing local changes" to detail
        }
        SyncProgressPhase.PULLING -> {
          val detail =
            if (progress.pulled == 0) {
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

  fun deviceName(deviceId: String?): String =
    deviceId?.let { id -> devices.firstOrNull { it.id == id }?.name ?: id } ?: "Unknown device"

  fun selectNote(note: LocalNote) {
    navigateTo("editor")
    scope.launch {
      flushPendingSave()
      val fullNote = repository.loadNote(note.id)
      if (fullNote == null) {
        refresh()
        openDraftNote()
        return@launch
      }
      selectedNote = fullNote
      titleValue = fullNote.title
      bodyValue = fullNote.body
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

  private fun clearSensitiveWorkspace() {
    saveJob?.cancel()
    saveJob = null
    notes = emptyList()
    notebooks = emptyList()
    trash = emptyList()
    conflicts = emptyList()
    selectedNote = null
    selectedNoteIds = emptySet()
    noteSelectionMode = false
    titleValue = ""
    bodyValue = ""
    filterId = "all"
    noteFilterNotebookIds = emptySet()
    noteFilterDateRanges = emptySet()
    pendingSyncCount = 0
    resetHistory()
  }

  fun updateEditor(field: String, value: String) {
    val normalizedField = if (field == "title") "title" else "body"
    if (normalizedField == "title" && titleValue == value) return
    if (normalizedField == "body" && bodyValue == value) return

    val before = titleValue to bodyValue
    if (normalizedField == "title") titleValue = value else bodyValue = value
    val now = SystemClock.uptimeMillis()
    val shouldCaptureUndo =
      undoStack.isEmpty() ||
        lastUndoSnapshotField != normalizedField ||
        now - lastUndoSnapshotAt >= UNDO_SNAPSHOT_INTERVAL_MS
    if (shouldCaptureUndo) {
      undoStack = (undoStack + before).takeLast(120)
      redoStack = emptyList()
      lastUndoSnapshotAt = now
      lastUndoSnapshotField = normalizedField
    } else if (redoStack.isNotEmpty()) {
      redoStack = emptyList()
    }
    lastSnapshot = titleValue to bodyValue
    scheduleSave()
  }

  fun undoEditor() {
    val snapshot = undoStack.lastOrNull() ?: return
    redoStack = (redoStack + (titleValue to bodyValue)).takeLast(120)
    undoStack = undoStack.dropLast(1)
    titleValue = snapshot.first
    bodyValue = snapshot.second
    lastSnapshot = snapshot
    lastUndoSnapshotAt = SystemClock.uptimeMillis()
    lastUndoSnapshotField = ""
    scheduleSave()
  }

  fun redoEditor() {
    val snapshot = redoStack.lastOrNull() ?: return
    undoStack = (undoStack + (titleValue to bodyValue)).takeLast(120)
    redoStack = redoStack.dropLast(1)
    titleValue = snapshot.first
    bodyValue = snapshot.second
    lastSnapshot = snapshot
    lastUndoSnapshotAt = SystemClock.uptimeMillis()
    lastUndoSnapshotField = ""
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

  fun setGroup(group: String) {
    noteGroup = group
    repository.setGroup(group)
  }

  fun toggleNoteFilterNotebook(notebookId: String) {
    val normalized = if (notebookId.isBlank()) NOTE_FILTER_UNFILED_ID else notebookId.trim()
    noteFilterNotebookIds =
      if (normalized in noteFilterNotebookIds) noteFilterNotebookIds - normalized
      else noteFilterNotebookIds + normalized
  }

  fun toggleNoteFilterDateRange(range: String) {
    if (range !in NOTE_DATE_FILTERS) return
    noteFilterDateRanges =
      if (range in noteFilterDateRanges) noteFilterDateRanges - range
      else noteFilterDateRanges + range
  }

  fun clearNoteFilters() {
    noteFilterNotebookIds = emptySet()
    noteFilterDateRanges = emptySet()
  }

  fun clearNotebookFilters() {
    noteFilterNotebookIds = emptySet()
  }

  fun clearDateFilters() {
    noteFilterDateRanges = emptySet()
  }

  fun toggleCompactView() {
    compactView = !compactView
    repository.setCompactView(compactView)
  }

  fun toggleTheme(systemDark: Boolean = false) {
    val resolvedTheme = resolveThemeChoice(theme, systemDark)
    theme = if (resolvedTheme.startsWith("dark")) "light" else "dark"
    repository.setTheme(theme)
  }

  fun checkForUpdates() {
    repository.enqueueUpdateCheck()
    notify(
      "success",
      "Checking for updates",
      "Author will notify you if a newer Android release is available.",
    )
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
    noteSelectionMode = true
    selectedNoteIds = if (selected) selectedNoteIds + note.id else selectedNoteIds - note.id
  }

  fun toggleAllVisible(selected: Boolean) {
    noteSelectionMode = true
    selectedNoteIds =
      if (selected) selectedNoteIds + visibleNotes.map { it.id }
      else selectedNoteIds - visibleNotes.map { it.id }.toSet()
  }

  fun clearSelection() {
    noteSelectionMode = false
    selectedNoteIds = emptySet()
  }

  fun createNotebook() {
    val trimmed = notebookNameValue.trim()
    if (trimmed.isEmpty()) {
      notebookError = "Name required"
      notify("error", "Notebook name required", "Enter a name before creating a notebook.")
      return
    }
    if (notebookNameTaken(trimmed)) {
      notebookError = "Name already exists"
      notify("error", "Notebook already exists", "Use a different notebook name.")
      return
    }
    scope.launch {
      val notebook = repository.createNotebook(trimmed)
      if (notebook == null) {
        notebookError = "Name already exists"
        notify("error", "Notebook already exists", "Use a different notebook name.")
        return@launch
      }
      filterId = notebook.id
      selectedNote
        ?.takeIf { it.trashedAt == null }
        ?.let { selectedNote = repository.assignNoteToNotebook(it.id, notebook.id, true) }
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
    val trimmed = renameNotebookValue.trim()
    if (trimmed.isEmpty()) return
    if (notebookNameTaken(trimmed, notebook.id)) {
      notify("error", "Notebook already exists", "Use a different notebook name.")
      return
    }
    scope.launch {
      val renamed = repository.renameNotebook(notebook.id, trimmed)
      if (renamed == null) return@launch
      renamingNotebookId = null
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  private fun notebookNameTaken(name: String, excludeId: String? = null): Boolean {
    val normalized = normalizedNotebookName(name)
    return notebooks.any {
      it.deletedAt == null && it.id != excludeId && normalizedNotebookName(it.name) == normalized
    }
  }

  fun confirmDeleteNotebook(notebook: LocalNotebook) {
    scope.launch {
      repository.deleteNotebook(notebook.id)
      if (filterId == notebook.id) filterId = "all"
      noteFilterNotebookIds = noteFilterNotebookIds - notebook.id
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

  fun toggleFavorite(note: LocalNote) {
    if (note.trashedAt != null) return
    scope.launch {
      flushPendingSave()
      val updated = repository.setNoteFavorite(note.id, !note.isFavorite)
      if (selectedNote?.id == note.id) selectedNote = updated
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  fun trashNote(note: LocalNote) {
    scope.launch {
      val shouldReopenRestoredNote = currentPage == "editor" && selectedNote?.id == note.id
      flushPendingSave()
      repository.moveNoteToTrash(note.id)
      refresh()
      if (selectedNote?.id == note.id)
        notes.firstOrNull { it.id != note.id }?.let(::selectNote) ?: openDraftNote()
      notifyNotesMovedToTrash(listOf(note.id), shouldReopenRestoredNote)
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
      if (selectedNote?.id == note.id)
        (if (filterId == "trash") trash.firstOrNull() else notes.firstOrNull())?.let(::selectNote)
          ?: openDraftNote()
      scheduleSyncAfterLocalChange()
    }
  }

  fun trashSelected() {
    val targets = selectedNotes.filter { it.trashedAt == null }
    if (targets.isEmpty()) return
    scope.launch {
      val shouldReopenRestoredNote =
        currentPage == "editor" && targets.any { it.id == selectedNote?.id }
      flushPendingSave()
      val targetIds = targets.map { it.id }.toSet()
      targets.forEach { repository.moveNoteToTrash(it.id) }
      selectedNoteIds = selectedNoteIds - targetIds
      refresh()
      if (selectedNote?.id in targetIds) {
        notes.firstOrNull { it.id !in targetIds }?.let(::selectNote) ?: openDraftNote()
      }
      notifyNotesMovedToTrash(targets.map { it.id }, shouldReopenRestoredNote)
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
      targets.firstOrNull()?.let { target ->
        notes.firstOrNull { it.id == target.id }?.let(::selectNote)
      }
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
        (if (filterId == "trash") trash.firstOrNull() else notes.firstOrNull())?.let(::selectNote)
          ?: openDraftNote()
      }
      scheduleSyncAfterLocalChange()
    }
  }

  fun submitLogin() {
    val username = loginUsernameValue.trim()
    val password = loginPasswordValue
    val hasPassword = password.isNotBlank()
    val canUseDeviceOtpLogin =
      authMode == "signin" && !hasPassword && repository.hasStoredEncryptionKeyMaterial()
    if (username.isEmpty()) {
      showLoginError("Username required")
      return
    }
    if (!hasPassword && authMode == "signup") {
      showLoginError("Password required")
      return
    }
    if (authMode == "signup" && !passwordMeetsMinimumLength(password)) {
      showLoginError("Password must be at least $MIN_PASSWORD_LENGTH characters")
      return
    }
    if (!hasPassword && !canUseDeviceOtpLogin) {
      showLoginError("Password required on first login for this device")
      return
    }
    if (canUseDeviceOtpLogin && loginTotpCodeValue.isBlank()) {
      showLoginError("2FA code required")
      return
    }
    if (authMode == "signup" && password != signupConfirmPasswordValue) {
      showLoginError("Passwords do not match")
      return
    }
    if (authMode == "signup" && !signupEnabled) {
      showLoginError("Signup is disabled")
      return
    }
    if (authMode == "signup" && signupEmailRequired && signupEmailValue.isBlank()) {
      showLoginError("Email required")
      return
    }
    scope.launch {
      isLoggingIn = true
      loginError = ""
      try {
        val wasSignup = authMode == "signup"
        val previousUsername =
          repository.getStoredSession()?.user?.username
            ?: repository.getLoginHint().ifBlank { null }
        val response =
          if (wasSignup) {
            repository.signup(username, signupEmailValue, password)
          } else {
            repository.login(username, password, loginTotpCodeValue.trim().ifBlank { null })
          }
        val workspaceCleared =
          try {
            repository.prepareLocalWorkspaceForAccount(response.user.username, previousUsername)
          } catch (error: Throwable) {
            runCatching { repository.logout(response.token) }
            throw error
          }
        val adoptionPreviousUsername = if (workspaceCleared) null else previousUsername
        try {
          repository.assertLocalWorkspaceCanUseAccount(
            response.user.username,
            adoptionPreviousUsername,
          )
        } catch (error: Throwable) {
          runCatching { repository.logout(response.token) }
          throw error
        }
        if (hasPassword) {
          repository.rememberPasswordAndAdopt(
            response.user.username,
            password,
            adoptionPreviousUsername,
            response.encryptionKeyMaterial,
          )
        } else {
          repository.adoptWithStoredKey(response.user.username, adoptionPreviousUsername)
        }
        repository.setStoredSession(
          StoredSession(response.token, response.user, response.expiresAt)
        )
        applyAccount(
          response.user,
          listOf(
            TrustedAuthDevice(
              deviceId = response.device.id,
              deviceName = response.device.name,
              createdAt = "",
              lastUsedAt = "",
              current = true,
            )
          ),
        )
        deviceOtpLoginAvailable = repository.hasStoredEncryptionKeyMaterial()
        loginOpen = false
        hasToken = true
        if (
          wasSignup &&
            !response.recoveryCode.isNullOrBlank() &&
            !response.recoveryKitJson.isNullOrBlank()
        ) {
          showSignupRecoveryPrompt(response.recoveryCode, response.recoveryKitJson)
        }
        authMode = "signin"
        loginPasswordValue = ""
        loginTotpCodeValue = ""
        signupEmailValue = ""
        signupConfirmPasswordValue = ""
        syncMessage = "Signed in"
        notify(
          "success",
          if (wasSignup) "Account created" else "Signed in",
          "Syncing local and remote notes.",
        )
        refreshAccount()
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

  private fun showLoginError(message: String) {
    loginError = message
    notify("error", "Sign-in failed", message)
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
      if (!repository.hasUsableStoredEncryptionKeyMaterial()) {
        repository.recordSyncError(
          IllegalStateException("Sign in again to sync encrypted notes"),
          "Sync",
        )
        refresh()
        expireSession("Sign in again to sync encrypted notes")
        return@launch
      }
      isSyncing = true
      updateSyncProgress(SyncProgress(SyncProgressPhase.PREPARING))
      var syncCompleted = false
      try {
        flushPendingSave()
        val result =
          repository.runSync(token) { progress ->
            withContext(Dispatchers.Main) { updateSyncProgress(progress) }
          }
        syncMessage =
          if (result.conflicts > 0) "${result.conflicts} conflicts" else "Local changes saved"
        refresh()
        try {
          val remote = repository.loadSyncStatus(token)
          remoteSyncEnabled = remote.enabled
          remoteSyncState = remote.state
          remoteSyncError = remote.lastError ?: ""
          if (!remote.lastError.isNullOrBlank()) {
            repository.recordSyncError(IllegalStateException(remote.lastError), "Remote worker")
            refresh()
          }
        } catch (error: AuthException) {
          repository.recordSyncError(error, "Remote worker status")
          refresh()
          expireSession(error.message ?: "Sign-in expired")
          return@launch
        } catch (error: Throwable) {
          repository.recordSyncError(error, "Remote worker status")
          refresh()
          remoteSyncEnabled = true
          remoteSyncState = "error"
          remoteSyncError = error.message ?: "Could not check remote worker"
        }
        runCatching { refreshServerConfigNow() }
          .onFailure { serverConfigError = it.message ?: "Could not reach sync API" }
        syncCompleted = true
      } catch (error: AuthException) {
        refresh()
        expireSession(error.message ?: "Sign-in expired")
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
        val response = repository.updateAccount(token, accountEmail.ifBlank { null })
        val session = repository.getStoredSession()
        if (session != null) repository.setStoredSession(session.copy(user = response.user))
        applyAccount(response.user, response.trustedDevices)
        accountProfileEditing = false
        accountPanel = null
        accountMessage = "Email saved"
        notify("success", "Email saved")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not save email"
        notify("error", "Email not saved", accountError)
      }
    }
  }

  fun startDeviceNameEdit() {
    deviceNameEditing = true
    deviceNameValue = currentDeviceName
    deviceNameError = ""
    accountMessage = ""
  }

  fun cancelDeviceNameEdit() {
    deviceNameEditing = false
    deviceNameValue = currentDeviceName
    deviceNameError = ""
  }

  fun saveDeviceName() {
    if (deviceNameValue.isBlank()) {
      deviceNameError = "Device name required"
      notify("error", "Device name required")
      return
    }
    scope.launch {
      try {
        val device = repository.renameCurrentDevice(deviceNameValue)
        currentDeviceName = device.name
        deviceNameValue = device.name
        accountTrustedDevices =
          accountTrustedDevices.map {
            if (it.deviceId == device.id) it.copy(deviceName = device.name) else it
          }
        accountPanel = null
        deviceNameEditing = false
        deviceNameError = ""
        accountMessage = "Device name saved"
        refresh()
        notify("success", "Device name saved")
        if (hasToken) syncNow()
      } catch (error: Throwable) {
        deviceNameError = error.message ?: "Could not save device name"
        notify("error", "Device name not saved", deviceNameError)
      }
    }
  }

  fun revokeTrustedDevice(deviceId: String) {
    val token = repository.getStoredSession()?.token ?: return
    scope.launch {
      try {
        val response = repository.revokeTrustedDevice(token, deviceId)
        val session = repository.getStoredSession()
        if (session != null) repository.setStoredSession(session.copy(user = response.user))
        applyAccount(response.user, response.trustedDevices)
        deviceOtpLoginAvailable = response.trustedDevices.any { it.current }
        accountMessage = "Trusted device removed"
        notify("success", "Trusted device removed")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not remove trusted device"
        notify("error", "Trusted device not removed", accountError)
      }
    }
  }

  fun refreshAccount() {
    val token = repository.getStoredSession()?.token ?: return
    scope.launch {
      try {
        val response = repository.loadAccount(token)
        val session = repository.getStoredSession()
        if (session != null) repository.setStoredSession(session.copy(user = response.user))
        applyAccount(response.user, response.trustedDevices)
      } catch (error: AuthException) {
        repository.recordSyncError(error, "Account refresh")
        expireSession(error.message ?: "Sign-in expired")
      } catch (error: Throwable) {
        repository.recordSyncError(error, "Account refresh")
      }
    }
  }

  fun startTotpEdit() {
    val token = repository.getStoredSession()?.token ?: return
    accountTotpEditing = true
    accountProfileEditing = false
    accountPasswordEditing = false
    accountDeleteEditing = false
    accountTotpCodeValue = ""
    accountTotpPasswordValue = ""
    accountError = ""
    accountMessage = ""
    if (accountTwoFactorEnabled) {
      accountTotpSecret = ""
      accountTotpUrl = ""
      return
    }
    scope.launch {
      try {
        val setup = repository.setupTotp(token)
        accountTotpSecret = setup.secret
        accountTotpUrl = setup.otpauthUrl
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not start 2FA setup"
        notify("error", "2FA setup failed", accountError)
        accountTotpEditing = false
      }
    }
  }

  fun cancelTotpEdit() {
    accountTotpEditing = false
    accountTotpSecret = ""
    accountTotpUrl = ""
    accountTotpCodeValue = ""
    accountTotpPasswordValue = ""
    accountError = ""
  }

  fun saveTotp() {
    val token = repository.getStoredSession()?.token ?: return
    if (accountTotpPasswordValue.isBlank()) {
      accountError = "Current password required"
      notify("error", "Current password required")
      return
    }
    if (accountTotpCodeValue.isBlank()) {
      accountError = "2FA code required"
      notify("error", "2FA code required")
      return
    }
    if (!accountTwoFactorEnabled && accountTotpSecret.isBlank()) {
      accountError = "2FA setup not ready"
      notify("error", "2FA setup not ready")
      return
    }
    scope.launch {
      try {
        val response =
          if (accountTwoFactorEnabled) {
            repository.disableTotp(token, accountTotpPasswordValue, accountTotpCodeValue)
          } else {
            repository.enableTotp(
              token,
              accountTotpPasswordValue,
              accountTotpSecret,
              accountTotpCodeValue,
            )
          }
        applyAccount(response.user, response.trustedDevices)
        clearLocalSession("2FA changed. Sign in again to keep syncing.", openLogin = true)
        loginUsernameValue = response.user.username
        notify("success", "2FA changed", "Sign in again to keep syncing.")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not update 2FA"
        notify("error", "2FA not changed", accountError)
      }
    }
  }

  fun changePassword() {
    val token = repository.getStoredSession()?.token ?: return
    if (currentPasswordValue.isBlank()) {
      accountError = "Current password required"
      notify("error", "Current password required")
      return
    }
    if (newPasswordValue.isBlank()) {
      accountError = "New password required"
      notify("error", "New password required")
      return
    }
    if (!passwordMeetsMinimumLength(newPasswordValue)) {
      accountError = "New password must be at least $MIN_PASSWORD_LENGTH characters"
      notify("error", accountError)
      return
    }
    if (newPasswordValue != confirmPasswordValue) {
      accountError = "Passwords do not match"
      notify("error", "Passwords do not match")
      return
    }
    scope.launch {
      try {
        val response = repository.changePassword(token, currentPasswordValue, newPasswordValue)
        applyAccount(response.user, response.trustedDevices)
        hasToken = repository.getStoredSession() != null
        currentPasswordValue = ""
        newPasswordValue = ""
        confirmPasswordValue = ""
        accountPasswordEditing = false
        accountPanel = null
        accountMessage = "Password changed"
        syncMessage = "Local changes saved"
        refresh()
        notify("success", "Password changed", "Your encrypted notes stayed on the same data key.")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not change password"
        val syncIncomplete = accountError.startsWith("Password changed, but")
        if (syncIncomplete) {
          val storedSession = repository.getStoredSession()
          hasToken = storedSession != null
          storedSession?.user?.let { applyUser(it) }
          currentPasswordValue = ""
          newPasswordValue = ""
          confirmPasswordValue = ""
          accountPasswordEditing = false
          syncMessage = "Password changed; sync retry needed"
          refresh()
        }
        notify(
          "error",
          if (syncIncomplete) "Password sync incomplete" else "Password not changed",
          accountError,
        )
      }
    }
  }

  fun logout() {
    val token = repository.getStoredSession()?.token
    scope.launch {
      if (token != null) repository.logout(token)
      clearSensitiveWorkspace()
      clearLocalSession(
        "Signed out and locked",
        openLogin = true,
        clearEncryptionKeyMaterial = true,
      )
      notify("info", "Signed out and locked", "Sign in to unlock notes on this device.")
    }
  }

  fun deleteAccount() {
    val token = repository.getStoredSession()?.token ?: return
    if (deletePasswordValue.isBlank()) {
      accountError = "Password required to delete account"
      notify("error", "Password required to delete account")
      return
    }
    scope.launch {
      try {
        flushPendingSave()
        repository.deleteAccount(token, deletePasswordValue)
        clearLocalSession("Account deleted", clearEncryptionKeyMaterial = true)
        refresh()
        openDraftNote()
        notify("info", "Account deleted")
      } catch (error: Throwable) {
        accountError = error.message ?: "Could not delete account"
        notify("error", "Account not deleted", accountError)
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

  fun showSignupRecoveryPrompt(recoveryCode: String, recoveryKitText: String) {
    if (recoveryCode.isBlank() || recoveryKitText.isBlank()) return
    signupRecoveryCodeValue = recoveryCode
    signupRecoveryKitText = recoveryKitText
    signupRecoveryCodeVisible = true
    signupRecoverySaved = false
    signupRecoveryMessage = ""
    signupRecoveryOpen = true
  }

  fun completeSignupRecoveryPrompt() {
    if (!signupRecoverySaved) return
    signupRecoveryOpen = false
    signupRecoveryCodeValue = ""
    signupRecoveryKitText = ""
    signupRecoveryCodeVisible = true
    signupRecoverySaved = false
    signupRecoveryMessage = ""
    preparedSignupRecoveryKit = null
  }

  fun prepareSignupRecoveryKitSave(onReady: (String) -> Unit) {
    val kit = signupRecoveryKitText
    if (kit.isBlank()) return
    preparedSignupRecoveryKit = kit.toByteArray(Charsets.UTF_8)
    signupRecoveryMessage = "Recovery kit ready"
    onReady(recoveryKitFileName())
  }

  fun completeSignupRecoveryKitSave(uri: Uri?, resolver: ContentResolver) {
    val bytes = preparedSignupRecoveryKit ?: return
    preparedSignupRecoveryKit = null
    if (uri == null) return
    scope.launch {
      runCatching { resolver.openOutputStream(uri)?.use { it.write(bytes) } }
        .onSuccess {
          signupRecoveryMessage = "Recovery kit saved"
          notify("success", "Recovery kit saved")
        }
        .onFailure {
          signupRecoveryMessage = it.message ?: "Could not save recovery kit"
          notify("error", "Recovery kit failed", signupRecoveryMessage)
        }
    }
  }

  fun completeMarkdownExport(uri: Uri?, resolver: ContentResolver) {
    val bytes = preparedExport ?: return
    preparedExport = null
    if (uri == null) return
    scope.launch {
      runCatching { resolver.openOutputStream(uri)?.use { it.write(bytes) } }
        .onSuccess { notify("success", "Export complete", "Markdown ZIP saved.") }
        .onFailure { notify("error", "Export failed", it.message ?: "Could not write file") }
    }
  }

  fun importMarkdownUris(uris: List<Uri>, resolver: ContentResolver) {
    if (uris.isEmpty()) return
    scope.launch {
      isArchiveBusy = true
      try {
        var totalBytes = 0L
        val files =
          uris.mapNotNull { uri ->
            val name = displayName(uri, resolver)
            val declaredSize = contentSize(uri, resolver)
            if (declaredSize != null && declaredSize > MAX_MARKDOWN_IMPORT_FILE_BYTES) {
              error("$name is too large to import")
            }
            if (
              declaredSize != null && totalBytes + declaredSize > MAX_MARKDOWN_IMPORT_TOTAL_BYTES
            ) {
              error("Markdown import is too large")
            }
            val remainingBytes = MAX_MARKDOWN_IMPORT_TOTAL_BYTES - totalBytes
            if (remainingBytes <= 0) error("Markdown import is too large")
            val bounded =
              resolver.openInputStream(uri)?.use {
                readBoundedUtf8(it, minOf(MAX_MARKDOWN_IMPORT_FILE_BYTES, remainingBytes))
              } ?: return@mapNotNull null
            totalBytes += bounded.byteCount
            MarkdownInputFile(name, importPath(uri, name), bounded.text)
          }
        val result = repository.importMarkdownFiles(files)
        importBanner = result.summary()
        notify("success", "Import succeeded", result.summary())
        refresh()
        result.noteIds.firstOrNull()?.let { id ->
          notes.firstOrNull { it.id == id }?.let(::selectNote)
        }
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
    selectedNote?.let { selectedNote = it.copy(title = titleValue.trim(), syncStatus = "pending") }
    saveJob =
      scope.launch {
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
    val saved =
      if (current != null) {
        repository.updateNoteContent(current.id, titleValue, bodyValue)
      } else if (titleValue.trim().isNotEmpty() || bodyValue.trim().isNotEmpty()) {
        repository.createBlankNote(titleValue, bodyValue, draftNotebookId())
      } else {
        null
      }
    if (saved != null) {
      selectedNote = saved
      mergeSavedNote(saved)
      if (saved.syncStatus == "pending") pendingSyncCount = maxOf(pendingSyncCount, 1)
      scheduleSyncAfterLocalChange()
    } else if (current != null) {
      refresh()
      scheduleSyncAfterLocalChange()
    }
  }

  private fun mergeSavedNote(note: LocalNote) {
    if (note.deletedAt != null) {
      notes = notes.filterNot { it.id == note.id }
      trash = trash.filterNot { it.id == note.id }
      return
    }
    if (note.trashedAt != null) {
      notes = notes.filterNot { it.id == note.id }
      trash =
        (listOf(note) + trash.filterNot { it.id == note.id }).sortedByDescending {
          it.trashedAt ?: ""
        }
    } else {
      trash = trash.filterNot { it.id == note.id }
      notes =
        (listOf(note) + notes.filterNot { it.id == note.id }).sortedByDescending { it.updatedAt }
    }
  }

  private fun draftNotebookId(): String? =
    if (filterId in setOf("all", NOTE_FILTER_FAVORITES_ID, "unfiled", "trash")) null else filterId

  private fun resetHistory() {
    undoStack = emptyList()
    redoStack = emptyList()
    lastSnapshot = titleValue to bodyValue
    lastUndoSnapshotAt = 0L
    lastUndoSnapshotField = ""
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
    autoSyncJob =
      scope.launch {
        delay(600)
        autoSyncJob = null
        syncNow()
      }
  }

  private suspend fun resumeSession(token: String) {
    if (!repository.hasUsableStoredEncryptionKeyMaterial()) {
      expireSession("Sign in again to sync encrypted notes")
      return
    }
    try {
      val (user, expiresAt) = repository.validateSession(token)
      repository.setStoredSession(StoredSession(token, user, expiresAt))
      applyUser(user)
      hasToken = true
      refreshAccount()
      syncNow()
    } catch (error: AuthException) {
      repository.recordSyncError(error, "Session resume")
      refresh()
      expireSession(error.message ?: "Sign-in expired")
    } catch (error: Throwable) {
      repository.recordSyncError(error, "Session resume")
      refresh()
      syncMessage = error.message ?: "Sync failed"
    }
  }

  private fun applyUser(user: AuthUser) {
    accountUsername = user.username
    accountEmail = user.email ?: ""
    accountDisplayName = user.displayName ?: ""
    accountTwoFactorEnabled = user.twoFactorEnabled
  }

  private fun applyAccount(user: AuthUser, trustedDevices: List<TrustedAuthDevice>) {
    applyUser(user)
    accountTrustedDevices = trustedDevices
  }

  private fun expireSession(message: String) {
    clearLocalSession(message, openLogin = true)
    notify("error", "Session ended", message)
  }

  private fun clearLocalSession(
    message: String,
    openLogin: Boolean = false,
    clearEncryptionKeyMaterial: Boolean = false,
  ) {
    repository.clearStoredSession(clearEncryptionKeyMaterial)
    hasToken = false
    accountUsername = ""
    accountEmail = ""
    accountDisplayName = ""
    accountTwoFactorEnabled = false
    accountTrustedDevices = emptyList()
    accountMessage = message
    accountError = ""
    signupRecoveryOpen = false
    signupRecoveryCodeValue = ""
    signupRecoveryKitText = ""
    signupRecoveryCodeVisible = true
    signupRecoverySaved = false
    signupRecoveryMessage = ""
    preparedSignupRecoveryKit = null
    accountPanel = null
    accountProfileEditing = false
    accountPasswordEditing = false
    accountTotpEditing = false
    accountDeleteEditing = false
    accountTotpSecret = ""
    accountTotpUrl = ""
    accountTotpCodeValue = ""
    accountTotpPasswordValue = ""
    deviceNameEditing = false
    deviceNameError = ""
    loginUsernameValue = repository.getLoginHint()
    deviceOtpLoginAvailable = repository.hasStoredEncryptionKeyMaterial()
    loginPasswordValue = ""
    loginTotpCodeValue = ""
    signupEmailValue = ""
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
    signupEnabled = config.signupEnabled
    signupEmailRequired = config.signupEmailRequired
    if (!signupEnabled && authMode == "signup") {
      authMode = "signin"
      signupEmailValue = ""
      signupConfirmPasswordValue = ""
    }
    serverConfigError = ""
  }

  private fun isHttpApiUrl(value: String): Boolean =
    runCatching { java.net.URL(value) }
      .getOrNull()
      ?.let { parsed ->
        parsed.protocol in setOf("http", "https") && !parsed.host.isNullOrBlank()
      } == true

  fun dismissNotification(id: String) {
    notifications = notifications.filterNot { it.id == id }
    notificationActions = notificationActions - id
  }

  fun runNotificationAction(id: String) {
    val action = notificationActions[id] ?: return
    dismissNotification(id)
    action()
  }

  private fun notify(
    kind: String,
    title: String,
    message: String = "",
    actionLabel: String = "",
    action: (() -> Unit)? = null,
  ) {
    val id = java.util.UUID.randomUUID().toString()
    val next = notifications.takeLast(2) + AppNotification(id, kind, title, message, actionLabel)
    val nextIds = next.map { it.id }.toSet()
    notificationActions = notificationActions.filterKeys { it in nextIds }
    if (action != null) notificationActions = notificationActions + (id to action)
    notifications = next
    scope.launch {
      delay(if (kind == "error") 7000 else 4200)
      dismissNotification(id)
    }
  }

  private fun notifyNotesMovedToTrash(noteIds: List<String>, reopenFirstRestoredNote: Boolean) {
    val ids = noteIds.distinct()
    if (ids.isEmpty()) return
    notify(
      "info",
      if (ids.size == 1) "Moved to Trash" else "${ids.size} notes moved to Trash",
      actionLabel = "Undo",
    ) {
      restoreTrashedNotes(ids, reopenFirstRestoredNote)
    }
  }

  private fun restoreTrashedNotes(noteIds: List<String>, reopenFirstRestoredNote: Boolean) {
    if (noteIds.isEmpty()) return
    scope.launch {
      noteIds.forEach { repository.restoreNote(it) }
      selectedNoteIds = selectedNoteIds - noteIds.toSet()
      filterId = "all"
      refresh()
      if (reopenFirstRestoredNote) {
        noteIds.firstOrNull()?.let { id -> notes.firstOrNull { it.id == id }?.let(::selectNote) }
      }
      scheduleSyncAfterLocalChange()
    }
  }

  private fun displayName(uri: Uri, resolver: ContentResolver): String {
    val fromCursor =
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    return fromCursor ?: uri.lastPathSegment?.substringAfterLast('/') ?: "note.md"
  }

  private fun contentSize(uri: Uri, resolver: ContentResolver): Long? {
    val fromCursor =
      resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
      }
    return fromCursor?.takeIf { it >= 0 }
  }

  private fun importPath(uri: Uri, displayName: String): String {
    val candidates =
      listOfNotNull(
        runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull(),
        uri.path,
        uri.lastPathSegment,
      )
    return candidates
      .asSequence()
      .map { Uri.decode(it) ?: it }
      .map { it.substringAfter("/document/", it).substringAfter(':', it) }
      .map { it.replace('\\', '/').trim('/') }
      .firstOrNull { it.endsWith(displayName) } ?: displayName
  }

  private fun recoveryKitFileName(): String =
    "author-recovery-kit-${java.time.Instant.now().toString().take(10)}.json"
}
