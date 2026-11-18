package com.author.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Mirrors apps/web/src/lib/client/manuscript.test.ts so both clients export the same documents.
class ManuscriptExportTest {
  private fun source(
    id: String,
    title: String,
    body: String,
    createdAt: String = "2026-01-01T00:00:00.000Z",
  ) = ManuscriptSourceNote(id, title, body, createdAt)

  private fun options(
    preset: ManuscriptPreset = ManuscriptPreset.POETRY,
    pageSize: ManuscriptPageSize = ManuscriptPageSize.A4,
    header: String = "Beyond Rituals",
    pageNumbers: Boolean = true,
    titlePage: Boolean = false,
  ) =
    ManuscriptOptions(
      preset = preset,
      pageSize = pageSize,
      header = header,
      pageNumbers = pageNumbers,
      titlePage = titlePage,
    )

  private fun ids(notes: List<ManuscriptSourceNote>, order: ManuscriptOrder) =
    orderManuscriptNotes(notes, order) { it }.map { it.id }

  @Test
  fun ordersTitlesByNumberAndPutsUntitledNotesLast() {
    val notes =
      listOf(
        source("a", "Chapter 10", "", "2026-01-03T00:00:00.000Z"),
        source("b", "chapter 2", "", "2026-01-02T00:00:00.000Z"),
        source("c", "", "untitled", "2026-01-01T00:00:00.000Z"),
        source("d", "Chapter 1", "", "2026-01-04T00:00:00.000Z"),
      )
    assertEquals(listOf("d", "b", "a", "c"), ids(notes, ManuscriptOrder.TITLE))
    assertEquals(listOf("c", "b", "a", "d"), ids(notes, ManuscriptOrder.CREATED))
  }

  @Test
  fun ordersRomanNumeralsByValueWhereTheyAreNumbers() {
    val notes =
      listOf("Maya IX", "Maya", "Maya II", "Maya X", "Maya V", "Maya IV").mapIndexed { index, title
        ->
        source(index.toString(), title, "")
      }
    assertEquals(
      listOf("Maya", "Maya II", "Maya IV", "Maya V", "Maya IX", "Maya X"),
      orderManuscriptNotes(notes, ManuscriptOrder.TITLE) { it }.map { it.title },
    )
    assertEquals("12", titleSortKey("XII"))
    assertEquals("4. Winter", titleSortKey("IV. Winter"))
    assertEquals("9 — River", titleSortKey("IX — River"))
    assertEquals("I Remember", titleSortKey("I Remember"))
    assertEquals("MIX Tape", titleSortKey("MIX Tape"))
    assertEquals("Part IIII", titleSortKey("Part IIII"))
    assertEquals("Civil war", titleSortKey("Civil war"))
  }

  @Test
  fun ordersMixedTimestampFormatsByInstant() {
    val notes =
      listOf(
        source("android", "B", "", "2026-01-01T10:00:00Z"),
        source("web", "A", "", "2026-01-01T10:00:00.500Z"),
        source("offset", "C", "", "2026-01-01T11:30:00+02:00"),
        source("broken", "D", "", "not a date"),
      )
    assertEquals(listOf("offset", "android", "web", "broken"), ids(notes, ManuscriptOrder.CREATED))
  }

  @Test
  fun keepsPoetryLinesIndentationAndSingleStanzaBreaks() {
    assertEquals(
      listOf(
        ManuscriptBlock.Line("first line"),
        ManuscriptBlock.Line("   indented"),
        ManuscriptBlock.StanzaBreak,
        ManuscriptBlock.Line("second stanza"),
      ),
      parseManuscriptBody(
        "\n\nfirst line  \n   indented\n\n\n\nsecond stanza\n\n",
        ManuscriptPreset.POETRY,
      ),
    )
  }

  @Test
  fun turnsProseLinesIntoParagraphsAndRecognisesSceneBreaks() {
    assertEquals(
      listOf(
        ManuscriptBlock.Paragraph("One paragraph."),
        ManuscriptBlock.Paragraph("Two."),
        ManuscriptBlock.SceneBreak,
        ManuscriptBlock.Paragraph("Three."),
      ),
      parseManuscriptBody(
        "  One   paragraph.\n\nTwo.\r\n* * *\n***\n#\nThree.\n~\n",
        ManuscriptPreset.PROSE,
      ),
    )
  }

