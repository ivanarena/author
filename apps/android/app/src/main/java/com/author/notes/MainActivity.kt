package com.author.notes

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material.icons.outlined.ZoomOut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.notes.core.LocalConflict
import com.author.notes.core.LocalNote
import com.author.notes.core.LocalNotebook
import com.author.notes.core.NotesRepository
import com.author.notes.core.formatDateTime
import com.author.notes.core.formatListDate
import com.author.notes.core.noteDisplayTitle
import com.author.notes.core.noteNotebookIds
import com.author.notes.core.notePreview
import com.author.notes.core.relativeAge
import com.author.notes.ui.NotesController

class MainActivity : ComponentActivity() {
  private lateinit var controller: NotesController

  private val exportLauncher = registerForActivityResult(
    ActivityResultContracts.CreateDocument("application/zip")
  ) { uri: Uri? ->
    controller.completeMarkdownExport(uri, contentResolver)
  }

  private val importLauncher = registerForActivityResult(
    ActivityResultContracts.OpenMultipleDocuments()
  ) { uris: List<Uri> ->
    controller.importMarkdownUris(uris, contentResolver)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      val scope = rememberCoroutineScope()
      val notesController = remember {
        NotesController(NotesRepository(applicationContext), scope)
      }
      controller = notesController
      LaunchedEffect(Unit) { notesController.initialize() }
      AuthorNotesApp(
        controller = notesController,
        onExport = { notesController.prepareMarkdownExport { exportLauncher.launch(it) } },
        onImport = { importLauncher.launch(arrayOf("text/markdown", "text/plain", "application/octet-stream")) }
      )
    }
  }
}

@Composable
private fun AuthorNotesApp(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit
) {
  val dark = controller.theme == "dark"
  val colors = if (dark) {
    darkColorScheme(background = Color(0xFF111111), surface = Color(0xFF151515), onSurface = Color(0xFFF2F2F2))
  } else {
    lightColorScheme(background = Color.White, surface = Color.White, onSurface = Color(0xFF202020))
  }
  MaterialTheme(colorScheme = colors) {
    Box(
      Modifier
        .fillMaxSize()
        .background(if (dark) Color(0xFF111111) else Color.White)
        .windowInsetsPadding(WindowInsets.safeDrawing)
        .imePadding()
    ) {
      EditorPane(controller)
      TopDock(controller)
      if (controller.menusOpen) NavigationOverlay(controller)
      if (controller.profileOpen) ProfileOverlay(controller)
      if (controller.settingsOpen) SettingsDialog(controller, onExport, onImport)
      if (controller.loginOpen) LoginDialog(controller)
      controller.conflicts.firstOrNull()?.let { ConflictDialog(controller, it) }
      NotificationStack(controller)
    }
  }
}

