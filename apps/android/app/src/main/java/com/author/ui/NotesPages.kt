package com.author.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun NotesPage(controller: NotesController) {
  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    NotesTopBar(controller)
    NoteListPanel(controller, Modifier.fillMaxSize())
  }
}

@Composable
private fun NotesTopBar(controller: NotesController) {
  val compactScreen = isCompactWindow()
  Surface(color = toolbarColor()) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = if (compactScreen) 56.dp else 64.dp)
        .padding(horizontal = pageHorizontalPadding(), vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      GlassIcon(Icons.Outlined.Book, "Notebooks") { controller.navigateTo("notebooks") }
      SearchNotesField(controller, Modifier.weight(1f))
      ProfileMenu(controller)
    }
  }
}

@Composable
private fun ProfileMenu(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  Box {
    GlassIcon(Icons.Outlined.AccountCircle, "Profile and settings", active = open) { open = true }
    AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      if (controller.hasToken) {
        AppDropdownMenuItem(
          label = "Profile",
          leadingIcon = {
            Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(18.dp))
          },
          onClick = {
            open = false
            controller.navigateTo("account")
          },
        )
      } else {
        AppDropdownMenuItem(
          label = "Sign in to sync",
          leadingIcon = {
            Icon(Icons.AutoMirrored.Outlined.Login, null, modifier = Modifier.size(18.dp))
          },
          onClick = {
            open = false
            controller.openLogin()
          },
        )
      }
      AppDropdownMenuItem(
        label = "Settings",
        leadingIcon = { Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(18.dp)) },
        onClick = {
          open = false
          controller.navigateTo("settings")
        },
      )
      DropdownSectionLabel("Sort notes")
      SortMenuItem("date-desc", "Newest first", controller) { open = false }
      SortMenuItem("az", "A-Z", controller) { open = false }
      SortMenuItem("za", "Z-A", controller) { open = false }
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
    leadingIcon = {
      if (controller.noteSort == sort) {
        MenuCheck(true)
      } else {
        Icon(Icons.AutoMirrored.Outlined.Sort, null, modifier = Modifier.size(18.dp))
      }
    },
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
    leadingIcon = {
      if (controller.noteGroup == group) {
        MenuCheck(true)
      } else {
        Icon(Icons.AutoMirrored.Outlined.Sort, null, modifier = Modifier.size(18.dp))
      }
    },
    onClick = {
      controller.setGroup(group)
      onPicked()
    },
  )
}

@Composable
internal fun NotebooksPage(controller: NotesController) {
  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    PageHeader(
      leading = {
        GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to notes") {
          controller.handleBack()
        }
      }
    )
    NotebookSidebar(
      controller = controller,
      modifier = Modifier.fillMaxSize(),
      onFilterPicked = { controller.navigateTo("notes") },
    )
  }
}

@Composable
internal fun AccountPage(controller: NotesController) {
  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    PageHeader(
      leading = {
        GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to notes") {
          controller.handleBack()
        }
      },
      actions = {
        if (controller.hasToken) {
          GlassIcon(Icons.Outlined.Refresh, "Sync now", enabled = !controller.isSyncing) {
            controller.syncNow()
          }
          GlassIcon(Icons.AutoMirrored.Outlined.Logout, "Log out and lock") { controller.logout() }
        } else {
          GlassIcon(Icons.AutoMirrored.Outlined.Login, "Sign in") { controller.openLogin() }
        }
      },
    )
    Column(
      Modifier.fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = pageHorizontalPadding(), vertical = 16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
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
      horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Box(modifier = Modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.AccountCircle, null, modifier = Modifier.size(28.dp))
      }
      Column(Modifier.weight(1f)) {
        Text(
          if (controller.hasToken) controller.accountUsername else "Local workspace",
          fontWeight = FontWeight.Bold,
          fontSize = AppTextSize.Title,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        if (controller.hasToken) {
          Text(
            controller.accountEmail.ifBlank { "Signed in" },
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
          )
        }
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          SyncActivityIndicator(controller.isSyncing)
          SyncStatusText(controller.syncLabel)
        }
        if (controller.syncDetail.isNotBlank()) {
          Text(
            controller.syncDetail,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
    }
  }
}
