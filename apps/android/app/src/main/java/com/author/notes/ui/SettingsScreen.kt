package com.author.notes.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material.icons.outlined.ZoomOut
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.notes.BuildConfig

@Composable
internal fun SettingsPage(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit
) {
  val compactScreen = LocalConfiguration.current.screenWidthDp < 720
  val showingMenu = compactScreen && controller.settingsSection == "menu"
  val section = activeSettingsSection(controller.settingsSection)

  Surface(
    modifier = Modifier.fillMaxSize(),
    color = MaterialTheme.colorScheme.background
  ) {
    Column(Modifier.fillMaxSize()) {
      PageHeader(
        leading = {
          GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") {
            if (compactScreen && controller.settingsSection != "menu") {
              controller.settingsSection = "menu"
            } else {
              controller.navigateTo("notes")
            }
          }
        }
      )
      if (compactScreen) {
        if (showingMenu) {
          SettingsSectionSelector(
            controller = controller,
            modifier = Modifier
              .fillMaxSize()
              .padding(horizontal = 20.dp, vertical = 16.dp)
          )
        } else {
          Column(
            Modifier
              .fillMaxSize()
              .verticalScroll(rememberScrollState())
              .padding(horizontal = 20.dp, vertical = 16.dp)
          ) {
            SettingsContent(controller, onExport, onImport, section)
          }
        }
      } else {
        Row(
          Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp, vertical = 24.dp),
          horizontalArrangement = Arrangement.spacedBy(24.dp)
        ) {
          SettingsSectionSelector(controller, modifier = Modifier.width(220.dp))
          Column(
            Modifier
              .weight(1f)
              .widthIn(max = 760.dp)
              .verticalScroll(rememberScrollState())
          ) {
            SettingsContent(controller, onExport, onImport, section)
          }
        }
      }
    }
  }
}

@Composable
private fun SettingsSectionSelector(
  controller: NotesController,
  modifier: Modifier = Modifier
) {
  val sections = listOf(
    Triple("account", "Account", Icons.Outlined.AccountCircle),
    Triple("sync", "Sync", Icons.Outlined.Refresh),
    Triple("data", "Data", Icons.Outlined.Download),
    Triple("appearance", "Appearance", if (controller.theme.startsWith("dark")) Icons.Outlined.LightMode else Icons.Outlined.DarkMode)
  )
  Column(modifier.animateContentSize(tween(AppMotion.Medium)), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    sections.forEach { (id, label, icon) ->
      SettingsNavRow(icon, label, active = activeSettingsSection(controller.settingsSection) == id) {
        controller.settingsSection = id
      }
    }
  }
}