@Composable
private fun EditorPane(controller: NotesController) {
  val text = MaterialTheme.colorScheme.onSurface
  val muted = text.copy(alpha = 0.52f)
  Column(
    Modifier
      .fillMaxSize()
      .padding(horizontal = 32.dp)
      .padding(top = 160.dp, bottom = 24.dp),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Column(Modifier.fillMaxWidth().weight(1f, fill = true)) {
      Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        val note = controller.selectedNote
        val rows = if (note == null) listOf("Unsaved draft") else listOf(
          syncStatusLabel(note.syncStatus),
          "Updated ${formatDateTime(note.updatedAt)}",
          "Created ${formatDateTime(note.createdAt)}"
        )
        rows.forEach { Text(it, color = muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      }
      Spacer(Modifier.height(18.dp))
      BasicTextField(
        value = controller.titleValue,
        onValueChange = { controller.updateEditor("title", it) },
        readOnly = controller.selectedNote?.trashedAt != null,
        textStyle = TextStyle(color = text, fontSize = (58 * controller.editorZoom).sp, fontWeight = FontWeight.Bold, lineHeight = (63 * controller.editorZoom).sp),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
          if (controller.titleValue.isBlank()) Text("Title", color = muted.copy(alpha = 0.38f), fontSize = (58 * controller.editorZoom).sp, fontWeight = FontWeight.Bold)
          inner()
        }
      )
      Spacer(Modifier.height(48.dp))
      BasicTextField(
        value = controller.bodyValue,
        onValueChange = { controller.updateEditor("body", it) },
        readOnly = controller.selectedNote?.trashedAt != null,
        textStyle = TextStyle(color = text, fontSize = (16 * controller.editorZoom).sp, lineHeight = (28 * controller.editorZoom).sp),
        modifier = Modifier
          .fillMaxWidth()
          .weight(1f)
          .verticalScroll(rememberScrollState()),
        decorationBox = { inner ->
          if (controller.bodyValue.isBlank()) Text("Body", color = muted.copy(alpha = 0.38f), fontSize = (16 * controller.editorZoom).sp)
          inner()
        }
      )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      GlassChip {
        GlassIcon(Icons.AutoMirrored.Outlined.Undo, "Undo", enabled = controller.undoStack.isNotEmpty()) { controller.undoEditor() }
        GlassIcon(Icons.AutoMirrored.Outlined.Redo, "Redo", enabled = controller.redoStack.isNotEmpty()) { controller.redoEditor() }
        Text("${controller.undoStack.size} undo, ${controller.redoStack.size} redo", color = muted, fontSize = 11.sp)
      }
      GlassChip {
        GlassIcon(Icons.Outlined.ZoomOut, "Zoom out", enabled = controller.editorZoom > 0.8f) { controller.zoomEditor(-1) }
        Text("${(controller.editorZoom * 100).toInt()}%", color = muted, fontSize = 11.sp)
        GlassIcon(Icons.Outlined.ZoomIn, "Zoom in", enabled = controller.editorZoom < 1.4f) { controller.zoomEditor(1) }
      }
      Text("${controller.wordCount} words", color = muted, fontSize = 11.sp)
    }
  }
}

private fun syncStatusLabel(status: String): String =
  status.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

@Composable
private fun TopDock(controller: NotesController) {
  Row(
    Modifier
      .fillMaxWidth()
      .padding(top = 18.dp),
    horizontalArrangement = Arrangement.Center
  ) {
    GlassIcon(Icons.Outlined.Menu, "Navigation", active = controller.menusOpen) {
      controller.menusOpen = !controller.menusOpen
      controller.profileOpen = false
    }
    Spacer(Modifier.width(14.dp))
    GlassIcon(Icons.Outlined.AccountCircle, "Profile", active = controller.profileOpen || controller.settingsOpen) {
      controller.profileOpen = !controller.profileOpen
      controller.menusOpen = false
    }
  }
}

@Composable
private fun NavigationOverlay(controller: NotesController) {
  val widthDp = LocalConfiguration.current.screenWidthDp
  GlassPanel(
    Modifier
      .padding(horizontal = 10.dp)
      .padding(top = 82.dp)
      .fillMaxWidth()
      .height(if (widthDp < 720) 650.dp else 520.dp)
  ) {
    if (widthDp < 720) {
      Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        NotebookSidebar(controller, Modifier.weight(0.42f))
        NoteListPanel(controller, Modifier.weight(0.58f))
      }
    } else {
      Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        NotebookSidebar(controller, Modifier.width(280.dp).fillMaxHeight())
        NoteListPanel(controller, Modifier.weight(1f).fillMaxHeight())
      }
    }
  }
}

@Composable
private fun NotebookSidebar(controller: NotesController, modifier: Modifier = Modifier) {
  Column(modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      GlassIcon(Icons.Outlined.FolderOpen, "All notes", active = controller.filterId == "all") { controller.filterId = "all" }
      GlassIcon(Icons.Outlined.Add, "New notebook", active = controller.newNotebookOpen) {
        controller.newNotebookOpen = !controller.newNotebookOpen
      }
    }
    if (controller.newNotebookOpen) {
      GlassPanel(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
          MiniField(controller.notebookNameValue, "Notebook name", Modifier.weight(1f)) {
            controller.notebookNameValue = it
            controller.notebookError = ""
          }
          GlassIcon(Icons.Outlined.Check, "Create") { controller.createNotebook() }
          GlassIcon(Icons.Outlined.Close, "Close") { controller.newNotebookOpen = false }
        }
        if (controller.notebookError.isNotBlank()) Text(controller.notebookError, color = Color(0xFFC9362F), fontSize = 11.sp, modifier = Modifier.padding(start = 10.dp, bottom = 8.dp))
      }
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      item { NavRow(Icons.Outlined.FolderOpen, "All notes", controller.notes.size.toString(), controller.filterId == "all") { controller.filterId = "all" } }
      item { NavRow(Icons.Outlined.Folder, "Unfiled", controller.unfiledCount.toString(), controller.filterId == "unfiled") { controller.filterId = "unfiled" } }
      items(controller.notebooks, key = { it.id }) { notebook ->
        NotebookRow(controller, notebook)
      }
      item { NavRow(Icons.Outlined.Delete, "Trash", controller.trash.size.toString(), controller.filterId == "trash") { controller.filterId = "trash" } }
    }
  }
}

