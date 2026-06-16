package com.author.core

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesDatabaseInstrumentedTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    deleteDatabaseArtifacts()
  }

  @After
  fun tearDown() {
    deleteDatabaseArtifacts()
  }

  @Test
  fun storesPendingSyncRowsInDeviceSqlite() {
    val db = NotesDatabase(context)
    try {
      db.putDevice(Device("device-1", "Android test"))
      db.putNotebook(notebook("book-1"))
      db.putNote(note("note-1"))

      assertEquals(Device("device-1", "Android test"), db.getDevice("device-1"))
      assertEquals("Work", db.getNotebook("book-1")?.name)
      assertEquals("Draft", db.getNote("note-1")?.title)
      assertEquals(2, db.pendingSyncCount())
    } finally {
      db.close()
    }
  }

  @Test
  fun encryptsTheDatabaseFileAtRest() {
    val db = NotesDatabase(context)
    try {
      db.putDevice(Device("device-1", "Android test"))
    } finally {
      db.close()
    }

    val plaintext = runCatching {
      SQLiteDatabase.openDatabase(
        context.getDatabasePath("author.db").absolutePath,
        null,
        SQLiteDatabase.OPEN_READONLY,
      )
    }
    val opened = plaintext.getOrNull()
    try {
      if (opened != null) {
        val query = runCatching {
          opened.rawQuery("SELECT count(*) FROM devices", null).use { it.moveToFirst() }
        }
        if (query.isSuccess) {
          fail("Android SQLite opened the encrypted Author database without SQLCipher")
        }
      }
    } finally {
      opened?.close()
    }
  }

  @Test
  fun startsFreshWhenDatabaseKeyMaterialIsLost() {
    val first = NotesDatabase(context)
    try {
      first.putDevice(Device("device-1", "Android test"))
    } finally {
      first.close()
    }

    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()

    val second = NotesDatabase(context)
    try {
      assertEquals(emptyList<Device>(), second.allDevices())
      second.putDevice(Device("device-2", "Recovered Android test"))
      assertEquals(Device("device-2", "Recovered Android test"), second.getDevice("device-2"))
    } finally {
      second.close()
    }

    val databaseDir = context.getDatabasePath("author.db").parentFile
    assertTrue(
      databaseDir?.listFiles()?.any { it.name.startsWith("author.db.unreadable-") } == true
    )
  }

  @Test
  fun deletesPlaintextBackupAfterOpeningEncryptedDatabase() {
    val dbFile = context.getDatabasePath("author.db")
    val first = NotesDatabase(context)
    first.close()

    dbFile.parentFile?.resolve("author.db.plaintext-backup")?.writeText("stale backup")

    val reopened = NotesDatabase(context)
    reopened.close()

    assertFalse(dbFile.parentFile?.resolve("author.db.plaintext-backup")?.exists() == true)
  }

  private fun note(id: String) =
    LocalNote(
      id = id,
      title = "Draft",
      body = "Body",
      titleHash = null,
      bodyHash = null,
      notebookIds = listOf("book-1"),
      notebookId = "book-1",
      createdAt = "2026-05-10T09:00:00Z",
      updatedAt = "2026-05-10T10:00:00Z",
      deletedAt = null,
      trashedAt = null,
      deviceId = "device-1",
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null,
    )

  private fun notebook(id: String) =
    LocalNotebook(
      id = id,
      name = "Work",
      nameHash = null,
      createdAt = "2026-05-10T09:00:00Z",
      updatedAt = "2026-05-10T10:00:00Z",
      deletedAt = null,
      deviceId = "device-1",
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null,
    )

  private fun deleteDatabaseArtifacts() {
    context.deleteDatabase("author.db")
    context
      .getDatabasePath("author.db")
      .parentFile
      ?.listFiles()
      ?.filter { it.name.startsWith("author.db.unreadable-") }
      ?.forEach { it.delete() }
    context
      .getDatabasePath("author.db")
      .parentFile
      ?.listFiles()
      ?.filter {
        it.name == "author.db.plaintext-backup" || it.name == "author.db.sqlcipher-migrating"
      }
      ?.forEach { it.delete() }
  }
}
