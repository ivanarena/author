package com.author.notes.ui

import com.author.notes.core.LocalNote
import com.author.notes.core.countNotesByNotebook
import com.author.notes.core.countWords
import com.author.notes.core.filterNotesBySearch
import com.author.notes.core.filterNotesForView
import com.author.notes.core.groupNotesByDateRange
import com.author.notes.core.sortNotes

val NotesController.notebookCounts: Map<String, Int>
  get() = countNotesByNotebook(notes)

val NotesController.unfiledCount: Int
  get() = notebookCounts[""] ?: 0

val NotesController.visibleNotes: List<LocalNote>
  get() = sortNotes(filterNotesBySearch(filterNotesForView(notes, trash, filterId), searchValue), noteSort)

val NotesController.visibleGroups: List<Pair<String, List<LocalNote>>>
  get() = groupNotesByDateRange(visibleNotes, noteSort)

val NotesController.selectedNotes: List<LocalNote>
  get() = (notes + trash).filter { selectedNoteIds.contains(it.id) }

val NotesController.wordCount: Int
  get() = countWords("$titleValue $bodyValue")

val NotesController.syncLabel: String
  get() = when {
    isWorkspaceLoading -> "Loading local notes"
    isSyncing -> syncActivityLabel.ifBlank { "Syncing changes" }
    conflicts.isNotEmpty() -> "${conflicts.size} conflict${if (conflicts.size == 1) "" else "s"}"
    !hasToken -> "Local only"
    pendingSyncCount > 0 -> "Waiting to sync"
    remoteSyncEnabled && remoteSyncState == "queued" -> "Remote sync queued"
    remoteSyncEnabled && (remoteSyncState == "syncing" || remoteSyncState == "unknown") -> "Syncing remote"
    remoteSyncEnabled && remoteSyncState == "error" -> "Remote sync failed"
    remoteSyncEnabled -> "All changes synced"
    else -> "All changes saved"
  }

val NotesController.syncDetail: String
  get() = when {
    isWorkspaceLoading -> "Reading saved notes on this device"
    isSyncing -> syncActivityDetail
    !hasToken -> "Sign in to sync"
    remoteSyncState == "error" -> remoteSyncError
    pendingSyncCount > 0 -> "$pendingSyncCount item${if (pendingSyncCount == 1) "" else "s"} queued locally"
    syncMessage !in setOf(
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
      "Waiting to sync"
    ) -> syncMessage
    else -> ""
  }