@Composable
private fun NotebookRow(controller: NotesController, notebook: LocalNotebook) {
  if (controller.renamingNotebookId == notebook.id) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      MiniField(controller.renameNotebookValue, "Notebook", Modifier.weight(1f)) { controller.renameNotebookValue = it }
      GlassIcon(Icons.Outlined.Check, "Save") { controller.submitRename(notebook) }
      GlassIcon(Icons.Outlined.Close, "Cancel") { controller.renamingNotebookId = null }
    }
  } else if (controller.deletingNotebookId == notebook.id) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Delete?", color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f), fontSize = 12.sp)
      GlassIcon(Icons.Outlined.Check, "Confirm delete") { controller.confirmDeleteNotebook(notebook) }
      GlassIcon(Icons.Outlined.Close, "Cancel") { controller.deletingNotebookId = null }
    }
  } else {
    NavRow(
      icon = Icons.Outlined.Folder,
      label = notebook.name,
      count = (controller.notebookCounts[notebook.id] ?: 0).toString(),
      active = controller.filterId == notebook.id,
      trailing = {
        GlassIcon(Icons.Outlined.Edit, "Rename") { controller.startRename(notebook) }
        GlassIcon(Icons.Outlined.Delete, "Delete") { controller.deletingNotebookId = notebook.id }
      }
    ) { controller.filterId = notebook.id }
  }
}

@Composable
private fun NoteListPanel(controller: NotesController, modifier: Modifier = Modifier) {
  Column(modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      GlassIcon(Icons.AutoMirrored.Outlined.NoteAdd, "New note") { controller.newNote() }
      Checkbox(
        checked = controller.visibleNotes.isNotEmpty() && controller.visibleNotes.all { controller.selectedNoteIds.contains(it.id) },
        onCheckedChange = { controller.toggleAllVisible(it) },
        enabled = controller.visibleNotes.isNotEmpty()
      )
      if (controller.selectedNoteIds.isNotEmpty()) {
        if (controller.selectedNotes.any { it.trashedAt == null }) {
          GlassIcon(Icons.AutoMirrored.Outlined.DriveFileMove, "Move selected") { controller.selectedNotebookMenuOpen = !controller.selectedNotebookMenuOpen }
          GlassIcon(Icons.Outlined.Delete, "Trash selected") { controller.trashSelected() }
        }
        if (controller.selectedNotes.any { it.trashedAt != null }) {
          GlassIcon(Icons.Outlined.RestoreFromTrash, "Restore selected") { controller.restoreSelected() }
          GlassIcon(Icons.Outlined.Delete, "Delete selected") { controller.deleteSelectedPermanently() }
        }
        TextButton(onClick = { controller.clearSelection() }) { Text("${controller.selectedNoteIds.size} selected") }
      }
      Spacer(Modifier.weight(1f))
      Text(controller.syncLabel, color = statusColor(controller.syncLabel), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), modifier = Modifier.size(16.dp))
      MiniField(controller.searchValue, "Search notes", Modifier.weight(1f)) { controller.searchValue = it }
      listOf("date-desc" to "Date", "az" to "A-Z", "za" to "Z-A").forEach { (id, label) ->
        SmallTextButton(label, active = controller.noteSort == id) { controller.setSort(id) }
      }
    }
    if (controller.selectedNotebookMenuOpen) NotebookPicker(controller, controller.selectedNotes.firstOrNull(), selectedMode = true)
    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      controller.visibleGroups.forEach { (label, groupNotes) ->
        item { Text(label, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp, start = 8.dp)) }
        items(groupNotes, key = { it.id }) { note ->
          NoteRow(controller, note)
        }
      }
      if (controller.visibleNotes.isEmpty()) item { Text(if (controller.searchValue.isBlank()) "No notes" else "No matching notes", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, modifier = Modifier.padding(14.dp)) }
    }
  }
}

