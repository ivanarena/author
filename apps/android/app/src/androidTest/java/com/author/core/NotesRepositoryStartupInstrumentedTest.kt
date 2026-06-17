package com.author.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesRepositoryStartupInstrumentedTest {
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
  fun startupPreviewLoadsTitlesBeforeFullBodies() = runBlocking {
    val repository = NotesRepository(context)
    try {
      val note = repository.createBlankNote("Startup title", "Startup body that can hydrate later")

      val preview = repository.loadWorkspacePreview().notes.single { it.id == note.id }

      assertEquals("Startup title", preview.title)
      assertEquals("", preview.body)

      val fullNote = repository.loadNote(note.id)
      assertEquals(note.body, fullNote?.body)
      assertNotEquals(preview.body, fullNote?.body)
    } finally {
      repository.close()
    }
  }

  @Test
  fun startupPreviewDoesNotCreateReplacementKeyWhenAccountKeyIsMissing() = runBlocking {
    val prefs = context.getSharedPreferences("author", Context.MODE_PRIVATE)
    val accountKeyMaterial =
      NoteCrypto(prefs, SecurePreferenceStore(prefs))
        .prepareNewAccountKeyring("owner", "correct horse battery staple")
        .keyMaterial
    val repository = NotesRepository(context)
    try {
      repository.rememberPasswordAndAdopt(
        "owner",
        "correct horse battery staple",
        previousUsername = null,
        nextMaterialOverride = accountKeyMaterial,
      )
      val note = repository.createBlankNote("Locked title", "Locked body")

      repository.clearStoredSession(clearEncryptionKeyMaterial = true)
      NoteCrypto(prefs, SecurePreferenceStore(prefs)).getEncryptionKeyMaterial()
      val preview = repository.loadWorkspacePreview()

      assertTrue(preview.notes.isEmpty())

      repository.rememberPasswordAndAdopt(
        "owner",
        "correct horse battery staple",
        previousUsername = "owner",
        nextMaterialOverride = accountKeyMaterial,
      )
      assertEquals("Locked body", repository.loadNote(note.id)?.body)
    } finally {
      repository.close()
    }
  }

  @Test
  fun resetDeviceSyncStateRestoresAccountKeyAndPreservesWrongKeyDrafts() = runBlocking {
    val prefs = context.getSharedPreferences("author", Context.MODE_PRIVATE)
    val password = "correct horse battery staple"
    val accountKeyMaterial =
      NoteCrypto(prefs, SecurePreferenceStore(prefs))
        .prepareNewAccountKeyring("owner", password)
        .keyMaterial
    val repository = NotesRepository(context)
    try {
      repository.rememberPasswordAndAdopt(
        "owner",
        password,
        previousUsername = null,
        nextMaterialOverride = accountKeyMaterial,
      )
      val syncedNote = repository.createBlankNote("Recover title", "Recover body")

      repository.clearStoredSession(clearEncryptionKeyMaterial = true)
      NoteCrypto(prefs, SecurePreferenceStore(prefs)).getEncryptionKeyMaterial()
      val localDraft = repository.createBlankNote("Broken local draft", "Draft body")

      assertEquals(false, repository.hasUsableStoredEncryptionKeyMaterial())
      assertEquals(false, repository.canUseTrustedDeviceLogin())
      val brokenDiagnostics = repository.loadRepairDiagnostics()
      val keyDiagnostic = brokenDiagnostics.entries.single { it.label == "Encryption key material" }
      assertEquals("error", keyDiagnostic.status)
      assertEquals(true, brokenDiagnostics.canResetDeviceSync)

      repository.resetDeviceSyncState()

      assertEquals(false, repository.hasStoredEncryptionKeyMaterial())
      val postResetDraft = repository.createBlankNote("Post-reset draft", "Post-reset body")
      repository.rememberPasswordAndAdopt(
        "owner",
        password,
        previousUsername = "owner",
        nextMaterialOverride = accountKeyMaterial,
      )

      val restored = repository.loadWorkspaceSnapshot().notes.associateBy { it.id }
      assertEquals("Recover body", restored[syncedNote.id]?.body)
      assertEquals("Draft body", restored[localDraft.id]?.body)
      assertEquals("Post-reset body", restored[postResetDraft.id]?.body)
      assertEquals(true, repository.canUseTrustedDeviceLogin())
    } finally {
      repository.close()
    }
  }

  @Test
  fun trustedDeviceAdoptionRejectsStoredAccountKeyForDifferentUsername() = runBlocking {
    val prefs = context.getSharedPreferences("author", Context.MODE_PRIVATE)
    val password = "correct horse battery staple"
    val ownerKeyMaterial =
      NoteCrypto(prefs, SecurePreferenceStore(prefs))
        .prepareNewAccountKeyring("owner", password)
        .keyMaterial
    val repository = NotesRepository(context)
    try {
      repository.rememberPasswordAndAdopt(
        "owner",
        password,
        previousUsername = null,
        nextMaterialOverride = ownerKeyMaterial,
      )

      val error =
        try {
          repository.adoptWithStoredKey("other", previousUsername = null)
          null
        } catch (error: IllegalStateException) {
          error
        }

      assertEquals("Password required to restore encrypted sync for this account", error?.message)
    } finally {
      repository.close()
    }
  }

  private fun resetWorkspace() {
    context.deleteDatabase("author.db")
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
  }
}
