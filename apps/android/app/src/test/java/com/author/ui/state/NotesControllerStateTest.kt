package com.author.ui.state

import org.junit.Assert.assertEquals
import org.junit.Test

class NotesControllerStateTest {
  @Test
  fun compactEditorSyncStatusUsesShortSuccessLabels() {
    assertEquals(
      EditorSyncStatus("Synced", EditorSyncTone.Success),
      status(hasToken = true, remoteSyncEnabled = true),
    )
    assertEquals(EditorSyncStatus("Changes saved", EditorSyncTone.Success), status())
  }

  @Test
  fun compactEditorSyncStatusUsesNeutralLabelsWhileWorkIsPending() {
    assertEquals(
      EditorSyncStatus("Saving", EditorSyncTone.Neutral),
      status(noteStatus = "pending", pendingSyncCount = 1),
    )
    assertEquals(EditorSyncStatus("Syncing", EditorSyncTone.Neutral), status(isSyncing = true))
    assertEquals(
      EditorSyncStatus("Unsaved draft", EditorSyncTone.Neutral),
      status(noteStatus = null),
    )
  }

  @Test
  fun compactEditorSyncStatusUsesErrorLabelsForFailures() {
    assertEquals(
      EditorSyncStatus("Conflict", EditorSyncTone.Error),
      status(noteStatus = "conflict", conflictCount = 1),
    )
    assertEquals(
      EditorSyncStatus("Sync failed", EditorSyncTone.Error),
      status(remoteSyncState = "error"),
    )
  }

  private fun status(
    noteStatus: String? = "synced",
    hasToken: Boolean = false,
    isSyncing: Boolean = false,
    pendingSyncCount: Int = 0,
    conflictCount: Int = 0,
    remoteSyncEnabled: Boolean = false,
    remoteSyncState: String = "idle",
  ): EditorSyncStatus =
    compactEditorSyncStatus(
      noteStatus = noteStatus,
      hasToken = hasToken,
      isSyncing = isSyncing,
      pendingSyncCount = pendingSyncCount,
      conflictCount = conflictCount,
      remoteSyncEnabled = remoteSyncEnabled,
      remoteSyncState = remoteSyncState,
    )
}