@Composable
private fun NoteRow(controller: NotesController, note: LocalNote) {
  val active = controller.selectedNote?.id == note.id
  GlassPanel(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(12.dp))
      .clickable { controller.selectNote(note) },
    active = active || controller.selectedNoteIds.contains(note.id),
    compact = true
  ) {
    Column {
      Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(
          checked = controller.selectedNoteIds.contains(note.id),
          onCheckedChange = { controller.toggleSelection(note, it) }
        )
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(noteDisplayTitle(note), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (controller.compactView) Text(relativeAge(note.updatedAt), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f))
          }
          if (!controller.compactView) {
            Text(notePreview(note).ifBlank { "No text" }, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val notebookNames = noteNotebookIds(note).mapNotNull { id -> controller.notebooks.firstOrNull { it.id == id }?.name }
            if (notebookNames.isNotEmpty()) Text(notebookNames.joinToString(", "), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Updated ${formatListDate(note.updatedAt)}   Created ${formatListDate(note.createdAt)}", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 11.sp, maxLines = 1)
          }
        }
        if (note.trashedAt != null) {
          GlassIcon(Icons.Outlined.RestoreFromTrash, "Restore") { controller.restoreNote(note) }
          GlassIcon(Icons.Outlined.Delete, "Delete permanently") { controller.deleteNotePermanently(note) }
        } else {
          GlassIcon(Icons.AutoMirrored.Outlined.DriveFileMove, "Notebooks") { controller.linkingNoteId = if (controller.linkingNoteId == note.id) null else note.id }
          GlassIcon(Icons.Outlined.Delete, "Move to Trash") { controller.trashNote(note) }
        }
      }
      if (controller.linkingNoteId == note.id && note.trashedAt == null) NotebookPicker(controller, note)
    }
  }
}

@Composable
private fun NotebookPicker(controller: NotesController, note: LocalNote?, selectedMode: Boolean = false) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      PickerRow("Unfiled", active = note?.let { noteNotebookIds(it).isEmpty() } == true || selectedMode && controller.selectedNotes.all { noteNotebookIds(it).isEmpty() }) {
        if (selectedMode) controller.assignNotebookForSelected(null) else note?.let { controller.assignNotebook(it, null) }
      }
      controller.notebooks.forEach { notebook ->
        val active = if (selectedMode) controller.selectedNotes.all { noteNotebookIds(it).contains(notebook.id) } else note?.let { noteNotebookIds(it).contains(notebook.id) } == true
        PickerRow(notebook.name, active) {
          if (selectedMode) controller.assignNotebookForSelected(notebook.id) else note?.let { controller.assignNotebook(it, notebook.id) }
        }
      }
    }
  }
}

@Composable
private fun ProfileOverlay(controller: NotesController) {
  GlassPanel(
    Modifier
      .padding(horizontal = 24.dp)
      .padding(top = 82.dp)
      .fillMaxWidth()
  ) {
    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(32.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(if (controller.hasToken) controller.accountDisplayName.ifBlank { controller.accountUsername } else "Local workspace", fontWeight = FontWeight.Bold)
          if (controller.hasToken) Text(controller.accountUsername, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
          Text(controller.syncLabel, color = statusColor(controller.syncLabel), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
      }
      if (controller.syncDetail.isNotBlank()) Text(controller.syncDetail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      if (controller.hasToken) {
        ActionRow(Icons.Outlined.Refresh, if (controller.isSyncing) "Syncing changes" else "Sync now") { controller.syncNow() }
        ActionRow(Icons.AutoMirrored.Outlined.Logout, "Log out") { controller.logout() }
      } else {
        ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.loginOpen = true; controller.profileOpen = false }
      }
      ActionRow(if (controller.theme == "dark") Icons.Outlined.LightMode else Icons.Outlined.DarkMode, if (controller.theme == "dark") "Light" else "Dark") { controller.toggleTheme() }
      ActionRow(Icons.Outlined.Settings, "Settings") { controller.settingsOpen = true; controller.profileOpen = false }
    }
  }
}

@Composable
private fun SettingsDialog(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  AlertDialog(
    onDismissRequest = { controller.settingsOpen = false },
    containerColor = panelColor(),
    title = {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Settings")
      }
    },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          listOf("account" to "Account", "sync" to "Sync", "data" to "Data", "appearance" to "Appearance").forEach { (id, label) ->
            SmallTextButton(label, active = controller.settingsSection == id) { controller.settingsSection = id }
          }
        }
        when (controller.settingsSection) {
          "account" -> AccountSettings(controller)
          "sync" -> SyncSettings(controller)
          "data" -> DataSettings(controller, onExport, onImport)
          else -> AppearanceSettings(controller)
        }
      }
    },
    confirmButton = {
      TextButton(onClick = { controller.settingsOpen = false }) { Text("Close") }
    }
  )
}

