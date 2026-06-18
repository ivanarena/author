package com.author.ui.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.author.core.LocalConflict
import com.author.ui.common.*
import com.author.ui.state.NotesController
import com.author.ui.theme.AppTextSize

@Composable
internal fun LoginDialog(controller: NotesController) {
  AppModal(
    onDismissRequest = { if (!controller.isLoggingIn) controller.loginOpen = false },
    dismissOnBackPress = !controller.isLoggingIn,
    dismissOnClickOutside = !controller.isLoggingIn,
  ) {
    AppModalTitle(
      if (controller.authMode == "signup") "Create account" else "Sign in",
      onDismiss = { if (!controller.isLoggingIn) controller.loginOpen = false },
      dismissEnabled = !controller.isLoggingIn,
    )
    AuthModeTabs(controller)
    MiniField(
      controller.loginUsernameValue,
      if (controller.authMode == "signup") "Username" else "Username or email",
      Modifier.fillMaxWidth(),
      keyboardOptions =
        KeyboardOptions(
          autoCorrectEnabled = false,
          keyboardType =
            if (controller.authMode == "signup") KeyboardType.Ascii else KeyboardType.Email,
        ),
    ) {
      controller.loginUsernameValue = it
      controller.loginError = ""
    }
    if (controller.authMode == "signup") {
      MiniField(
        controller.signupEmailValue,
        "Email",
        Modifier.fillMaxWidth(),
        keyboardOptions =
          KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Email),
      ) {
        controller.signupEmailValue = it
        controller.loginError = ""
      }
    }
    PasswordField(
      controller.loginPasswordValue,
      if (controller.authMode == "signup" || !controller.deviceOtpLoginAvailable) "Password"
      else "Password optional",
    ) {
      controller.loginPasswordValue = it
      controller.loginError = ""
    }
    if (controller.authMode == "signup") {
      PasswordField(controller.signupConfirmPasswordValue, "Confirm password") {
        controller.signupConfirmPasswordValue = it
        controller.loginError = ""
      }
    } else {
      MiniField(
        controller.loginTotpCodeValue,
        "Authenticator code",
        Modifier.fillMaxWidth(),
        keyboardOptions =
          KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.NumberPassword),
      ) {
        controller.loginTotpCodeValue = it
        controller.loginError = ""
      }
    }
    if (controller.loginError.isNotBlank()) {
      Text(
        controller.loginError,
        color = MaterialTheme.colorScheme.error,
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
    }
    LoginDialogActions(controller)
  }
}

@Composable
private fun AuthModeTabs(controller: NotesController) {
  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(18.dp),
    color = rowColor(),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = 0.72f)),
  ) {
    Row(Modifier.fillMaxWidth().padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      AuthModeTab(
        label = "Sign in",
        active = controller.authMode == "signin",
        enabled = !controller.isLoggingIn,
        modifier = Modifier.weight(1f),
      ) {
        controller.chooseAuthMode("signin")
      }
      if (controller.signupEnabled) {
        AuthModeTab(
          label = "Sign up",
          active = controller.authMode == "signup",
          enabled = !controller.isLoggingIn,
          modifier = Modifier.weight(1f),
        ) {
          controller.chooseAuthMode("signup")
        }
      }
    }
  }
}

