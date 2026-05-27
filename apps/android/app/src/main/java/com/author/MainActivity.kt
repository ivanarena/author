package com.author

import android.Manifest
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
      )
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
}