@Composable
private fun AccountSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (controller.hasToken) {
      Text(controller.accountDisplayName.ifBlank { controller.accountUsername }, fontWeight = FontWeight.Bold)
      Text(controller.accountUsername, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      if (controller.accountProfileEditing) {
        MiniField(controller.accountDisplayName, "Nickname", Modifier.fillMaxWidth()) { controller.accountDisplayName = it }
        ActionRow(Icons.Outlined.Check, "Save profile") { controller.saveAccountProfile() }
      } else {
        ActionRow(Icons.Outlined.Edit, "Edit profile") { controller.accountProfileEditing = true }
      }
      if (controller.accountPasswordEditing) {
        PasswordField(controller.currentPasswordValue, "Current") { controller.currentPasswordValue = it }
        PasswordField(controller.newPasswordValue, "New") { controller.newPasswordValue = it }
        PasswordField(controller.confirmPasswordValue, "Confirm") { controller.confirmPasswordValue = it }
        ActionRow(Icons.Outlined.Check, "Change password") { controller.changePassword() }
      } else {
        ActionRow(Icons.Outlined.Settings, "Change password") { controller.accountPasswordEditing = true }
      }
      if (controller.accountDeleteEditing) {
        PasswordField(controller.deletePasswordValue, "Password") { controller.deletePasswordValue = it }
        ActionRow(Icons.Outlined.Delete, "Delete account") { controller.deleteAccount() }
      } else {
        ActionRow(Icons.Outlined.Delete, "Delete account") { controller.accountDeleteEditing = true }
      }
      if (controller.accountError.isNotBlank()) Text(controller.accountError, color = Color(0xFFC9362F), fontSize = 12.sp)
      if (controller.accountMessage.isNotBlank()) Text(controller.accountMessage, color = Color(0xFF1F8F4D), fontSize = 12.sp)
    } else {
      Text("Local workspace", fontWeight = FontWeight.Bold)
      Text("Sync is off for this device", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.loginOpen = true; controller.settingsOpen = false }
    }
  }
}

@Composable
private fun SyncSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    InfoTile("Status", controller.syncLabel, controller.syncDetail)
    InfoTile("Pending local changes", controller.pendingSyncCount.toString(), "${controller.pendingSyncCount} items waiting to sync")
    InfoTile("Last sync pass", controller.lastSyncPassTitle, controller.lastSyncPassDetail)
    if (controller.remoteSyncEnabled || controller.remoteSyncError.isNotBlank()) InfoTile("Remote sync", controller.remoteSyncState, controller.remoteSyncError.ifBlank { "Remote worker status from the last check" })
    MiniField(controller.apiBaseUrl, "Sync server URL", Modifier.fillMaxWidth()) { controller.apiBaseUrl = it }
    ActionRow(Icons.Outlined.Check, "Save sync server") { controller.saveApiBaseUrl() }
    if (controller.hasToken) ActionRow(Icons.Outlined.Refresh, if (controller.isSyncing) "Syncing" else "Sync now") { controller.syncNow() } else ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.loginOpen = true }
  }
}

@Composable
private fun DataSettings(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (controller.importBanner.isNotBlank()) Text(controller.importBanner, color = Color(0xFF1F8F4D), fontSize = 12.sp)
    ActionRow(Icons.Outlined.Download, if (controller.isArchiveBusy) "Working" else "Export MD ZIP") { if (!controller.isArchiveBusy) onExport() }
    ActionRow(Icons.Outlined.Upload, if (controller.isArchiveBusy) "Working" else "Import MD files") { if (!controller.isArchiveBusy) onImport() }
  }
}

