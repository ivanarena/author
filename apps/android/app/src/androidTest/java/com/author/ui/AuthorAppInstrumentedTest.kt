package com.author.ui

import android.content.Context
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.author.core.LocalNote
import com.author.core.NotesRepository
import com.author.ui.app.AuthorApp
import com.author.ui.state.NotesController
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthorAppInstrumentedTest {
  private companion object {
    const val SAVE_DELAY_ADVANCE_MS = 250L
    const val SAVE_TIMEOUT_MS = 15_000L
  }

  @get:Rule val compose = createComposeRule()

  private lateinit var context: Context
  private val repositories = mutableListOf<NotesRepository>()

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    resetWorkspace()
  }

  @After
  fun tearDown() {
    repositories.forEach { it.close() }
    repositories.clear()
    resetWorkspace()
  }

  @Test
  fun editorDraftPersistsAndAppearsInNotesList() {
    val title = "Android UI draft"
    val body = "Saved through Compose"
    val repository = newRepository()

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember { NotesController(repository, scope) }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.onNodeWithTag("note-title-field").assertIsDisplayed().performTextInput(title)
    compose.onNodeWithTag("note-body-field").assertIsDisplayed().performTextInput(body)
    compose.mainClock.advanceTimeBy(SAVE_DELAY_ADVANCE_MS)
    compose.waitForIdle()
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      savedDraft(repository, title)?.body == body
    }

    compose.onNodeWithContentDescription("Notes").performClick()
    compose.onNodeWithText(title).assertIsDisplayed()
    compose.onNodeWithText(body).assertIsDisplayed()
  }

  @Test
  fun appLockScreenBlocksNotesUntilUnlockRequested() {
    val repository = newRepository()
    val unlockRequested = AtomicBoolean(false)

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember {
        NotesController(repository, scope).also {
          it.appLockEnabled = true
          it.appLocked = true
          it.appLockMessage = "Use this device's screen lock to reopen notes."
        }
      }

      AuthorApp(
        controller = controller,
        onExport = {},
        onImport = {},
        onUnlockApp = { unlockRequested.set(true) },
      )
    }

    compose.onNodeWithText("Author locked").assertIsDisplayed()
    compose.onNodeWithText("Unlock").assertIsDisplayed().performClick()

    compose.waitForIdle()
    assertTrue(unlockRequested.get())
  }

  @Test
  fun longPressNoteSelectsAndOpensSelectedNotesMenu() {
    val repository = newRepository()
    val note = runBlocking { repository.createBlankNote("Long press note", "Menu body") }

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember {
        NotesController(repository, scope).also { it.currentPage = "notes" }
      }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      compose.onAllNodesWithText(note.title).fetchSemanticsNodes().isNotEmpty()
    }
    compose
      .onNodeWithTag("note-row-${note.id}")
      .performSemanticsAction(SemanticsActions.OnLongClick)

    compose.onNodeWithText("1 selected").assertIsDisplayed()
    compose.onNodeWithText("Move selected to Trash").assertIsDisplayed()
  }

  @Test
  fun trashingSelectedNoteOffersImmediateUndo() {
    val repository = newRepository()
    val note = runBlocking { repository.createBlankNote("Undo trash note", "Restore me") }
    lateinit var controller: NotesController

    compose.setContent {
      val scope = rememberCoroutineScope()
      controller = remember { NotesController(repository, scope).also { it.currentPage = "notes" } }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      compose.onAllNodesWithText(note.title).fetchSemanticsNodes().isNotEmpty()
    }
    compose
      .onNodeWithTag("note-row-${note.id}")
      .performSemanticsAction(SemanticsActions.OnLongClick)
    compose.onNodeWithText("Move selected to Trash").performClick()
    compose.onNodeWithText("Undo").assertIsDisplayed().performClick()

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      val workspace = repository.loadWorkspaceSnapshot()
      workspace.notes.any { it.id == note.id } && workspace.trash.none { it.id == note.id }
    }
    assertTrue("Undo should keep the notes page open", controller.currentPage == "notes")
  }

  @Test
  fun signupRecoveryPromptRequiresSavingConfirmation() {
    val repository = newRepository()
    val saveRequested = AtomicBoolean(false)

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember {
        NotesController(repository, scope).also {
          it.signupRecoveryOpen = true
          it.signupRecoveryCodeValue = "author-recovery-v1-test-code"
          it.signupRecoveryKitText = "{\"type\":\"author-recovery-kit\"}\n"
        }
      }

      AuthorApp(
        controller = controller,
        onExport = {},
        onSaveRecoveryKit = {
          saveRequested.set(true)
          controller.signupRecoveryMessage = "Recovery kit saved"
        },
        onImport = {},
      )
    }

    compose.onNodeWithText("Save recovery key").assertIsDisplayed()
    compose.onNodeWithText("Done").assertIsNotEnabled()
    compose.onNodeWithText("Copy key").performClick()
    compose.onNodeWithText("Recovery key copied").assertIsDisplayed()
    compose.onNodeWithText("Hide key").performClick()
    compose.onNodeWithText("Recovery key hidden").assertIsDisplayed()
    compose.onNodeWithText("Show key").performClick()
    compose.onNodeWithText("author-recovery-v1-test-code").assertIsDisplayed()
    compose.onNodeWithText("Save kit").performClick()
    compose.waitForIdle()
    assertTrue(saveRequested.get())

    compose
      .onNode(hasText("I saved the recovery key and kit") and hasClickAction())
      .performSemanticsAction(SemanticsActions.OnClick)
    compose
      .onNode(hasText("Done") and hasClickAction())
      .assertIsEnabled()
      .performSemanticsAction(SemanticsActions.OnClick)
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      compose.onAllNodesWithText("Save recovery key").fetchSemanticsNodes().isEmpty()
    }
    compose.onAllNodesWithText("Save recovery key").assertCountEquals(0)
  }

  private fun savedDraft(repository: NotesRepository, title: String): LocalNote? =
    repository.loadWorkspaceSnapshot().notes.firstOrNull { it.title == title }

  private fun newRepository(): NotesRepository =
    NotesRepository(context).also { repositories.add(it) }

  private fun resetWorkspace() {
    context.deleteDatabase("author.db")
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
  }
}
