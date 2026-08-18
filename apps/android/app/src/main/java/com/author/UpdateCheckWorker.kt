package com.author

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color
import androidx.core.content.edit
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
import com.author.core.DebugLogStore
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private const val UPDATE_CHANNEL_ID = "app_updates"
private const val UPDATE_NOTIFICATION_ID = 2001
private const val UPDATE_PREFS = "author_update_check"
private const val LAST_NOTIFIED_VERSION_CODE = "lastNotifiedVersionCode"
private const val LAST_NOTIFIED_VERSION_NAME = "lastNotifiedVersionName"
private const val UNIQUE_PERIODIC_WORK_NAME = "author-android-update-check"
private const val UNIQUE_STARTUP_WORK_NAME = "author-android-update-check-after-startup"
private const val UNIQUE_MANUAL_WORK_NAME = "author-android-update-check-now"
private const val MAX_UPDATE_RESPONSE_CHARS = 2 * 1024 * 1024

class UpdateCheckWorker(appContext: Context, params: WorkerParameters) :
  CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result =
    runCatching {
        DebugLogStore.record(applicationContext, "info", "Update worker", "Update check started")
        val latest = loadLatestUpdate()
        if (latest.isNewerThanInstalled(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)) {
          notifyOnce(latest)
          DebugLogStore.record(
            applicationContext,
            "info",
            "Update worker",
            "Update available",
            latest.versionName,
          )
        } else {
          DebugLogStore.record(
            applicationContext,
            "debug",
            "Update worker",
            "No update available",
            latest.versionName,
          )
        }
      }
      .fold(
        onSuccess = { Result.success() },
        onFailure = {
          DebugLogStore.record(
            applicationContext,
            "error",
            "Update worker",
            "Update check failed",
            it.stackTraceToString(),
          )
          if (runAttemptCount < 3) Result.retry() else Result.success()
        },
      )

  private fun loadLatestUpdate(): UpdateInfo =
    runCatching { fetchLatestUpdate(BuildConfig.UPDATE_CHECK_URL) }
      .getOrElse { primaryError ->
        val fallbackUrl = BuildConfig.UPDATE_DOWNLOAD_URL
        if (fallbackUrl.isNotBlank() && fallbackUrl != BuildConfig.UPDATE_CHECK_URL) {
          runCatching { fetchLatestUpdate(fallbackUrl) }.getOrElse { throw primaryError }
        } else {
          throw primaryError
        }
      }

  private fun fetchLatestUpdate(url: String): UpdateInfo {
    val connection =
      (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        instanceFollowRedirects = true
        connectTimeout = 15_000
        readTimeout = 15_000
        setRequestProperty("accept", "text/html,application/json,text/plain,*/*")
        setRequestProperty("user-agent", "AuthorAndroid/${BuildConfig.VERSION_NAME}")
      }

    try {
      val status = connection.responseCode
      val body = readResponse(connection, status)
      if (status !in 200..299) error("Update check failed: $status")
      return parseUpdateInfo(body, BuildConfig.UPDATE_DOWNLOAD_URL, connection.url.toString())
    } finally {
      connection.disconnect()
    }
  }

  private fun notifyOnce(update: UpdateInfo) {
    val prefs = applicationContext.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
    if (update.versionCode != null) {
      if (prefs.getInt(LAST_NOTIFIED_VERSION_CODE, 0) >= update.versionCode) return
    } else if (prefs.getString(LAST_NOTIFIED_VERSION_NAME, null) == update.versionName) {
      return
    }

    createChannel(applicationContext)
    val manager = applicationContext.getSystemService(NotificationManager::class.java)
    if (!manager.areNotificationsEnabled()) return
    val body = applicationContext.getString(R.string.update_notification_body, update.versionName)

    val notification =
      Notification.Builder(applicationContext, UPDATE_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(applicationContext.getString(R.string.update_notification_title))
        .setContentText(body)
        .setStyle(Notification.BigTextStyle().bigText(body))
        .setContentIntent(
          UpdateDownloadActivity.pendingIntent(applicationContext, update.downloadUrl)
        )
        .setColor(Color.rgb(47, 125, 82))
        .setCategory(Notification.CATEGORY_STATUS)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .build()

    manager.notify(UPDATE_NOTIFICATION_ID, notification)
    prefs.edit {
      update.versionCode?.let { putInt(LAST_NOTIFIED_VERSION_CODE, it) }
      putString(LAST_NOTIFIED_VERSION_NAME, update.versionName)
    }
  }

  private fun readResponse(connection: HttpURLConnection, status: Int): String {
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    if (stream == null) return ""
    return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
      val buffer = CharArray(8192)
      val builder = StringBuilder()
      while (true) {
        val count = reader.read(buffer)
        if (count == -1) break
        if (builder.length + count > MAX_UPDATE_RESPONSE_CHARS) {
          error("Update check response too large")
        }
        builder.append(buffer, 0, count)
      }
      builder.toString()
    }
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

    fun checkNow(context: Context) {
      val appContext = context.applicationContext
      createChannel(appContext)
      val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
      val request =
        OneTimeWorkRequestBuilder<UpdateCheckWorker>()
          .setConstraints(constraints)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build()
      WorkManager.getInstance(appContext)
        .enqueueUniqueWork(UNIQUE_MANUAL_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
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
            enableLights(true)
            lightColor = Color.rgb(47, 125, 82)
          }
      manager.createNotificationChannel(channel)
    }
  }
}

