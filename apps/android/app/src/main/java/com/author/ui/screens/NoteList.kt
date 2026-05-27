package com.author.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.author.core.LocalNote
import com.author.core.formatListDate
import com.author.core.noteDisplayTitle
import com.author.core.noteNotebookIds
import com.author.core.notePreview
import com.author.core.relativeAge
import com.author.ui.common.*
import com.author.ui.state.*
import com.author.ui.theme.*

@Composable
internal fun NoteListPanel(controller: NotesController, modifier: Modifier = Modifier) {
  Column(
    modifier.padding(horizontal = pageHorizontalPadding(), vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    AnimatedVisibility(
      visible = controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty(),
      enter = fadeIn(appTween(AppMotion.Medium)) + expandVertically(appTween(AppMotion.Slow)),
      exit = fadeOut(appTween(AppMotion.Fast)) + shrinkVertically(appTween(AppMotion.Medium)),
    ) {
      Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          if (controller.selectedNoteIds.isEmpty()) "Select notes"
          else "${controller.selectedNoteIds.size} selected",
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
          fontSize = AppTextSize.Label,
          fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.weight(1f))
        Checkbox(
          checked =
            controller.visibleNotes.isNotEmpty() &&
              controller.visibleNotes.all { controller.selectedNoteIds.contains(it.id) },
          onCheckedChange = { controller.toggleAllVisible(it) },
          enabled = controller.visibleNotes.isNotEmpty(),
          colors = appCheckboxColors(),
        )
        GlassIcon(Icons.Outlined.Close, "Clear selection") { controller.clearSelection() }
      }
    }
    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      controller.visibleGroups.forEach { (label, groupNotes) ->
        if (label.isNotBlank()) {
          item {
            Text(
              label,
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
              fontSize = AppTextSize.Label,
              fontWeight = FontWeight.SemiBold,
              modifier = Modifier.padding(top = 10.dp, start = 8.dp),
            )
          }
        }
        items(groupNotes, key = { it.id }) { note -> NoteRow(controller, note) }
      }
      if (controller.visibleNotes.isEmpty()) {
        item {
          Text(
            if (controller.searchValue.isBlank()) "No notes" else "No matching notes",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
            modifier = Modifier.padding(14.dp),
          )
        }
      }
    }
  }
}

@Composable
internal fun SearchNotesField(controller: NotesController, modifier: Modifier = Modifier) {
  val textColor = MaterialTheme.colorScheme.onSurface
  Surface(
    modifier = modifier.animateContentSize(appTween(AppMotion.Medium)),
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.055f),
    shape = RoundedCornerShape(18.dp),
  ) {
    Row(
      Modifier.heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(
        Icons.Outlined.Search,
        null,
        tint = textColor.copy(alpha = 0.52f),
        modifier = Modifier.size(18.dp),
      )
      BasicTextField(
        value = controller.searchValue,
        onValueChange = { controller.searchValue = it },
        singleLine = true,
        cursorBrush = SolidColor(textColor),
        textStyle =
          TextStyle(
            color = textColor,
            fontSize = AppTextSize.Body,
            fontFamily = LocalAppFontFamily.current,
          ),
        modifier = Modifier.weight(1f),
        decorationBox = { inner ->
          Box {
            if (controller.searchValue.isBlank()) {
              Text(
                "Search notes",
                color = textColor.copy(alpha = 0.42f),
                fontSize = AppTextSize.Body,
              )
            }
            inner()
          }
        },
      )
      AnimatedVisibility(
        visible = controller.searchValue.isNotBlank(),
        enter = fadeIn(appTween(AppMotion.Fast)),
        exit = fadeOut(appTween(AppMotion.Fast)),
      ) {
        Box(
          modifier =
            Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).clickable {
              controller.searchValue = ""
            },
          contentAlignment = Alignment.Center,
        ) {
          Icon(
            Icons.Outlined.Close,
            "Clear search",
            modifier = Modifier.size(18.dp),
            tint = textColor.copy(alpha = 0.62f),
          )
        }
      }
    }
  }
}

