package com.author.ui.state

import com.author.core.LocalNote
import com.author.core.countNotesByNotebook
import com.author.core.countWords
import com.author.core.filterNotesByAdvancedFilters
import com.author.core.filterNotesBySearch
import com.author.core.filterNotesForView
import com.author.core.groupNotes
import com.author.core.sortNotes

val NotesController.notebookCounts: Map<String, Int>
  get() = countNotesByNotebook(notes)

val NotesController.unfiledCount: Int
  get() = notebookCounts[""] ?: 0

val NotesController.favoriteCount: Int
  get() = notes.count { it.isFavorite }

val NotesController.visibleNotes: List<LocalNote>
  get() =
    sortNotes(
      filterNotesBySearch(
        filterNotesByAdvancedFilters(
          filterNotesForView(notes, trash, filterId),
          noteFilterNotebookIds,
          noteFilterDateRanges,
        ),
        searchValue,
      ),
      noteSort,
    )

val NotesController.noteFiltersActive: Boolean
  get() = noteFilterNotebookIds.isNotEmpty() || noteFilterDateRanges.isNotEmpty()

val NotesController.visibleGroups: List<Pair<String, List<LocalNote>>>
  get() = groupNotes(visibleNotes, noteSort, noteGroup)

val NotesController.selectedNotes: List<LocalNote>
  get() = (notes + trash).filter { selectedNoteIds.contains(it.id) }

val NotesController.wordCount: Int
  get() = countWords("$titleValue $bodyValue")

val NotesController.syncLabel: String
  get() =
    when {
      isSyncing -> syncActivityLabel.ifBlank { "Syncing changes" }
      conflicts.isNotEmpty() -> "${conflicts.size} conflict${if (conflicts.size == 1) "" else "s"}"
      !hasToken -> "Local only"
      pendingSyncCount > 0 -> "Waiting to sync"
      remoteSyncEnabled && remoteSyncState == "queued" -> "Remote worker queued"
      remoteSyncEnabled && (remoteSyncState == "syncing" || remoteSyncState == "unknown") ->
        "Syncing remote worker"
      remoteSyncEnabled && remoteSyncState == "error" -> "Remote worker failed"
      remoteSyncEnabled -> "All changes synced"
      else -> "All changes saved"
    }

internal enum class EditorSyncTone {
  Success,
  Neutral,
  Error,
}

internal data class EditorSyncStatus(val label: String, val tone: EditorSyncTone)

internal fun compactEditorSyncStatus(
  noteStatus: String?,
  hasToken: Boolean,
  isSyncing: Boolean,
  pendingSyncCount: Int,
  conflictCount: Int,
  remoteSyncEnabled: Boolean,
  remoteSyncState: String,
): EditorSyncStatus =
  when {
    conflictCount > 0 || noteStatus == "conflict" ->
      EditorSyncStatus("Conflict", EditorSyncTone.Error)
    remoteSyncState == "error" -> EditorSyncStatus("Sync failed", EditorSyncTone.Error)
    isSyncing -> EditorSyncStatus("Syncing", EditorSyncTone.Neutral)
    noteStatus == null -> EditorSyncStatus("Unsaved draft", EditorSyncTone.Neutral)
    noteStatus == "pending" || pendingSyncCount > 0 ->
      EditorSyncStatus("Saving", EditorSyncTone.Neutral)
    hasToken && remoteSyncEnabled -> EditorSyncStatus("Synced", EditorSyncTone.Success)
    else -> EditorSyncStatus("Changes saved", EditorSyncTone.Success)
  }

val NotesController.syncDetail: String
  get() =
    when {
      isSyncing -> syncActivityDetail
      !hasToken -> "Sign in to sync"
      remoteSyncState == "error" -> remoteSyncError
      pendingSyncCount > 0 ->
        "$pendingSyncCount local change${if (pendingSyncCount == 1) "" else "s"} queued"
      syncMessage !in
        setOf(
          "Online",
          "Saving",
          "Syncing",
          "Synced",
          "All changes saved",
          "All changes synced",
          "Local changes saved",
          "Preparing sync",
          "Pushing local changes",
          "Pulling remote changes",
          "Waiting to sync",
          "Remote worker queued",
          "Syncing remote worker",
        ) -> syncMessage
      else -> ""
    }
