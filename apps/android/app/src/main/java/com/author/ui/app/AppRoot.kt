package com.author.ui.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.author.ui.screens.*
import com.author.ui.state.NotesController
import com.author.ui.theme.*

@Composable
internal fun AuthorApp(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
  onUnlockApp: () -> Unit = {},
) {
  AuthorTheme(theme = controller.theme, font = controller.editorFont) {
    AuthorScaffold(controller, onExport, onImport, onUnlockApp)
  }
}

@Composable
private fun AuthorScaffold(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
  onUnlockApp: () -> Unit,
) {
  BackHandler(enabled = !controller.appLocked && controller.canHandleBack) {
    controller.handleBack()
  }
  Scaffold(
    modifier = Modifier.fillMaxSize(),
    containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = WindowInsets.safeDrawing,
    floatingActionButton = { if (!controller.appLocked) PageFloatingAction(controller) },
  ) { innerPadding ->
    Box(Modifier.fillMaxSize().padding(innerPadding)) {
      AppPage(controller, onExport, onImport, onUnlockApp)
    }
  }
}

@Composable
private fun AppPage(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
  onUnlockApp: () -> Unit,
) {
  Box(Modifier.fillMaxSize()) {
    if (controller.appLocked) {
      AppLockPage(controller, onUnlockApp)
    } else {
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
}

@Composable
private fun AppLockPage(controller: NotesController, onUnlockApp: () -> Unit) {
  Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
    Column(
      Modifier.fillMaxWidth(),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Icon(
        Icons.Outlined.Lock,
        null,
        modifier = Modifier.size(42.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
      Text(
        "Author locked",
        color = MaterialTheme.colorScheme.onSurface,
        fontWeight = FontWeight.SemiBold,
        style = MaterialTheme.typography.titleMedium,
        textAlign = TextAlign.Center,
      )
      Text(
        controller.appLockMessage.ifBlank { "Use this device's screen lock to reopen notes." },
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.58f),
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
      )
      Button(onClick = onUnlockApp) { Text("Unlock") }
    }
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
