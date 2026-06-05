package com.author.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.author.core.NOTE_FILTER_UNFILED_ID
import com.author.ui.common.*
import com.author.ui.state.*
import com.author.ui.theme.*

@Composable
internal fun NotesPage(controller: NotesController) {
  var searchOpen by remember { mutableStateOf(false) }
  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    NotesTopBar(
      controller = controller,
      searchOpen = searchOpen,
      onSearchOpen = { searchOpen = true },
      onSearchClose = { searchOpen = false },
    )
    NoteListPanel(controller, Modifier.fillMaxSize())
  }
}

@Composable
private fun NotesTopBar(
  controller: NotesController,
  searchOpen: Boolean,
  onSearchOpen: () -> Unit,
  onSearchClose: () -> Unit,
) {
  val compactScreen = isCompactWindow()
  Column {
    Surface(color = toolbarColor()) {
      Column {
        Row(
          Modifier.fillMaxWidth()
            .heightIn(min = if (compactScreen) 56.dp else 64.dp)
            .padding(horizontal = pageHorizontalPadding(), vertical = 10.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          GlassIcon(
            Icons.Outlined.Search,
            "Search notes",
            active = searchOpen || controller.searchValue.isNotBlank(),
          ) {
            onSearchOpen()
          }
          NotesSortButton(controller)
          GlassIcon(Icons.Outlined.Book, "Notebooks") { controller.navigateTo("notebooks") }
          Box(Modifier.weight(1f))
          ProfileMenu(controller)
        }
        AnimatedVisibility(
          visible = searchOpen,
          enter =
            fadeIn(appTween(AppMotion.Fast)) +
              expandVertically(
                animationSpec = appTween(AppMotion.Fast),
                expandFrom = Alignment.Top,
              ),
          exit =
            fadeOut(appTween(AppMotion.Fast)) +
              shrinkVertically(
                animationSpec = appTween(AppMotion.Fast),
                shrinkTowards = Alignment.Top,
              ),
        ) {
          SearchNotesField(
            controller = controller,
            modifier =
              Modifier.fillMaxWidth()
                .padding(
                  start = pageHorizontalPadding(),
                  end = pageHorizontalPadding(),
                  top = 0.dp,
                  bottom = 8.dp,
                ),
            onDismiss = onSearchClose,
          )
        }
        NotebookFilterRail(controller)
      }
    }
  }
}

@Composable
private fun NotebookFilterRail(controller: NotesController) {
  val activeNotebooks =
    controller.notebooks
      .filter { it.deletedAt == null }
      .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name.ifBlank { "Untitled" } })
  val showUnfiled =
    controller.unfiledCount > 0 || NOTE_FILTER_UNFILED_ID in controller.noteFilterNotebookIds

  Row(
    Modifier.fillMaxWidth()
      .padding(
        start = pageHorizontalPadding(),
        end = pageHorizontalPadding(),
        top = 2.dp,
        bottom = 4.dp,
      ),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    LazyRow(
      modifier = Modifier.weight(1f),
      contentPadding = PaddingValues(end = 2.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (controller.noteFilterNotebookIds.isNotEmpty()) {
        item(key = "clear") {
          NotebookFilterChip(
            label = "Clear",
            icon = Icons.Outlined.Close,
            active = true,
            accent = false,
            onClick = { controller.clearNotebookFilters() },
          )
        }
      }
      if (showUnfiled) {
        item(key = NOTE_FILTER_UNFILED_ID) {
          NotebookFilterChip(
            label = "Unfiled",
            detail = "${controller.unfiledCount}",
            active = NOTE_FILTER_UNFILED_ID in controller.noteFilterNotebookIds,
            onClick = { controller.toggleNoteFilterNotebook(NOTE_FILTER_UNFILED_ID) },
          )
        }
      }
      items(activeNotebooks, key = { it.id }) { notebook ->
        NotebookFilterChip(
          label = notebook.name.ifBlank { "Untitled notebook" },
          detail = "${controller.notebookCounts[notebook.id] ?: 0}",
          active = notebook.id in controller.noteFilterNotebookIds,
          onClick = { controller.toggleNoteFilterNotebook(notebook.id) },
        )
      }
    }
  }
}