@Composable
internal fun SortMenu(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  Box {
    GlassIcon(
      Icons.AutoMirrored.Outlined.Sort,
      "Sort notes",
      active = controller.noteSort != "date-desc" || controller.noteGroup != "smart",
    ) {
      open = true
    }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownSectionLabel("Sort notes")
      SortMenuItem("date-desc", "Newest first", controller) { open = false }
      SortMenuItem("az", "A-Z", controller) { open = false }
      SortMenuItem("za", "Z-A", controller) { open = false }
      HorizontalDivider()
      DropdownSectionLabel("Group notes")
      GroupMenuItem("smart", "Recent ranges", controller) { open = false }
      GroupMenuItem("month", "Month", controller) { open = false }
      GroupMenuItem("year", "Year", controller) { open = false }
      GroupMenuItem("none", "None", controller) { open = false }
    }
  }
}

@Composable
private fun SortMenuItem(
  sort: String,
  label: String,
  controller: NotesController,
  onPicked: () -> Unit,
) {
  AppDropdownMenuItem(
    label = label,
    leadingIcon = { MenuCheck(controller.noteSort == sort) },
    onClick = {
      controller.setSort(sort)
      onPicked()
    },
  )
}

@Composable
private fun GroupMenuItem(
  group: String,
  label: String,
  controller: NotesController,
  onPicked: () -> Unit,
) {
  AppDropdownMenuItem(
    label = label,
    leadingIcon = { MenuCheck(controller.noteGroup == group) },
    onClick = {
      controller.setGroup(group)
      onPicked()
    },
  )
}

@Composable
private fun BulkActionsMenuContent(controller: NotesController, onDismiss: () -> Unit) {
  val hasActiveNotes = controller.selectedNotes.any { it.trashedAt == null }
  val hasTrashedNotes = controller.selectedNotes.any { it.trashedAt != null }

  if (hasActiveNotes) {
    DropdownSectionLabel("Move selected")
    NotebookAssignmentMenuItems(controller, note = null, selectedMode = true) { onDismiss() }
    HorizontalDivider()
    AppDropdownMenuItem(
      label = "Move selected to Trash",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.trashSelected()
      },
    )
  }
  if (hasTrashedNotes) {
    if (hasActiveNotes) HorizontalDivider()
    AppDropdownMenuItem(
      label = "Restore selected",
      leadingIcon = {
        Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
      },
      onClick = {
        onDismiss()
        controller.restoreSelected()
      },
    )
    AppDropdownMenuItem(
      label = "Delete selected permanently",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.deleteSelectedPermanently()
      },
    )
  }
  HorizontalDivider()
  AppDropdownMenuItem(
    label = "Clear selection",
    leadingIcon = { Icon(Icons.Outlined.Close, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.clearSelection()
    },
  )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NoteRow(controller: NotesController, note: LocalNote) {
  val active = controller.selectedNote?.id == note.id
  val selected = controller.selectedNoteIds.contains(note.id)
  val selecting = controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty()
  var menuOpen by remember(note.id) { mutableStateOf(false) }
  var menuMode by remember(note.id) { mutableStateOf("note") }
  val titleColor =
    if (active || selected) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.onSurface

  Box {
    Surface(
      modifier =
        Modifier.fillMaxWidth()
          .clip(RoundedCornerShape(8.dp))
          .animateContentSize(appTween(AppMotion.Medium))
          .combinedClickable(
            onClick = {
              if (selecting) {
                controller.toggleSelection(note, !selected)
              } else {
                controller.selectNote(note)
              }
            },
            onLongClick = {
              val wasSelecting =
                controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty()
              val hasSelection = controller.selectedNoteIds.isNotEmpty()
              controller.enterNoteSelectionMode()
              if (wasSelecting) {
                menuMode = if (hasSelection) "bulk" else "note"
                menuOpen = true
              }
            },
          ),
      color = Color.Transparent,
      shape = RoundedCornerShape(8.dp),
    ) {
      Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (selecting) {
          Checkbox(
            checked = selected,
            onCheckedChange = { controller.toggleSelection(note, it) },
            colors = appCheckboxColors(),
          )
        }
        Column(
          Modifier.weight(1f).padding(horizontal = if (selecting) 8.dp else 4.dp),
          verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
              noteDisplayTitle(note),
              color = titleColor,
              fontWeight = FontWeight.SemiBold,
              fontSize = AppTextSize.Body,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f),
            )
            if (controller.compactView) {
              Text(
                relativeAge(note.updatedAt),
                fontSize = AppTextSize.Label,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
              )
            }
          }
          if (!controller.compactView) {
            Text(
              notePreview(note).ifBlank { "No text" },
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
              fontSize = AppTextSize.Label,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
            val notebookNames =
              noteNotebookIds(note).mapNotNull { id ->
                controller.notebooks.firstOrNull { it.id == id }?.name
              }
            if (notebookNames.isNotEmpty()) {
              Row(
                modifier = Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
              ) {
                Icon(
                  Icons.Outlined.Book,
                  null,
                  modifier = Modifier.size(13.dp),
                  tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.58f),
                )
                Text(
                  notebookNames.joinToString(", "),
                  fontSize = AppTextSize.Label,
                  fontWeight = FontWeight.SemiBold,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
            }
            Text(
              "Updated ${formatListDate(note.updatedAt)}   Created ${formatListDate(note.createdAt)}",
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
              fontSize = AppTextSize.Label,
              maxLines = 1,
            )
          }
        }
      }
    }
    AppDropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
      if (menuMode == "bulk") {
        BulkActionsMenuContent(controller) { menuOpen = false }
      } else {
        NoteActionsMenuContent(controller, note) { menuOpen = false }
      }
    }
  }
}

