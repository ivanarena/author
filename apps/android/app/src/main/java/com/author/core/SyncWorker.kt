package com.author.core

import android.content.Context
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
    repository.recordDebugLog("info", "Sync worker", "Background sync started")
    val token =
      repository.getStoredSession()?.token
        ?: run {
          repository.recordDebugLog("debug", "Sync worker", "No stored session; skipping sync")
          return Result.success()
        }
    if (!repository.hasStoredEncryptionKeyMaterial()) {
      repository.recordDebugLog("warn", "Sync worker", "No encryption key material; skipping sync")
      return Result.success()
    }

    return runCatching { repository.runSync(token) }
      .fold(
        onSuccess = {
          repository.recordDebugLog("info", "Sync worker", "Background sync completed")
          Result.success()
        },
        onFailure = { error ->
          repository.recordDebugLog(
            "error",
            "Sync worker",
            "Background sync failed",
            error.stackTraceToString(),
          )
          if (error is AuthException) Result.success() else Result.retry()
        },
      )
  }

  companion object {
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