@Composable
private fun AuthModeTab(
  label: String,
  active: Boolean,
  enabled: Boolean,
  modifier: Modifier = Modifier,
  onClick: () -> Unit,
) {
  val contentColor =
    if (active) MaterialTheme.colorScheme.onSurface
    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.62f)
  Surface(
    modifier =
      modifier
        .heightIn(min = 40.dp)
        .clip(RoundedCornerShape(14.dp))
        .clickable(enabled = enabled, onClick = onClick),
    shape = RoundedCornerShape(14.dp),
    color = if (active) dialogContainerColor() else Color.Transparent,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Box(
      Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp),
      contentAlignment = Alignment.Center,
    ) {
      Text(
        label,
        color = contentColor,
        fontSize = AppTextSize.Body,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

@Composable
private fun LoginDialogActions(controller: NotesController) {
  Row(
    Modifier.fillMaxWidth().padding(top = 2.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    ModalActionButton(
      label = "Cancel",
      enabled = !controller.isLoggingIn,
      modifier = Modifier.weight(1f),
    ) {
      controller.loginOpen = false
    }
    ModalActionButton(
      label = authSubmitLabel(controller),
      primary = true,
      loading = controller.isLoggingIn,
      enabled = !controller.isLoggingIn && !controller.isArchiveBusy,
      modifier = Modifier.weight(1f),
    ) {
      controller.submitLogin()
    }
  }
}

private fun authSubmitLabel(controller: NotesController): String =
  if (controller.isLoggingIn) {
    if (controller.authMode == "signup") "Creating sync account..." else "Signing in to sync..."
  } else if (controller.authMode == "signup") {
    "Create account"
  } else {
    "Sign in to sync"
  }

@Composable
internal fun SignupRecoveryDialog(controller: NotesController, onSaveRecoveryKit: () -> Unit) {
  val clipboard = LocalClipboardManager.current
  val recoveryMessage = controller.signupRecoveryMessage
  AppModal(onDismissRequest = {}, dismissOnBackPress = false, dismissOnClickOutside = false) {
    AppModalTitle("Save recovery key")
    Text(
      recoveryMessage.ifBlank { "Save this key and recovery kit before continuing." },
      color =
        if (recoveryMessage.isBlank()) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.62f)
        else MaterialTheme.colorScheme.primary,
      fontSize = AppTextSize.Body,
      fontWeight = if (recoveryMessage.isBlank()) FontWeight.Normal else FontWeight.SemiBold,
    )
    GlassPanel(Modifier.fillMaxWidth()) {
      Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
          "Recovery key",
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
          fontWeight = FontWeight.SemiBold,
        )
        SelectionContainer {
          Text(
            if (controller.signupRecoveryCodeVisible) {
              controller.signupRecoveryCodeValue
            } else {
              "Recovery key hidden"
            },
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = AppTextSize.Label,
            fontWeight = FontWeight.Medium,
          )
        }
      }
    }
    ModalActionButton("Copy key") {
      clipboard.setText(AnnotatedString(controller.signupRecoveryCodeValue))
      controller.signupRecoveryMessage = "Recovery key copied"
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ModalActionButton(
        if (controller.signupRecoveryCodeVisible) "Hide key" else "Show key",
        modifier = Modifier.weight(1f),
      ) {
        controller.signupRecoveryCodeVisible = !controller.signupRecoveryCodeVisible
      }
      ModalActionButton("Save kit", modifier = Modifier.weight(1f)) { onSaveRecoveryKit() }
    }
    RecoveryConfirmRow(controller)
    ModalActionButton("Done", primary = true, enabled = controller.signupRecoverySaved) {
      controller.completeSignupRecoveryPrompt()
    }
  }
}

@Composable
private fun RecoveryConfirmRow(controller: NotesController) {
  Surface(
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)),
    color = rowColor(),
    shape = RoundedCornerShape(16.dp),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = 0.72f)),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .clickable { controller.signupRecoverySaved = !controller.signupRecoverySaved }
        .padding(horizontal = 10.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Checkbox(
        checked = controller.signupRecoverySaved,
        onCheckedChange = { controller.signupRecoverySaved = it },
        colors = appCheckboxColors(),
      )
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
          "I saved the recovery key and kit",
          color = MaterialTheme.colorScheme.onSurface,
          fontSize = AppTextSize.Body,
          fontWeight = FontWeight.SemiBold,
        )
        Text(
          "They are needed together if you lose password access.",
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
        )
      }
    }
  }
}

