package com.author.core

// Page layout for manuscript PDFs, kept free of Android types so it can be unit-tested with a fake
// measurer. Sizes mirror the web print stylesheet (styles/manuscript-print.css): 12 pt text, 1.15
// line height for poetry and double spacing for prose, 10 pt header and page number at half the
// page margin, and prose chapters dropped a third of the way down the text area.

private const val POINTS_PER_MM = 72.0 / 25.4
/** Wrapped poetry lines hang-indent by a quarter inch (as in the DOCX and the web). */
const val MANUSCRIPT_HANGING_INDENT_PT = 18f
private const val FIT_TOLERANCE_PT = 0.01f

enum class ManuscriptTextStyle {
  POEM_LINE,
  /** The rest of a verse line taller than a page; indented as a wrapped line. */
  POEM_LINE_CONTINUED,
  PARAGRAPH,
  /** A prose paragraph continued from the previous page; no first-line indent. */
  PARAGRAPH_CONTINUED,
  SCENE_BREAK,
  POEM_TITLE,
  CHAPTER_TITLE,
  BOOK_TITLE,
  WORD_COUNT,
}

/** Character range of one laid-out line of a text. */
data class MeasuredLine(val start: Int, val end: Int)

/** Breaks text into lines at the manuscript's text width for a style. */
fun interface ManuscriptMeasurer {
  fun lines(text: String, style: ManuscriptTextStyle): List<MeasuredLine>
}

data class PlacedText(
  val text: String,
  val style: ManuscriptTextStyle,
  /** Top of the first line, in points from the top of the text area. */
  val top: Float,
  val lines: List<MeasuredLine>,
)

data class ManuscriptPage(val number: Int?, val isTitlePage: Boolean, val items: List<PlacedText>)

data class ManuscriptMetrics(val options: ManuscriptOptions) {
  val pageWidth = (options.pageSize.widthMm * POINTS_PER_MM).toFloat()
  val pageHeight = (options.pageSize.heightMm * POINTS_PER_MM).toFloat()
  val margin = (options.pageSize.marginMm * POINTS_PER_MM).toFloat()
  val contentWidth = pageWidth - margin * 2
  val contentHeight = pageHeight - margin * 2
  val fontSize = MANUSCRIPT_FONT_SIZE_PT.toFloat()
  val headerFontSize = MANUSCRIPT_HEADER_SIZE_PT.toFloat()
  val lineHeight = fontSize * if (options.preset == ManuscriptPreset.PROSE) 2f else 1.15f
  val proseIndent = (MANUSCRIPT_PROSE_INDENT_MM * POINTS_PER_MM).toFloat()
  val chapterDrop = (chapterDropMm(options.pageSize) * POINTS_PER_MM).toFloat()
  /** Space after a section title: 12 pt for poems, one double-spaced line for chapters. */
  val titleAfter = if (options.preset == ManuscriptPreset.PROSE) lineHeight else fontSize
}

private class PageBuilder(private val metrics: ManuscriptMetrics) {
  val pages = mutableListOf<ManuscriptPage>()
  private var items = mutableListOf<PlacedText>()
  private var pageNumber = 0
  var y = 0f
    private set

  val isEmpty: Boolean
    get() = items.isEmpty()

  fun remaining(): Float = metrics.contentHeight - y

  fun fits(height: Float): Boolean = y + height <= metrics.contentHeight + FIT_TOLERANCE_PT

  fun titlePage(items: List<PlacedText>) {
    pages += ManuscriptPage(number = null, isTitlePage = true, items = items)
  }

  fun newPage() {
    pageNumber += 1
    items = mutableListOf()
    pages += ManuscriptPage(number = pageNumber, isTitlePage = false, items = items)
    y = 0f
  }

  fun place(text: String, style: ManuscriptTextStyle, lines: List<MeasuredLine>) {
    items += PlacedText(text, style, y, lines)
    y += lines.size * metrics.lineHeight
  }

  fun skip(height: Float) {
    y += height
  }
}

/** Lines that fit in the remaining height (at least one when `atLeastOne`). */
private fun linesThatFit(remaining: Float, lineHeight: Float, atLeastOne: Boolean): Int {
  val count = ((remaining + FIT_TOLERANCE_PT) / lineHeight).toInt()
  return if (atLeastOne) maxOf(1, count) else maxOf(0, count)
}

