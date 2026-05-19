package com.author.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.author.core.LocalNotebook

@Composable
internal fun NotebookSidebar(
  controller: NotesController,
  modifier: Modifier = Modifier,
  onFilterPicked: () -> Unit = {},
) {
  Column(
    modifier.padding(horizontal = pageHorizontalPadding(), vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    AnimatedVisibility(
      visible = controller.newNotebookOpen,
      enter = fadeIn(appTween(AppMotion.Medium)) + expandVertically(appTween(AppMotion.Slow)),
      exit = fadeOut(appTween(AppMotion.Fast)) + shrinkVertically(appTween(AppMotion.Medium)),
    ) {
      GlassPanel(Modifier.fillMaxWidth()) {
        Row(
          Modifier.padding(8.dp).animateContentSize(appTween(AppMotion.Medium)),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          MiniField(controller.notebookNameValue, "Notebook name", Modifier.weight(1f)) {
            controller.notebookNameValue = it
            controller.notebookError = ""
          }
          GlassIcon(Icons.Outlined.Check, "Create") { controller.createNotebook() }
          GlassIcon(Icons.Outlined.Close, "Close") { controller.newNotebookOpen = false }
        }
      }
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      item {
        NavRow(
          Icons.AutoMirrored.Outlined.Article,
          "All notes",
          notebookCountLabel(controller.notes.size, controller),
          controller.filterId == "all",
        ) {
          controller.filterId = "all"
          onFilterPicked()
        }
      }
      item {
        NavRow(
          Icons.Outlined.BookmarkBorder,
          "Unfiled",
          notebookCountLabel(controller.unfiledCount, controller),
          controller.filterId == "unfiled",
        ) {
          controller.filterId = "unfiled"
          onFilterPicked()
        }
      }
      if (controller.notebooks.isNotEmpty()) {
        item { NotebookGroupSeparator() }
      }
      items(controller.notebooks, key = { it.id }) { notebook ->
        NotebookRow(controller, notebook, onPicked = onFilterPicked)
      }
      item { NotebookGroupSeparator() }
      item {
        NavRow(
          Icons.Outlined.Delete,
          "Trash",
          notebookCountLabel(controller.trash.size, controller),
          controller.filterId == "trash",
        ) {
          controller.filterId = "trash"
          onFilterPicked()
        }
      }
    }
  }
}

private fun notebookCountLabel(count: Int, controller: NotesController): String =
  if (controller.isWorkspaceLoading) "..." else count.toString()

@Composable
private fun NotebookGroupSeparator() {
  Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
    HorizontalDivider(
      color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.11f),
      thickness = 1.dp,
    )
  }
}

@Composable
private fun NotebookRow(
  controller: NotesController,
  notebook: LocalNotebook,
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
  AlertDialog(
    onDismissRequest = { controller.deletingNotebookId = null },
    containerColor = MaterialTheme.colorScheme.background,
    title = { Text("Delete notebook?") },
    text = { Text("Notes in ${notebook.name} will move to Trash.") },
    confirmButton = {
      TextButton(onClick = { controller.confirmDeleteNotebook(notebook) }) { Text("Delete") }
    },
    dismissButton = {
      TextButton(onClick = { controller.deletingNotebookId = null }) { Text("Cancel") }
    },
  )
}