@Composable
private fun AppearanceSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    ActionRow(Icons.Outlined.FolderOpen, "Compact notes") { controller.toggleCompactView() }
    ActionRow(if (controller.theme == "dark") Icons.Outlined.LightMode else Icons.Outlined.DarkMode, if (controller.theme == "dark") "Light mode" else "Dark mode") { controller.toggleTheme() }
    Row(verticalAlignment = Alignment.CenterVertically) {
      GlassIcon(Icons.Outlined.ZoomOut, "Zoom out") { controller.zoomEditor(-1) }
      Text("Zoom ${(controller.editorZoom * 100).toInt()}%", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f))
      GlassIcon(Icons.Outlined.ZoomIn, "Zoom in") { controller.zoomEditor(1) }
    }
  }
}

@Composable
private fun LoginDialog(controller: NotesController) {
  AlertDialog(
    onDismissRequest = { if (!controller.isLoggingIn) controller.loginOpen = false },
    containerColor = panelColor(),
    title = { Text(if (controller.authMode == "signup") "Create account" else "Sign in") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          SmallTextButton("Sign in", active = controller.authMode == "signin") { controller.authMode = "signin" }
          SmallTextButton("Sign up", active = controller.authMode == "signup") { controller.authMode = "signup" }
        }
        MiniField(controller.loginUsernameValue, "Username", Modifier.fillMaxWidth()) { controller.loginUsernameValue = it; controller.loginError = "" }
        PasswordField(controller.loginPasswordValue, "Password") { controller.loginPasswordValue = it; controller.loginError = "" }
        if (controller.authMode == "signup") {
          MiniField(controller.signupDisplayNameValue, "Nickname", Modifier.fillMaxWidth()) { controller.signupDisplayNameValue = it }
          PasswordField(controller.signupConfirmPasswordValue, "Confirm password") { controller.signupConfirmPasswordValue = it; controller.loginError = "" }
        }
        if (controller.loginError.isNotBlank()) Text(controller.loginError, color = Color(0xFFC9362F), fontSize = 12.sp)
      }
    },
    confirmButton = {
      Button(onClick = { controller.submitLogin() }, enabled = !controller.isLoggingIn && !controller.isArchiveBusy) {
        Text(if (controller.isLoggingIn) "Working" else if (controller.authMode == "signup") "Create account" else "Sign in")
      }
    },
    dismissButton = { TextButton(onClick = { controller.loginOpen = false }) { Text("Cancel") } }
  )
}

@Composable
private fun ConflictDialog(controller: NotesController, conflict: LocalConflict) {
  val noteConflict = conflict.noteConflict
  val notebookConflict = conflict.notebookConflict
  AlertDialog(
    onDismissRequest = {},
    containerColor = panelColor(),
    title = { Text("Sync conflict") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (conflict.reason == "duplicate_name") "A notebook with this name already exists. Choose one version or duplicate both." else "Choose which version to keep. Both versions are preserved until you decide.")
        val localName = noteConflict?.local?.deviceName ?: notebookConflict?.local?.deviceName ?: "Local"
        val localPreview = noteConflict?.local?.previewText ?: notebookConflict?.local?.previewText ?: ""
        val remoteName = noteConflict?.remote?.deviceName ?: notebookConflict?.remote?.deviceName ?: "Remote"
        val remotePreview = noteConflict?.remote?.previewText ?: notebookConflict?.remote?.previewText ?: ""
        InfoTile(localName, localPreview, "")
        InfoTile(remoteName, remotePreview, "")
      }
    },
    confirmButton = {
      Column {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          SmallTextButton("Keep newer") { controller.resolveConflict("keep-newer") }
          SmallTextButton("Keep older") { controller.resolveConflict("keep-older") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          SmallTextButton("Keep local") { controller.resolveConflict("keep-local") }
          SmallTextButton("Keep remote") { controller.resolveConflict("keep-remote") }
          SmallTextButton("Duplicate both") { controller.resolveConflict("duplicate-both") }
        }
      }
    }
  )
}

@Composable
private fun NotificationStack(controller: NotesController) {
  Column(
    Modifier
      .fillMaxWidth()
      .padding(top = 8.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    controller.notifications.forEach { notification ->
      GlassPanel(Modifier.width(360.dp), compact = true) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(notification.title, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
          GlassIcon(Icons.Outlined.Close, "Dismiss") { controller.dismissNotification(notification.id) }
        }
        if (notification.message.isNotBlank()) Text(notification.message, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, modifier = Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp))
      }
    }
  }
}

