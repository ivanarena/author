package com.author.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.core.LocalConflict

@Composable
internal fun LoginDialog(controller: NotesController) {
  AlertDialog(
    onDismissRequest = { if (!controller.isLoggingIn) controller.loginOpen = false },
    containerColor = MaterialTheme.colorScheme.background,
    title = { Text(if (controller.authMode == "signup") "Create account" else "Sign in") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          SmallTextButton("Sign in", active = controller.authMode == "signin") {
            controller.chooseAuthMode("signin")
          }
          if (controller.signupEnabled) {
            SmallTextButton("Sign up", active = controller.authMode == "signup") {
              controller.chooseAuthMode("signup")
            }
          }
        }
        MiniField(
          controller.loginUsernameValue,
          if (controller.authMode == "signup") "Username" else "Username or email",
          Modifier.fillMaxWidth(),
        ) {
          controller.loginUsernameValue = it
          controller.loginError = ""
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
          MiniField(controller.signupEmailValue, "Email", Modifier.fillMaxWidth()) {
            controller.signupEmailValue = it
            controller.loginError = ""
          }
          PasswordField(controller.signupConfirmPasswordValue, "Confirm password") {
            controller.signupConfirmPasswordValue = it
            controller.loginError = ""
          }
        } else {
          MiniField(controller.loginTotpCodeValue, "2FA code", Modifier.fillMaxWidth()) {
            controller.loginTotpCodeValue = it
            controller.loginError = ""
          }
        }
        if (controller.loginError.isNotBlank()) {
          Text(
            controller.loginError,
            color = messageColor(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
          )
        }
      }
    },
    confirmButton = {
      TextButton(
        onClick = { controller.submitLogin() },
        enabled = !controller.isLoggingIn && !controller.isArchiveBusy,
      ) {
        Text(
          if (controller.isLoggingIn) {
            "Working"
          } else if (controller.authMode == "signup") {
            "Create account"
          } else {
            "Sign in"
          }
        )
      }
    },
    dismissButton = { TextButton(onClick = { controller.loginOpen = false }) { Text("Cancel") } },
  )
}

@Composable
internal fun ConflictDialog(controller: NotesController, conflict: LocalConflict) {
  val noteConflict = conflict.noteConflict
  val notebookConflict = conflict.notebookConflict

  AlertDialog(
    onDismissRequest = {},
    containerColor = MaterialTheme.colorScheme.background,
    title = { Text("Sync conflict") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
      }
    },
    confirmButton = {
      Column {
        if (conflict.reason == "duplicate_name") {
          Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SmallTextButton("Keep local copy") { controller.resolveConflict("keep-local") }
            SmallTextButton("Keep existing") { controller.resolveConflict("keep-remote") }
          }
        } else {
          Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SmallTextButton("Keep newer") { controller.resolveConflict("keep-newer") }
            SmallTextButton("Keep older") { controller.resolveConflict("keep-older") }
          }
          Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SmallTextButton("Keep local") { controller.resolveConflict("keep-local") }
            SmallTextButton("Keep remote") { controller.resolveConflict("keep-remote") }
            SmallTextButton("Duplicate both") { controller.resolveConflict("duplicate-both") }
          }
        }
      }
    },
  )
}

@Composable
internal fun NotificationStack(controller: NotesController) {
  Column(
    Modifier.fillMaxWidth().padding(top = 8.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    controller.notifications.forEach { notification ->
      GlassPanel(Modifier.width(360.dp)) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(
            notification.title,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            modifier = Modifier.weight(1f),
          )
          GlassIcon(Icons.Outlined.Close, "Dismiss") {
            controller.dismissNotification(notification.id)
          }
        }
        if (notification.message.isNotBlank()) {
          Text(
            notification.message,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = 12.sp,
            modifier = Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
          )
        }
      }
    }
  }
}
