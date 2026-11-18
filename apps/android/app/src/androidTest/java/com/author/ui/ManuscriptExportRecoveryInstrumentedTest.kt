package com.author.ui

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.author.core.NotesRepository
import com.author.ui.state.NotesController
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipInputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ManuscriptExportRecoveryInstrumentedTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val scopes = mutableListOf<CoroutineScope>()
  private val repositories = mutableListOf<NotesRepository>()

  @Before fun setUp() = resetWorkspace()

  @After
  fun tearDown() {
    scopes.forEach { it.cancel() }
    repositories.forEach { it.close() }
    resetWorkspace()
  }

  private fun resetWorkspace() {
    context.deleteDatabase("author.db")
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
  }

  private fun newController(): NotesController {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val repository = NotesRepository(context)
    scopes += scope
    repositories += repository
    return NotesController(repository, scope)
  }

  private fun waitFor(timeoutMs: Long = 15_000, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (!condition()) {
      check(System.currentTimeMillis() < deadline) { "condition not met in $timeoutMs ms" }
      Thread.sleep(50)
    }
  }

  @Test
  fun writesTheDocxWhenThePickerReturnsToARecreatedActivity() {
    val setup = NotesRepository(context).also { repositories += it }
    val notebook = runBlocking { setup.createNotebook("Poems")!! }
    runBlocking {
      val note = setup.createBlankNote("Poem 1", "first line")
      setup.assignNoteToNotebook(note.id, notebook.id, true)
    }

    // Controller before the activity is recreated: prepares and opens the picker.
    val before = newController()
    runBlocking(Dispatchers.Main) { before.refresh() }
    val requested = AtomicReference<String?>(null)
    runBlocking(Dispatchers.Main) {
      before.openManuscriptExport(before.notebooks.first { it.id == notebook.id })
      before.prepareManuscriptDocx { requested.set(it) }
    }
    waitFor { requested.get() != null }
    assertEquals("Poems.docx", requested.get())

    // The picker returns to a new controller that never prepared anything.
    val after = newController()
    val output = File(context.cacheDir, "recovered.docx").apply { writeText("x".repeat(50_000)) }
    runBlocking(Dispatchers.Main) {
      after.completeManuscriptDocx(Uri.fromFile(output), context.contentResolver)
    }
    var document = ""
    waitFor {
      runCatching {
          ZipInputStream(output.inputStream()).use { zip ->
            generateSequence { zip.nextEntry }
              .first { it.name == "word/document.xml" }
              .let { document = zip.readBytes().toString(Charsets.UTF_8) }
          }
        }
        .isSuccess
    }
    assertTrue(document.contains("Poem 1"))
    // Saving over a larger file truncates it (no stale tail after the ZIP).
    assertTrue(output.length() < 50_000)

    // The request is used once: a later picker result does nothing.
    val stray = File(context.cacheDir, "stray.docx").apply { delete() }
    runBlocking(Dispatchers.Main) {
      after.completeManuscriptDocx(Uri.fromFile(stray), context.contentResolver)
    }
    Thread.sleep(500)
    assertTrue(!stray.exists() || stray.length() == 0L)
  }
}
