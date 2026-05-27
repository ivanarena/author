package com.author.ui

import android.content.Context
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.author.core.LocalNote
import com.author.core.NotesDatabase
import com.author.core.NotesRepository
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthorAppInstrumentedTest {
  @get:Rule val compose = createComposeRule()

  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    resetWorkspace()
  }

  @After
  fun tearDown() {
    resetWorkspace()
  }

  @Test
  fun editorDraftPersistsAndAppearsInNotesList() {
    val title = "Android UI draft"
    val body = "Saved through Compose"

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember { NotesController(NotesRepository(context), scope) }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.onNodeWithTag("note-title-field").assertIsDisplayed().performTextInput(title)
    compose.onNodeWithTag("note-body-field").assertIsDisplayed().performTextInput(body)
    compose.waitUntil(timeoutMillis = 5_000) { savedDraft(title)?.body == body }

    compose.onNodeWithContentDescription("Notes").performClick()
    compose.onNodeWithText(title).assertIsDisplayed()
    compose.onNodeWithText(body).assertIsDisplayed()
  }

  private fun savedDraft(title: String): LocalNote? {
    val db = NotesDatabase(context)
    try {
      return db.allNotes().firstOrNull { it.title == title }
    } finally {
      db.close()
    }
  }

  private fun resetWorkspace() {
    context.deleteDatabase("author.db")
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
  }
}
