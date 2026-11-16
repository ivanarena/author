package com.author.core

import androidx.work.ExistingWorkPolicy
import androidx.work.WorkInfo
import org.junit.Assert.assertEquals
import org.junit.Test

class SyncWorkerPolicyTest {
  @Test
  fun immediateSyncAppendsOnceBehindARunningSync() {
    assertEquals(
      ExistingWorkPolicy.APPEND_OR_REPLACE,
      immediateSyncPolicy(listOf(WorkInfo.State.RUNNING)),
    )
    assertEquals(
      ExistingWorkPolicy.KEEP,
      immediateSyncPolicy(listOf(WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)),
    )
    assertEquals(ExistingWorkPolicy.KEEP, immediateSyncPolicy(listOf(WorkInfo.State.ENQUEUED)))
    assertEquals(ExistingWorkPolicy.KEEP, immediateSyncPolicy(listOf(WorkInfo.State.SUCCEEDED)))
    assertEquals(ExistingWorkPolicy.KEEP, immediateSyncPolicy(emptyList()))
  }
}
