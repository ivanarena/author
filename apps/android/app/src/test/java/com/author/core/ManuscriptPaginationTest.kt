package com.author.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ManuscriptPaginationTest {
  /** Greedy word wrap at a fixed number of characters; splits words longer than a line. */
  private class FakeMeasurer(private val width: Int = 40) : ManuscriptMeasurer {
    override fun lines(text: String, style: ManuscriptTextStyle): List<MeasuredLine> {
      val lines = mutableListOf<MeasuredLine>()
      var start = 0
      while (start < text.length) {
        val available =
          when {
            style == ManuscriptTextStyle.PARAGRAPH && lines.isEmpty() -> width - 5
            style == ManuscriptTextStyle.POEM_LINE && lines.isNotEmpty() -> width - 2
            style == ManuscriptTextStyle.POEM_LINE_CONTINUED -> width - 2
            else -> width
          }
        var end = minOf(text.length, start + available)
        if (end < text.length) {
          val space = text.lastIndexOf(' ', end)
          if (space > start) end = space + 1
        }
        lines += MeasuredLine(start, end)
        start = end
      }
      return lines
    }
  }

  private val sentence =
    "The shutters had been closed for eleven years and when Marta finally pushed them open"

  private fun manuscript(
    preset: ManuscriptPreset,
    notes: List<ManuscriptSourceNote>,
    titlePage: Boolean = false,
    pageSize: ManuscriptPageSize = ManuscriptPageSize.A5,
  ) =
    buildManuscript(
      "Book",
      notes,
      ManuscriptOptions(
        preset = preset,
        pageSize = pageSize,
        header = "Book",
        titlePage = titlePage,
      ),
    )

  private fun assertNoOverflowAndAllTextPlaced(
    manuscript: Manuscript,
    pages: List<ManuscriptPage>,
  ) {
    val metrics = ManuscriptMetrics(manuscript.options)
    pages
      .filterNot { it.isTitlePage }
      .forEach { page ->
        page.items.forEach { item ->
          val bottom = item.top + item.lines.size * metrics.lineHeight
          assertTrue(
            "overflow: $bottom > ${metrics.contentHeight}",
            bottom <= metrics.contentHeight + 0.01f,
          )
          item.lines.forEach { assertTrue(it.end <= item.text.length) }
        }
      }
    val placed =
      pages
        .filterNot { it.isTitlePage }
        .flatMap { page -> page.items.filter { it.style != ManuscriptTextStyle.SCENE_BREAK } }
        .joinToString("") { it.text }
        .filterNot { it.isWhitespace() }
    val expected =
      manuscript.sections
        .joinToString("") { section ->
          section.title +
            section.blocks.joinToString("") {
              when (it) {
                is ManuscriptBlock.Line -> it.text
                is ManuscriptBlock.Paragraph -> it.text
                else -> ""
              }
            }
        }
        .filterNot { it.isWhitespace() }
    assertEquals(expected, placed)
  }

  @Test
  fun proseFillsPagesWithoutLosingOrOverflowingText() {
    val notes =
      (1..4).map { chapter ->
        ManuscriptSourceNote(
          "c$chapter",
          "Chapter $chapter",
          (0 until 30).joinToString("\n") { index ->
            if (index % 9 == 8) "* * *" else "$index ${sentence.repeat(1 + index % 4)}"
          },
          "2026-01-0${chapter}T00:00:00Z",
        )
      }
    val manuscript = manuscript(ManuscriptPreset.PROSE, notes, titlePage = true)
    val pages = paginateManuscript(manuscript, FakeMeasurer())
    assertNoOverflowAndAllTextPlaced(manuscript, pages)

    val metrics = ManuscriptMetrics(manuscript.options)
    // Title page: word count, then the title a third of the way down; unnumbered.
    val titlePage = pages.first()
    assertTrue(titlePage.isTitlePage)
    assertNull(titlePage.number)
    assertEquals(ManuscriptTextStyle.WORD_COUNT, titlePage.items[0].style)
    assertEquals(metrics.lineHeight + metrics.chapterDrop, titlePage.items[1].top, 0.01f)
    // Numbered pages start at 1; every chapter starts a page at the chapter drop.
    assertEquals((1 until pages.size).toList(), pages.drop(1).map { it.number })
    val chapterStarts =
      pages.filter { page -> page.items.firstOrNull()?.style == ManuscriptTextStyle.CHAPTER_TITLE }
    assertEquals(4, chapterStarts.size)
    chapterStarts.forEach { assertEquals(metrics.chapterDrop, it.items.first().top, 0.01f) }
    // Paragraphs split across pages continue without an indent.
    assertTrue(
      pages.any { page ->
        page.items.firstOrNull()?.style == ManuscriptTextStyle.PARAGRAPH_CONTINUED
      }
    )
  }

  @Test
  fun poetryKeepsLinesWholeAndNeverOpensAPageWithAStanzaGap() {
    val poem =
      (0 until 120).joinToString("\n") { index ->
        if (index % 5 == 4) "" else "   line $index ${sentence.take(30 + index % 40)}"
      }
    val manuscript =
      manuscript(
        ManuscriptPreset.POETRY,
        listOf(
          ManuscriptSourceNote("p1", "Long poem", poem, "2026-01-01T00:00:00Z"),
          ManuscriptSourceNote("p2", "Short", "one\ntwo", "2026-01-02T00:00:00Z"),
        ),
      )
    val pages = paginateManuscript(manuscript, FakeMeasurer())
    assertNoOverflowAndAllTextPlaced(manuscript, pages)
    pages.forEach { page -> assertEquals(0f, page.items.first().top, 0.01f) }
    // Verse lines are never split when they fit on a page.
    pages.forEach { page ->
      page.items.forEach { assertTrue(it.style != ManuscriptTextStyle.POEM_LINE_CONTINUED) }
    }
    assertEquals(ManuscriptTextStyle.POEM_TITLE, pages.last().items.first().style)
  }

  @Test
  fun splitsTextTallerThanAPageAndAlwaysTerminates() {
    val manuscript =
      manuscript(
        ManuscriptPreset.POETRY,
        listOf(
          ManuscriptSourceNote(
            "w",
            "Wide",
            "short\n${"y".repeat(9000)}\nafter",
            "2026-01-01T00:00:00Z",
          )
        ),
      )
    val pages = paginateManuscript(manuscript, FakeMeasurer())
    assertNoOverflowAndAllTextPlaced(manuscript, pages)
    assertTrue(pages.size > 1)
    assertTrue(
      pages.any { page -> page.items.any { it.style == ManuscriptTextStyle.POEM_LINE_CONTINUED } }
    )

    val prose =
      manuscript(
        ManuscriptPreset.PROSE,
        listOf(
          ManuscriptSourceNote(
            "x",
            "Paste",
            "start ${"x".repeat(9000)} end",
            "2026-01-01T00:00:00Z",
          )
        ),
      )
    val prosePages = paginateManuscript(prose, FakeMeasurer())
    assertNoOverflowAndAllTextPlaced(prose, prosePages)
  }
}
