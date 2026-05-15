package com.author.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
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
  Scaffold(
    modifier = Modifier.fillMaxSize(),
    containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = WindowInsets.safeDrawing,
    floatingActionButton = { PageFloatingAction(controller) },
  ) { innerPadding ->
    Box(Modifier.fillMaxSize().padding(innerPadding).imePadding()) {
      AppPage(controller, onExport, onImport)
    }
  }
}

@Composable
private fun AppPage(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  Box(Modifier.fillMaxSize()) {
    Crossfade(
      targetState = controller.currentPage,
      animationSpec = tween(durationMillis = AppMotion.Slow),
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
  if (controller.currentPage != "notes") return

  GlassIcon(Icons.AutoMirrored.Outlined.NoteAdd, "New note") { controller.newNote() }
}
