package com.author.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.unit.sp
import com.author.core.LocalNote
import com.author.core.formatListDate
import com.author.core.noteDisplayTitle
import com.author.core.noteNotebookIds
import com.author.core.notePreview
import com.author.core.relativeAge

@Composable
internal fun NoteListPanel(controller: NotesController, modifier: Modifier = Modifier) {
  Column(
    modifier.padding(horizontal = pageHorizontalPadding(), vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Row(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      SearchNotesField(controller, Modifier.weight(1f))
      SortMenu(controller)
    }
    AnimatedVisibility(
      visible = controller.selectedNoteIds.isNotEmpty(),
      enter = fadeIn(tween(AppMotion.Medium)) + expandVertically(tween(AppMotion.Slow)),
      exit = fadeOut(tween(AppMotion.Fast)) + shrinkVertically(tween(AppMotion.Medium)),
    ) {
      Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          "${controller.selectedNoteIds.size} selected",
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
          fontSize = 12.sp,
          fontWeight = FontWeight.SemiBold,
        )
        BulkActionsMenu(controller)
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
        item {
          Text(
            label,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 10.dp, start = 8.dp),
          )
        }
        items(groupNotes, key = { it.id }) { note -> NoteRow(controller, note) }
      }
      if (controller.isWorkspaceLoading) {
        item {
          Text(
            "Loading local notes",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            modifier = Modifier.padding(14.dp),
          )
        }
      } else if (controller.visibleNotes.isEmpty()) {
        item {
          Text(
            if (controller.searchValue.isBlank()) "No notes" else "No matching notes",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            modifier = Modifier.padding(14.dp),
          )
        }
      }
    }
  }
}

@Composable
private fun SearchNotesField(controller: NotesController, modifier: Modifier = Modifier) {
  val textColor = MaterialTheme.colorScheme.onSurface
  Surface(
    modifier = modifier.animateContentSize(tween(AppMotion.Medium)),
    color = Color.Transparent,
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
          TextStyle(color = textColor, fontSize = 14.sp, fontFamily = LocalAppFontFamily.current),
        modifier = Modifier.weight(1f),
        decorationBox = { inner ->
          Box {
            if (controller.searchValue.isBlank()) {
              Text("Search notes", color = textColor.copy(alpha = 0.42f), fontSize = 14.sp)
            }
            inner()
          }
        },
      )
      AnimatedVisibility(
        visible = controller.searchValue.isNotBlank(),
        enter = fadeIn(tween(AppMotion.Fast)),
        exit = fadeOut(tween(AppMotion.Fast)),
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
private fun SortMenu(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  Box {
    GlassIcon(
      Icons.AutoMirrored.Outlined.Sort,
      "Sort notes",
      active = controller.noteSort != "date-desc",
    ) {
      open = true
    }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      SortMenuItem("date-desc", "Newest first", controller) { open = false }
      SortMenuItem("az", "A-Z", controller) { open = false }
      SortMenuItem("za", "Z-A", controller) { open = false }
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
  DropdownMenuItem(
    text = { Text(label) },
    leadingIcon = { MenuCheck(controller.noteSort == sort) },
    onClick = {
      controller.setSort(sort)
      onPicked()
    },
  )
}

@Composable
private fun BulkActionsMenu(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  val hasActiveNotes = controller.selectedNotes.any { it.trashedAt == null }
  val hasTrashedNotes = controller.selectedNotes.any { it.trashedAt != null }

  Box {
    GlassIcon(Icons.Outlined.MoreVert, "Selection actions") { open = true }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      if (hasActiveNotes) {
        DropdownSectionLabel("Move selected")
        NotebookAssignmentMenuItems(controller, note = null, selectedMode = true) { open = false }
        HorizontalDivider()
        DropdownMenuItem(
          text = { Text("Move selected to Trash") },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.trashSelected()
          },
        )
      }
      if (hasTrashedNotes) {
        if (hasActiveNotes) HorizontalDivider()
        DropdownMenuItem(
          text = { Text("Restore selected") },
          leadingIcon = {
            Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
          },
          onClick = {
            open = false
            controller.restoreSelected()
          },
        )
        DropdownMenuItem(
          text = { Text("Delete selected permanently") },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.deleteSelectedPermanently()
          },
        )
      }
      HorizontalDivider()
      DropdownMenuItem(
        text = { Text("Clear selection") },
        leadingIcon = { Icon(Icons.Outlined.Close, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.clearSelection()
        },
      )
    }
  }
}

@Composable
private fun NoteRow(controller: NotesController, note: LocalNote) {
  val active = controller.selectedNote?.id == note.id
  val selected = controller.selectedNoteIds.contains(note.id)
  val selecting = controller.selectedNoteIds.isNotEmpty()
  val titleColor =
    if (active || selected) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.onSurface

  Surface(
    modifier =
      Modifier.fillMaxWidth()
        .clip(RoundedCornerShape(8.dp))
        .animateContentSize(tween(AppMotion.Medium))
        .clickable {
          if (selecting) {
            controller.toggleSelection(note, !selected)
          } else {
            controller.selectNote(note)
          }
        },
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
      Column(Modifier.weight(1f).padding(horizontal = if (selecting) 8.dp else 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            noteDisplayTitle(note),
            color = titleColor,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
          )
          if (controller.compactView) {
            Text(
              relativeAge(note.updatedAt),
              fontSize = 12.sp,
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            )
          }
        }
        if (!controller.compactView) {
          Text(
            notePreview(note).ifBlank { "No text" },
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          val notebookNames =
            noteNotebookIds(note).mapNotNull { id ->
              controller.notebooks.firstOrNull { it.id == id }?.name
            }
          if (notebookNames.isNotEmpty()) {
            Text(
              notebookNames.joinToString(", "),
              fontSize = 12.sp,
              fontWeight = FontWeight.SemiBold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          Text(
            "Updated ${formatListDate(note.updatedAt)}   Created ${formatListDate(note.createdAt)}",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            maxLines = 1,
          )
        }
      }
      if (!selecting) NoteActionsMenu(controller, note)
    }
  }
}

@Composable
private fun NoteActionsMenu(controller: NotesController, note: LocalNote) {
  var open by remember(note.id) { mutableStateOf(false) }
  Box {
    GlassIcon(Icons.Outlined.MoreVert, "Note actions") { open = true }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(
        text = { Text("Select") },
        leadingIcon = { Icon(Icons.Outlined.Check, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.toggleSelection(note, true)
        },
      )
      HorizontalDivider()
      if (note.trashedAt != null) {
        DropdownMenuItem(
          text = { Text("Restore") },
          leadingIcon = {
            Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
          },
          onClick = {
            open = false
            controller.restoreNote(note)
          },
        )
        DropdownMenuItem(
          text = { Text("Delete permanently") },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
          onClick = {
            open = false
            controller.deleteNotePermanently(note)
          },
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
          },
        )
      }
    }
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

  DropdownMenuItem(
    text = { Text("Unfiled") },
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
    DropdownMenuItem(
      text = { Text(notebook.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
      leadingIcon = { MenuCheck(active) },
      onClick = {
        onPicked()
        if (selectedMode) controller.assignNotebookForSelected(notebook.id)
        else note?.let { controller.assignNotebook(it, notebook.id) }
      },
    )
  }
}