@Composable
private fun NotebookFilterChip(
  label: String,
  active: Boolean,
  accent: Boolean = active,
  detail: String = "",
  icon: ImageVector = Icons.Outlined.Book,
  onClick: () -> Unit,
) {
  val useAccent = active && accent
  Surface(
    modifier =
      Modifier.heightIn(min = 40.dp)
        .widthIn(max = 180.dp)
        .clip(AppShape.Pill)
        .clickable(onClick = onClick),
    shape = AppShape.Pill,
    color = contrastControlColor(active = useAccent),
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Icon(
        icon,
        null,
        modifier = Modifier.size(15.dp),
        tint = contrastControlContentColor(active = useAccent),
      )
      Text(
        label,
        modifier = Modifier.weight(1f, fill = false),
        color = contrastControlContentColor(active = useAccent),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (detail.isNotBlank()) {
        Text(
          detail,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          fontSize = AppTextSize.Label,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
        )
      }
    }
  }
}

@Composable
private fun ProfileMenu(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  Box {
    GlassIcon(Icons.Outlined.AccountCircle, "Profile and settings", active = open) { open = true }
    if (open) ProfileModal(controller) { open = false }
  }
}

@Composable
private fun ProfileModal(controller: NotesController, onDismiss: () -> Unit) {
  AppModal(
    onDismissRequest = onDismiss,
    maxWidth = 342.dp,
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp),
  ) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      AppModalTitle("Profile", onDismiss = onDismiss)
      ProfileIdentitySummary(controller)
      DropdownSectionLabel("Session")
      if (controller.hasToken) {
        ActionRow(
          icon = Icons.AutoMirrored.Outlined.Logout,
          label = "Log out",
          detail = "Lock this synced workspace",
          onClick = {
            onDismiss()
            controller.logout()
          },
        )
      } else {
        ActionRow(
          icon = Icons.AutoMirrored.Outlined.Login,
          label = "Sign in",
          detail = "Enable sync for this workspace",
          onClick = {
            onDismiss()
            controller.openLogin()
          },
        )
      }
      DropdownSectionLabel("Sync")
      ActionRow(
        icon = Icons.Outlined.Refresh,
        label = "Sync now",
        enabled = controller.hasToken,
        active = controller.isSyncing,
        detail = if (controller.hasToken) controller.syncLabel else "Sign in first",
        onClick = { if (!controller.isSyncing) controller.syncNow() },
      )
      DropdownSectionLabel("Manage")
      ActionRow(
        icon = Icons.Outlined.AccountCircle,
        label = "Account",
        enabled = controller.hasToken,
        detail = if (controller.hasToken) "Profile, password, devices" else "Sign in first",
        onClick = {
          onDismiss()
          controller.navigateTo("account")
        },
      )
      ActionRow(
        icon = Icons.Outlined.Settings,
        label = "Settings",
        detail = "Appearance, editor, storage",
        onClick = {
          onDismiss()
          controller.navigateTo("settings")
        },
      )
    }
  }
}

@Composable
private fun ProfileIdentitySummary(controller: NotesController) {
  val title =
    if (controller.hasToken) {
      controller.accountDisplayName.ifBlank { controller.accountUsername.ifBlank { "Signed in" } }
    } else {
      "Local workspace"
    }
  val detail =
    if (controller.hasToken) {
      controller.accountEmail.ifBlank { controller.accountUsername.ifBlank { "Synced account" } }
    } else {
      "Stored on this device until you sign in"
    }

  Row(
    Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    MaterialIconTile(
      Icons.Outlined.AccountCircle,
      null,
      active = controller.hasToken,
      size = 44.dp,
      iconSize = 24.dp,
    )
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        title,
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = AppTextSize.Body,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Text(
        detail,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        SyncActivityIndicator(controller.isSyncing)
        SyncStatusText(controller.syncLabel)
      }
    }
  }
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
