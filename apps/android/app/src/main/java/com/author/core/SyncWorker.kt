package com.author.core

import android.content.Context
import android.database.sqlite.SQLiteDatabaseLockedException
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SyncWorker(appContext: Context, params: WorkerParameters) :
  CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val repository = NotesRepository(applicationContext)
    return try {
      repository.recordDebugLog("info", "Sync worker", "Background sync started")
      val token =
        repository.getStoredSession()?.token
          ?: run {
            repository.recordDebugLog("debug", "Sync worker", "No stored session; skipping sync")
            return Result.success()
          }
      if (!repository.hasStoredEncryptionKeyMaterial()) {
        repository.recordDebugLog(
          "warn",
          "Sync worker",
          "No encryption key material; skipping sync",
        )
        return Result.success()
      }

      runCatching { repository.runSync(token) }
        .fold(
          onSuccess = {
            repository.recordDebugLog("info", "Sync worker", "Background sync completed")
            Result.success()
          },
          onFailure = { error ->
            val localDatabaseBusy = error.isLocalDatabaseBusy()
            val retryLocalDatabaseBusy =
              localDatabaseBusy && runAttemptCount < LOCAL_DATABASE_BUSY_RETRY_LIMIT
            repository.recordDebugLog(
              if (localDatabaseBusy) "warn" else "error",
              "Sync worker",
              when {
                retryLocalDatabaseBusy -> "Background sync waiting; local database is busy"
                localDatabaseBusy -> "Background sync skipped; local database stayed busy"
                else -> "Background sync failed"
              },
              error.stackTraceToString(),
            )
            when {
              error is AuthException -> Result.success()
              error is SyncHttpException && !error.isRetryable() -> Result.success()
              retryLocalDatabaseBusy -> Result.retry()
              localDatabaseBusy -> Result.success()
              else -> Result.retry()
            }
          },
        )
    } finally {
      repository.close()
    }
  }

  companion object {
    private const val LOCAL_DATABASE_BUSY_RETRY_LIMIT = 3
    private const val UNIQUE_WORK_NAME = "author-sync"
    private const val IMMEDIATE_UNIQUE_WORK_NAME = "author-sync-now"

    /**
     * Background safety net after local edits. The foreground controller syncs a few seconds after
     * edits stop; this delayed run covers the app being closed first, without pushing every pause.
     */
    const val LOCAL_CHANGE_DELAY_SECONDS = 30L

    /**
     * Enqueues an immediate background sync. If one is running and none is waiting behind it, a
     * second one is appended so edits saved after the running sync read its pending records are
     * still sent; otherwise the existing request is kept, so repeated calls cannot build a chain.
     */
    suspend fun enqueueImmediate(context: Context) {
      val infos =
        withContext(Dispatchers.IO) {
          WorkManager.getInstance(context.applicationContext)
            .getWorkInfosForUniqueWork(IMMEDIATE_UNIQUE_WORK_NAME)
            .get()
        }
      val running = infos.any { it.state == WorkInfo.State.RUNNING }
      val waiting =
        infos.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
      enqueue(
        context,
        immediate = true,
        policy =
          if (running && !waiting) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,
      )
    }

    /**
     * Enqueues a background sync. A delayed request runs once [LOCAL_CHANGE_DELAY_SECONDS] after
     * the first edit it covers; an [immediate] request, used when the app leaves the foreground,
     * runs as soon as the network allows. Both share the repository sync mutex.
     */
    fun enqueue(
      context: Context,
      immediate: Boolean = false,
      policy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP,
    ) {
      val request =
        OneTimeWorkRequestBuilder<SyncWorker>()
          .setConstraints(
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
          )
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .apply { if (!immediate) setInitialDelay(LOCAL_CHANGE_DELAY_SECONDS, TimeUnit.SECONDS) }
          .build()

      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(
          if (immediate) IMMEDIATE_UNIQUE_WORK_NAME else UNIQUE_WORK_NAME,
          // A delayed request already waiting covers later edits, so it is kept.
          policy,
          request,
        )
    }
  }
}

private fun SyncHttpException.isRetryable(): Boolean =
  status == 408 || status == 429 || status >= 500

private fun Throwable.isLocalDatabaseBusy(): Boolean {
  var current: Throwable? = this
  while (current != null) {
    if (current is SQLiteDatabaseLockedException) return true
    val message = current.message.orEmpty()
    if (
      message.contains("database is locked", ignoreCase = true) ||
        message.contains("database locked", ignoreCase = true)
    ) {
      return true
    }
    current = current.cause
  }
  return false
}
