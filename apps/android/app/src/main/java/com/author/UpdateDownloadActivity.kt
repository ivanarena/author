package com.author

import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.net.toUri
import com.author.core.DebugLogStore

class UpdateDownloadActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    openDownload(intent?.getStringExtra(EXTRA_DOWNLOAD_URL))
    finish()
  }

  private fun openDownload(rawUrl: String?) {
    val downloadUrl = rawUrl?.takeIf { it.isNotBlank() } ?: BuildConfig.UPDATE_DOWNLOAD_URL
    val uri = downloadUrl.toUri()
    val scheme = uri.scheme?.lowercase()
    if (scheme != "https" && scheme != "http") {
      DebugLogStore.record(this, "warn", "Update download", "Ignored unsupported URL", downloadUrl)
      return
    }

    val viewIntent =
      Intent(Intent.ACTION_VIEW, uri)
        .addCategory(Intent.CATEGORY_BROWSABLE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val chooser =
      Intent.createChooser(viewIntent, getString(R.string.update_download_chooser_title))
    runCatching { startActivity(chooser) }
      .onFailure {
        DebugLogStore.record(
          this,
          "error",
          "Update download",
          "Could not open update URL",
          it.stackTraceToString(),
        )
      }
  }

  companion object {
    private const val EXTRA_DOWNLOAD_URL = "com.author.extra.UPDATE_DOWNLOAD_URL"

    fun pendingIntent(context: Context, downloadUrl: String): PendingIntent {
      val intent =
        Intent()
          .setComponent(ComponentName(context, UpdateDownloadActivity::class.java))
          .setPackage(context.packageName)
          .putExtra(EXTRA_DOWNLOAD_URL, downloadUrl)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
