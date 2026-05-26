package com.author.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.BuildConfig
import com.author.core.formatDateTime
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.util.Locale

@Composable
internal fun SettingsPage(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  val compactScreen = isCompactWindow()
  val showingMenu = compactScreen && controller.settingsSection == "menu"
  val section = activeSettingsSection(controller.settingsSection)

  Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
    Column(Modifier.fillMaxSize()) {
      PageHeader(
        leading = {
          GlassIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") {
            if (compactScreen && controller.settingsSection != "menu") {
              controller.settingsSection = "menu"
            } else {
              controller.handleBack()
            }
          }
        }
      )
      if (compactScreen) {
        if (showingMenu) {
          SettingsSectionSelector(
            controller = controller,
            modifier =
              Modifier.fillMaxSize().padding(horizontal = pageHorizontalPadding(), vertical = 16.dp),
          )
        } else {
          Column(
            Modifier.fillMaxSize()
              .verticalScroll(rememberScrollState())
              .padding(horizontal = pageHorizontalPadding(), vertical = 16.dp)
          ) {
            SettingsContent(controller, onExport, onImport, section)
          }
        }
      } else {
        Row(
          Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 24.dp),
          horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
          SettingsSectionSelector(controller, modifier = Modifier.width(220.dp))
          Column(Modifier.weight(1f).widthIn(max = 760.dp).verticalScroll(rememberScrollState())) {
            SettingsContent(controller, onExport, onImport, section)
          }
        }
      }
    }
  }
}

@Composable
private fun SettingsSectionSelector(controller: NotesController, modifier: Modifier = Modifier) {
  val systemDark = isSystemInDarkTheme()
  val resolvedTheme = resolveThemeChoice(controller.theme, systemDark)
  val sections =
    listOf(
      SettingsSectionItem(
        "account",
        "Account",
        accountSettingsSubtitle(controller),
        Icons.Outlined.AccountCircle,
      ),
      SettingsSectionItem("sync", "Sync", controller.syncLabel, Icons.Outlined.Refresh, true),
      SettingsSectionItem("data", "Data", "Import and export", Icons.Outlined.Download),
      SettingsSectionItem(
        "appearance",
        "Appearance",
        themeSettingsSubtitle(controller.theme, systemDark),
        if (resolvedTheme.startsWith("dark")) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
      ),
    )
  Column(
    modifier.animateContentSize(appTween(AppMotion.Medium)),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    sections.forEach { section ->
      SettingsNavRow(
        section.icon,
        section.label,
        section.subtitle,
        active = activeSettingsSection(controller.settingsSection) == section.id,
        syncStatus = section.syncStatus,
      ) {
        controller.settingsSection = section.id
      }
    }
  }
}

