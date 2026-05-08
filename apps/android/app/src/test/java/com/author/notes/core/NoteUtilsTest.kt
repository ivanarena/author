package com.author.notes.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class NoteUtilsTest {
  @Test
  fun filterNotesForViewHandlesSystemFiltersAndNotebookIds() {
    val notes = listOf(
      note("a", title = "Alpha"),
      note("b", title = "Bravo", notebookIds = listOf("work")),
      note("c", title = "Charlie", notebookId = "legacy")
    )
    val trash = listOf(note("t", title = "Trashed", trashedAt = "2026-05-07T12:00:00Z"))

    assertEquals(listOf("a", "b", "c"), filterNotesForView(notes, trash, "all").map { it.id })
    assertEquals(listOf("a"), filterNotesForView(notes, trash, "unfiled").map { it.id })
    assertEquals(listOf("b"), filterNotesForView(notes, trash, "work").map { it.id })
    assertEquals(listOf("c"), filterNotesForView(notes, trash, "legacy").map { it.id })
    assertEquals(listOf("t"), filterNotesForView(notes, trash, "trash").map { it.id })
  }

  @Test
  fun filterNotesBySearchMatchesTitleAndBodyCaseInsensitively() {
    val notes = listOf(
      note("a", title = "Meeting", body = "Roadmap decisions"),
      note("b", title = "Ideas", body = "tiny durable sparks")
    )

    assertEquals(listOf("a"), filterNotesBySearch(notes, "roadmap").map { it.id })
    assertEquals(listOf("b"), filterNotesBySearch(notes, "IDEAS").map { it.id })
    assertEquals(notes.map { it.id }, filterNotesBySearch(notes, " ").map { it.id })
  }

  @Test
  fun sortNotesUsesExpectedModes() {
    val notes = listOf(
      note("old", title = "Zed", updatedAt = "2026-05-05T12:00:00Z"),
      note("middle", title = "alpha", updatedAt = "2026-05-06T12:00:00Z"),
      note("new", title = "Beta", updatedAt = "2026-05-07T12:00:00Z")
    )

    assertEquals(listOf("new", "middle", "old"), sortNotes(notes, "date-desc").map { it.id })
    assertEquals(listOf("middle", "new", "old"), sortNotes(notes, "az").map { it.id })
    assertEquals(listOf("old", "new", "middle"), sortNotes(notes, "za").map { it.id })
  }

  @Test
  fun groupNotesByDateRangeGroupsOnlyDateSort() {
    val now = Instant.parse("2026-05-07T12:00:00Z")
    val notes = listOf(
      note("today", title = "Today", updatedAt = "2026-05-07T10:00:00Z"),
      note("yesterday", title = "Yesterday", updatedAt = "2026-05-06T10:00:00Z")
    )

    assertEquals(
      listOf("Today" to listOf("today"), "Yesterday" to listOf("yesterday")),
      groupNotesByDateRange(notes, "date-desc", now).map { (label, group) -> label to group.map { it.id } }
    )
    assertEquals(
      listOf("A-Z" to listOf("today", "yesterday")),
      groupNotesByDateRange(notes, "az", now).map { (label, group) -> label to group.map { it.id } }
    )
  }

  private fun note(
    id: String,
    title: String,
    body: String = "",
    notebookIds: List<String> = emptyList(),
    notebookId: String? = null,
    updatedAt: String = "2026-05-07T12:00:00Z",
    trashedAt: String? = null
  ) = LocalNote(
    id = id,
    title = title,
    body = body,
    titleHash = null,
    bodyHash = null,
    notebookIds = notebookIds,
    notebookId = notebookId,
    createdAt = "2026-05-01T12:00:00Z",
    updatedAt = updatedAt,
    deletedAt = null,
    trashedAt = trashedAt,
    deviceId = "test-device",
    version = 1,
    syncStatus = "synced",
    lastSyncedVersion = 1,
    lastSyncedAt = null
  )
}
