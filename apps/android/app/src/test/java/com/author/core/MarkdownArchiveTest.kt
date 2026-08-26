package com.author.core

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownArchiveTest {
  @Test
  fun parseMarkdownImportKeepsNotebookFoldersAndFrontmatterDates() {
    val parsed =
      parseNotesMarkdownImportFiles(
        listOf(
          markdownFile(
            "nn-export/Ideas/Roadmap.md",
            """
            ---
            title: "Roadmap"
            created_at: 15-12-2023 04:35 PM
            updated_at: 16-12-2023 05:45 PM
            ---

            # Roadmap

            Launch plan
            """
              .trimIndent(),
          ),
          markdownFile("nn-export/Ideas/Nested/Deep.md", "Deep thought\n\nSecond line"),
          MarkdownInputFile("Readme.txt", "nn-export/Readme.txt", "not a note"),
        )
      )

    assertEquals(listOf("Ideas", "Nested"), parsed.notebooks.map { it.name })
    assertEquals(2, parsed.notes.size)
    assertEquals("Roadmap", parsed.notes[0].title)
    assertEquals("Launch plan", parsed.notes[0].body)
    assertEquals(listOf("Ideas"), parsed.notes[0].sourceNotebookNames)
    assertFalse(parsed.notes[0].createdAt.isNullOrBlank())
    assertFalse(parsed.notes[0].updatedAt.isNullOrBlank())
    assertEquals("Deep thought", parsed.notes[1].title)
    assertEquals(listOf("Ideas", "Nested"), parsed.notes[1].sourceNotebookNames)
  }

  @Test
  fun parseMarkdownImportFallsBackToFileNameForBlankNotes() {
    val parsed = parseNotesMarkdownImportFiles(listOf(markdownFile("Export/Loose-note.md", "")))

    assertEquals("Loose note", parsed.notes.single().title)
    assertEquals("", parsed.notes.single().body)
  }

  @Test
  fun roundTripsPortableAuthorMetadata() {
    val note =
      LocalNote(
        id = "note-1",
        title = "Portable",
        body = "Body",
        titleHash = null,
        bodyHash = null,
        notebookIds = listOf("book-1", "book-2"),
        notebookId = "book-1",
        createdAt = "2026-05-10T09:00:00Z",
        updatedAt = "2026-05-10T10:00:00Z",
        deletedAt = null,
        trashedAt = "2026-05-11T10:00:00Z",
        deviceId = "device-1",
        version = 1,
        syncStatus = "pending",
        lastSyncedVersion = 0,
        lastSyncedAt = null,
        isFavorite = true,
      )
    val content = markdownNoteContent(note, note.title, listOf("Work", "Ideas"))
    val parsed = parseMarkdownNote(content, "Portable.md")

    assertTrue(content.contains("created_at: 2026-05-10T09:00:00Z"))
    assertEquals("note-1", parsed.sourceId)
    assertEquals(listOf("Work", "Ideas"), parsed.sourceNotebookNames)
    assertEquals("2026-05-11T10:00:00Z", parsed.trashedAt)
    assertTrue(parsed.isFavorite)
  }

  @Test
  fun markdownExportCanBeLimitedToSelectedNotebooks() {
    val ideas = archiveNote("ideas-note", listOf("ideas"))
    val shared = archiveNote("shared-note", listOf("work", "ideas"))
    val work = archiveNote("work-note", listOf("work"))
    val unfiled = archiveNote("unfiled-note", emptyList())
    val deleted = archiveNote("deleted-note", listOf("ideas"), deletedAt = nowIso())

    assertEquals(
      listOf("ideas-note", "shared-note"),
      notesForMarkdownExport(listOf(ideas, shared, work, unfiled, deleted), setOf("ideas")).map {
        it.id
      },
    )
    assertEquals(
      listOf("ideas-note", "shared-note", "work-note", "unfiled-note"),
      notesForMarkdownExport(listOf(ideas, shared, work, unfiled, deleted)).map { it.id },
    )
  }

  @Test
  fun readBoundedUtf8StopsOversizedImports() {
    val text = readBoundedUtf8(ByteArrayInputStream("hello".toByteArray()), 5)
    assertEquals("hello", text.text)
    assertEquals(5, text.byteCount)

    assertThrows(IllegalStateException::class.java) {
      readBoundedUtf8(ByteArrayInputStream("oversized".toByteArray()), 4)
    }
  }

  private fun archiveNote(
    id: String,
    notebookIds: List<String>,
    deletedAt: String? = null,
  ): LocalNote =
    LocalNote(
      id = id,
      title = id,
      body = "Body",
      titleHash = null,
      bodyHash = null,
      notebookIds = notebookIds,
      notebookId = notebookIds.firstOrNull(),
      createdAt = "2026-05-10T09:00:00Z",
      updatedAt = "2026-05-10T10:00:00Z",
      deletedAt = deletedAt,
      trashedAt = null,
      deviceId = "device-1",
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null,
      isFavorite = false,
    )

  private fun markdownFile(path: String, text: String): MarkdownInputFile =
    MarkdownInputFile(path.substringAfterLast('/'), path, text)
}
