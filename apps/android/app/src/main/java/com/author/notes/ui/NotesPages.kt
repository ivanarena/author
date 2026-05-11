package com.author.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NotesPage(controller: NotesController) {
  Column(
    Modifier
      .fillMaxSize()
      .background(MaterialTheme.colorScheme.background)
  ) {
    PageHeader(
      leading = {
        GlassIcon(Icons.Outlined.AutoStories, "Notebooks") { controller.navigateTo("notebooks") }
      },
      actions = {
        GlassIcon(Icons.Outlined.AccountCircle, "Account") { controller.navigateTo("account") }
        GlassIcon(Icons.Outlined.Settings, "Settings") { controller.navigateTo("settings") }
      }
    )
    NoteListPanel(controller, Modifier.fillMaxSize())
  }
}

@Composable
internal fun NotebooksPage(controller: NotesController) {
  Column(
    Modifier
      .fillMaxSize()
      .background(MaterialTheme.colorScheme.background)
  ) {
    PageHeader(
      leading = {
        GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to notes") { controller.navigateTo("notes") }
      },
      actions = {
        GlassIcon(Icons.Outlined.Add, "New notebook") { controller.newNotebookOpen = true }
      }
    )
    NotebookSidebar(
      controller = controller,
      modifier = Modifier.fillMaxSize(),
      onFilterPicked = { controller.navigateTo("notes") }
    )
  }
}

@Composable
internal fun AccountPage(controller: NotesController) {
  Column(
    Modifier
      .fillMaxSize()
      .background(MaterialTheme.colorScheme.background)
  ) {
    PageHeader(
      leading = {
        GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to notes") { controller.navigateTo("notes") }
      },
      actions = {
        if (controller.hasToken) {
          GlassIcon(Icons.Outlined.Refresh, "Sync now", enabled = !controller.isSyncing) { controller.syncNow() }
          GlassIcon(Icons.AutoMirrored.Outlined.Logout, "Log out") { controller.logout() }
        } else {
          GlassIcon(Icons.AutoMirrored.Outlined.Login, "Sign in") { controller.openLogin() }
        }
      }
    )
    Column(
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = pageHorizontalPadding(), vertical = 16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
      AccountSummary(controller)
      AccountSettings(controller, showIdentity = false)
    }
  }
}

@Composable
private fun AccountSummary(controller: NotesController) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Row(
      Modifier.padding(16.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
      Box(modifier = Modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(28.dp))
      }
      Column(Modifier.weight(1f)) {
        Text(
          if (controller.hasToken) controller.accountDisplayName.ifBlank { controller.accountUsername } else "Local workspace",
          fontWeight = FontWeight.Bold,
          fontSize = 18.sp,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        if (controller.hasToken) {
          Text(controller.accountUsername, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
        }
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          SyncActivityIndicator(controller.isSyncing)
          Text(controller.syncLabel, color = statusColor(controller.syncLabel), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        if (controller.syncDetail.isNotBlank()) {
          Text(controller.syncDetail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}
