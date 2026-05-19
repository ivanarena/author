package com.author.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
internal fun AuthorApp(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  AuthorTheme(theme = controller.theme, font = controller.editorFont) {
    AuthorScaffold(controller, onExport, onImport)
  }
}

@Composable
private fun AuthorScaffold(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
) {
  BackHandler(enabled = controller.canHandleBack) { controller.handleBack() }
  Scaffold(
    modifier = Modifier.fillMaxSize(),
    containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = WindowInsets.safeDrawing,
    floatingActionButton = { PageFloatingAction(controller) },
  ) { innerPadding ->
    Box(Modifier.fillMaxSize().padding(innerPadding)) { AppPage(controller, onExport, onImport) }
  }
}

@Composable
private fun AppPage(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  Box(Modifier.fillMaxSize()) {
    Crossfade(
      targetState = controller.currentPage,
      animationSpec = appTween(AppMotion.Slow),
      label = "page-crossfade",
    ) { page ->
      when (page) {
        "notes" -> NotesPage(controller)
        "notebooks" -> NotebooksPage(controller)
        "account" -> AccountPage(controller)
        "settings" -> SettingsPage(controller, onExport, onImport)
        else -> EditorPage(controller)
      }
    }
    if (controller.loginOpen) LoginDialog(controller)
    controller.conflicts.firstOrNull()?.let { ConflictDialog(controller, it) }
    NotificationStack(controller)
  }
}

@Composable
private fun PageFloatingAction(controller: NotesController) {
  if (controller.currentPage != "notes" && controller.currentPage != "notebooks") return

  FloatingActionButton(
    onClick = {
      if (controller.currentPage == "notebooks") controller.newNotebookOpen = true
      else controller.newNote()
    },
    shape = CircleShape,
    containerColor = MaterialTheme.colorScheme.primary,
    contentColor = MaterialTheme.colorScheme.onPrimary,
  ) {
    Icon(
      Icons.Outlined.Add,
      if (controller.currentPage == "notebooks") "New notebook" else "New note",
    )
  }
}