@Composable
private fun SettingsNavRow(
  icon: ImageVector,
  label: String,
  active: Boolean,
  onClick: () -> Unit
) {
  val rowColor by animateColorAsState(
    targetValue = if (active) activeColor() else fieldColor(),
    animationSpec = tween(durationMillis = AppMotion.Medium),
    label = "settings-nav-color"
  )
  Surface(
    color = rowColor,
    shape = RoundedCornerShape(8.dp)
  ) {
    Row(
      Modifier
        .fillMaxWidth()
        .heightIn(min = 44.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      Icon(icon, null, modifier = Modifier.size(17.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (active) 0.82f else 0.58f))
      Text(label, fontSize = 14.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
    }
  }
}

private fun activeSettingsSection(section: String): String = if (section == "menu") "account" else section

@Composable
private fun SettingsContent(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
  section: String = activeSettingsSection(controller.settingsSection)
) {
  Column(
    Modifier
      .fillMaxWidth()
      .animateContentSize(tween(AppMotion.Slow)),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    when (section) {
      "account" -> AccountSettings(controller)
      "sync" -> SyncSettings(controller)
      "data" -> DataSettings(controller, onExport, onImport)
      else -> AppearanceSettings(controller)
    }
  }
}

@Composable
internal fun AccountSettings(controller: NotesController, showIdentity: Boolean = true) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (controller.hasToken) {
      if (showIdentity) {
        Text(controller.accountDisplayName.ifBlank { controller.accountUsername }, fontWeight = FontWeight.Bold)
        Text(controller.accountUsername, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      }
      if (controller.accountProfileEditing) {
        MiniField(controller.accountDisplayName, "Nickname", Modifier.fillMaxWidth()) { controller.accountDisplayName = it }
        ActionRow(Icons.Outlined.Check, "Save profile") { controller.saveAccountProfile() }
      } else {
        ActionRow(Icons.Outlined.Edit, "Edit profile") { controller.accountProfileEditing = true }
      }
      if (controller.accountPasswordEditing) {
        PasswordField(controller.currentPasswordValue, "Current") { controller.currentPasswordValue = it }
        PasswordField(controller.newPasswordValue, "New") { controller.newPasswordValue = it }
        PasswordField(controller.confirmPasswordValue, "Confirm") { controller.confirmPasswordValue = it }
        ActionRow(Icons.Outlined.Check, "Change password") { controller.changePassword() }
      } else {
        ActionRow(Icons.Outlined.Settings, "Change password") { controller.accountPasswordEditing = true }
      }
      if (controller.accountDeleteEditing) {
        PasswordField(controller.deletePasswordValue, "Password") { controller.deletePasswordValue = it }
        ActionRow(Icons.Outlined.Delete, "Delete account") { controller.deleteAccount() }
      } else {
        ActionRow(Icons.Outlined.Delete, "Delete account") { controller.accountDeleteEditing = true }
      }
      if (controller.accountError.isNotBlank()) {
        Text(controller.accountError, color = messageColor(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
      }
      if (controller.accountMessage.isNotBlank()) {
        Text(controller.accountMessage, color = messageColor(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
      }
    } else {
      if (showIdentity) {
        Text("Local workspace", fontWeight = FontWeight.Bold)
        Text("Sync is off for this device", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      }
      ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.openLogin() }
    }
  }
}

@Composable
private fun SyncSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SyncStatusTile(controller)
    InfoTile("Pending local changes", controller.pendingSyncCount.toString(), "${controller.pendingSyncCount} items waiting to sync")
    InfoTile("Last sync pass", controller.lastSyncPassTitle, controller.lastSyncPassDetail)
    InfoTile("Installed API", BuildConfig.DEFAULT_API_BASE_URL, buildApiDetail())
    InfoTile("Connected API", controller.serverApiBaseUrl.ifBlank { controller.apiBaseUrl }, serverApiDetail(controller))
    InfoTile("Remote database", remoteDatabaseValue(controller), remoteDatabaseDetail(controller))
    if (controller.remoteSyncEnabled || controller.remoteSyncError.isNotBlank()) {
      InfoTile("Remote sync", controller.remoteSyncState, controller.remoteSyncError.ifBlank { "Remote worker status from the last check" })
    }
    SyncDebugTile(controller)
    MiniField(controller.apiBaseUrl, "Author API URL", Modifier.fillMaxWidth()) { controller.apiBaseUrl = it }
    ActionRow(Icons.Outlined.Check, "Save API URL") { controller.saveApiBaseUrl() }
    ActionRow(Icons.Outlined.Settings, "Use installed API") { controller.useBuildApiBaseUrl() }
    ActionRow(Icons.Outlined.Refresh, "Check API") { controller.refreshServerConfig(showNotification = true) }
    if (controller.hasToken) {
      ActionRow(Icons.Outlined.Refresh, if (controller.isSyncing) controller.syncLabel else "Sync now") { controller.syncNow() }
    } else {
      ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") {
        controller.openLogin()
      }
    }
  }
}

@Composable
private fun SyncStatusTile(controller: NotesController) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp)) {
      Text("Status", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        SyncActivityIndicator(controller.isSyncing)
        Text(controller.syncLabel.ifBlank { " " }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      if (controller.syncDetail.isNotBlank()) {
        Text(controller.syncDetail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}

private fun buildApiDetail(): String = if (BuildConfig.DEFAULT_API_BASE_URL_CONFIGURED) {
  "Loaded from build-time environment or Gradle property"
} else {
  "Local emulator default. Set AUTHOR_NOTES_API_URL for a real build."
}

private fun serverApiDetail(controller: NotesController): String = controller.serverConfigError.ifBlank {
  "Reported by the Author API. Turso credentials stay on the server."
}

private fun remoteDatabaseValue(controller: NotesController): String = when {
  controller.serverRemoteDatabaseConfigured -> "Configured"
  controller.serverConfigError.isBlank() -> "Not configured"
  else -> "Unknown"
}

private fun remoteDatabaseDetail(controller: NotesController): String = when {
  controller.serverConfigError.isNotBlank() -> controller.serverConfigError
  controller.serverRemoteSyncEnabled -> "Turso remote mirror enabled by the API server"
  controller.serverRemoteDatabaseConfigured -> "Turso configured on the API server, remote sync disabled"
  else -> "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN on the API server"
}

@Composable
private fun SyncDebugTile(controller: NotesController) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text("Debug", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
      Text(controller.syncDebugTitle, fontWeight = FontWeight.SemiBold)
      Text(controller.syncDebugDetail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      SelectionContainer {
        Text(
          controller.syncDebugLog,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
          fontFamily = FontFamily.Monospace,
          fontSize = 11.sp,
          lineHeight = 15.sp
        )
      }
    }
  }
}

@Composable
private fun DataSettings(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (controller.importBanner.isNotBlank()) {
      Text(controller.importBanner, color = messageColor(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
    ActionRow(Icons.Outlined.Download, if (controller.isArchiveBusy) "Working" else "Export MD ZIP") {
      if (!controller.isArchiveBusy) onExport()
    }
    ActionRow(Icons.Outlined.Upload, if (controller.isArchiveBusy) "Working" else "Import MD files") {
      if (!controller.isArchiveBusy) onImport()
    }
  }
}

@Composable
private fun AppearanceSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    ActionRow(Icons.Outlined.FolderOpen, "Compact notes") { controller.toggleCompactView() }
    ActionRow(
      if (controller.theme.startsWith("dark")) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
      if (controller.theme.startsWith("dark")) "Light mode" else "Dark mode"
    ) { controller.toggleTheme() }
    SettingsChoiceGroup("Themes") {
      ThemeChoices.forEach { choice ->
        AppearanceChoice(choice.label, controller.theme == choice.value) {
          controller.setThemeChoice(choice.value)
        }
      }
    }
    SettingsChoiceGroup("Font") {
      FontChoices.forEach { choice ->
        AppearanceChoice(choice.label, controller.editorFont == choice.value) {
          controller.chooseEditorFont(choice.value)
        }
      }
    }
    SettingsStepper("Text size", "${controller.editorTextSize.toInt()}sp") {
      GlassIcon(Icons.Outlined.ZoomOut, "Smaller text", enabled = controller.editorTextSize > 14f) {
        controller.adjustEditorTextSize(-1f)
      }
      GlassIcon(Icons.Outlined.ZoomIn, "Larger text", enabled = controller.editorTextSize < 22f) {
        controller.adjustEditorTextSize(1f)
      }
    }
    SettingsStepper("Line height", String.format("%.2f", controller.editorLineHeight)) {
      GlassIcon(Icons.Outlined.ZoomOut, "Tighter lines", enabled = controller.editorLineHeight > 1.35f) {
        controller.adjustEditorLineHeight(-0.05f)
      }
      GlassIcon(Icons.Outlined.ZoomIn, "Looser lines", enabled = controller.editorLineHeight < 2.1f) {
        controller.adjustEditorLineHeight(0.05f)
      }
    }
    SettingsStepper("Editor zoom", "${(controller.editorZoom * 100).toInt()}%") {
      GlassIcon(Icons.Outlined.ZoomOut, "Zoom out", enabled = controller.editorZoom > 0.8f) {
        controller.zoomEditor(-1)
      }
      GlassIcon(Icons.Outlined.ZoomIn, "Zoom in", enabled = controller.editorZoom < 1.4f) {
        controller.zoomEditor(1)
      }
    }
  }
}

@Composable
private fun SettingsChoiceGroup(label: String, content: @Composable ColumnScope.() -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(
      label,
      color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
      fontSize = 12.sp,
      fontWeight = FontWeight.SemiBold
    )
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
  }
}

@Composable
private fun AppearanceChoice(label: String, active: Boolean, onClick: () -> Unit) {
  val rowColor by animateColorAsState(
    targetValue = if (active) activeColor() else fieldColor(),
    animationSpec = tween(durationMillis = AppMotion.Medium),
    label = "appearance-choice-color"
  )
  Surface(
    color = rowColor,
    shape = RoundedCornerShape(8.dp)
  ) {
    Row(
      Modifier
        .fillMaxWidth()
        .heightIn(min = 40.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Text(
        label,
        modifier = Modifier.weight(1f),
        fontSize = 14.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal
      )
      Icon(
        Icons.Outlined.Check,
        null,
        modifier = Modifier.size(16.dp),
        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (active) 0.72f else 0f)
      )
    }
  }
}

@Composable
private fun SettingsStepper(
  label: String,
  value: String,
  controls: @Composable RowScope.() -> Unit
) {
  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    Column(Modifier.weight(1f)) {
      Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
      Text(
        value,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = 12.sp
      )
    }
    controls()
  }
}
