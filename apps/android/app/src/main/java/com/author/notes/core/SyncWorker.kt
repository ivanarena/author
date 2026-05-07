package com.author.notes.core

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

class SyncWorker(
  appContext: Context,
  params: WorkerParameters
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val repository = NotesRepository(applicationContext)
    val token = repository.getStoredSession()?.token ?: return Result.success()
    if (!repository.hasStoredEncryptionKeyMaterial()) return Result.success()

    return runCatching {
      repository.runSync(token)
    }.fold(
      onSuccess = { Result.success() },
      onFailure = { error ->
        if (error is AuthException) Result.success() else Result.retry()
      }
    )
  }

  companion object {
    private const val UNIQUE_WORK_NAME = "author-notes-sync"

    fun enqueue(context: Context) {
      val request = OneTimeWorkRequestBuilder<SyncWorker>()
        .setConstraints(
          Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        )
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .build()

      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
    }
  }
}