@Composable
internal fun ConflictDialog(controller: NotesController, conflict: LocalConflict) {
  val noteConflict = conflict.noteConflict
  val notebookConflict = conflict.notebookConflict

  AppModal(onDismissRequest = {}, dismissOnBackPress = false, dismissOnClickOutside = false) {
    AppModalTitle("Sync conflict")
    Text(
      if (conflict.reason == "duplicate_name")
        "A notebook with this name already exists. Keep the existing notebook or keep the local one as a renamed copy."
      else "Choose which version to keep. Both versions are preserved until you decide."
    )
    val localName =
      noteConflict?.local?.deviceName ?: notebookConflict?.local?.deviceName ?: "Local"
    val localPreview =
      noteConflict?.local?.previewText ?: notebookConflict?.local?.previewText ?: ""
    val remoteName =
      noteConflict?.remote?.deviceName ?: notebookConflict?.remote?.deviceName ?: "Remote"
    val remotePreview =
      noteConflict?.remote?.previewText ?: notebookConflict?.remote?.previewText ?: ""
    InfoTile(localName, localPreview, "")
    InfoTile(remoteName, remotePreview, "")
    if (conflict.reason == "duplicate_name") {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ModalActionButton("Keep local copy", modifier = Modifier.weight(1f), primary = true) {
          controller.resolveConflict("keep-local")
        }
        ModalActionButton("Keep existing", modifier = Modifier.weight(1f)) {
          controller.resolveConflict("keep-remote")
        }
      }
    } else {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ModalActionButton("Keep newer", modifier = Modifier.weight(1f), primary = true) {
          controller.resolveConflict("keep-newer")
        }
        ModalActionButton("Keep older", modifier = Modifier.weight(1f)) {
          controller.resolveConflict("keep-older")
        }
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ModalActionButton("Keep local", modifier = Modifier.weight(1f)) {
          controller.resolveConflict("keep-local")
        }
        ModalActionButton("Keep remote", modifier = Modifier.weight(1f)) {
          controller.resolveConflict("keep-remote")
        }
      }
      ModalActionButton("Duplicate both") { controller.resolveConflict("duplicate-both") }
    }
  }
}

@Composable
internal fun NotificationStack(controller: NotesController) {
  if (controller.notifications.isEmpty()) return

  Popup(alignment = Alignment.TopCenter, properties = PopupProperties(focusable = false)) {
    Column(
      Modifier.fillMaxWidth().padding(top = 8.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      controller.notifications.forEach { notification ->
        NotificationSurface(notification.kind, Modifier.fillMaxWidth().widthIn(max = 420.dp)) {
          NotificationContent(notification, controller)
        }
      }
    }
  }
}

@Composable
private fun NotificationContent(notification: AppNotification, controller: NotesController) {
  val colors = notificationColors(notification.kind)
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 11.dp),
    verticalAlignment = Alignment.Top,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Box(Modifier.padding(top = 4.dp).size(9.dp).clip(CircleShape).background(colors.accent))
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        notification.title,
        color = colors.content,
        fontWeight = FontWeight.SemiBold,
        fontSize = AppTextSize.Body,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (notification.message.isNotBlank()) {
        Text(
          notification.message,
          color = colors.content.copy(alpha = 0.72f),
          fontSize = AppTextSize.Label,
          lineHeight = AppTextSize.Body,
          maxLines = 3,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    if (notification.actionLabel.isNotBlank()) {
      TextButton(onClick = { controller.runNotificationAction(notification.id) }) {
        Text(
          notification.actionLabel,
          color = colors.content,
          fontWeight = FontWeight.SemiBold,
          fontSize = AppTextSize.Label,
          maxLines = 1,
        )
      }
    }
    IconButton(
      onClick = { controller.dismissNotification(notification.id) },
      modifier = Modifier.size(32.dp),
    ) {
      Icon(
        Icons.Outlined.Close,
        "Dismiss",
        modifier = Modifier.size(17.dp),
        tint = colors.content.copy(alpha = 0.68f),
      )
    }
  }
}

@Composable
private fun NotificationSurface(
  kind: String,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  val colors = notificationColors(kind)
  Surface(
    modifier = modifier.padding(horizontal = 12.dp),
    shape = RoundedCornerShape(18.dp),
    color = colors.background,
    border = BorderStroke(1.dp, colors.border),
    tonalElevation = 0.dp,
    shadowElevation = 14.dp,
    contentColor = colors.content,
    content = content,
  )
}

@Composable
private fun notificationColors(kind: String): NotificationColors {
  val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
  val surface = if (dark) Color(0xFF202020) else Color(0xFFFFFFFF)
  val content = if (dark) Color(0xFFF4F4F2) else Color(0xFF202020)
  val accent =
    when (kind) {
      "error" -> if (dark) Color(0xFFFFB4AB) else Color(0xFFBA1A1A)
      "success" -> if (dark) Color(0xFF9AD7AA) else Color(0xFF2F7D52)
      else -> MaterialTheme.colorScheme.primary
    }
  return NotificationColors(
    background = surface,
    content = content,
    accent = accent,
    border = accent.copy(alpha = if (kind == "error") 0.5f else 0.34f),
  )
}

private data class NotificationColors(
  val background: Color,
  val content: Color,
  val accent: Color,
  val border: Color,
)
