package com.author.ui

import android.content.Context
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.author.core.NotesRepository
import com.author.ui.app.NotesApp
import com.author.ui.state.NotesController
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ManuscriptExportDialogInstrumentedTest {
  @get:Rule val compose = createComposeRule()

  private val context: Context = ApplicationProvider.getApplicationContext()
  private val repositories = mutableListOf<NotesRepository>()

  @Before fun setUp() = resetWorkspace()

  @After
  fun tearDown() {
    repositories.forEach { it.close() }
    resetWorkspace()
  }

  private fun resetWorkspace() {
    context.deleteDatabase("author.db")
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
  }

  @Test
  fun optionTogglesAreSingleLabelledCheckboxes() {
    val repository = NotesRepository(context).also { repositories += it }
    val notebook = runBlocking { repository.createNotebook("Poems")!! }
    lateinit var controller: NotesController
    compose.setContent {
      val scope = rememberCoroutineScope()
      // Seeded directly: the test is about the dialog, not app start-up timing.
      controller = remember {
        NotesController(repository, scope).also { it.notebooks = listOf(notebook) }
      }
      NotesApp(controller = controller, onExport = {}, onImport = {})
    }
    compose.runOnIdle { controller.openManuscriptExport(notebook) }
    compose.waitUntil(timeoutMillis = 15_000) {
      compose.onAllNodesWithText("Export manuscript").fetchSemanticsNodes().isNotEmpty()
    }

    // Each option is one TalkBack stop: a checkbox named by its label.
    val pageNumbers = hasText("Page numbers") and isToggleable()
    compose.onNode(pageNumbers).performScrollTo().assertIsOn()
    compose.onNode(hasText("Title page") and isToggleable()).assertIsOff()
    compose.onAllNodes(isToggleable()).assertCountEquals(2)
    compose
      .onAllNodes(
        isToggleable() and
          SemanticsMatcher.expectValue(
            SemanticsProperties.Role,
            androidx.compose.ui.semantics.Role.Checkbox,
          )
      )
      .assertCountEquals(2)

    compose.onNode(pageNumbers).performClick()
    compose.onNode(pageNumbers).assertIsOff()
    compose.runOnIdle { assertFalse(controller.manuscriptOptions.pageNumbers) }
    assertEquals(1, compose.onAllNodesWithText("Title page").fetchSemanticsNodes().size)
  }
}
