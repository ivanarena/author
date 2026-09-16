package com.author.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.core.LocalNote
import com.author.core.formatDateTime
import com.author.ui.common.*
import com.author.ui.state.*
import com.author.ui.theme.*
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

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
  Column {
    Surface(color = toolbarColor()) {
      Row(
        Modifier.fillMaxWidth()
          .heightIn(min = if (compactScreen) 64.dp else 72.dp)
          .padding(horizontal = if (compactScreen) 16.dp else 28.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        GlassIcon(Icons.Outlined.Menu, "Notes") { controller.navigateTo("notes") }
        Spacer(Modifier.weight(1f))
        GlassIcon(
          Icons.AutoMirrored.Outlined.Undo,
          "Undo",
          enabled = controller.undoStack.isNotEmpty(),
        ) {
          controller.undoEditor()
        }
        GlassIcon(
          Icons.AutoMirrored.Outlined.Redo,
          "Redo",
          enabled = controller.redoStack.isNotEmpty(),
        ) {
          controller.redoEditor()
        }
        EditorMoreMenu(controller)
      }
    }
  }
}

@Composable
private fun EditorPane(controller: NotesController, modifier: Modifier = Modifier) {
  val text = MaterialTheme.colorScheme.onSurface
  val muted = text.copy(alpha = 0.52f)
  val compactScreen = isCompactWindow()
  val titleSize =
    (controller.editorTextSize * (if (compactScreen) 2.38f else 3.62f) * controller.editorZoom).sp
  val titleLineHeight =
    (controller.editorTextSize * (if (compactScreen) 2.75f else 3.94f) * controller.editorZoom).sp
  val bodySize = (controller.editorTextSize * controller.editorZoom).sp
  val bodyLineHeight =
    (controller.editorTextSize * controller.editorLineHeight * controller.editorZoom).sp
  val fontFamily = LocalAppFontFamily.current

  Column(
    modifier
      .fillMaxSize()
      .pointerInput(controller.selectedNote?.id) {
        var horizontalDrag = 0f
        val navigationThreshold = 72.dp.toPx()
        detectHorizontalDragGestures(
          onDragStart = { horizontalDrag = 0f },
          onDragCancel = { horizontalDrag = 0f },
          onDragEnd = {
            if (abs(horizontalDrag) >= navigationThreshold) {
              controller.navigateAdjacentNote(forward = horizontalDrag < 0f)
            }
            horizontalDrag = 0f
          },
          onHorizontalDrag = { change, dragAmount ->
            horizontalDrag += dragAmount
            change.consume()
          },
        )
      }
      .testTag("editor-pane")
      .padding(horizontal = if (compactScreen) 56.dp else 84.dp)
      .padding(
        top = if (compactScreen) 44.dp else 72.dp,
        bottom = if (compactScreen) 32.dp else 48.dp,
      ),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Column(Modifier.fillMaxWidth().weight(1f, fill = true)) {
      BasicTextField(
        value = controller.titleValue,
        onValueChange = { controller.updateEditor("title", it) },
        readOnly = controller.selectedNote?.trashedAt != null,
        textStyle =
          TextStyle(
            color = text,
            fontSize = titleSize,
            fontWeight = FontWeight.SemiBold,
            lineHeight = titleLineHeight,
            fontFamily = fontFamily,
          ),
        modifier = Modifier.fillMaxWidth().testTag("note-title-field"),
        decorationBox = { inner ->
          if (controller.titleValue.isBlank()) {
            Text(
              "Title",
              color = muted.copy(alpha = 0.38f),
              fontSize = titleSize,
              fontWeight = FontWeight.SemiBold,
              fontFamily = fontFamily,
            )
          }
          inner()
        },
      )
      Spacer(Modifier.height(if (compactScreen) 28.dp else 48.dp))
      key(controller.selectedNote?.id) {
        var bodyFieldValue by remember { mutableStateOf(TextFieldValue(controller.bodyValue)) }
        var bodyLayoutResult by remember { mutableStateOf<TextLayoutResult?>(null) }
        var bodyViewportHeight by remember { mutableIntStateOf(0) }
        val bodyScrollState = rememberScrollState()

        LaunchedEffect(controller.bodyValue) {
          if (bodyFieldValue.text != controller.bodyValue) {
            val length = controller.bodyValue.length
            bodyFieldValue =
              TextFieldValue(
                text = controller.bodyValue,
                selection =
                  TextRange(
                    bodyFieldValue.selection.start.coerceIn(0, length),
                    bodyFieldValue.selection.end.coerceIn(0, length),
                  ),
              )
          }
        }

        LaunchedEffect(
          bodyFieldValue.text,
          bodyFieldValue.selection,
          bodyLayoutResult,
          bodyViewportHeight,
          bodyScrollState.maxValue,
        ) {
          if (bodyViewportHeight <= 0) return@LaunchedEffect
          val layout = bodyLayoutResult ?: return@LaunchedEffect
          val cursor =
            layout.getCursorRect(
              bodyFieldValue.selection.end.coerceIn(0, bodyFieldValue.text.length)
            )
          val visibleTop = bodyScrollState.value.toFloat()
          val visibleBottom = visibleTop + bodyViewportHeight
          val target =
            when {
              cursor.bottom > visibleBottom -> ceil(cursor.bottom - bodyViewportHeight).toInt()
              cursor.top < visibleTop -> floor(cursor.top).toInt()
              else -> null
            }
          if (target != null) {
            bodyScrollState.scrollTo(target.coerceIn(0, bodyScrollState.maxValue))
          }
        }

        BasicTextField(
          value = bodyFieldValue,
          onValueChange = {
            bodyFieldValue = it
            controller.updateEditor("body", it.text)
          },
          readOnly = controller.selectedNote?.trashedAt != null,
          textStyle =
            TextStyle(
              color = text,
              fontSize = bodySize,
              fontWeight = FontWeight.Normal,
              lineHeight = bodyLineHeight,
              fontFamily = fontFamily,
            ),
          onTextLayout = { bodyLayoutResult = it },
          modifier =
            Modifier.fillMaxWidth()
              .weight(1f)
              .onSizeChanged { bodyViewportHeight = it.height }
              .verticalScroll(bodyScrollState)
              .testTag("note-body-field"),
          decorationBox = { inner ->
            if (bodyFieldValue.text.isBlank()) {
              Text(
                "Body",
                color = muted.copy(alpha = 0.38f),
                fontSize = bodySize,
                fontWeight = FontWeight.Normal,
                fontFamily = fontFamily,
              )
            }
            inner()
          },
        )
      }
    }
    Spacer(Modifier.height(if (compactScreen) 24.dp else 32.dp))
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
      if (note?.trashedAt != null) {
        AppDropdownMenuItem(
          label = "Restore",
          leadingIcon = {
            Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
          },
          onClick = {
            open = false
            controller.restoreNote(note)
          },
        )
        AppDropdownMenuItem(
          label = "Delete permanently",
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.deleteNotePermanently(note)
          },
        )
      } else if (note != null) {
        AppDropdownMenuItem(
          label = if (note.isFavorite) "Remove from Favorites" else "Add to Favorites",
          leadingIcon = {
            Icon(
              if (note.isFavorite) Icons.Outlined.Star else Icons.Outlined.StarBorder,
              null,
              modifier = Modifier.size(18.dp),
            )
          },
          onClick = {
            open = false
            controller.toggleFavorite(note)
          },
        )
        HorizontalDivider()
        DropdownSectionLabel("Notebooks")
        NotebookAssignmentMenuItems(controller, note = note, selectedMode = false) { open = false }
        HorizontalDivider()
        AppDropdownMenuItem(
          label = "Move to Trash",
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.trashNote(note)
          },
        )
      }
      if (note != null) HorizontalDivider()
      AppDropdownMenuItem(
        label = "Metadata",
        leadingIcon = { Icon(Icons.Outlined.Info, null, modifier = Modifier.size(18.dp)) },
        enabled = note != null,
        onClick = {
          open = false
          metadataOpen = true
        },
      )
      AppDropdownMenuItem(
        label = "Account",
        leadingIcon = { Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.navigateTo("account")
        },
      )
      AppDropdownMenuItem(
        label = "Settings",
        leadingIcon = { Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.navigateTo("settings")
        },
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
  onDismiss: () -> Unit,
) {
  AppModal(onDismissRequest = onDismiss) {
    AppModalTitle("Metadata", onDismiss = onDismiss)
    val status = syncStatusLabel(note.syncStatus)
    InfoTile("Status", status, "", valueColor = syncStatusColor(status))
    InfoTile("Last synced", lastSyncedLabel(controller, note), "")
    InfoTile("Updated", formatDateTime(note.updatedAt), "")
    InfoTile("Created", formatDateTime(note.createdAt), "")
    ModalActionButton("Done", primary = true, onClick = onDismiss)
  }
}

private fun lastSyncedLabel(controller: NotesController, note: LocalNote): String =
  note.lastSyncedAt?.let { "${formatDateTime(it)} by ${controller.deviceName(note.deviceId)}" }
    ?: "Not synced yet"

@Composable
private fun EditorStatusBar(controller: NotesController, muted: Color) {
  val status =
    compactEditorSyncStatus(
      noteStatus = controller.selectedNote?.syncStatus,
      hasToken = controller.hasToken,
      isSyncing = controller.isSyncing,
      pendingSyncCount = controller.pendingSyncCount,
      conflictCount = controller.conflicts.size,
      remoteSyncEnabled = controller.remoteSyncEnabled,
      remoteSyncState = controller.remoteSyncState,
    )
  val dotColor =
    when (status.tone) {
      EditorSyncTone.Success -> syncStatusColor("Synced")
      EditorSyncTone.Neutral -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f)
      EditorSyncTone.Error -> MaterialTheme.colorScheme.error
    }
  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(7.dp),
  ) {
    Box(Modifier.size(6.dp).background(dotColor, RectangleShape))
    Text(status.label, color = muted, fontSize = AppTextSize.Label, maxLines = 1)
  }
}

private fun syncStatusLabel(status: String): String =
  status.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