@Composable
private fun NavRow(
  icon: ImageVector,
  label: String,
  count: String,
  active: Boolean,
  trailing: @Composable (() -> Unit)? = null,
  onClick: () -> Unit
) {
  GlassPanel(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(12.dp))
      .clickable(onClick = onClick),
    active = active,
    compact = true
  ) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(icon, null, modifier = Modifier.size(16.dp))
      Spacer(Modifier.width(8.dp))
      Text(label, modifier = Modifier.weight(1f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (trailing == null) Text(count, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 11.sp) else Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { trailing() }
    }
  }
}

@Composable
private fun PickerRow(label: String, active: Boolean, onClick: () -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onClick)
      .background(if (active) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent)
      .padding(horizontal = 10.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Text(label, modifier = Modifier.weight(1f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (active) Icon(Icons.Outlined.Check, null, modifier = Modifier.size(14.dp))
  }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onClick)
      .padding(horizontal = 10.dp, vertical = 9.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Icon(icon, null, modifier = Modifier.size(16.dp))
    Spacer(Modifier.width(8.dp))
    Text(label, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

@Composable
private fun InfoTile(label: String, value: String, detail: String) {
  GlassPanel(Modifier.fillMaxWidth(), compact = true) {
    Column(Modifier.padding(10.dp)) {
      Text(label, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 11.sp, fontWeight = FontWeight.Bold)
      Text(value.ifBlank { " " }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (detail.isNotBlank()) Text(detail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
  }
}

@Composable
private fun MiniField(value: String, placeholder: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    modifier = modifier,
    textStyle = TextStyle(fontSize = 13.sp)
  )
}

@Composable
private fun PasswordField(value: String, placeholder: String, onChange: (String) -> Unit) {
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    visualTransformation = PasswordVisualTransformation(),
    modifier = Modifier.fillMaxWidth(),
    textStyle = TextStyle(fontSize = 13.sp)
  )
}

@Composable
private fun SmallTextButton(label: String, active: Boolean = false, onClick: () -> Unit) {
  TextButton(
    onClick = onClick,
    modifier = Modifier
      .clip(RoundedCornerShape(8.dp))
      .background(if (active) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent)
  ) {
    Text(label, fontSize = 12.sp)
  }
}

@Composable
private fun GlassIcon(
  icon: ImageVector,
  label: String,
  active: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit
) {
  IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.background(if (active) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f) else Color.Transparent, RoundedCornerShape(8.dp))) {
    Icon(icon, label, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 0.72f else 0.32f))
  }
}

@Composable
private fun GlassChip(content: @Composable RowScope.() -> Unit) {
  Surface(
    color = fieldColor(),
    shape = RoundedCornerShape(8.dp),
    border = null
  ) {
    Row(Modifier.padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp), content = content)
  }
}

@Composable
private fun GlassPanel(
  modifier: Modifier = Modifier,
  active: Boolean = false,
  compact: Boolean = false,
  content: @Composable () -> Unit
) {
  Surface(
    modifier = modifier,
    color = if (active) activeColor() else panelColor(),
    shape = RoundedCornerShape(if (compact) 10.dp else 18.dp),
    border = null,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    content = content
  )
}

@Composable
private fun fieldColor(): Color =
  if (MaterialTheme.colorScheme.background == Color.White) Color.White.copy(alpha = 0.20f) else Color(0xFF18181C).copy(alpha = 0.22f)

@Composable
private fun panelColor(): Color =
  if (MaterialTheme.colorScheme.background == Color.White) Color.White.copy(alpha = 0.24f) else Color(0xFF121215).copy(alpha = 0.42f)

@Composable
private fun activeColor(): Color =
  MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)

@Composable
private fun statusColor(label: String): Color = when {
  label.contains("conflict", true) || label.contains("failed", true) -> Color(0xFFC9362F)
  label.contains("Local only", true) -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f)
  label.contains("Saving", true) || label.contains("Sync", true) || label.contains("queued", true) -> Color(0xFF2F6F9F)
  else -> Color(0xFF1F8F4D)
}
