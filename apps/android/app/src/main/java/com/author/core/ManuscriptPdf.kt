package com.author.core

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.res.ResourcesCompat
import com.author.R
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import kotlin.math.floor
import kotlin.math.roundToInt

/** A manuscript rendered to PDF bytes, ready to print or save. */
class RenderedManuscript(val fileName: String, val pdf: ByteArray, val pageCount: Int)

/**
 * Renders manuscripts to PDF with Android's own line breaking and PDF canvas, set in Newsreader
 * (embedded in the file). Pagination lives in ManuscriptPagination.kt.
 */
class ManuscriptPdfRenderer(context: Context) {
  private val typeface: Typeface =
    runCatching { ResourcesCompat.getFont(context, R.font.newsreader_variable) }.getOrNull()
      ?: Typeface.SERIF

  private fun paint(size: Float, bold: Boolean = false): TextPaint =
    TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
      typeface = this@ManuscriptPdfRenderer.typeface
      textSize = size
      color = Color.BLACK
      // Variable font: weight for titles, optical size matched to the text size.
      setFontVariationSettings("'wght' ${if (bold) 700 else 400}, 'opsz' ${size.roundToInt()}")
    }

  private fun isBold(style: ManuscriptTextStyle) =
    style == ManuscriptTextStyle.POEM_TITLE || style == ManuscriptTextStyle.BOOK_TITLE

  private fun firstLineIndent(style: ManuscriptTextStyle, metrics: ManuscriptMetrics): Float =
    when (style) {
      ManuscriptTextStyle.PARAGRAPH -> metrics.proseIndent
      ManuscriptTextStyle.POEM_LINE_CONTINUED -> MANUSCRIPT_HANGING_INDENT_PT
      else -> 0f
    }

  private fun laterLineIndent(style: ManuscriptTextStyle): Float =
    when (style) {
      ManuscriptTextStyle.POEM_LINE,
      ManuscriptTextStyle.POEM_LINE_CONTINUED -> MANUSCRIPT_HANGING_INDENT_PT
      else -> 0f
    }

  private fun measurer(metrics: ManuscriptMetrics): ManuscriptMeasurer {
    val width = floor(metrics.contentWidth).toInt()
    val paints = ManuscriptTextStyle.entries.associateWith { paint(metrics.fontSize, isBold(it)) }
    return ManuscriptMeasurer { text, style ->
      val layout =
        StaticLayout.Builder.obtain(text, 0, text.length, paints.getValue(style), width)
          .setIncludePad(false)
          .setAlignment(Layout.Alignment.ALIGN_NORMAL)
          .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
          .setIndents(
            intArrayOf(
              firstLineIndent(style, metrics).roundToInt(),
              laterLineIndent(style).roundToInt(),
            ),
            null,
          )
          .build()
      (0 until layout.lineCount).map {
        MeasuredLine(layout.getLineStart(it), layout.getLineEnd(it))
      }
    }
  }

  fun render(source: Manuscript): RenderedManuscript {
    // Tabs have no glyph; set them as four spaces, like the web's tab-size.
    val manuscript =
      source.copy(
        sections =
          source.sections.map { section ->
            section.copy(
              blocks =
                section.blocks.map { block ->
                  if (block is ManuscriptBlock.Line)
                    block.copy(text = block.text.replace("\t", "    "))
                  else block
                }
            )
          }
      )
    val metrics = ManuscriptMetrics(manuscript.options)
    val pages = paginateManuscript(manuscript, measurer(metrics))
    val document = PdfDocument()
    try {
      pages.forEachIndexed { index, page ->
        val info =
          PdfDocument.PageInfo.Builder(
              metrics.pageWidth.roundToInt(),
              metrics.pageHeight.roundToInt(),
              index + 1,
            )
            .create()
        val pdfPage = document.startPage(info)
        drawPage(pdfPage.canvas, page, manuscript, metrics)
        document.finishPage(pdfPage)
      }
      val bytes = ByteArrayOutputStream().also { document.writeTo(it) }.toByteArray()
      return RenderedManuscript(manuscriptFileName(manuscript.title, "pdf"), bytes, pages.size)
    } finally {
      document.close()
    }
  }

  /** Baseline that centres a font's glyphs in a line box, like CSS half-leading. */
  private fun baseline(top: Float, lineHeight: Float, paint: TextPaint): Float {
    val metrics = paint.fontMetrics
    return top + (lineHeight - (metrics.descent - metrics.ascent)) / 2 - metrics.ascent
  }

  private fun drawCentered(canvas: Canvas, text: String, top: Float, metrics: ManuscriptMetrics) {
    val paint = paint(metrics.headerFontSize)
    val fitted =
      TextUtils.ellipsize(text, paint, metrics.contentWidth, TextUtils.TruncateAt.END).toString()
    val x = metrics.margin + (metrics.contentWidth - paint.measureText(fitted)) / 2
    canvas.drawText(fitted, x, baseline(top, metrics.headerFontSize * 1.2f, paint), paint)
  }

  private fun drawPage(
    canvas: Canvas,
    page: ManuscriptPage,
    manuscript: Manuscript,
    metrics: ManuscriptMetrics,
  ) {
    canvas.drawColor(Color.WHITE)
    val header = manuscript.options.header
    if (!page.isTitlePage && header.isNotEmpty()) {
      drawCentered(canvas, header, metrics.margin / 2, metrics)
    }
    if (!page.isTitlePage && manuscript.options.pageNumbers && page.number != null) {
      val boxHeight = metrics.headerFontSize * 1.2f
      drawCentered(
        canvas,
        page.number.toString(),
        metrics.pageHeight - metrics.margin / 2 - boxHeight,
        metrics,
      )
    }

    for (item in page.items) {
      val paint = paint(metrics.fontSize, isBold(item.style))
      item.lines.forEachIndexed { index, line ->
        val text = item.text.substring(line.start, minOf(line.end, item.text.length)).trimEnd()
        if (text.isEmpty()) return@forEachIndexed
        val width = paint.measureText(text)
        val x =
          when (item.style) {
            ManuscriptTextStyle.SCENE_BREAK,
            ManuscriptTextStyle.POEM_TITLE,
            ManuscriptTextStyle.CHAPTER_TITLE,
            ManuscriptTextStyle.BOOK_TITLE -> metrics.margin + (metrics.contentWidth - width) / 2
            ManuscriptTextStyle.WORD_COUNT -> metrics.margin + metrics.contentWidth - width
            else ->
              metrics.margin +
                if (index == 0) firstLineIndent(item.style, metrics)
                else laterLineIndent(item.style)
          }
        val top = metrics.margin + item.top + index * metrics.lineHeight
        canvas.drawText(text, x, baseline(top, metrics.lineHeight, paint), paint)
      }
    }
  }
}

