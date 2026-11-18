package com.author.core

import java.io.OutputStream
import java.text.Collator
import java.text.Normalizer
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.roundToLong

// A manuscript is one notebook compiled into a submission-ready document.
// Notes stay plain text; layout is applied only at export time. This mirrors
// apps/web/src/lib/client/manuscript.ts; keep the two in step.

enum class ManuscriptPreset(val id: String) {
  POETRY("poetry"),
  PROSE("prose");

  companion object {
    fun fromId(id: String?): ManuscriptPreset? = entries.firstOrNull { it.id == id }
  }
}

enum class ManuscriptOrder(val id: String) {
  TITLE("title"),
  CREATED("created");

  companion object {
    fun fromId(id: String?): ManuscriptOrder? = entries.firstOrNull { it.id == id }
  }
}

enum class ManuscriptPageSize(
  val id: String,
  val label: String,
  val widthMm: Double,
  val heightMm: Double,
  val marginMm: Double,
) {
  A4("a4", "A4", 210.0, 297.0, 25.0),
  A5("a5", "A5", 148.0, 210.0, 20.0),
  LETTER("letter", "Letter", 215.9, 279.4, 25.4);

  companion object {
    fun fromId(id: String?): ManuscriptPageSize? = entries.firstOrNull { it.id == id }
  }
}

data class ManuscriptOptions(
  val preset: ManuscriptPreset = ManuscriptPreset.POETRY,
  val order: ManuscriptOrder = ManuscriptOrder.TITLE,
  val pageSize: ManuscriptPageSize = ManuscriptPageSize.A4,
  /** Running header text; empty means no header. */
  val header: String = "",
  val pageNumbers: Boolean = true,
  val titlePage: Boolean = false,
)

/** The font every manuscript is set in (PDF embeds it; DOCX names it). */
const val MANUSCRIPT_FONT = "Newsreader"
const val MANUSCRIPT_FONT_SIZE_PT = 12
const val MANUSCRIPT_HEADER_SIZE_PT = 10
/** Prose first-line indent: half an inch. */
const val MANUSCRIPT_PROSE_INDENT_MM = 12.7

data class ManuscriptSourceNote(
  val id: String,
  val title: String,
  val body: String,
  val createdAt: String,
)

sealed interface ManuscriptBlock {
  /** A poetry line; leading whitespace is significant. */
  data class Line(val text: String) : ManuscriptBlock

  /** The gap between two stanzas. */
  data object StanzaBreak : ManuscriptBlock

  /** A prose paragraph (one source line). */
  data class Paragraph(val text: String) : ManuscriptBlock

  /** A prose scene break, written as `* * *`, `***`, `#` or similar. */
  data object SceneBreak : ManuscriptBlock
}

data class ManuscriptSection(val id: String, val title: String, val blocks: List<ManuscriptBlock>)

data class Manuscript(
  val title: String,
  val options: ManuscriptOptions,
  val sections: List<ManuscriptSection>,
  val wordCount: Int,
)

// Matched after collapseSpaces, so any Unicode space between the marks counts.
private val SCENE_BREAK = Regex("^[*#~](?: ?[*#~])*$")
private val ROMAN_NUMERAL = Regex("^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$")
private val ROMAN_WORD = Regex("^([IVXLCDM]+)([.:)\\-–—]?)$")
private val ROMAN_VALUES =
  mapOf('I' to 1, 'V' to 5, 'X' to 10, 'L' to 50, 'C' to 100, 'D' to 500, 'M' to 1000)
private val NUMBER_CHUNK = Regex("\\d+|\\D+")

// Like JavaScript's \s, which the web client uses.
private fun isSpace(char: Char): Boolean =
  char.isWhitespace() || Character.isSpaceChar(char) || char == '\uFEFF'

private fun collapseSpaces(text: String): String = buildString {
  var lastWasSpace = false
  for (char in text) {
    if (isSpace(char)) {
      if (!lastWasSpace) append(' ')
      lastWasSpace = true
    } else {
      append(char)
      lastWasSpace = false
    }
  }
}

private fun romanValue(token: String): Int? {
  if (token.isEmpty() || !ROMAN_NUMERAL.matches(token)) return null
  var total = 0
  token.forEachIndexed { index, char ->
    val value = ROMAN_VALUES.getValue(char)
    val next = token.getOrNull(index + 1)?.let { ROMAN_VALUES[it] } ?: 0
    total += if (value < next) -value else value
  }
  return total
}