@Composable
private fun SettingsNavRow(
  icon: ImageVector,
  label: String,
  subtitle: String,
  active: Boolean,
  syncStatus: Boolean = false,
  onClick: () -> Unit,
) {
  val contentColor =
    if (active) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f)
  Surface(
    color =
      if (active) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.52f)
      else Color.Transparent,
    shape = RoundedCornerShape(10.dp),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = 54.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(icon, null, modifier = Modifier.size(17.dp), tint = contentColor)
      Column(Modifier.weight(1f)) {
        Text(
          label,
          color = contentColor,
          fontSize = AppTextSize.Body,
          fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          subtitle.ifBlank { " " },
          color =
            if (syncStatus) syncStatusColor(subtitle)
            else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.48f),
          fontSize = AppTextSize.Label,
          fontWeight = if (syncStatus) FontWeight.SemiBold else FontWeight.Normal,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

private fun activeSettingsSection(section: String): String =
  if (section == "menu") "account" else section

private data class SettingsSectionItem(
  val id: String,
  val label: String,
  val subtitle: String,
  val icon: ImageVector,
  val syncStatus: Boolean = false,
)

private fun accountSettingsSubtitle(controller: NotesController): String =
  if (controller.hasToken) {
    listOf(controller.accountUsername, controller.accountEmail)
      .map { it.trim() }
      .filter { it.isNotEmpty() }
      .ifEmpty { listOf(controller.accountUsername) }
      .joinToString(" - ")
  } else {
    "Local workspace"
  }

private fun themeSettingsSubtitle(theme: String, systemDark: Boolean): String =
  if (theme == "system") {
    "Auto (${if (systemDark) "dark" else "light"})"
  } else {
    themeChoiceLabel(theme)
  }

@Composable
private fun SettingsContent(
  controller: NotesController,
  onExport: () -> Unit,
  onImport: () -> Unit,
  section: String = activeSettingsSection(controller.settingsSection),
) {
  Column(
    Modifier.fillMaxWidth().animateContentSize(appTween(AppMotion.Slow)),
    verticalArrangement = Arrangement.spacedBy(14.dp),
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
      val panel = controller.accountPanel
      if (panel != null) {
        AccountDetailPanel(controller, panel)
      } else {
        if (showIdentity) {
          InfoTile(
            "Signed in",
            controller.accountUsername,
            controller.accountEmail.ifBlank { "Sync account" },
          )
        }
        AccountMenuRow(
          Icons.Outlined.Email,
          "Email",
          controller.accountEmail.ifBlank { "Signed in without email" },
        ) {
          controller.openAccountPanel("email")
        }
        AccountMenuRow(
          Icons.Outlined.Devices,
          "This device",
          controller.currentDeviceName.ifBlank { "Android device" },
        ) {
          controller.openAccountPanel("device")
        }
        AccountMenuRow(
          Icons.Outlined.Security,
          "Trusted devices",
          trustedDeviceCountLabel(controller.accountTrustedDevices.size),
        ) {
          controller.openAccountPanel("trusted-devices")
        }
        AccountMenuRow(Icons.Outlined.Lock, "Change password", "Requires current password") {
          controller.openAccountPanel("password")
        }
        AccountMenuRow(
          Icons.Outlined.Settings,
          "Authenticator 2FA",
          if (controller.accountTwoFactorEnabled) "Enabled" else "Disabled",
        ) {
          controller.openAccountPanel("totp")
        }
        AccountMenuRow(
          Icons.Outlined.Delete,
          "Delete account",
          "Permanent account removal",
          destructive = true,
        ) {
          controller.openAccountPanel("delete")
        }
      }
    } else {
      if (showIdentity) {
        Text("Local workspace", fontWeight = FontWeight.Bold)
        Text(
          "Sync is off for this device",
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
        )
      }
      ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.openLogin() }
    }
  }
}

private fun trustedDeviceCountLabel(count: Int): String =
  when (count) {
    0 -> "No trusted devices"
    1 -> "1 trusted device"
    else -> "$count trusted devices"
  }

@Composable
private fun AccountMenuRow(
  icon: ImageVector,
  label: String,
  detail: String,
  destructive: Boolean = false,
  onClick: () -> Unit,
) {
  val contentColor =
    if (destructive) MaterialTheme.colorScheme.error
    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f)
  Surface(
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)),
    color = Color.Transparent,
    shape = RoundedCornerShape(8.dp),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = 54.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(icon, null, modifier = Modifier.size(17.dp), tint = contentColor)
      Column(Modifier.weight(1f)) {
        Text(
          label,
          color = if (destructive) contentColor else MaterialTheme.colorScheme.onSurface,
          fontSize = AppTextSize.Body,
          fontWeight = FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          detail.ifBlank { " " },
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.48f),
          fontSize = AppTextSize.Label,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Icon(
        Icons.Outlined.ChevronRight,
        null,
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
      )
    }
  }
}

@Composable
private fun AccountDetailPanel(controller: NotesController, panel: String) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    AccountDetailHeader(accountPanelTitle(panel), accountPanelDetail(controller, panel)) {
      controller.closeAccountPanel()
    }
    when (panel) {
      "email" -> AccountEmailPanel(controller)
      "device" -> DeviceNameSettings(controller)
      "trusted-devices" -> TrustedDevicesSettings(controller)
      "password" -> PasswordSettingsPanel(controller)
      "totp" -> TotpSettingsPanel(controller)
      "delete" -> DeleteAccountPanel(controller)
    }
  }
}