  @Test
  fun treatsUnicodeSpacesLikeTheWebClient() {
    // No-break spaces between the marks still make a scene break (JavaScript's \s).
    assertEquals(
      listOf(
        ManuscriptBlock.Paragraph("Before."),
        ManuscriptBlock.SceneBreak,
        ManuscriptBlock.Paragraph("After."),
      ),
      parseManuscriptBody("Before.\n*\u00A0*\u00A0*\nAfter.\uFEFF", ManuscriptPreset.PROSE),
    )
    assertEquals(
      listOf(ManuscriptBlock.Line("verse")),
      parseManuscriptBody("verse\u00A0\uFEFF", ManuscriptPreset.POETRY),
    )
    // C1 control characters are stripped from file names too.
    assertEquals("Poems draft.docx", manuscriptFileName("Poems\u0085draft", "docx"))
    // Truncation keeps whole characters (same case as the web).
    assertEquals(
      "${"a".repeat(119)}\uD83D\uDE00.docx",
      manuscriptFileName("${"a".repeat(119)}\uD83D\uDE00b", "docx"),
    )
  }

  @Test
  fun buildsSectionsSkipsEmptyNotesAndCountsWords() {
    val manuscript =
      buildManuscript(
        "  Beyond Rituals ",
        listOf(
          source("a", "Breathing", "among the dead trees\n\n* * *"),
          source("b", "", "   \n"),
          source("c", "", "untitled poem"),
        ),
        options(header = "  Header  "),
      )
    assertEquals("Beyond Rituals", manuscript.title)
    assertEquals("Header", manuscript.options.header)
    assertEquals(listOf("a", "c"), manuscript.sections.map { it.id })
    assertEquals(7, manuscript.wordCount)
  }

  @Test
  fun roundsWordCountsAndCreatesSafeFileNames() {
    assertEquals("0 words", approximateWordCount(0))
    assertEquals("about 10 words", approximateWordCount(3))
    assertEquals("about 980 words", approximateWordCount(984))
    assertEquals("about 6,200 words", approximateWordCount(6_249))
    assertEquals("about 82,000 words", approximateWordCount(81_634))
    assertEquals("Beyond Rituals 2026.docx", manuscriptFileName("Beyond: Rituals / 2026", "docx"))
    assertEquals("manuscript.docx", manuscriptFileName("  ", "docx"))
    assertEquals("hidden.docx", manuscriptFileName("..hidden", "docx"))
  }

  private val createdAt = "2026-11-17T09:30:00.123Z"

  private fun files(manuscript: Manuscript) = manuscriptDocxFiles(manuscript, createdAt).toMap()

  @Test
  fun writesACompletePackageWithHeaderFooterAndManuscriptFont() {
    val poetry =
      buildManuscript(
        "Beyond Rituals",
        listOf(
          source("a", "Breathing", "breathing\n\tamong <the> dead & trees\n\nI feel"),
          source("b", "", "untitled"),
        ),
        options(),
      )
    val parts = manuscriptDocxFiles(poetry, createdAt)
    assertEquals(
      listOf(
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
        "word/settings.xml",
        "word/fontTable.xml",
        "word/header1.xml",
        "word/footer1.xml",
      ),
      parts.map { it.first },
    )
    val files = parts.toMap()
    val document = files.getValue("word/document.xml")
    assertTrue(
      document.contains(
        "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t xml:space=\"preserve\">Breathing</w:t></w:r></w:p>"
      )
    )
    assertTrue(
      document.contains(
        "<w:tab/><w:t xml:space=\"preserve\">among &lt;the&gt; dead &amp; trees</w:t>"
      )
    )
    assertTrue(document.contains("<w:p><w:pPr><w:pStyle w:val=\"Normal\"/></w:pPr></w:p>"))
    assertTrue(
      document.contains(
        "<w:pStyle w:val=\"Body\"/><w:pageBreakBefore/></w:pPr><w:r><w:t xml:space=\"preserve\">untitled</w:t>"
      )
    )
    assertTrue(document.contains("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"))
    assertFalse(document.contains("<w:titlePg/>"))
    assertTrue(files.getValue("word/header1.xml").contains("Beyond Rituals"))
    assertTrue(files.getValue("word/footer1.xml").contains("w:instr=\" PAGE \""))
    assertTrue(files.getValue("word/styles.xml").contains("w:ascii=\"Newsreader\""))
    assertTrue(files.getValue("word/styles.xml").contains("w:line=\"276\""))
    assertTrue(files.getValue("word/fontTable.xml").contains("<w:family w:val=\"roman\"/>"))
    assertTrue(files.getValue("docProps/core.xml").contains("2026-11-17T09:30:00Z"))
  }