/**
 * Sort key that reads Roman numerals as numbers where they almost certainly are: the whole title,
 * its last word ("Maya II"), or a first word followed by punctuation ("IV. Winter").
 */
fun titleSortKey(title: String): String {
  val words = collapseSpaces(title.trim()).split(' ')
  return words
    .mapIndexed { index, word ->
      val match = ROMAN_WORD.matchEntire(word) ?: return@mapIndexed word
      val numeral = match.groupValues[1]
      val punctuation = match.groupValues[2]
      val isWholeTitle = words.size == 1
      val isLast = index == words.lastIndex && words.size > 1
      val isLabel =
        index == 0 && (punctuation.isNotEmpty() || words.getOrNull(1) in setOf("—", "-", "–"))
      if (!isWholeTitle && !isLast && !isLabel) return@mapIndexed word
      val value = romanValue(numeral) ?: return@mapIndexed word
      "$value$punctuation"
    }
    .joinToString(" ")
}

/** Number-aware, case- and accent-insensitive comparison ("Chapter 2" < "chapter 10"). */
private class NaturalComparator : Comparator<String> {
  private val collator = Collator.getInstance(Locale.ROOT).apply { strength = Collator.PRIMARY }

  override fun compare(a: String, b: String): Int {
    val left = NUMBER_CHUNK.findAll(a).map { it.value }.toList()
    val right = NUMBER_CHUNK.findAll(b).map { it.value }.toList()
    for (index in 0 until minOf(left.size, right.size)) {
      val x = left[index]
      val y = right[index]
      val result =
        if (x[0].isDigit() && y[0].isDigit()) {
          val trimmedX = x.trimStart('0')
          val trimmedY = y.trimStart('0')
          if (trimmedX.length != trimmedY.length) trimmedX.length - trimmedY.length
          else trimmedX.compareTo(trimmedY)
        } else {
          collator.compare(x, y)
        }
      if (result != 0) return result
    }
    return left.size - right.size
  }
}

private val naturalComparator = NaturalComparator()

/** Timestamps come from several clients and imports, so compare instants; unparsable last. */
private fun instantMillis(value: String): Long =
  runCatching { Instant.parse(value).toEpochMilli() }
    .recoverCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
    .getOrDefault(Long.MAX_VALUE)

/**
 * Title order is number-aware ("Chapter 2" before "Chapter 10"); untitled notes go last. Created
 * order is oldest first. Each falls back to the other.
 */
fun <T> orderManuscriptNotes(
  notes: List<T>,
  order: ManuscriptOrder,
  source: (T) -> ManuscriptSourceNote,
): List<T> {
  val byCreated =
    Comparator<T> { a, b ->
      val x = source(a)
      val y = source(b)
      instantMillis(x.createdAt).compareTo(instantMillis(y.createdAt)).takeIf { it != 0 }
        ?: x.createdAt.compareTo(y.createdAt).takeIf { it != 0 }
        ?: x.id.compareTo(y.id)
    }
  val byTitle =
    Comparator<T> { a, b ->
      val x = source(a).title.trim()
      val y = source(b).title.trim()
      if (x.isEmpty() != y.isEmpty()) {
        if (x.isNotEmpty()) -1 else 1
      } else {
        naturalComparator.compare(titleSortKey(x), titleSortKey(y)).takeIf { it != 0 }
          ?: naturalComparator.compare(x, y)
      }
    }
  return notes.sortedWith(
    if (order == ManuscriptOrder.TITLE) byTitle.then(byCreated) else byCreated.then(byTitle)
  )
}

fun parseManuscriptBody(body: String, preset: ManuscriptPreset): List<ManuscriptBlock> {
  val lines = body.replace("\r\n", "\n").replace('\r', '\n').split('\n')
  val blocks = mutableListOf<ManuscriptBlock>()

  if (preset == ManuscriptPreset.POETRY) {
    for (rawLine in lines) {
      val text = rawLine.trimEnd(::isSpace)
      if (text.isEmpty()) {
        if (blocks.isNotEmpty() && blocks.last() != ManuscriptBlock.StanzaBreak) {
          blocks += ManuscriptBlock.StanzaBreak
        }
        continue
      }
      blocks += ManuscriptBlock.Line(text)
    }
    if (blocks.lastOrNull() == ManuscriptBlock.StanzaBreak) blocks.removeAt(blocks.lastIndex)
    return blocks
  }

  for (rawLine in lines) {
    val text = rawLine.trim(::isSpace)
    if (text.isEmpty()) continue
    if (SCENE_BREAK.matches(collapseSpaces(text))) {
      if (blocks.isNotEmpty() && blocks.last() != ManuscriptBlock.SceneBreak) {
        blocks += ManuscriptBlock.SceneBreak
      }
      continue
    }
    blocks += ManuscriptBlock.Paragraph(collapseSpaces(text))
  }
  if (blocks.lastOrNull() == ManuscriptBlock.SceneBreak) blocks.removeAt(blocks.lastIndex)
  return blocks
}