internal fun parseUpdateInfo(
  body: String,
  fallbackDownloadUrl: String,
  sourceUrl: String = fallbackDownloadUrl,
): UpdateInfo {
  val trimmed = body.trim()
  if (trimmed.startsWith("{")) {
    val json = JSONObject(trimmed)
    if (json.has("tag_name") || json.has("assets")) {
      return parseGithubRelease(json, fallbackDownloadUrl, sourceUrl)
    }

    val versionCode = json.optInt("versionCode").takeIf { it > 0 }
    val downloadUrl =
      trustedUpdateDownloadUrl(
        json.optString("apkUrl", fallbackDownloadUrl),
        fallbackDownloadUrl,
        sourceUrl,
      )
    return UpdateInfo(
      versionCode = versionCode,
      versionName = json.optString("versionName").ifBlank { versionCode?.toString().orEmpty() },
      downloadUrl = downloadUrl,
    )
  }

  parseGithubReleasePage(trimmed, fallbackDownloadUrl, sourceUrl)?.let {
    return it
  }

  val versionCode =
    Regex("""versionCode\s*=\s*(\d+)""").find(trimmed)?.groupValues?.get(1)?.toIntOrNull()
      ?: error("Could not find Android versionCode")
  val versionName =
    Regex("versionName\\s*=\\s*\"([^\"]+)\"").find(trimmed)?.groupValues?.get(1)
      ?: versionCode.toString()

  return UpdateInfo(versionCode, versionName, fallbackDownloadUrl)
}

private data class GithubReleaseLink(val tag: String, val href: String)

private fun parseGithubRelease(
  json: JSONObject,
  fallbackDownloadUrl: String,
  sourceUrl: String,
): UpdateInfo {
  val releaseName = json.optString("tag_name").ifBlank { json.optString("name") }
  val versionName = normalizeReleaseVersion(releaseName)
  val releaseUrl = json.optString("html_url", fallbackDownloadUrl)
  val assets = json.optJSONArray("assets")
  var apkUrl = ""
  if (assets != null) {
    for (index in 0 until assets.length()) {
      val asset = assets.optJSONObject(index) ?: continue
      val name = asset.optString("name")
      if (name.endsWith(".apk", ignoreCase = true) && name.contains("android", true)) {
        apkUrl = asset.optString("browser_download_url")
        break
      }
      if (apkUrl.isBlank() && name.endsWith(".apk", ignoreCase = true)) {
        apkUrl = asset.optString("browser_download_url")
      }
    }
  }
  return UpdateInfo(
    null,
    versionName,
    trustedUpdateDownloadUrl(apkUrl.ifBlank { releaseUrl }, fallbackDownloadUrl, sourceUrl),
  )
}

private fun parseGithubReleasePage(
  body: String,
  fallbackDownloadUrl: String,
  sourceUrl: String,
): UpdateInfo? {
  val tagFromUrl = githubReleaseTagFromUrl(sourceUrl)
  val releaseLink = githubReleaseLinkFromHtml(body)
  val tag = tagFromUrl ?: releaseLink?.tag ?: return null
  val versionName = normalizeReleaseVersion(tag)
  if (versionName.isBlank()) return null

  val releaseUrl =
    if (tagFromUrl != null) sourceUrl.substringBefore("?").substringBefore("#")
    else releaseLink?.let { resolveUrl(sourceUrl, it.href) }.orEmpty()
  val apkUrl = apkUrlFromGithubReleasePage(body, sourceUrl)

  return UpdateInfo(
    versionCode = null,
    versionName = versionName,
    downloadUrl =
      trustedUpdateDownloadUrl(
        apkUrl.ifBlank { releaseUrl.ifBlank { fallbackDownloadUrl } },
        fallbackDownloadUrl,
        sourceUrl,
      ),
  )
}

private fun githubReleaseTagFromUrl(url: String): String? =
  Regex("""/releases/tag/([^?#/]+)""").find(url)?.groupValues?.get(1)?.let(::decodeUrlComponent)

private fun githubReleaseLinkFromHtml(body: String): GithubReleaseLink? {
  val match =
    Regex("""href=["']([^"']*/releases/tag/([^"'?#]+)[^"']*)["']""", RegexOption.IGNORE_CASE)
      .find(body) ?: return null
  return GithubReleaseLink(
    tag = decodeUrlComponent(match.groupValues[2]),
    href = decodeHtmlAttribute(match.groupValues[1]),
  )
}

