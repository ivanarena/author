package com.author.core

import android.content.Context
import android.database.sqlite.SQLiteDatabaseLockedException
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

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

    fun enqueue(context: Context) {
      val request =
        OneTimeWorkRequestBuilder<SyncWorker>()
          .setConstraints(
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
          )
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build()

      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
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