fun buildManuscript(
  title: String,
  notes: List<ManuscriptSourceNote>,
  options: ManuscriptOptions,
): Manuscript {
  val sections = mutableListOf<ManuscriptSection>()
  var wordCount = 0
  for (note in orderManuscriptNotes(notes, options.order) { it }) {
    val sectionTitle = collapseSpaces(note.title.trim(::isSpace))
    val blocks = parseManuscriptBody(note.body, options.preset)
    if (sectionTitle.isEmpty() && blocks.isEmpty()) continue
    wordCount += countWords("${note.title} ${note.body}")
    sections += ManuscriptSection(note.id, sectionTitle, blocks)
  }
  return Manuscript(
    title = title.trim().ifEmpty { "Untitled manuscript" },
    options = options.copy(header = options.header.trim()),
    sections = sections,
    wordCount = wordCount,
  )
}

/** Manuscript-style rounded count, e.g. "about 6,200 words". */
fun approximateWordCount(words: Int): String {
  if (words <= 0) return "0 words"
  val step =
    when {
      words < 1_000 -> 10
      words < 10_000 -> 100
      else -> 1_000
    }
  val rounded = maxOf(step, (words.toDouble() / step).roundToLong().toInt() * step)
  return "about ${String.format(Locale.US, "%,d", rounded)} words"
}

fun manuscriptFileName(title: String, extension: String): String {
  val base =
    collapseSpaces(
        Normalizer.normalize(title, Normalizer.Form.NFKC)
          .replace(Regex("[\\\\/:*?\"<>|\\p{Cc}]+"), " ")
      )
      .trim()
      .takeCodePoints(120)
      .trimStart('.')
      .ifEmpty { "manuscript" }
  return "$base.$extension"
}

/** At most `count` characters, never splitting a surrogate pair (emoji). */
private fun String.takeCodePoints(count: Int): String =
  if (codePointCount(0, length) <= count) this else substring(0, offsetByCodePoints(0, count))

/** Distance from the top of the text area to a prose chapter heading. */
fun chapterDropMm(size: ManuscriptPageSize): Double = (size.heightMm - size.marginMm * 2) / 3

// ---------------------------------------------------------------------------
// DOCX (WordprocessingML), written by hand to avoid a dependency.

const val DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

private const val W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
private const val R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
private const val XML_DECLARATION =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"

private fun twips(mm: Double): Long = Math.round(mm / 25.4 * 1440)

// Characters that are not allowed in XML 1.0 documents.
private val INVALID_XML_CHARS =
  Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]")

private fun escapeXml(value: String): String =
  value
    .replace(INVALID_XML_CHARS, "")
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")

private fun docxRun(text: String): String {
  val content =
    text.split('\t').mapIndexed { index, piece ->
      (if (index > 0) "<w:tab/>" else "") +
        (if (piece.isNotEmpty()) "<w:t xml:space=\"preserve\">${escapeXml(piece)}</w:t>" else "")
    }
  return "<w:r>${content.joinToString("")}</w:r>"
}

private fun docxParagraph(style: String, text: String, pageBreakBefore: Boolean = false): String {
  val properties =
    "<w:pPr><w:pStyle w:val=\"$style\"/>${if (pageBreakBefore) "<w:pageBreakBefore/>" else ""}</w:pPr>"
  return "<w:p>$properties${if (text.isNotEmpty()) docxRun(text) else ""}</w:p>"
}

