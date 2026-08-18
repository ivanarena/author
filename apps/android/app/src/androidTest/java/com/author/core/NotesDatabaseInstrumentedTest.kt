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
  fun savesAConflictOnlyWhenTheLocalRecordFingerprintStillMatches() {
    val db = NotesDatabase(context)
    try {
      db.putNote(note("note-1").copy(notebookIds = emptyList(), notebookId = null))
      assertFalse(
        db.putConflictIfEntityUnchanged(
          "notes",
          "note-1",
          99,
          "stale",
          "conflict-stale",
          "note",
          "2026-01-01T00:00:00Z",
          "{}",
        )
      )
      assertEquals("pending", db.getNote("note-1")?.syncStatus)
      assertTrue(db.rawConflicts().isEmpty())

      assertTrue(
        db.putConflictIfEntityUnchanged(
          "notes",
          "note-1",
          1,
          "2026-05-10T10:00:00Z",
          "conflict-current",
          "note",
          "2026-01-01T00:00:00Z",
          "{}",
        )
      )
      assertEquals("conflict", db.getNote("note-1")?.syncStatus)
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
  fun preservesEncryptedDatabaseWhenKeyMaterialIsLost() {
    val first = NotesDatabase(context)
    try {
      first.putDevice(Device("device-1", "Android test"))
    } finally {
      first.close()
    }

    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()

    val dbFile = context.getDatabasePath("author.db")
    val sizeBefore = dbFile.length()
    val reopened = runCatching { NotesDatabase(context).readableDatabase }

    assertTrue(reopened.isFailure)
    assertTrue(dbFile.exists())
    assertEquals(sizeBefore, dbFile.length())
    val databaseDir = dbFile.parentFile
    assertFalse(
      databaseDir?.listFiles()?.any {
        it.name.startsWith("author.db.unreadable-") || it.name.startsWith("author.db.failed-")
      } == true
    )
  }

  @Test
  fun migratesAPlaintextVersionOneDatabaseBeforeDeletingItsBackup() {
    val dbFile = context.getDatabasePath("author.db")
    createPlaintextVersionOneDatabase(dbFile)

    val migrated = NotesDatabase(context)
    try {
      assertEquals("Legacy draft", migrated.getNote("legacy-note")?.title)
      assertEquals(false, migrated.getNote("legacy-note")?.isFavorite)
      assertEquals(null, migrated.getNotebook("legacy-book")?.nameHash)
    } finally {
      migrated.close()
    }

    assertFalse(dbFile.parentFile?.resolve("author.db.plaintext-backup")?.exists() == true)
  }

  @Test
  fun recoversAPlaintextBackupWhenTheMainFileIsMissing() {
    val dbFile = context.getDatabasePath("author.db")
    val backup = dbFile.parentFile!!.resolve("author.db.plaintext-backup")
    createPlaintextVersionOneDatabase(backup)

    val recovered = NotesDatabase(context)
    try {
      assertEquals("Legacy draft", recovered.getNote("legacy-note")?.title)
    } finally {
      recovered.close()
    }

    assertTrue(dbFile.exists())
    assertFalse(backup.exists())
  }

  @Test
  fun deletesPlaintextBackupAfterOpeningEncryptedDatabase() {
    val dbFile = context.getDatabasePath("author.db")
    val first = NotesDatabase(context)
    first.close()

    dbFile.parentFile?.resolve("author.db.plaintext-backup")?.writeText("stale backup")

    val reopened = NotesDatabase(context)
    reopened.readableDatabase
    reopened.close()

    assertFalse(dbFile.parentFile?.resolve("author.db.plaintext-backup")?.exists() == true)
  }

  private fun createPlaintextVersionOneDatabase(file: java.io.File) {
    file.parentFile?.mkdirs()
    val db = SQLiteDatabase.openOrCreateDatabase(file, null)
    try {
      db.execSQL(
        """
        CREATE TABLE notes (
          id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
          title_hash TEXT, body_hash TEXT, notebook_ids TEXT NOT NULL, notebook_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, trashed_at TEXT,
          device_id TEXT NOT NULL, version INTEGER NOT NULL, sync_status TEXT NOT NULL,
          last_synced_version INTEGER NOT NULL, last_synced_at TEXT
        )
        """
          .trimIndent()
      )
      db.execSQL(
        """
        CREATE TABLE notebooks (
          id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, deleted_at TEXT, device_id TEXT NOT NULL,
          version INTEGER NOT NULL, sync_status TEXT NOT NULL,
          last_synced_version INTEGER NOT NULL, last_synced_at TEXT
        )
        """
          .trimIndent()
      )
      db.execSQL("CREATE TABLE devices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)")
      db.execSQL("CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
      db.execSQL(
        "CREATE TABLE conflicts (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, conflict_json TEXT NOT NULL)"
      )
      db.execSQL(
        "INSERT INTO notebooks VALUES (?, ?, ?, ?, NULL, ?, 1, 'pending', 0, NULL)",
        arrayOf(
          "legacy-book",
          "Legacy",
          "2026-01-01T00:00:00Z",
          "2026-01-01T00:00:00Z",
          "legacy-device",
        ),
      )
      db.execSQL(
        "INSERT INTO notes VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, 1, 'pending', 0, NULL)",
        arrayOf(
          "legacy-note",
          "Legacy draft",
          "Legacy body",
          "[\"legacy-book\"]",
          "legacy-book",
          "2026-01-01T00:00:00Z",
          "2026-01-01T00:00:00Z",
          "legacy-device",
        ),
      )
      db.version = 1
    } finally {
      db.close()
    }
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
    context.getSharedPreferences("author", Context.MODE_PRIVATE).edit().clear().commit()
    context
      .getDatabasePath("author.db")
      .parentFile
      ?.listFiles()
      ?.filter {
        it.name.startsWith("author.db.unreadable-") || it.name.startsWith("author.db.failed-")
      }
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
