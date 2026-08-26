package com.author.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.author.core.LocalNote
import com.author.core.LocalNotebook
import com.author.core.NOTE_FILTER_FAVORITES_ID
import com.author.core.noteNotebookIds
import com.author.ui.common.*
import com.author.ui.state.*
import com.author.ui.theme.*

@Composable
internal fun NotebookSidebar(
  controller: NotesController,
  modifier: Modifier = Modifier,
  onFilterPicked: () -> Unit = {},
) {
  val membershipNotes = selectedNotebookMembershipNotes(controller)
  Column(
    modifier.padding(horizontal = pageHorizontalPadding(), vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      item {
        NavRow(
          Icons.AutoMirrored.Outlined.Article,
          "All notes",
          notebookCountLabel(controller.notes.size),
          controller.filterId == "all",
        ) {
          controller.filterId = "all"
          onFilterPicked()
        }
      }
      item {
        NavRow(
          Icons.Outlined.StarBorder,
          "Favorites",
          notebookCountLabel(controller.favoriteCount),
          controller.filterId == NOTE_FILTER_FAVORITES_ID,
          trailing =
            selectedMembershipTrailing(
              marked = membershipNotes.isNotEmpty() && membershipNotes.all { it.isFavorite },
              contentDescription =
                if (membershipNotes.size == 1) "Selected note is in Favorites"
                else "Selected notes are in Favorites",
            ),
        ) {
          controller.filterId = NOTE_FILTER_FAVORITES_ID
          onFilterPicked()
        }
      }
      item {
        NavRow(
          Icons.Outlined.BookmarkBorder,
          "Unfiled",
          notebookCountLabel(controller.unfiledCount),
          controller.filterId == "unfiled",
          trailing =
            selectedMembershipTrailing(
              marked =
                membershipNotes.isNotEmpty() &&
                  membershipNotes.all { noteNotebookIds(it).isEmpty() },
              contentDescription =
                if (membershipNotes.size == 1) "Selected note is unfiled"
                else "Selected notes are unfiled",
            ),
        ) {
          controller.filterId = "unfiled"
          onFilterPicked()
        }
      }
      if (controller.notebooks.isNotEmpty()) {
        item { NotebookGroupSeparator() }
      }
      items(controller.notebooks, key = { it.id }) { notebook ->
        NotebookRow(
          controller,
          notebook,
          membershipMarked =
            membershipNotes.isNotEmpty() &&
              membershipNotes.all { noteNotebookIds(it).contains(notebook.id) },
          membershipContentDescription =
            if (membershipNotes.size == 1) "Selected note is in ${notebook.name}"
            else "Selected notes are in ${notebook.name}",
          onPicked = onFilterPicked,
        )
      }
      item { NotebookGroupSeparator() }
      item {
        NavRow(
          Icons.Outlined.Delete,
          "Trash",
          notebookCountLabel(controller.trash.size),
          controller.filterId == "trash",
        ) {
          controller.filterId = "trash"
          onFilterPicked()
        }
      }
    }
  }
}

private fun notebookCountLabel(count: Int): String = count.toString()

private fun selectedNotebookMembershipNotes(controller: NotesController): List<LocalNote> {
  val notes =
    if (controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty()) {
      controller.selectedNotes
    } else {
      listOfNotNull(controller.selectedNote)
    }
  return notes.filter { it.trashedAt == null }
}

private fun selectedMembershipTrailing(
  marked: Boolean,
  contentDescription: String,
): (@Composable () -> Unit)? =
  if (!marked) null
  else {
    {
      Icon(
        Icons.Outlined.Check,
        contentDescription,
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
    }
  }

@Composable
internal fun NewNotebookDialog(controller: NotesController) {
  AppModal(onDismissRequest = { controller.dismissNewNotebook() }) {
    AppModalTitle("New notebook", onDismiss = { controller.dismissNewNotebook() })
    MiniField(controller.notebookNameValue, "Notebook name", Modifier.fillMaxWidth()) {
      controller.notebookNameValue = it
      controller.notebookError = ""
    }
    if (controller.notebookError.isNotBlank()) {
      Text(
        controller.notebookError,
        color = MaterialTheme.colorScheme.error,
        fontSize = AppTextSize.Label,
      )
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ModalActionButton(
        "Cancel",
        modifier = Modifier.weight(1f),
        onClick = { controller.dismissNewNotebook() },
      )
      ModalActionButton(
        "Create",
        modifier = Modifier.weight(1f),
        primary = true,
        onClick = { controller.createNotebook() },
      )
    }
  }
}

@Composable
private fun NotebookGroupSeparator() {
  Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) { AppHorizontalDivider() }
}

@Composable
private fun NotebookRow(
  controller: NotesController,
  notebook: LocalNotebook,
  membershipMarked: Boolean,
  membershipContentDescription: String,
  onPicked: () -> Unit = {},
) {
  if (controller.renamingNotebookId == notebook.id) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      MiniField(controller.renameNotebookValue, "Notebook", Modifier.weight(1f)) {
        controller.renameNotebookValue = it
      }
      GlassIcon(Icons.Outlined.Check, "Save") { controller.submitRename(notebook) }
      GlassIcon(Icons.Outlined.Close, "Cancel") { controller.renamingNotebookId = null }
    }
  } else {
    var open by remember(notebook.id) { mutableStateOf(false) }
    Box {
      NavRow(
        icon = Icons.Outlined.Book,
        label = notebook.name,
        count = (controller.notebookCounts[notebook.id] ?: 0).toString(),
        active = controller.filterId == notebook.id,
        trailing = selectedMembershipTrailing(membershipMarked, membershipContentDescription),
        onLongClick = { open = true },
      ) {
        controller.filterId = notebook.id
        onPicked()
      }
      AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        NotebookActionsMenuContent(controller, notebook) { open = false }
      }
    }
    if (controller.deletingNotebookId == notebook.id) {
      DeleteNotebookDialog(controller, notebook)
    }
  }
}

@Composable
private fun NotebookActionsMenuContent(
  controller: NotesController,
  notebook: LocalNotebook,
  onDismiss: () -> Unit,
) {
  AppDropdownMenuItem(
    label = "Rename",
    leadingIcon = { Icon(Icons.Outlined.Edit, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.startRename(notebook)
    },
  )
  AppDropdownMenuItem(
    label = "Delete",
    leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.deletingNotebookId = notebook.id
    },
  )
}

@Composable
private fun DeleteNotebookDialog(controller: NotesController, notebook: LocalNotebook) {
  AppModal(onDismissRequest = { controller.deletingNotebookId = null }) {
    AppModalTitle("Delete notebook?", onDismiss = { controller.deletingNotebookId = null })
    GlassPanel(Modifier.fillMaxWidth()) {
      Text("Notes in ${notebook.name} will stay in your notes.", modifier = Modifier.padding(16.dp))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ModalActionButton(
        "Cancel",
        modifier = Modifier.weight(1f),
        onClick = { controller.deletingNotebookId = null },
      )
      ModalActionButton(
        "Delete",
        modifier = Modifier.weight(1f),
        destructive = true,
        onClick = { controller.confirmDeleteNotebook(notebook) },
      )
    }
  }
}