/** Hands a rendered manuscript to the system print dialog, which can also save a PDF. */
private class ManuscriptPrintAdapter(private val rendered: RenderedManuscript) :
  PrintDocumentAdapter() {
  override fun onLayout(
    oldAttributes: PrintAttributes?,
    newAttributes: PrintAttributes,
    cancellationSignal: CancellationSignal,
    callback: LayoutResultCallback,
    extras: Bundle?,
  ) {
    if (cancellationSignal.isCanceled) {
      callback.onLayoutCancelled()
      return
    }
    val info =
      PrintDocumentInfo.Builder(rendered.fileName)
        .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
        .setPageCount(rendered.pageCount)
        .build()
    // The pages have their own size; other paper is scaled by the print system.
    callback.onLayoutFinished(info, oldAttributes == null)
  }

  override fun onWrite(
    pages: Array<out PageRange>,
    destination: ParcelFileDescriptor,
    cancellationSignal: CancellationSignal,
    callback: WriteResultCallback,
  ) {
    if (cancellationSignal.isCanceled) {
      callback.onWriteCancelled()
      return
    }
    try {
      // The print system owns and closes `destination`.
      val output = FileOutputStream(destination.fileDescriptor)
      output.write(rendered.pdf)
      output.flush()
      callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
    } catch (error: Exception) {
      callback.onWriteFailed(error.message)
    }
  }
}

fun printRenderedManuscript(
  context: Context,
  rendered: RenderedManuscript,
  size: ManuscriptPageSize,
) {
  val printManager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
  val media =
    when (size) {
      ManuscriptPageSize.A4 -> PrintAttributes.MediaSize.ISO_A4
      ManuscriptPageSize.A5 -> PrintAttributes.MediaSize.ISO_A5
      ManuscriptPageSize.LETTER -> PrintAttributes.MediaSize.NA_LETTER
    }
  printManager.print(
    rendered.fileName.removeSuffix(".pdf"),
    ManuscriptPrintAdapter(rendered),
    PrintAttributes.Builder()
      .setMediaSize(media)
      .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
      .build(),
  )
}
