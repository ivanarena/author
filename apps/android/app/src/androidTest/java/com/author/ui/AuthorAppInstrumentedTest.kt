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
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
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
  fun editorStepwiseTypingKeepsLatestDraftVisibleAndSaved() {
    val repository = newRepository()
    val titleChunks = listOf("Android", " UI", " draft")
    val bodyChunks = listOf("First chunk", " typed slowly", " while autosave", " keeps up")

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember { NotesController(repository, scope) }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    var expectedTitle = ""
    titleChunks.forEach { chunk ->
      expectedTitle += chunk
      compose.onNodeWithTag("note-title-field").assertIsDisplayed().performTextInput(chunk)
      compose.onNodeWithTag("note-title-field").assertTextEquals(expectedTitle)
    }

    var expectedBody = ""
    bodyChunks.forEach { chunk ->
      expectedBody += chunk
      compose.onNodeWithTag("note-body-field").assertIsDisplayed().performTextInput(chunk)
      compose.onNodeWithTag("note-body-field").assertTextEquals(expectedBody)
    }

    compose.mainClock.advanceTimeBy(SAVE_DELAY_ADVANCE_MS)
    compose.waitForIdle()
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      savedDraft(repository, expectedTitle)?.body == expectedBody
    }
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
    val notebook = runBlocking { repository.createNotebook("Existing notebook")!! }
    val note = runBlocking { repository.createBlankNote("Long press note", "Menu body") }
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
    val appRoot = compose.onRoot().fetchSemanticsNode()
    val screenCenter = appRoot.positionOnScreen.x + appRoot.size.width / 2f
    compose
      .onNodeWithTag("note-row-${note.id}")
      .performSemanticsAction(SemanticsActions.OnLongClick)

    compose.onNodeWithText("1 selected").assertIsDisplayed()
    val favoriteAction = compose.onNodeWithText("Add selected to Favorites").assertIsDisplayed()
    val actionNode = favoriteAction.fetchSemanticsNode()
    val actionCenter = actionNode.positionOnScreen.x + actionNode.size.width / 2f
    assertTrue(
      "The selected-notes menu should open on the right ($actionCenter <= $screenCenter)",
      actionCenter > screenCenter,
    )
    favoriteAction.performClick()
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      repository.loadWorkspaceSnapshot().notes.any { it.id == note.id && it.isFavorite }
    }

    compose
      .onNodeWithTag("note-row-${note.id}")
      .performSemanticsAction(SemanticsActions.OnLongClick)
    assertTrue(
      "The selected-notes menu should include the existing notebook",
      compose.onAllNodesWithText(notebook.name).fetchSemanticsNodes().size >= 2,
    )
    compose.onNodeWithText("New notebook").assertIsDisplayed().performClick()
    compose.onNodeWithText("Notebook name").performTextInput("Created from selection")
    compose.onNodeWithText("Create").performClick()

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      val workspace = repository.loadWorkspaceSnapshot()
      val created = workspace.notebooks.firstOrNull { it.name == "Created from selection" }
      created != null &&
        workspace.notes.any { it.id == note.id && it.notebookIds.contains(created.id) }
    }
    assertTrue(
      "Creating a notebook from selection should preserve the notes filter",
      controller.filterId == "all",
    )
  }

  @Test
  fun selectionToolbarSelectAllReflectsPressedState() {
    val repository = newRepository()
    val first = runBlocking { repository.createBlankNote("Select all first", "Body") }
    val second = runBlocking { repository.createBlankNote("Select all second", "Body") }

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember {
        NotesController(repository, scope).also {
          it.currentPage = "notes"
          it.noteSelectionMode = true
        }
      }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      compose.onAllNodesWithText(first.title).fetchSemanticsNodes().isNotEmpty() &&
        compose.onAllNodesWithText(second.title).fetchSemanticsNodes().isNotEmpty()
    }
    compose.onNodeWithText("Select notes").assertIsDisplayed()
    compose
      .onNodeWithContentDescription("Select all visible notes")
      .assertIsDisplayed()
      .performClick()

    compose.onNodeWithText("2 selected").assertIsDisplayed()
    compose
      .onNodeWithContentDescription("Clear visible selection")
      .assertIsDisplayed()
      .performClick()
    compose.onNodeWithText("Select notes").assertIsDisplayed()
    compose.onNodeWithContentDescription("Select all visible notes").assertIsDisplayed()
  }

  @Test
  fun notebooksPageMarksMembershipForSelectedNote() {
    val repository = newRepository()
    val ideas = runBlocking { repository.createNotebook("Ideas")!! }
    val archive = runBlocking { repository.createNotebook("Archive")!! }
    val note = runBlocking {
      val draft = repository.createBlankNote("Notebook-marked note", "Menu body")
      repository.assignNoteToNotebook(draft.id, ideas.id, true) ?: draft
    }

    compose.setContent {
      val scope = rememberCoroutineScope()
      val controller = remember {
        NotesController(repository, scope).also {
          it.currentPage = "notebooks"
          it.noteSelectionMode = true
          it.selectedNoteIds = setOf(note.id)
        }
      }

      LaunchedEffect(Unit) { controller.initialize() }
      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    waitUntilContentDescriptionDisplayed("Selected note is in Ideas")
    compose.onNodeWithText(ideas.name).assertIsDisplayed()
    compose.onNodeWithText(archive.name).assertIsDisplayed()
    assertContentDescriptionDoesNotExist("Selected note is in Archive")
  }

  @Test
  fun editorFavoriteActionUpdatesPressedState() {
    val repository = newRepository()
    val note = runBlocking { repository.createBlankNote("Favorite pressed note", "Menu body") }
    lateinit var controller: NotesController

    compose.setContent {
      val scope = rememberCoroutineScope()
      controller = remember {
        NotesController(repository, scope).also {
          it.selectedNote = note
          it.titleValue = note.title
          it.bodyValue = note.body
        }
      }

      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.onNodeWithContentDescription("Note actions").assertIsDisplayed().performClick()
    compose.onNodeWithText("Add to Favorites").assertIsDisplayed().performClick()

    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      repository.loadWorkspaceSnapshot().notes.any { it.id == note.id && it.isFavorite }
    }
    compose.onNodeWithContentDescription("Note actions").assertIsDisplayed().performClick()
    compose.onNodeWithText("Remove from Favorites").assertIsDisplayed()

    compose.runOnIdle { controller.currentPage = "notebooks" }
    waitUntilContentDescriptionDisplayed("Selected note is in Favorites")
  }

  @Test
  fun editorNotebookActionsUpdateSelectedMembershipState() {
    val repository = newRepository()
    val ideas = runBlocking { repository.createNotebook("Pressed Ideas")!! }
    val note = runBlocking { repository.createBlankNote("Notebook pressed note", "Menu body") }
    lateinit var controller: NotesController

    compose.setContent {
      val scope = rememberCoroutineScope()
      controller = remember {
        NotesController(repository, scope).also {
          it.notebooks = listOf(ideas)
          it.selectedNote = note
          it.titleValue = note.title
          it.bodyValue = note.body
        }
      }

      AuthorApp(controller = controller, onExport = {}, onImport = {})
    }

    compose.onNodeWithContentDescription("Note actions").assertIsDisplayed().performClick()
    compose.onNodeWithText(ideas.name).assertIsDisplayed().performClick()
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      repository.loadWorkspaceSnapshot().notes.any {
        it.id == note.id && it.notebookIds.contains(ideas.id)
      }
    }

    compose.runOnIdle { controller.currentPage = "notebooks" }
    waitUntilContentDescriptionDisplayed("Selected note is in ${ideas.name}")
    assertContentDescriptionDoesNotExist("Selected note is unfiled")

    compose.runOnIdle { controller.currentPage = "editor" }
    compose.onNodeWithContentDescription("Note actions").assertIsDisplayed().performClick()
    compose.onNodeWithText("Unfiled").assertIsDisplayed().performClick()
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      repository.loadWorkspaceSnapshot().notes.any { it.id == note.id && it.notebookIds.isEmpty() }
    }

    compose.runOnIdle { controller.currentPage = "notebooks" }
    waitUntilContentDescriptionDisplayed("Selected note is unfiled")
    assertContentDescriptionDoesNotExist("Selected note is in ${ideas.name}")
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
    waitUntilTextDisplayed("Recovery key copied")
    compose.onNodeWithText("Hide key").performClick()
    waitUntilTextDisplayed("Recovery key hidden")
    compose.onNodeWithText("Show key").performClick()
    waitUntilTextDisplayed("author-recovery-v1-test-code")
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

  private fun waitUntilTextDisplayed(text: String) {
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      try {
        compose.onNodeWithText(text).assertIsDisplayed()
        true
      } catch (_: AssertionError) {
        false
      }
    }
    compose.onNodeWithText(text).assertIsDisplayed()
  }

  private fun waitUntilContentDescriptionDisplayed(contentDescription: String) {
    compose.waitUntil(timeoutMillis = SAVE_TIMEOUT_MS) {
      try {
        compose.onNodeWithContentDescription(contentDescription).assertIsDisplayed()
        true
      } catch (_: AssertionError) {
        false
      }
    }
    compose.onNodeWithContentDescription(contentDescription).assertIsDisplayed()
  }

  private fun assertContentDescriptionDoesNotExist(contentDescription: String) {
    val exists =
      try {
        compose.onNodeWithContentDescription(contentDescription).assertIsDisplayed()
        true
      } catch (_: AssertionError) {
        false
      }
    assertTrue("$contentDescription should not exist", !exists)
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
