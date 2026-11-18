package com.author.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ManuscriptPdfInstrumentedTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val sentence =
    "The shutters had been closed for eleven years, and when Marta finally pushed them open " +
      "the light came in all at once, like water through a broken dam."

  private fun render(name: String, manuscript: Manuscript): Pair<RenderedManuscript, File> {
    val rendered = ManuscriptPdfRenderer(context).render(manuscript)
    // Kept on the device so the PDFs can be pulled and inspected (fonts, text layer).
    val directory = File(context.getExternalFilesDir(null), "manuscript-test").apply { mkdirs() }
    val file = File(directory, "$name.pdf").apply { writeBytes(rendered.pdf) }
    return rendered to file
  }

  private fun assertReadablePages(
    rendered: RenderedManuscript,
    file: File,
    sizePt: Pair<Int, Int>,
  ) {
    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
      PdfRenderer(descriptor).use { pdf ->
        assertEquals(rendered.pageCount, pdf.pageCount)
        pdf.openPage(pdf.pageCount - 1).use { page ->
          assertEquals(sizePt.first, page.width)
          assertEquals(sizePt.second, page.height)
          val bitmap = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
          bitmap.eraseColor(Color.WHITE)
          page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          var dark = 0
          for (x in 0 until bitmap.width step 2) for (y in 0 until bitmap.height step 2) {
            if (Color.red(bitmap.getPixel(x, y)) < 128) dark += 1
          }
          assertTrue("page has text", dark > 50)
        }
      }
    }
  }

  @Test
  fun rendersPoetryOnePoemPerPage() {
    val poems =
      (1..3).map { number ->
        ManuscriptSourceNote(
          "p$number",
          "Poem $number",
          (0 until 12).joinToString("\n") {
            if (it % 4 == 3) "" else "   line $it of poem $number"
          },
          "2026-01-0${number}T00:00:00Z",
        )
      }
    val manuscript =
      buildManuscript("Beyond Rituals", poems, ManuscriptOptions(header = "BEYOND RITUALS"))
    val (rendered, file) = render("poetry", manuscript)
    assertEquals(3, rendered.pageCount)
    assertEquals("Beyond Rituals.pdf", rendered.fileName)
    assertReadablePages(rendered, file, 595 to 842)
  }

  @Test
  fun rendersProseWithTitlePageAndSplitsParagraphs() {
    val chapters =
      (1..3).map { number ->
        ManuscriptSourceNote(
          "c$number",
          "Chapter $number",
          (0 until 14).joinToString("\n") { if (it == 6) "* * *" else sentence.repeat(1 + it % 3) },
          "2026-01-0${number}T00:00:00Z",
        )
      }
    val manuscript =
      buildManuscript(
        "The House on Via Garibaldi",
        chapters,
        ManuscriptOptions(
          preset = ManuscriptPreset.PROSE,
          pageSize = ManuscriptPageSize.LETTER,
          header = "The House on Via Garibaldi",
          titlePage = true,
        ),
      )
    val (rendered, file) = render("prose", manuscript)
    assertTrue(rendered.pageCount > 4)
    assertReadablePages(rendered, file, 612 to 792)
  }

  @Test
  fun rendersANovelCompactly() {
    val chapters =
      (1..30).map { number ->
        ManuscriptSourceNote(
          "n$number",
          "Chapter $number",
          (0 until 40).joinToString("\n") {
            if (it % 13 == 12) "* * *" else sentence.repeat(2 + it % 3)
          },
          "2026-01-01T00:00:00Z",
        )
      }
    val manuscript =
      buildManuscript(
        "Novel",
        chapters,
        ManuscriptOptions(preset = ManuscriptPreset.PROSE, header = "Novel", titlePage = true),
      )
    val started = System.nanoTime()
    val (rendered, file) = render("novel", manuscript)
    val millis = (System.nanoTime() - started) / 1_000_000
    android.util.Log.i(
      "ManuscriptPdfTest",
      "novel: ${manuscript.wordCount} words, ${rendered.pageCount} pages, " +
        "${rendered.pdf.size} bytes, $millis ms",
    )
    assertTrue(rendered.pageCount > 150)
    // Static fonts embed once: the file stays small enough for submission portals.
    assertTrue("${rendered.pdf.size} bytes", rendered.pdf.size < 3_000_000)
    assertReadablePages(rendered, file, 595 to 842)
  }

  @Test
  fun rendersTextTallerThanAPage() {
    val manuscript =
      buildManuscript(
        "Paste",
        listOf(
          ManuscriptSourceNote("w", "Wide", "start ${"x".repeat(9000)} end", "2026-01-01T00:00:00Z")
        ),
        ManuscriptOptions(preset = ManuscriptPreset.PROSE, pageSize = ManuscriptPageSize.A5),
      )
    val (rendered, file) = render("long-word", manuscript)
    assertTrue(rendered.pageCount > 1)
    assertReadablePages(rendered, file, 420 to 595)
  }
}