/** Splits `text` after `count` measured lines; returns (first part, rest). */
private fun splitAfterLines(
  text: String,
  lines: List<MeasuredLine>,
  count: Int,
): Pair<String, String> {
  val cut = lines[count - 1].end
  return text.substring(0, cut).trimEnd() to text.substring(cut).trimStart()
}

fun paginateManuscript(manuscript: Manuscript, measurer: ManuscriptMeasurer): List<ManuscriptPage> {
  val metrics = ManuscriptMetrics(manuscript.options)
  val prose = manuscript.options.preset == ManuscriptPreset.PROSE
  val builder = PageBuilder(metrics)

  if (manuscript.options.titlePage) {
    val items = mutableListOf<PlacedText>()
    var top = 0f
    if (prose) {
      val text = approximateWordCount(manuscript.wordCount)
      items +=
        PlacedText(
          text,
          ManuscriptTextStyle.WORD_COUNT,
          0f,
          measurer.lines(text, ManuscriptTextStyle.WORD_COUNT),
        )
      top = metrics.lineHeight
    }
    items +=
      PlacedText(
        manuscript.title,
        ManuscriptTextStyle.BOOK_TITLE,
        top + metrics.chapterDrop,
        measurer.lines(manuscript.title, ManuscriptTextStyle.BOOK_TITLE),
      )
    builder.titlePage(items)
  }

  for (section in manuscript.sections) {
    builder.newPage()
    if (section.title.isNotEmpty()) {
      if (prose) builder.skip(metrics.chapterDrop)
      val style = if (prose) ManuscriptTextStyle.CHAPTER_TITLE else ManuscriptTextStyle.POEM_TITLE
      builder.place(section.title, style, measurer.lines(section.title, style))
      builder.skip(metrics.titleAfter)
    }

    for (block in section.blocks) {
      when (block) {
        ManuscriptBlock.StanzaBreak -> {
          // A stanza gap never opens a page, and is dropped at a page end.
          if (!builder.isEmpty && builder.fits(metrics.lineHeight)) builder.skip(metrics.lineHeight)
        }
        ManuscriptBlock.SceneBreak -> {
          if (!builder.fits(metrics.lineHeight)) builder.newPage()
          builder.place(
            "#",
            ManuscriptTextStyle.SCENE_BREAK,
            measurer.lines("#", ManuscriptTextStyle.SCENE_BREAK),
          )
        }
        is ManuscriptBlock.Line ->
          placeSplittable(
            builder,
            metrics,
            measurer,
            block.text,
            ManuscriptTextStyle.POEM_LINE,
            wholeUnlessTooTall = true,
          )
        is ManuscriptBlock.Paragraph ->
          placeSplittable(
            builder,
            metrics,
            measurer,
            block.text,
            ManuscriptTextStyle.PARAGRAPH,
            wholeUnlessTooTall = false,
          )
      }
    }
  }
  return builder.pages
}

/**
 * Places a text, continuing it on new pages as needed. Verse lines move whole to the next page
 * unless they are taller than a page by themselves; prose paragraphs break between lines.
 */
private fun placeSplittable(
  builder: PageBuilder,
  metrics: ManuscriptMetrics,
  measurer: ManuscriptMeasurer,
  text: String,
  firstStyle: ManuscriptTextStyle,
  wholeUnlessTooTall: Boolean,
) {
  val continuedStyle =
    if (firstStyle == ManuscriptTextStyle.POEM_LINE) ManuscriptTextStyle.POEM_LINE_CONTINUED
    else ManuscriptTextStyle.PARAGRAPH_CONTINUED
  var rest = text
  var style = firstStyle
  while (true) {
    val lines = measurer.lines(rest, style)
    if (lines.isEmpty()) return
    val height = lines.size * metrics.lineHeight
    if (builder.fits(height)) {
      builder.place(rest, style, lines)
      return
    }
    val tooTallForAnyPage = height > metrics.contentHeight + FIT_TOLERANCE_PT
    if (wholeUnlessTooTall && !tooTallForAnyPage) {
      builder.newPage()
      continue
    }
    // Every page receives at least one line, so layout always terminates.
    val count = linesThatFit(builder.remaining(), metrics.lineHeight, atLeastOne = builder.isEmpty)
    if (count == 0) {
      builder.newPage()
      continue
    }
    val (first, remainder) = splitAfterLines(rest, lines, minOf(count, lines.size))
    builder.place(
      first,
      style,
      lines.take(count).map { MeasuredLine(it.start, minOf(it.end, first.length)) },
    )
    if (remainder.isEmpty()) return
    rest = remainder
    style = continuedStyle
    builder.newPage()
  }
}