@Composable
private fun AccountDetailHeader(title: String, detail: String, onBack: () -> Unit) {
  Surface(
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)),
    color = Color.Transparent,
    shape = RoundedCornerShape(8.dp),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = 52.dp)
        .clickable(onClick = onBack)
        .padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(
        Icons.AutoMirrored.Outlined.ArrowBack,
        null,
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
      )
      Column(Modifier.weight(1f)) {
        Text(
          title,
          fontSize = AppTextSize.Body,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          detail,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

private fun accountPanelTitle(panel: String): String =
  when (panel) {
    "email" -> "Email"
    "device" -> "This device"
    "trusted-devices" -> "Trusted devices"
    "password" -> "Change password"
    "totp" -> "Authenticator 2FA"
    "delete" -> "Delete account"
    else -> "Account"
  }

private fun accountPanelDetail(controller: NotesController, panel: String): String =
  when (panel) {
    "email" -> controller.accountEmail.ifBlank { "Signed in without email" }
    "device" -> controller.currentDeviceName.ifBlank { "Android device" }
    "trusted-devices" -> trustedDeviceCountLabel(controller.accountTrustedDevices.size)
    "password" -> "Requires current password"
    "totp" -> if (controller.accountTwoFactorEnabled) "Enabled" else "Disabled"
    "delete" -> "Permanent account removal"
    else -> "Account"
  }

@Composable
private fun AccountEmailPanel(controller: NotesController) {
  MiniField(controller.accountEmail, "Email", Modifier.fillMaxWidth()) {
    controller.accountEmail = it
  }
  ActionRow(Icons.Outlined.Check, "Save email") { controller.saveAccountProfile() }
  ActionRow(Icons.Outlined.Close, "Cancel") { controller.closeAccountPanel() }
}

@Composable
private fun DeviceNameSettings(controller: NotesController) {
  if (controller.deviceNameEditing) {
    MiniField(controller.deviceNameValue, "Device name", Modifier.fillMaxWidth()) {
      controller.deviceNameValue = it
      controller.deviceNameError = ""
    }
    ActionRow(Icons.Outlined.Check, "Save device") { controller.saveDeviceName() }
    ActionRow(Icons.Outlined.Close, "Cancel") { controller.cancelDeviceNameEdit() }
  } else {
    GlassPanel(Modifier.fillMaxWidth()) {
      Row(
        Modifier.fillMaxWidth().padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Column(Modifier.weight(1f)) {
          Text(
            "This device",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
          )
          Text(
            controller.currentDeviceName.ifBlank { "Android device" },
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        SmallTextButton("Rename") { controller.startDeviceNameEdit() }
      }
    }
  }
}

@Composable
private fun TrustedDevicesSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    InfoTile(
      "Trusted-device sign-in",
      trustedDeviceCountLabel(controller.accountTrustedDevices.size),
      "Removing trust stops future 2FA-code sign-in without a password. Active sessions stay signed in.",
    )
    if (controller.accountTrustedDevices.isEmpty()) {
      InfoTile("Trusted devices", "None", "Sign in with a password to trust this device")
    } else {
      controller.accountTrustedDevices.forEach { device ->
        GlassPanel(Modifier.fillMaxWidth()) {
          Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
          ) {
            Column(Modifier.weight(1f)) {
              Text(
                device.deviceName,
                fontSize = AppTextSize.Body,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
              Text(
                "${if (device.current) "This device" else "Last used"} - ${formatTrustedDeviceTime(device.lastUsedAt)}",
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
                fontSize = AppTextSize.Label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
            SmallTextButton("Remove") { controller.revokeTrustedDevice(device.deviceId) }
          }
        }
      }
    }
  }
}

@Composable
private fun PasswordSettingsPanel(controller: NotesController) {
  PasswordField(controller.currentPasswordValue, "Current password") {
    controller.currentPasswordValue = it
  }
  PasswordField(controller.newPasswordValue, "New password") { controller.newPasswordValue = it }
  PasswordField(controller.confirmPasswordValue, "Confirm password") {
    controller.confirmPasswordValue = it
  }
  ActionRow(Icons.Outlined.Check, "Change password") { controller.changePassword() }
  ActionRow(Icons.Outlined.Close, "Cancel") { controller.closeAccountPanel() }
}

@Composable
private fun TotpSettingsPanel(controller: NotesController) {
  if (!controller.accountTwoFactorEnabled) {
    TotpQrCode(controller.accountTotpUrl)
    MiniField(controller.accountTotpSecret, "Authenticator secret", Modifier.fillMaxWidth()) {
      controller.accountTotpSecret = it
    }
    SelectionContainer {
      Text(
        controller.accountTotpUrl,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
      )
    }
  }
  PasswordField(controller.accountTotpPasswordValue, "Current password") {
    controller.accountTotpPasswordValue = it
  }
  MiniField(controller.accountTotpCodeValue, "Authenticator code", Modifier.fillMaxWidth()) {
    controller.accountTotpCodeValue = it
  }
  ActionRow(
    Icons.Outlined.Check,
    if (controller.accountTwoFactorEnabled) "Disable authenticator 2FA"
    else "Enable authenticator 2FA",
  ) {
    controller.saveTotp()
  }
  ActionRow(Icons.Outlined.Close, "Cancel") { controller.closeAccountPanel() }
}

@Composable
private fun DeleteAccountPanel(controller: NotesController) {
  InfoTile(
    "Delete account",
    "Permanent",
    "Remote account data will be removed after your password is confirmed.",
    valueColor = MaterialTheme.colorScheme.error,
  )
  PasswordField(controller.deletePasswordValue, "Password") { controller.deletePasswordValue = it }
  ActionRow(Icons.Outlined.Delete, "Delete account") { controller.deleteAccount() }
  ActionRow(Icons.Outlined.Close, "Cancel") { controller.closeAccountPanel() }
}

@Composable
private fun SyncSettings(controller: NotesController) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    SettingsChoiceGroup("Status") {
      SyncStatusTile(controller)
      InfoTile(
        "Pending local changes",
        controller.pendingSyncCount.toString(),
        pendingSyncDetail(controller.pendingSyncCount),
        valueColor = syncStatusColor(if (controller.pendingSyncCount > 0) "Pending" else "Saved"),
      )
      InfoTile("Last sync", controller.lastSyncPassTitle, controller.lastSyncPassDetail)
      if (controller.remoteSyncEnabled || controller.remoteSyncError.isNotBlank()) {
        InfoTile(
          "Remote worker",
          controller.remoteSyncState,
          controller.remoteSyncError.ifBlank { "Remote worker status from the last check" },
          valueColor = syncStatusColor(controller.remoteSyncState),
        )
      }
    }

    SettingsChoiceGroup("Server") {
      InfoTile("Installed API URL", BuildConfig.DEFAULT_API_BASE_URL, buildApiDetail())
      InfoTile(
        "Current API URL",
        controller.serverApiBaseUrl.ifBlank { controller.apiBaseUrl },
        serverApiDetail(controller),
      )
      InfoTile("Remote database", remoteDatabaseValue(controller), remoteDatabaseDetail(controller))
      MiniField(controller.apiBaseUrl, "Author API URL", Modifier.fillMaxWidth()) {
        controller.apiBaseUrl = it
      }
      ActionRow(Icons.Outlined.Check, "Save API URL") { controller.saveApiBaseUrl() }
      ActionRow(Icons.Outlined.Settings, "Use installed API") { controller.useBuildApiBaseUrl() }
      ActionRow(Icons.Outlined.Refresh, "Check API") {
        controller.refreshServerConfig(showNotification = true)
      }
    }

    SettingsChoiceGroup("Troubleshooting") {
      SyncDebugTile(controller)
      ActionRow(Icons.Outlined.Delete, "Clear diagnostic log") { controller.clearDebugLog() }
    }

    SettingsChoiceGroup("Actions") {
      ActionRow(Icons.Outlined.Download, "Check for updates") { controller.checkForUpdates() }
      if (controller.hasToken) {
        ActionRow(
          Icons.Outlined.Refresh,
          if (controller.isSyncing) "Syncing" else "Sync now",
          enabled = !controller.isSyncing,
        ) {
          controller.syncNow()
        }
      } else {
        ActionRow(Icons.AutoMirrored.Outlined.Login, "Sign in to sync") { controller.openLogin() }
      }
    }
  }
}

private fun pendingSyncDetail(count: Int): String =
  if (count == 1) "1 local change queued" else "$count local changes queued"

@Composable
private fun SyncStatusTile(controller: NotesController) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp)) {
      Text(
        "Status",
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        SyncActivityIndicator(controller.isSyncing)
        SyncStatusText(controller.syncLabel, modifier = Modifier.weight(1f), maxLines = 2)
      }
      if (controller.syncDetail.isNotBlank()) {
        Text(
          controller.syncDetail,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
          maxLines = 3,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

private fun buildApiDetail(): String =
  if (BuildConfig.DEFAULT_API_BASE_URL_CONFIGURED) {
    "Bundled with this Android build"
  } else {
    "Local emulator default. Set AUTHOR_API_URL for a real build."
  }

private fun serverApiDetail(controller: NotesController): String =
  controller.serverConfigError.ifBlank {
    "Reported by the Author API. Database credentials stay on the server."
  }

private fun remoteDatabaseValue(controller: NotesController): String =
  when {
    controller.serverRemoteDatabaseConfigured -> "Configured"
    controller.serverConfigError.isBlank() -> "Not configured"
    else -> "Unknown"
  }

private fun remoteDatabaseDetail(controller: NotesController): String =
  when {
    controller.serverConfigError.isNotBlank() -> controller.serverConfigError
    controller.serverRemoteSyncEnabled -> "Remote mirror enabled by the API server"
    controller.serverRemoteDatabaseConfigured ->
      "Remote database configured on the API server; remote sync disabled"
    else -> "Configure remote database credentials on the API server"
  }

@Composable
private fun SyncDebugTile(controller: NotesController) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(
        "Last sync error",
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
      Text(controller.syncDebugTitle, fontWeight = FontWeight.SemiBold)
      Text(
        controller.syncDebugDetail,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
      )
      SelectionContainer {
        Text(
          controller.syncDebugLog,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
          fontFamily = FontFamily.Monospace,
          fontSize = AppTextSize.Debug,
          lineHeight = 15.sp,
        )
      }
      Text(
        "Diagnostics",
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
      Text(controller.appDebugTitle, fontWeight = FontWeight.SemiBold)
      Text(
        controller.appDebugDetail,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
      )
      SelectionContainer {
        Text(
          controller.appDebugLog,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
          fontFamily = FontFamily.Monospace,
          fontSize = AppTextSize.Debug,
          lineHeight = 15.sp,
        )
      }
    }
  }
}

@Composable
private fun DataSettings(controller: NotesController, onExport: () -> Unit, onImport: () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    ActionRow(
      Icons.Outlined.Download,
      if (controller.isArchiveBusy) "Working" else "Export Markdown ZIP",
    ) {
      if (!controller.isArchiveBusy) onExport()
    }
    ActionRow(
      Icons.Outlined.Upload,
      if (controller.isArchiveBusy) "Working" else "Import Markdown files",
    ) {
      if (!controller.isArchiveBusy) onImport()
    }
  }
}

@Composable
private fun AppearanceSettings(controller: NotesController) {
  val systemDark = isSystemInDarkTheme()
  val resolvedTheme = resolveThemeChoice(controller.theme, systemDark)
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    ActionRow(Icons.Outlined.FolderOpen, "Compact notes") { controller.toggleCompactView() }
    ActionRow(
      if (resolvedTheme.startsWith("dark")) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
      if (resolvedTheme.startsWith("dark")) "Light mode" else "Dark mode",
    ) {
      controller.toggleTheme(systemDark)
    }
    ThemePicker(controller)
    FontDropdown(controller)
    SettingsStepper("Text size", "${controller.editorTextSize.toInt()}sp") {
      GlassIcon(Icons.Outlined.ZoomOut, "Smaller text", enabled = controller.editorTextSize > 14f) {
        controller.adjustEditorTextSize(-1f)
      }
      GlassIcon(Icons.Outlined.ZoomIn, "Larger text", enabled = controller.editorTextSize < 22f) {
        controller.adjustEditorTextSize(1f)
      }
    }
    SettingsStepper(
      "Line height",
      String.format(Locale.ROOT, "%.2f", controller.editorLineHeight),
    ) {
      GlassIcon(
        Icons.Outlined.ZoomOut,
        "Tighter lines",
        enabled = controller.editorLineHeight > 1.35f,
      ) {
        controller.adjustEditorLineHeight(-0.05f)
      }
      GlassIcon(
        Icons.Outlined.ZoomIn,
        "Looser lines",
        enabled = controller.editorLineHeight < 2.1f,
      ) {
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
private fun ThemePicker(controller: NotesController) {
  SettingsChoiceGroup("Theme") {
    ThemeChoices.forEach { choice ->
      ThemeChoiceRow(choice, active = controller.theme == choice.value) {
        controller.setThemeChoice(choice.value)
      }
    }
  }
}

@Composable
private fun ThemeChoiceRow(choice: ThemeChoice, active: Boolean, onClick: () -> Unit) {
  val background =
    if (active) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.52f)
    else Color.Transparent
  Surface(
    modifier =
      Modifier.fillMaxWidth()
        .semantics {
          contentDescription = choice.label
          stateDescription = if (active) "Selected" else "Not selected"
        }
        .clickable(onClick = onClick),
    color = background,
    contentColor = MaterialTheme.colorScheme.onSurface,
    shape = RoundedCornerShape(8.dp),
  ) {
    Row(
      Modifier.heightIn(min = 42.dp).padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      ThemeSwatch(choice.value)
      Column(Modifier.weight(1f)) {
        Text(
          choice.label,
          fontSize = AppTextSize.Body,
          fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        if (choice.value == "system") {
          Text(
            "Follows device",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
      Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
        if (active) {
          Icon(Icons.Outlined.Check, null, modifier = Modifier.size(16.dp))
        }
      }
    }
  }
}

@Composable
private fun ThemeSwatch(theme: String) {
  val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.62f)
  Surface(
    modifier = Modifier.size(18.dp),
    shape = CircleShape,
    color = if (theme == "system") Color.Transparent else themeDotColor(theme),
    border = BorderStroke(1.dp, borderColor),
  ) {
    if (theme == "system") {
      Canvas(Modifier.fillMaxSize()) {
        drawArc(Color.White, startAngle = 90f, sweepAngle = 180f, useCenter = true)
        drawArc(Color(0xFF151515), startAngle = -90f, sweepAngle = 180f, useCenter = true)
        drawCircle(borderColor, style = Stroke(width = 1.dp.toPx()))
      }
    }
  }
}

@Composable
private fun TotpQrCode(value: String) {
  val matrix =
    remember(value) {
      if (value.isBlank()) {
        null
      } else {
        runCatching {
            QRCodeWriter()
              .encode(
                value,
                BarcodeFormat.QR_CODE,
                1,
                1,
                mapOf<EncodeHintType, Any>(
                  EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                  EncodeHintType.MARGIN to 3,
                ),
              )
          }
          .getOrNull()
      }
    } ?: return

  Surface(
    modifier = Modifier.semantics { contentDescription = "Authenticator setup QR code" },
    color = Color.White,
    contentColor = Color.Black,
    shape = RoundedCornerShape(8.dp),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Canvas(Modifier.size(190.dp).padding(12.dp)) {
      drawRect(Color.White)
      val moduleSize = minOf(size.width / matrix.width, size.height / matrix.height)
      val width = moduleSize * matrix.width
      val height = moduleSize * matrix.height
      val left = (size.width - width) / 2f
      val top = (size.height - height) / 2f

      for (y in 0 until matrix.height) {
        for (x in 0 until matrix.width) {
          if (matrix[x, y]) {
            drawRect(
              Color.Black,
              topLeft = Offset(left + x * moduleSize, top + y * moduleSize),
              size = Size(moduleSize, moduleSize),
            )
          }
        }
      }
    }
  }
}

@Composable
private fun FontDropdown(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  val selected = FontChoices.find { it.value == controller.editorFont } ?: FontChoices.first()

  SettingsChoiceGroup("Font") {
    Box {
      Surface(
        modifier = Modifier.fillMaxWidth().clickable { open = true },
        color = Color.Transparent,
        shape = RoundedCornerShape(8.dp),
      ) {
        Row(
          Modifier.heightIn(min = 42.dp).padding(horizontal = 12.dp, vertical = 8.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          Text(
            selected.label,
            modifier = Modifier.weight(1f),
            fontSize = AppTextSize.Body,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          Icon(
            Icons.Outlined.ExpandMore,
            null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.58f),
          )
        }
      }
      AppDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        FontChoices.forEach { choice ->
          AppDropdownMenuItem(
            label = choice.label,
            leadingIcon = { MenuCheck(controller.editorFont == choice.value) },
            onClick = {
              controller.chooseEditorFont(choice.value)
              open = false
            },
          )
        }
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
      fontSize = AppTextSize.Label,
      fontWeight = FontWeight.SemiBold,
    )
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
  }
}

@Composable
private fun SettingsStepper(
  label: String,
  value: String,
  controls: @Composable RowScope.() -> Unit,
) {
  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Column(Modifier.weight(1f)) {
      Text(label, fontSize = AppTextSize.Body, fontWeight = FontWeight.SemiBold)
      Text(
        value,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
      )
    }
    controls()
  }
}

private fun themeDotColor(theme: String): Color =
  when (theme) {
    "light-mint" -> Color(0xFF527E5F)
    "light-rose" -> Color(0xFF985966)
    "light-lavender" -> Color(0xFF655B91)
    "dark" -> Color(0xFF202020)
    "dark-mint" -> Color(0xFFA7D7B4)
    "dark-rose" -> Color(0xFFE7B1BC)
    "dark-lavender" -> Color(0xFFC8BEEF)
    else -> Color(0xFFF8F7F3)
  }

private fun formatTrustedDeviceTime(value: String): String =
  value.ifBlank { null }?.let { formatDateTime(it) } ?: "Recently"