private fun docxStyles(manuscript: Manuscript): String {
  val options = manuscript.options
  val font = escapeXml(MANUSCRIPT_FONT)
  val size = MANUSCRIPT_FONT_SIZE_PT * 2
  val headerSize = MANUSCRIPT_HEADER_SIZE_PT * 2
  val prose = options.preset == ManuscriptPreset.PROSE
  // Single line at 1.15 for poetry, double spacing for prose (240 = single).
  val line = if (prose) 480 else 276
  val bodyIndent =
    if (prose) "<w:ind w:firstLine=\"${twips(MANUSCRIPT_PROSE_INDENT_MM)}\"/>"
    // Wrapped poetry lines hang-indent so the line break stays visible.
    else "<w:ind w:left=\"360\" w:hanging=\"360\"/>"
  val headingAfter = if (prose) line else size * 10
  val headingRun = if (prose) "" else "<w:b/><w:bCs/>"
  // Word processors drop "space before" at the top of a page, so the chapter
  // drop is an empty paragraph with an exact line height instead.
  val drop = twips(chapterDropMm(options.pageSize))

  return """${XML_DECLARATION}<w:styles xmlns:w="$W_NS">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="$font" w:hAnsi="$font" w:eastAsia="$font" w:cs="$font"/><w:sz w:val="$size"/><w:szCs w:val="$size"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="$line" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Manuscript Body"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>$bodyIndent</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Body"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="$headingAfter"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>$headingRun</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="$line"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="PageDrop"><w:name w:val="Page Drop"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="$drop" w:lineRule="exact"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="WordCount"><w:name w:val="Word Count"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Body"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="$headerSize"/><w:szCs w:val="$headerSize"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="$headerSize"/><w:szCs w:val="$headerSize"/></w:rPr></w:style>
</w:styles>"""
}

private fun docxDocument(manuscript: Manuscript): String {
  val options = manuscript.options
  val size = options.pageSize
  val paragraphs = mutableListOf<String>()

  if (options.titlePage) {
    if (options.preset == ManuscriptPreset.PROSE) {
      paragraphs += docxParagraph("WordCount", approximateWordCount(manuscript.wordCount))
    }
    paragraphs += docxParagraph("PageDrop", "")
    paragraphs += docxParagraph("Title", manuscript.title)
  }

  manuscript.sections.forEachIndexed { sectionIndex, section ->
    // Every section starts a new page, except the first one in the file.
    var needsBreak = sectionIndex > 0 || options.titlePage
    if (section.title.isNotEmpty()) {
      if (options.preset == ManuscriptPreset.PROSE) {
        paragraphs += docxParagraph("PageDrop", "", pageBreakBefore = needsBreak)
        needsBreak = false
      }
      paragraphs += docxParagraph("Heading1", section.title, pageBreakBefore = needsBreak)
      needsBreak = false
    }
    for (block in section.blocks) {
      paragraphs +=
        when (block) {
          is ManuscriptBlock.Line -> docxParagraph("Body", block.text, needsBreak)
          is ManuscriptBlock.Paragraph -> docxParagraph("Body", block.text, needsBreak)
          ManuscriptBlock.SceneBreak -> docxParagraph("SceneBreak", "#", needsBreak)
          ManuscriptBlock.StanzaBreak -> docxParagraph("Normal", "", needsBreak)
        }
      needsBreak = false
    }
  }

  val margin = twips(size.marginMm)
  val headerDistance = twips(size.marginMm / 2)
  val sectionProperties =
    listOf(
        if (options.header.isNotEmpty()) "<w:headerReference w:type=\"default\" r:id=\"rId4\"/>"
        else "",
        if (options.pageNumbers) "<w:footerReference w:type=\"default\" r:id=\"rId5\"/>" else "",
        "<w:pgSz w:w=\"${twips(size.widthMm)}\" w:h=\"${twips(size.heightMm)}\"/>",
        "<w:pgMar w:top=\"$margin\" w:right=\"$margin\" w:bottom=\"$margin\" w:left=\"$margin\" " +
          "w:header=\"$headerDistance\" w:footer=\"$headerDistance\" w:gutter=\"0\"/>",
        // The title page is page 0 and carries no header or number.
        if (options.titlePage) "<w:pgNumType w:start=\"0\"/>" else "",
        if (options.titlePage) "<w:titlePg/>" else "",
      )
      .joinToString("")

  return "${XML_DECLARATION}<w:document xmlns:w=\"$W_NS\" xmlns:r=\"$R_NS\"><w:body>" +
    paragraphs.joinToString("") +
    "<w:sectPr>$sectionProperties</w:sectPr></w:body></w:document>"
}

private fun docxHeader(text: String): String =
  "${XML_DECLARATION}<w:hdr xmlns:w=\"$W_NS\" xmlns:r=\"$R_NS\">${docxParagraph("Header", text)}</w:hdr>"