private fun apkUrlFromGithubReleasePage(body: String, sourceUrl: String): String {
  val apkLinks =
    Regex("""href=["']([^"']+\.apk(?:\?[^"']*)?)["']""", RegexOption.IGNORE_CASE)
      .findAll(body)
      .map { decodeHtmlAttribute(it.groupValues[1]) }
      .toList()
  val apk =
    apkLinks.firstOrNull { it.contains("android", ignoreCase = true) } ?: apkLinks.firstOrNull()
  return apk?.let { resolveUrl(sourceUrl, it) }.orEmpty()
}

private fun resolveUrl(baseUrl: String, href: String): String =
  runCatching { URL(URL(baseUrl), href).toString() }.getOrElse { href }

private fun decodeHtmlAttribute(value: String): String = value.replace("&amp;", "&")

private fun decodeUrlComponent(value: String): String =
  runCatching { URLDecoder.decode(value, "UTF-8") }.getOrElse { value }

private fun trustedUpdateDownloadUrl(
  candidateUrl: String,
  fallbackDownloadUrl: String,
  sourceUrl: String,
): String {
  val trustedUrls = listOf(fallbackDownloadUrl, sourceUrl)
  if (isAllowedUpdateDownloadUrl(candidateUrl, trustedUrls)) return candidateUrl
  if (isAllowedUpdateDownloadUrl(fallbackDownloadUrl, trustedUrls)) return fallbackDownloadUrl
  return ""
}

internal fun isAllowedUpdateDownloadUrl(
  downloadUrl: String,
  trustedUrls: List<String> = listOf(BuildConfig.UPDATE_DOWNLOAD_URL, BuildConfig.UPDATE_CHECK_URL),
): Boolean {
  val url = runCatching { URL(downloadUrl) }.getOrNull() ?: return false
  val protocol = url.protocol.lowercase()
  if (protocol != "https" && !(BuildConfig.DEBUG && protocol == "http")) return false
  val trustedHosts =
    trustedUrls
      .mapNotNull { trustedUrl -> runCatching { URL(trustedUrl).host.lowercase() }.getOrNull() }
      .filter { it.isNotBlank() }
      .distinct()
  if (trustedHosts.isEmpty()) return false
  val host = url.host.lowercase()
  return trustedHosts.any { trustedHost -> updateHostsMatch(host, trustedHost) }
}

private fun updateHostsMatch(host: String, trustedHost: String): Boolean =
  host == trustedHost ||
    host.endsWith(".$trustedHost") ||
    (host == "github.com" && trustedHost == "api.github.com")

internal data class UpdateInfo(
  val versionCode: Int?,
  val versionName: String,
  val downloadUrl: String,
) {
  fun isNewerThanInstalled(installedVersionCode: Int, installedVersionName: String): Boolean {
    if (versionCode != null) return versionCode > installedVersionCode
    if (versionName.isBlank()) return false
    return isVersionNameNewer(versionName, installedVersionName)
  }
}

internal fun normalizeReleaseVersion(value: String): String = stripKnownVersionPrefixes(value)

private fun normalizeVersionName(value: String): String = stripKnownVersionPrefixes(value)

private fun stripKnownVersionPrefixes(value: String): String {
  var normalized = value.trim()
  val prefixes = listOf("author-android-", "android-", "Author Android ", "v")
  var changed = true
  while (changed) {
    changed = false
    for (prefix in prefixes) {
      if (normalized.startsWith(prefix, ignoreCase = true)) {
        normalized = normalized.drop(prefix.length).trim()
        changed = true
        break
      }
    }
  }
  return normalized
}

private fun isVersionNameNewer(latest: String, installed: String): Boolean {
  val latestNormalized = normalizeVersionName(latest)
  val installedNormalized = normalizeVersionName(installed)
  val latestParts = versionParts(latestNormalized)
  val installedParts = versionParts(installedNormalized)
  if (latestParts != null && installedParts != null) {
    return compareVersionParts(latestParts, installedParts) > 0
  }
  return latestNormalized != installedNormalized
}

private fun versionParts(value: String): List<Int>? {
  val match = Regex("""^\d+(?:\.\d+)*""").find(value) ?: return null
  return match.value.split(".").mapNotNull { it.toIntOrNull() }.takeIf { it.isNotEmpty() }
}

private fun compareVersionParts(left: List<Int>, right: List<Int>): Int {
  val length = maxOf(left.size, right.size)
  for (index in 0 until length) {
    val leftPart = left.getOrElse(index) { 0 }
    val rightPart = right.getOrElse(index) { 0 }
    if (leftPart != rightPart) return leftPart.compareTo(rightPart)
  }
  return 0
}
