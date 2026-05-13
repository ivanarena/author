package com.author.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class MarkdownArchiveTest {
  @Test
  fun parseMarkdownImportKeepsNotebookFoldersAndFrontmatterDates() {
    val parsed = parseNotesMarkdownImportFiles(
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
          """.trimIndent()
        ),
        markdownFile(
          "nn-export/Ideas/Nested/Deep.md",
          "Deep thought\n\nSecond line"
        ),
        MarkdownInputFile("Readme.txt", "nn-export/Readme.txt", "not a note")
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
    val parsed = parseNotesMarkdownImportFiles(
      listOf(markdownFile("Export/Loose-note.md", ""))
    )

    assertEquals("Loose note", parsed.notes.single().title)
    assertEquals("", parsed.notes.single().body)
  }

  private fun markdownFile(path: String, text: String): MarkdownInputFile = MarkdownInputFile(path.substringAfterLast('/'), path, text)
}