private fun docxFooter(): String =
  "${XML_DECLARATION}<w:ftr xmlns:w=\"$W_NS\" xmlns:r=\"$R_NS\"><w:p><w:pPr><w:pStyle w:val=\"Footer\"/></w:pPr>" +
    "<w:fldSimple w:instr=\" PAGE \"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>"

private fun docxCoreProperties(title: String, createdAt: String): String {
  val created = escapeXml(createdAt.replace(Regex("\\.\\d+Z$"), "Z"))
  return "${XML_DECLARATION}<cp:coreProperties " +
    "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
    "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
    "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>${escapeXml(title)}</dc:title>" +
    "<dcterms:created xsi:type=\"dcterms:W3CDTF\">$created</dcterms:created>" +
    "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">$created</dcterms:modified></cp:coreProperties>"
}

/** The DOCX package parts, in package order. */
fun manuscriptDocxFiles(manuscript: Manuscript, createdAt: String): List<Pair<String, String>> {
  val header = manuscript.options.header
  val pageNumbers = manuscript.options.pageNumbers
  val contentTypes =
    listOf(
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>",
        "<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>",
        "<Override PartName=\"/word/fontTable.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml\"/>",
        if (header.isNotEmpty())
          "<Override PartName=\"/word/header1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml\"/>"
        else "",
        if (pageNumbers)
          "<Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/>"
        else "",
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
      )
      .joinToString("")
  val documentRelationships =
    listOf(
        "<Relationship Id=\"rId1\" Type=\"$R_NS/styles\" Target=\"styles.xml\"/>",
        "<Relationship Id=\"rId2\" Type=\"$R_NS/settings\" Target=\"settings.xml\"/>",
        "<Relationship Id=\"rId3\" Type=\"$R_NS/fontTable\" Target=\"fontTable.xml\"/>",
        if (header.isNotEmpty())
          "<Relationship Id=\"rId4\" Type=\"$R_NS/header\" Target=\"header1.xml\"/>"
        else "",
        if (pageNumbers) "<Relationship Id=\"rId5\" Type=\"$R_NS/footer\" Target=\"footer1.xml\"/>"
        else "",
      )
      .joinToString("")
  val font = escapeXml(MANUSCRIPT_FONT)
  val relationshipsNs = "http://schemas.openxmlformats.org/package/2006/relationships"

  val files =
    mutableListOf(
      "[Content_Types].xml" to
        "${XML_DECLARATION}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">$contentTypes</Types>",
      "_rels/.rels" to
        "${XML_DECLARATION}<Relationships xmlns=\"$relationshipsNs\">" +
          "<Relationship Id=\"rId1\" Type=\"$R_NS/officeDocument\" Target=\"word/document.xml\"/>" +
          "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
          "</Relationships>",
      "docProps/core.xml" to docxCoreProperties(manuscript.title, createdAt),
      "word/_rels/document.xml.rels" to
        "${XML_DECLARATION}<Relationships xmlns=\"$relationshipsNs\">$documentRelationships</Relationships>",
      "word/document.xml" to docxDocument(manuscript),
      "word/styles.xml" to docxStyles(manuscript),
      "word/settings.xml" to
        "${XML_DECLARATION}<w:settings xmlns:w=\"$W_NS\"><w:defaultTabStop w:val=\"720\"/><w:compat>" +
          "<w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/>" +
          "</w:compat></w:settings>",
      // Recipients without Newsreader get a serif substitute, not a sans.
      "word/fontTable.xml" to
        "${XML_DECLARATION}<w:fonts xmlns:w=\"$W_NS\"><w:font w:name=\"$font\"><w:family w:val=\"roman\"/>" +
          "<w:pitch w:val=\"variable\"/></w:font></w:fonts>",
    )
  if (header.isNotEmpty()) files += "word/header1.xml" to docxHeader(header)
  if (pageNumbers) files += "word/footer1.xml" to docxFooter()
  return files
}

fun writeManuscriptDocx(manuscript: Manuscript, createdAt: String, output: OutputStream) {
  ZipOutputStream(output, Charsets.UTF_8).use { zip ->
    for ((path, content) in manuscriptDocxFiles(manuscript, createdAt)) {
      zip.putNextEntry(ZipEntry(path))
      zip.write(content.toByteArray(Charsets.UTF_8))
      zip.closeEntry()
    }
  }
}
