package com.author

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import com.author.core.NotesRepository
import com.author.ui.app.AuthorApp
import com.author.ui.state.NotesController

class MainActivity : ComponentActivity() {
  private lateinit var controller: NotesController
  private var appLockAuthenticating = false

  private val notificationPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

  private val exportLauncher =
    registerForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri: Uri?
      ->
      controller.completeMarkdownExport(uri, contentResolver)
    }

  private val importLauncher =
    registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
      controller.importMarkdownUris(uris, contentResolver)
    }

  private val appUnlockLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      appLockAuthenticating = false
      if (result.resultCode == Activity.RESULT_OK) {
        controller.unlockApp()
      } else {
        controller.appLockAuthenticationFailed()
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestNotificationPermission()
    enableEdgeToEdge()
    setContent {
      val scope = rememberCoroutineScope()
      val notesController = remember { NotesController(NotesRepository(applicationContext), scope) }

      controller = notesController
      LaunchedEffect(Unit) { notesController.initialize() }
      AuthorApp(
        controller = notesController,
        onExport = { notesController.prepareMarkdownExport { exportLauncher.launch(it) } },
        onImport = {
          importLauncher.launch(arrayOf("text/markdown", "text/plain", "application/octet-stream"))
        },
        onUnlockApp = { requestAppUnlock() },
      )
    }
  }

  override fun onStop() {
    super.onStop()
    if (::controller.isInitialized && !appLockAuthenticating) {
      controller.lockAppIfEnabled()
    }
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    )
      return

    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  @Suppress("DEPRECATION")
  private fun requestAppUnlock() {
    if (!::controller.isInitialized || appLockAuthenticating) return
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (keyguard?.isDeviceSecure != true) {
      controller.appLockUnavailable()
      return
    }
    val intent =
      keyguard.createConfirmDeviceCredentialIntent(
        "Unlock Author",
        "Use this device's screen lock to reopen notes.",
      )
    if (intent == null) {
      controller.appLockUnavailable()
      return
    }
    appLockAuthenticating = true
    controller.prepareAppUnlock()
    appUnlockLauncher.launch(intent)
  }
}