@Composable
private fun NoteActionsMenuContent(
  controller: NotesController,
  note: LocalNote,
  onDismiss: () -> Unit,
) {
  AppDropdownMenuItem(
    label = "Select",
    leadingIcon = { Icon(Icons.Outlined.Check, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.toggleSelection(note, true)
    },
  )
  HorizontalDivider()
  if (note.trashedAt != null) {
    AppDropdownMenuItem(
      label = "Restore",
      leadingIcon = {
        Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
      },
      onClick = {
        onDismiss()
        controller.restoreNote(note)
      },
    )
    AppDropdownMenuItem(
      label = "Delete permanently",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.deleteNotePermanently(note)
      },
    )
  } else {
    DropdownSectionLabel("Notebooks")
    NotebookAssignmentMenuItems(controller, note = note, selectedMode = false) { onDismiss() }
    HorizontalDivider()
    AppDropdownMenuItem(
      label = "Move to Trash",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.trashNote(note)
      },
    )
  }
}

@Composable
internal fun NotebookAssignmentMenuItems(
  controller: NotesController,
  note: LocalNote?,
  selectedMode: Boolean,
  onPicked: () -> Unit,
) {
  val activeSelectedNotes =
    if (selectedMode) controller.selectedNotes.filter { it.trashedAt == null } else emptyList()
  val unfiledActive =
    if (selectedMode) {
      activeSelectedNotes.isNotEmpty() && activeSelectedNotes.all { noteNotebookIds(it).isEmpty() }
    } else {
      note?.let { noteNotebookIds(it).isEmpty() } == true
    }

  AppDropdownMenuItem(
    label = "Unfiled",
    leadingIcon = { MenuCheck(unfiledActive) },
    onClick = {
      onPicked()
      if (selectedMode) controller.assignNotebookForSelected(null)
      else note?.let { controller.assignNotebook(it, null) }
    },
  )
  controller.notebooks.forEach { notebook ->
    val active =
      if (selectedMode) {
        activeSelectedNotes.isNotEmpty() &&
          activeSelectedNotes.all { noteNotebookIds(it).contains(notebook.id) }
      } else {
        note?.let { noteNotebookIds(it).contains(notebook.id) } == true
      }
    AppDropdownMenuItem(
      label = notebook.name,
      leadingIcon = { MenuCheck(active) },
      onClick = {
        onPicked()
        if (selectedMode) controller.assignNotebookForSelected(notebook.id)
        else note?.let { controller.assignNotebook(it, notebook.id) }
      },
    )
  }
}
