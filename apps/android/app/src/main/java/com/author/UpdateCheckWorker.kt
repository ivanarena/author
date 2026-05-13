package com.author

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private const val UPDATE_CHANNEL_ID = "app_updates"
private const val UPDATE_NOTIFICATION_ID = 2001
private const val UPDATE_PREFS = "author_update_check"
private const val LAST_NOTIFIED_VERSION_CODE = "lastNotifiedVersionCode"
private const val UNIQUE_PERIODIC_WORK_NAME = "author-android-update-check"
private const val UNIQUE_STARTUP_WORK_NAME = "author-android-update-check-after-startup"

class UpdateCheckWorker(appContext: Context, params: WorkerParameters) :
  CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result =
    runCatching {
        val latest = loadLatestUpdate()
        if (latest.versionCode > BuildConfig.VERSION_CODE) {
          notifyOnce(latest)
        }
      }
      .fold(
        onSuccess = { Result.success() },
        onFailure = { if (runAttemptCount < 3) Result.retry() else Result.success() },
      )

  private fun loadLatestUpdate(): UpdateInfo {
    val connection =
      (URL(BuildConfig.UPDATE_CHECK_URL).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 15_000
        setRequestProperty("accept", "application/json,text/plain,*/*")
        setRequestProperty("user-agent", "AuthorAndroid/${BuildConfig.VERSION_NAME}")
      }

    try {
      val status = connection.responseCode
      val body = readResponse(connection, status)
      if (status !in 200..299) error("Update check failed: $status")
      return parseUpdateInfo(body)
    } finally {
      connection.disconnect()
    }
  }

  private fun parseUpdateInfo(body: String): UpdateInfo {
    val trimmed = body.trim()
    if (trimmed.startsWith("{")) {
      val json = JSONObject(trimmed)
      return UpdateInfo(
        versionCode = json.getInt("versionCode"),
        versionName = json.optString("versionName", json.getInt("versionCode").toString()),
        downloadUrl = json.optString("apkUrl", BuildConfig.UPDATE_DOWNLOAD_URL),
      )
    }

    val versionCode =
      Regex("""versionCode\s*=\s*(\d+)""").find(trimmed)?.groupValues?.get(1)?.toIntOrNull()
        ?: error("Could not find Android versionCode")
    val versionName =
      Regex("versionName\\s*=\\s*\"([^\"]+)\"").find(trimmed)?.groupValues?.get(1)
        ?: versionCode.toString()

    return UpdateInfo(versionCode, versionName, BuildConfig.UPDATE_DOWNLOAD_URL)
  }

  private fun notifyOnce(update: UpdateInfo) {
    val prefs = applicationContext.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
    if (prefs.getInt(LAST_NOTIFIED_VERSION_CODE, 0) >= update.versionCode) return

    createChannel(applicationContext)
    val manager = applicationContext.getSystemService(NotificationManager::class.java)
    if (!manager.areNotificationsEnabled()) return

    val notification =
      Notification.Builder(applicationContext, UPDATE_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher)
        .setContentTitle(applicationContext.getString(R.string.update_notification_title))
        .setContentText(
          applicationContext.getString(R.string.update_notification_body, update.versionName)
        )
        .setContentIntent(updateIntent(update.downloadUrl))
        .setAutoCancel(true)
        .build()

    manager.notify(UPDATE_NOTIFICATION_ID, notification)
    prefs.edit { putInt(LAST_NOTIFIED_VERSION_CODE, update.versionCode) }
  }

  private fun updateIntent(downloadUrl: String): PendingIntent {
    val intent =
      Intent(Intent.ACTION_VIEW, downloadUrl.ifBlank { BuildConfig.UPDATE_DOWNLOAD_URL }.toUri())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      applicationContext,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun readResponse(connection: HttpURLConnection, status: Int): String {
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    if (stream == null) return ""
    return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
  }

  companion object {
    fun schedule(context: Context) {
      val appContext = context.applicationContext
      createChannel(appContext)
      val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
      val periodic =
        PeriodicWorkRequestBuilder<UpdateCheckWorker>(
            BuildConfig.UPDATE_CHECK_INTERVAL_HOURS,
            TimeUnit.HOURS,
          )
          .setConstraints(constraints)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build()
      val startup =
        OneTimeWorkRequestBuilder<UpdateCheckWorker>()
          .setConstraints(constraints)
          .setInitialDelay(BuildConfig.UPDATE_STARTUP_DELAY_MINUTES, TimeUnit.MINUTES)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build()

      WorkManager.getInstance(appContext)
        .enqueueUniquePeriodicWork(
          UNIQUE_PERIODIC_WORK_NAME,
          ExistingPeriodicWorkPolicy.UPDATE,
          periodic,
        )
      WorkManager.getInstance(appContext)
        .enqueueUniqueWork(UNIQUE_STARTUP_WORK_NAME, ExistingWorkPolicy.KEEP, startup)
    }

    private fun createChannel(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(UPDATE_CHANNEL_ID) != null) return

      val channel =
        NotificationChannel(
            UPDATE_CHANNEL_ID,
            context.getString(R.string.update_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
          )
          .apply {
            description = context.getString(R.string.update_notification_channel_description)
          }
      manager.createNotificationChannel(channel)
    }
  }
}

private data class UpdateInfo(
  val versionCode: Int,
  val versionName: String,
  val downloadUrl: String,
)
