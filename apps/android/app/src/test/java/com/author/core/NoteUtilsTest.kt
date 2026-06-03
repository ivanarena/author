package com.author.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class NoteUtilsTest {
  @Test
  fun filterNotesForViewHandlesSystemFiltersAndNotebookIds() {
    val notes =
      listOf(
        note("a", title = "Alpha"),
        note("b", title = "Bravo", notebookIds = listOf("work")),
        note("c", title = "Charlie", notebookId = "legacy"),
        note("favorite", title = "Favorite", notebookIds = listOf("starred"))
          .copy(isFavorite = true),
      )
    val trash = listOf(note("t", title = "Trashed", trashedAt = "2026-05-07T12:00:00Z"))

    assertEquals(
      listOf("a", "b", "c", "favorite"),
      filterNotesForView(notes, trash, "all").map { it.id },
    )
    assertEquals(listOf("favorite"), filterNotesForView(notes, trash, "favorites").map { it.id })
    assertEquals(listOf("a"), filterNotesForView(notes, trash, "unfiled").map { it.id })
    assertEquals(listOf("b"), filterNotesForView(notes, trash, "work").map { it.id })
    assertEquals(listOf("c"), filterNotesForView(notes, trash, "legacy").map { it.id })
    assertEquals(listOf("t"), filterNotesForView(notes, trash, "trash").map { it.id })
  }

  @Test
  fun filterNotesBySearchMatchesTitleAndBodyCaseInsensitively() {
    val notes =
      listOf(
        note("a", title = "Meeting", body = "Roadmap decisions"),
        note("b", title = "Ideas", body = "tiny durable sparks"),
      )

    assertEquals(listOf("a"), filterNotesBySearch(notes, "roadmap").map { it.id })
    assertEquals(listOf("b"), filterNotesBySearch(notes, "IDEAS").map { it.id })
    assertEquals(notes.map { it.id }, filterNotesBySearch(notes, " ").map { it.id })
  }

  @Test
  fun filterNotesByAdvancedFiltersSupportsNotebookAndDateRanges() {
    val now = Instant.parse("2026-05-07T12:00:00Z")
    val notes =
      listOf(
        note("unfiled-today", title = "Unfiled", updatedAt = "2026-05-07T10:00:00Z"),
        note(
          "work-yesterday",
          title = "Work yesterday",
          notebookIds = listOf("work"),
          updatedAt = "2026-05-06T10:00:00Z",
        ),
        note(
          "home-week",
          title = "Home week",
          notebookIds = listOf("home"),
          updatedAt = "2026-05-03T10:00:00Z",
        ),
        note(
          "work-month",
          title = "Work month",
          notebookIds = listOf("work"),
          updatedAt = "2026-04-20T10:00:00Z",
        ),
        note(
          "work-older",
          title = "Work older",
          notebookIds = listOf("work"),
          updatedAt = "2025-04-01T10:00:00Z",
        ),
      )

    assertEquals(
      listOf("work-yesterday", "work-month", "work-older"),
      filterNotesByAdvancedFilters(notes, setOf("work"), emptySet(), now).map { it.id },
    )
    assertEquals(
      listOf("unfiled-today"),
      filterNotesByAdvancedFilters(notes, setOf(NOTE_FILTER_UNFILED_ID), emptySet(), now).map {
        it.id
      },
    )
    assertEquals(
      listOf("unfiled-today", "work-yesterday"),
      filterNotesByAdvancedFilters(
          notes,
          emptySet(),
          setOf(NOTE_DATE_FILTER_TODAY, NOTE_DATE_FILTER_YESTERDAY),
          now,
        )
        .map { it.id },
    )
    assertEquals(
      listOf("work-month"),
      filterNotesByAdvancedFilters(notes, setOf("work"), setOf(NOTE_DATE_FILTER_PREVIOUS_30), now)
        .map { it.id },
    )
  }

  @Test
  fun sortNotesUsesExpectedModes() {
    val notes =
      listOf(
        note("old", title = "Zed", updatedAt = "2026-05-05T12:00:00Z"),
        note("middle", title = "alpha", updatedAt = "2026-05-06T12:00:00Z"),
        note("new", title = "Beta", updatedAt = "2026-05-07T12:00:00Z"),
      )

    assertEquals(listOf("new", "middle", "old"), sortNotes(notes, "date-desc").map { it.id })
    assertEquals(listOf("middle", "new", "old"), sortNotes(notes, "az").map { it.id })
    assertEquals(listOf("old", "new", "middle"), sortNotes(notes, "za").map { it.id })
  }

  @Test
  fun groupNotesByDateRangeGroupsOnlyDateSort() {
    val now = Instant.parse("2026-05-07T12:00:00Z")
    val notes =
      listOf(
        note("today", title = "Today", updatedAt = "2026-05-07T10:00:00Z"),
        note("yesterday", title = "Yesterday", updatedAt = "2026-05-06T10:00:00Z"),
      )

    assertEquals(
      listOf("Today" to listOf("today"), "Yesterday" to listOf("yesterday")),
      groupNotesByDateRange(notes, "date-desc", now).map { (label, group) ->
        label to group.map { it.id }
      },
    )
    assertEquals(
      listOf("A-Z" to listOf("today", "yesterday")),
      groupNotesByDateRange(notes, "az", now).map { (label, group) -> label to group.map { it.id } },
    )
  }

  @Test
  fun groupNotesSupportsMonthYearAndNoHeadingModes() {
    val now = Instant.parse("2026-05-07T12:00:00Z")
    val notes =
      listOf(
        note("may-new", title = "May new", updatedAt = "2026-05-07T10:00:00Z"),
        note("may-old", title = "May old", updatedAt = "2026-05-01T10:00:00Z"),
        note("april", title = "April", updatedAt = "2026-04-30T10:00:00Z"),
      )
    val monthFormatter =
      DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).withZone(ZoneId.systemDefault())
    val mayLabel = monthFormatter.format(Instant.parse("2026-05-07T10:00:00Z"))
    val aprilLabel = monthFormatter.format(Instant.parse("2026-04-30T10:00:00Z"))

    assertEquals(
      listOf(mayLabel to listOf("may-new", "may-old"), aprilLabel to listOf("april")),
      groupNotes(notes, "date-desc", "month", now).map { (label, group) ->
        label to group.map { it.id }
      },
    )
    assertEquals(
      listOf("2026" to listOf("may-new", "may-old", "april")),
      groupNotes(notes, "date-desc", "year", now).map { (label, group) ->
        label to group.map { it.id }
      },
    )
    assertEquals(
      listOf("" to listOf("may-new", "may-old", "april")),
      groupNotes(notes, "az", "none", now).map { (label, group) -> label to group.map { it.id } },
    )
  }

  @Test
  fun recordsDifferUsesHashesAndNotebookMembershipForSyncConflicts() {
    val local =
      note(
          "sync",
          title = "Encrypted title",
          body = "Encrypted body",
          notebookIds = listOf("work"),
          notebookId = "work",
        )
        .copy(titleHash = "hash:title:1", bodyHash = "hash:body:1")
    val sameEncryptedWithDifferentCiphertext =
      local.copy(title = "Different ciphertext title", body = "Different ciphertext body")
    val changedBodyHash = sameEncryptedWithDifferentCiphertext.copy(bodyHash = "hash:body:2")
    val changedNotebook =
      sameEncryptedWithDifferentCiphertext.copy(notebookIds = listOf("personal"))
    val changedFavorite = sameEncryptedWithDifferentCiphertext.copy(isFavorite = true)

    assertEquals(false, recordsDiffer(local, sameEncryptedWithDifferentCiphertext))
    assertEquals(true, recordsDiffer(local, changedBodyHash))
    assertEquals(true, recordsDiffer(local, changedNotebook))
    assertEquals(true, recordsDiffer(local, changedFavorite))
  }

  @Test
  fun syncPushBatchesRespectTotalChangeLimit() {
    val notes = (1..25).map { "note-$it" }
    val notebooks = (1..18).map { "notebook-$it" }

    val batches = syncPushBatches(notes, notebooks, maxChanges = 20)

    assertEquals(listOf(20, 20, 3), batches.map { it.notes.size + it.notebooks.size })
    assertEquals(25, batches.sumOf { it.notes.size })
    assertEquals(18, batches.sumOf { it.notebooks.size })
    assertEquals(true, batches.all { it.notes.size + it.notebooks.size <= 20 })
  }

  @Test
  fun remapNotebookIdsReplacesAndDeduplicatesNotebookReferences() {
    assertEquals(
      listOf("remote", "other"),
      remapNotebookIds(listOf("local", "other", "local"), "local", "remote"),
    )
  }

  @Test
  fun preparePendingNoteForPushUsesCurrentDeviceAndValidBaseVersion() {
    val prepared =
      preparePendingNoteForPush(
        note(
            "pulled",
            title = "Pulled",
            notebookIds = listOf(" work ", "", "work", "home"),
            notebookId = "legacy",
          )
          .copy(
            deviceId = "remote-device",
            version = 1,
            syncStatus = "pending",
            lastSyncedVersion = 1,
          ),
        Device("android-device", "Android"),
      )

    assertEquals("android-device", prepared.deviceId)
    assertEquals(2, prepared.version)
    assertEquals("pending", prepared.syncStatus)
    assertEquals(1, prepared.lastSyncedVersion)
    assertEquals(listOf("work", "home"), prepared.notebookIds)
    assertEquals("work", prepared.notebookId)
  }

  @Test
  fun preparePendingNotebookForPushClampsInvalidBaseVersion() {
    val prepared =
      preparePendingNotebookForPush(
        notebook("book", "Work")
          .copy(
            deviceId = "remote-device",
            version = 0,
            syncStatus = "pending",
            lastSyncedVersion = -1,
          ),
        Device("android-device", "Android"),
      )

    assertEquals("android-device", prepared.deviceId)
    assertEquals(1, prepared.version)
    assertEquals("pending", prepared.syncStatus)
    assertEquals(0, prepared.lastSyncedVersion)
  }

  @Test
  fun uniqueNotebookCopyNameAvoidsExistingActiveNotebookNames() {
    val notebooks =
      listOf(
        notebook("source", "Ideas"),
        notebook("copy", "Ideas copy"),
        notebook("copy-2", "Ideas copy 2"),
        notebook("deleted", "Ideas copy 3", deletedAt = "2026-05-07T12:00:00Z"),
      )

    assertEquals("Ideas copy 3", uniqueNotebookCopyName("Ideas", notebooks, setOf("source")))
  }

  private fun note(
    id: String,
    title: String,
    body: String = "",
    notebookIds: List<String> = emptyList(),
    notebookId: String? = null,
    updatedAt: String = "2026-05-07T12:00:00Z",
    trashedAt: String? = null,
  ) =
    LocalNote(
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
      lastSyncedAt = null,
    )

  private fun notebook(id: String, name: String, deletedAt: String? = null) =
    LocalNotebook(
      id = id,
      name = name,
      nameHash = null,
      createdAt = "2026-05-01T12:00:00Z",
      updatedAt = "2026-05-07T12:00:00Z",
      deletedAt = deletedAt,
      deviceId = "test-device",
      version = 1,
      syncStatus = "synced",
      lastSyncedVersion = 1,
      lastSyncedAt = null,
    )
}