  @Test
  fun omitsHeaderAndFooterPartsWhenSwitchedOff() {
    val plain =
      buildManuscript(
        "Plain",
        listOf(source("a", "One", "text")),
        options(header = "", pageNumbers = false),
      )
    val parts = manuscriptDocxFiles(plain, createdAt)
    assertFalse(parts.any { it.first == "word/header1.xml" || it.first == "word/footer1.xml" })
    val text = parts.joinToString("\n") { it.second }
    listOf("header1.xml", "footer1.xml", "headerReference", "footerReference").forEach {
      assertFalse(text.contains(it))
    }
  }

  @Test
  fun laysOutProseWithTitlePageWordCountAndChapterDrop() {
    val prose =
      buildManuscript(
        "Novel",
        listOf(source("a", "Chapter 1", "It began.\n* * *\nIt ended.")),
        options(
          preset = ManuscriptPreset.PROSE,
          pageSize = ManuscriptPageSize.LETTER,
          titlePage = true,
        ),
      )
    val files = files(prose)
    val document = files.getValue("word/document.xml")
    assertTrue(document.contains("about 10 words"))
    assertTrue(document.contains("<w:pStyle w:val=\"Title\"/>"))
    assertTrue(
      document.contains(
        "<w:pStyle w:val=\"SceneBreak\"/></w:pPr><w:r><w:t xml:space=\"preserve\">#</w:t>"
      )
    )
    assertTrue(document.contains("<w:pgSz w:w=\"12240\" w:h=\"15840\"/>"))
    assertTrue(document.contains("<w:pgNumType w:start=\"0\"/><w:titlePg/>"))
    assertTrue(
      document.contains(
        "<w:p><w:pPr><w:pStyle w:val=\"PageDrop\"/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val=\"Title\"/>"
      )
    )
    assertTrue(
      document.contains(
        "<w:p><w:pPr><w:pStyle w:val=\"PageDrop\"/><w:pageBreakBefore/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>"
      )
    )
    val styles = files.getValue("word/styles.xml")
    assertTrue(styles.contains("w:line=\"480\""))
    assertTrue(styles.contains("<w:ind w:firstLine=\"720\"/>"))
    assertTrue(styles.contains("w:line=\"4320\" w:lineRule=\"exact\""))
  }

  @Test
  fun writesTheZipWithContentTypesFirst() {
    val manuscript = buildManuscript("Poems", listOf(source("a", "One", "line")), options())
    val bytes = ByteArrayOutputStream().also { writeManuscriptDocx(manuscript, createdAt, it) }
    val names = mutableListOf<String>()
    var document = ""
    ZipInputStream(ByteArrayInputStream(bytes.toByteArray())).use { zip ->
      while (true) {
        val entry = zip.nextEntry ?: break
        names += entry.name
        val content = zip.readBytes().toString(Charsets.UTF_8)
        if (entry.name == "word/document.xml") document = content
      }
    }
    assertEquals("[Content_Types].xml", names.first())
    assertTrue(document.contains("One"))
  }

  @Test
  fun stripsCharactersThatAreInvalidInXml() {
    val manuscript =
      buildManuscript("Bad\u0001Title", listOf(source("a", "One", "a\u0000b\u000bc")), options())
    val text = manuscriptDocxFiles(manuscript, createdAt).joinToString("") { it.second }
    assertFalse(Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]").containsMatchIn(text))
    assertTrue(text.contains("abc"))
  }
}
