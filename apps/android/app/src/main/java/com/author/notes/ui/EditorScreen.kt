package com.author.notes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.notes.core.LocalNote
import com.author.notes.core.formatDateTime

@Composable
internal fun EditorPage(controller: NotesController) {
  Column(Modifier.fillMaxSize()) {
    EditorTopBar(controller)
    EditorPane(controller, Modifier.weight(1f))
  }
}

@Composable
private fun EditorTopBar(controller: NotesController) {
  val compactScreen = isCompactWindow()
  Surface(color = toolbarColor()) {
    Row(
      Modifier
        .fillMaxWidth()
        .heightIn(min = if (compactScreen) 64.dp else 72.dp)
        .padding(horizontal = if (compactScreen) 16.dp else 28.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      GlassIcon(Icons.Outlined.Menu, "Notes") { controller.navigateTo("notes") }
      Spacer(Modifier.weight(1f))
      GlassIcon(Icons.AutoMirrored.Outlined.Undo, "Undo", enabled = controller.undoStack.isNotEmpty()) { controller.undoEditor() }
      GlassIcon(Icons.AutoMirrored.Outlined.Redo, "Redo", enabled = controller.redoStack.isNotEmpty()) { controller.redoEditor() }
      EditorMoreMenu(controller)
    }
  }
}

@Composable
private fun EditorPane(controller: NotesController, modifier: Modifier = Modifier) {
  val text = MaterialTheme.colorScheme.onSurface
  val muted = text.copy(alpha = 0.52f)
  val compactScreen = isCompactWindow()
  val titleSize = (controller.editorTextSize * (if (compactScreen) 2.38f else 3.62f) * controller.editorZoom).sp
  val titleLineHeight = (controller.editorTextSize * (if (compactScreen) 2.75f else 3.94f) * controller.editorZoom).sp
  val bodySize = (controller.editorTextSize * controller.editorZoom).sp
  val bodyLineHeight = (controller.editorTextSize * controller.editorLineHeight * controller.editorZoom).sp
  val fontFamily = LocalAppFontFamily.current

  Column(
    modifier
      .fillMaxSize()
      .padding(horizontal = if (compactScreen) 20.dp else 32.dp)
      .padding(top = if (compactScreen) 24.dp else 48.dp, bottom = if (compactScreen) 8.dp else 16.dp),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Column(Modifier.fillMaxWidth().weight(1f, fill = true)) {
      BasicTextField(
        value = controller.titleValue,
        onValueChange = { controller.updateEditor("title", it) },
        readOnly = controller.selectedNote?.trashedAt != null,
        textStyle = TextStyle(
          color = text,
          fontSize = titleSize,
          fontWeight = FontWeight.Bold,
          lineHeight = titleLineHeight,
          fontFamily = fontFamily
        ),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
          if (controller.titleValue.isBlank()) {
            Text(
              "Title",
              color = muted.copy(alpha = 0.38f),
              fontSize = titleSize,
              fontWeight = FontWeight.Bold,
              fontFamily = fontFamily
            )
          }
          inner()
        }
      )
      Spacer(Modifier.height(if (compactScreen) 28.dp else 48.dp))
      BasicTextField(
        value = controller.bodyValue,
        onValueChange = { controller.updateEditor("body", it) },
        readOnly = controller.selectedNote?.trashedAt != null,
        textStyle = TextStyle(
          color = text,
          fontSize = bodySize,
          lineHeight = bodyLineHeight,
          fontFamily = fontFamily
        ),
        modifier = Modifier
          .fillMaxWidth()
          .weight(1f)
          .verticalScroll(rememberScrollState()),
        decorationBox = { inner ->
          if (controller.bodyValue.isBlank()) {
            Text(
              "Body",
              color = muted.copy(alpha = 0.38f),
              fontSize = bodySize,
              fontFamily = fontFamily
            )
          }
          inner()
        }
      )
    }
    EditorStatusBar(controller, muted)
  }
}

@Composable
private fun EditorMoreMenu(controller: NotesController) {
  val note = controller.selectedNote
  var open by remember(note?.id) { mutableStateOf(false) }
  var metadataOpen by remember(note?.id) { mutableStateOf(false) }

  Box {
    GlassIcon(Icons.Outlined.MoreVert, "Note actions") { open = true }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      if (note == null) {
        DropdownMenuItem(
          text = { Text("Open notes") },
          leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.navigateTo("notes")
          }
        )
      } else if (note.trashedAt != null) {
        DropdownMenuItem(
          text = { Text("Restore") },
          leadingIcon = { Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.restoreNote(note)
          }
        )
        DropdownMenuItem(
          text = { Text("Delete permanently") },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.deleteNotePermanently(note)
          }
        )
      } else {
        DropdownSectionLabel("Notebooks")
        NotebookAssignmentMenuItems(controller, note = note, selectedMode = false) { open = false }
        HorizontalDivider()
        DropdownMenuItem(
          text = { Text("Move to Trash") },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.trashNote(note)
          }
        )
      }
      HorizontalDivider()
      DropdownMenuItem(
        text = { Text("Metadata") },
        leadingIcon = { Icon(Icons.Outlined.Info, null, modifier = Modifier.size(18.dp)) },
        enabled = note != null,
        onClick = {
          open = false
          metadataOpen = true
        }
      )
      DropdownMenuItem(
        text = { Text("Account") },
        leadingIcon = { Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.navigateTo("account")
        }
      )
      DropdownMenuItem(
        text = { Text("Settings") },
        leadingIcon = { Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.navigateTo("settings")
        }
      )
    }
  }

  if (metadataOpen && note != null) {
    NoteMetadataDialog(controller, note) { metadataOpen = false }
  }
}

@Composable
private fun NoteMetadataDialog(
  controller: NotesController,
  note: LocalNote,
  onDismiss: () -> Unit
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = MaterialTheme.colorScheme.background,
    title = { Text("Metadata") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        InfoTile("Status", syncStatusLabel(note.syncStatus), "")
        InfoTile("Last synced", lastSyncedLabel(controller, note), "")
        InfoTile("Updated", formatDateTime(note.updatedAt), "")
        InfoTile("Created", formatDateTime(note.createdAt), "")
      }
    },
    confirmButton = {
      TextButton(onClick = onDismiss) { Text("Done") }
    }
  )
}

private fun lastSyncedLabel(controller: NotesController, note: LocalNote): String = note.lastSyncedAt?.let { "${formatDateTime(it)} by ${controller.deviceName(note.deviceId)}" } ?: "Not synced yet"

@Composable
private fun EditorStatusBar(controller: NotesController, muted: Color) {
  val note = controller.selectedNote
  val status = note?.let { syncStatusLabel(it.syncStatus) } ?: "Unsaved draft"
  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    Text(status, color = muted, fontSize = 12.sp, maxLines = 1)
    Text("/", color = muted, fontSize = 12.sp, maxLines = 1)
    SyncActivityIndicator(controller.isSyncing)
    Text(controller.syncLabel, color = statusColor(controller.syncLabel), fontSize = 12.sp, maxLines = 1)
  }
}

private fun syncStatusLabel(status: String): String = status.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
