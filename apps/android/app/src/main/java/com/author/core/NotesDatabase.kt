package com.author.core

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import java.io.File
import java.security.SecureRandom
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import org.json.JSONArray

private const val DATABASE_NAME = "author.db"
private const val DATABASE_VERSION = 3
private const val DATABASE_KEY_PREF = "author-database-key-material-v1"

private data class DatabasePassword(val value: String, val generated: Boolean)

class NotesDatabase(
  context: Context,
  securePrefs: SecurePreferenceStore = defaultSecurePreferences(context),
) :
  SQLiteOpenHelper(
    context.applicationContext,
    DATABASE_NAME,
    prepareDatabase(context.applicationContext, securePrefs),
    null,
    DATABASE_VERSION,
    0,
    null,
    null,
    false,
  ) {
  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.rawExecSQL("PRAGMA busy_timeout = 5000")
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE notes (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        title_hash TEXT,
        body_hash TEXT,
        notebook_ids TEXT NOT NULL,
        notebook_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        trashed_at TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        device_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        sync_status TEXT NOT NULL,
        last_synced_version INTEGER NOT NULL,
        last_synced_at TEXT
      )
      """
        .trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        name_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        device_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        sync_status TEXT NOT NULL,
        last_synced_version INTEGER NOT NULL,
        last_synced_at TEXT
      )
      """
        .trimIndent()
    )
    db.execSQL("CREATE TABLE devices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)")
    db.execSQL("CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
    db.execSQL(
      """
      CREATE TABLE conflicts (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        conflict_json TEXT NOT NULL
      )
      """
        .trimIndent()
    )
    db.execSQL("CREATE INDEX notes_sync_status ON notes(sync_status)")
    db.execSQL("CREATE INDEX notebooks_sync_status ON notebooks(sync_status)")
    db.execSQL("CREATE INDEX conflicts_status ON conflicts(status)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      db.execSQL("ALTER TABLE notebooks ADD COLUMN name_hash TEXT")
    }
    if (oldVersion < 3) {
      db.execSQL("ALTER TABLE notes ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0")
    }
  }

  fun putNote(note: LocalNote) =
    writableDatabase.insertWithOnConflict(
      "notes",
      null,
      noteValues(note),
      SQLiteDatabase.CONFLICT_REPLACE,
    )

  fun putNotes(notes: List<LocalNote>) {
    writableDatabase.transaction { notes.forEach { putNote(it) } }
  }

  fun getNote(id: String): LocalNote? =
    readableDatabase.queryOne("notes", "id = ?", arrayOf(id)) { it.toNote() }

  fun allNotes(): List<LocalNote> = readableDatabase.queryAll("notes") { it.toNote() }

  fun deleteNote(id: String) {
    writableDatabase.delete("notes", "id = ?", arrayOf(id))
  }

  fun pendingNotes(): List<LocalNote> =
    readableDatabase.queryAll("notes", "sync_status = ?", arrayOf("pending")) { it.toNote() }

  fun putNotebook(notebook: LocalNotebook) =
    writableDatabase.insertWithOnConflict(
      "notebooks",
      null,
      notebookValues(notebook),
      SQLiteDatabase.CONFLICT_REPLACE,
    )

  fun putNotebooks(notebooks: List<LocalNotebook>) {
    writableDatabase.transaction { notebooks.forEach { putNotebook(it) } }
  }

  fun getNotebook(id: String): LocalNotebook? =
    readableDatabase.queryOne("notebooks", "id = ?", arrayOf(id)) { it.toNotebook() }

  fun allNotebooks(): List<LocalNotebook> =
    readableDatabase.queryAll("notebooks") { it.toNotebook() }

  fun deleteNotebookRow(id: String) {
    writableDatabase.delete("notebooks", "id = ?", arrayOf(id))
  }

  fun pendingNotebooks(): List<LocalNotebook> =
    readableDatabase.queryAll("notebooks", "sync_status = ?", arrayOf("pending")) {
      it.toNotebook()
    }

  fun putDevice(device: Device) =
    writableDatabase.insertWithOnConflict(
      "devices",
      null,
      ContentValues().apply {
        put("id", device.id)
        put("name", device.name)
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )

  fun putDevices(devices: List<Device>) {
    writableDatabase.transaction { devices.forEach { putDevice(it) } }
  }

  fun getDevice(id: String): Device? =
    readableDatabase.queryOne("devices", "id = ?", arrayOf(id)) {
      Device(it.getString("id"), it.getString("name"))
    }

  fun allDevices(): List<Device> =
    readableDatabase.queryAll("devices") { Device(it.getString("id"), it.getString("name")) }

  fun deleteDevice(id: String) {
    writableDatabase.delete("devices", "id = ?", arrayOf(id))
  }

  fun getMeta(key: String): String? =
    readableDatabase.queryOne("sync_meta", "key = ?", arrayOf(key)) { it.getString("value") }

  fun putMeta(key: String, value: String) =
    writableDatabase.insertWithOnConflict(
      "sync_meta",
      null,
      ContentValues().apply {
        put("key", key)
        put("value", value)
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )

  fun deleteMeta(key: String) {
    writableDatabase.delete("sync_meta", "key = ?", arrayOf(key))
  }

  fun clearAll() {
    writableDatabase.transaction {
      delete("notes", null, null)
      delete("notebooks", null, null)
      delete("devices", null, null)
      delete("sync_meta", null, null)
      delete("conflicts", null, null)
    }
  }

  fun putConflict(
    id: String,
    entityType: String,
    entityId: String,
    status: String,
    createdAt: String,
    conflictJson: String,
  ) =
    writableDatabase.insertWithOnConflict(
      "conflicts",
      null,
      ContentValues().apply {
        put("id", id)
        put("entity_type", entityType)
        put("entity_id", entityId)
        put("status", status)
        put("created_at", createdAt)
        put("conflict_json", conflictJson)
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )

  fun rawConflicts(status: String? = null): List<RawConflict> =
    if (status == null) {
        readableDatabase.queryAll("conflicts") { it.toRawConflict() }
      } else {
        readableDatabase.queryAll("conflicts", "status = ?", arrayOf(status)) { it.toRawConflict() }
      }
      .sortedBy { it.createdAt }

  fun rawConflict(id: String): RawConflict? =
    readableDatabase.queryOne("conflicts", "id = ?", arrayOf(id)) { it.toRawConflict() }

  fun pendingSyncCount(): Int =
    readableDatabase.countRows("notes", "sync_status = ?", arrayOf("pending")) +
      readableDatabase.countRows("notebooks", "sync_status = ?", arrayOf("pending"))
}

private fun defaultSecurePreferences(context: Context): SecurePreferenceStore =
  SecurePreferenceStore(
    context.applicationContext.getSharedPreferences("author", Context.MODE_PRIVATE)
  )

private fun prepareDatabase(context: Context, securePrefs: SecurePreferenceStore): String {
  System.loadLibrary("sqlcipher")
  val password = databasePassword(securePrefs)
  prepareExistingDatabase(context, password)
  return password.value
}

private fun databasePassword(securePrefs: SecurePreferenceStore): DatabasePassword {
  securePrefs
    .getString(DATABASE_KEY_PREF)
    ?.takeIf { it.isNotBlank() }
    ?.let {
      return DatabasePassword(it, generated = false)
    }
  val key = ByteArray(32)
  SecureRandom().nextBytes(key)
  val password = base64UrlEncode(key).also { securePrefs.putString(DATABASE_KEY_PREF, it) }
  return DatabasePassword(password, generated = true)
}

private fun prepareExistingDatabase(context: Context, password: DatabasePassword) {
  val dbFile = context.getDatabasePath(DATABASE_NAME)
  if (!dbFile.exists()) {
    deletePlaintextBackupIfPresent(dbFile)
    return
  }
  if (canOpenEncryptedDatabase(dbFile, password.value)) {
    deletePlaintextBackupIfPresent(dbFile)
    return
  }
  if (!canOpenPlaintextDatabase(dbFile)) {
    if (password.generated) {
      quarantineUnreadableDatabase(dbFile)
      return
    }
    throw IllegalStateException("Could not open encrypted Android database")
  }
  migratePlaintextDatabase(dbFile, password.value)
}

private fun migratePlaintextDatabase(dbFile: File, password: String) {
  val tempFile = File(dbFile.parentFile, "${dbFile.name}.sqlcipher-migrating")
  val backupFile = plaintextBackupFile(dbFile)
  tempFile.delete()
  deletePlaintextBackupIfPresent(dbFile)

  var source: SQLiteDatabase? = null
  try {
    source =
      SQLiteDatabase.openDatabase(
        dbFile.absolutePath,
        "",
        null,
        SQLiteDatabase.OPEN_READWRITE,
        null,
      )
    source.rawQuery("PRAGMA wal_checkpoint(FULL)", emptyArray<String>()).use {}
    source.rawExecSQL("PRAGMA user_version = $DATABASE_VERSION")
    source.rawExecSQL(
      "ATTACH DATABASE ${sqlString(tempFile.absolutePath)} AS encrypted KEY ${sqlString(password)}"
    )
    source.rawQuery("SELECT sqlcipher_export('encrypted')", emptyArray<String>()).use {}
    source.rawExecSQL("DETACH DATABASE encrypted")
  } finally {
    source?.close()
  }

  if (!dbFile.renameTo(backupFile)) {
    tempFile.delete()
    throw IllegalStateException("Could not prepare encrypted Android database")
  }
  try {
    tempFile.copyTo(dbFile, overwrite = true)
    if (!tempFile.delete()) {
      throw IllegalStateException("Could not remove temporary encrypted Android database")
    }
    deleteDatabaseSidecars(tempFile)
  } catch (error: Exception) {
    backupFile.renameTo(dbFile)
    tempFile.delete()
    deleteDatabaseSidecars(tempFile)
    throw IllegalStateException("Could not install encrypted Android database", error)
  }
  deleteDatabaseSidecars(dbFile)
  deletePlaintextBackupIfPresent(dbFile)
}

private fun canOpenPlaintextDatabase(dbFile: File): Boolean {
  var db: SQLiteDatabase? = null
  return runCatching {
      db =
        SQLiteDatabase.openDatabase(
          dbFile.absolutePath,
          "",
          null,
          SQLiteDatabase.OPEN_READONLY,
          null,
        )
      db.rawQuery("SELECT count(*) FROM sqlite_master", emptyArray<String>()).use {}
    }
    .also { db?.close() }
    .isSuccess
}

private fun canOpenEncryptedDatabase(dbFile: File, password: String): Boolean {
  var db: SQLiteDatabase? = null
  return runCatching {
      db =
        SQLiteDatabase.openDatabase(
          dbFile.absolutePath,
          password,
          null,
          SQLiteDatabase.OPEN_READONLY,
          null,
        )
      db.rawQuery("SELECT count(*) FROM sqlite_master", emptyArray<String>()).use {}
    }
    .also { db?.close() }
    .isSuccess
}

private fun quarantineUnreadableDatabase(dbFile: File) {
  val quarantineFile =
    File(dbFile.parentFile, "${dbFile.name}.unreadable-${System.currentTimeMillis()}")
  if (!dbFile.renameTo(quarantineFile)) {
    throw IllegalStateException("Could not move unreadable Android database aside")
  }
  deleteDatabaseSidecars(dbFile)
}

private fun plaintextBackupFile(dbFile: File): File =
  File(dbFile.parentFile, "${dbFile.name}.plaintext-backup")

private fun deletePlaintextBackupIfPresent(dbFile: File) {
  val backupFile = plaintextBackupFile(dbFile)
  if (backupFile.exists() && !backupFile.delete()) {
    throw IllegalStateException("Could not delete plaintext Android database backup")
  }
}

private fun deleteDatabaseSidecars(dbFile: File) {
  listOf("-journal", "-shm", "-wal").forEach { suffix ->
    File("${dbFile.absolutePath}$suffix").delete()
  }
}

private fun sqlString(value: String): String = "'${value.replace("'", "''")}'"

data class RawConflict(
  val id: String,
  val entityType: String,
  val entityId: String,
  val status: String,
  val createdAt: String,
  val conflictJson: String,
)

private fun noteValues(note: LocalNote) =
  ContentValues().apply {
    put("id", note.id)
    put("title", note.title)
    put("body", note.body)
    put("title_hash", note.titleHash)
    put("body_hash", note.bodyHash)
    put("notebook_ids", JSONArray(note.notebookIds).toString())
    put("notebook_id", note.notebookId)
    put("created_at", note.createdAt)
    put("updated_at", note.updatedAt)
    put("deleted_at", note.deletedAt)
    put("trashed_at", note.trashedAt)
    put("is_favorite", if (note.isFavorite) 1 else 0)
    put("device_id", note.deviceId)
    put("version", note.version)
    put("sync_status", note.syncStatus)
    put("last_synced_version", note.lastSyncedVersion)
    put("last_synced_at", note.lastSyncedAt)
  }

private fun notebookValues(notebook: LocalNotebook) =
  ContentValues().apply {
    put("id", notebook.id)
    put("name", notebook.name)
    put("name_hash", notebook.nameHash)
    put("created_at", notebook.createdAt)
    put("updated_at", notebook.updatedAt)
    put("deleted_at", notebook.deletedAt)
    put("device_id", notebook.deviceId)
    put("version", notebook.version)
    put("sync_status", notebook.syncStatus)
    put("last_synced_version", notebook.lastSyncedVersion)
    put("last_synced_at", notebook.lastSyncedAt)
  }

private fun Cursor.toNote() =
  LocalNote(
    id = getString("id"),
    title = getString("title"),
    body = getString("body"),
    titleHash = getNullableString("title_hash"),
    bodyHash = getNullableString("body_hash"),
    notebookIds = parseStringArray(getString("notebook_ids")),
    notebookId = getNullableString("notebook_id"),
    createdAt = getString("created_at"),
    updatedAt = getString("updated_at"),
    deletedAt = getNullableString("deleted_at"),
    trashedAt = getNullableString("trashed_at"),
    isFavorite = getInt("is_favorite") != 0,
    deviceId = getString("device_id"),
    version = getInt("version"),
    syncStatus = getString("sync_status"),
    lastSyncedVersion = getInt("last_synced_version"),
    lastSyncedAt = getNullableString("last_synced_at"),
  )

private fun Cursor.toNotebook() =
  LocalNotebook(
    id = getString("id"),
    name = getString("name"),
    nameHash = getNullableString("name_hash"),
    createdAt = getString("created_at"),
    updatedAt = getString("updated_at"),
    deletedAt = getNullableString("deleted_at"),
    deviceId = getString("device_id"),
    version = getInt("version"),
    syncStatus = getString("sync_status"),
    lastSyncedVersion = getInt("last_synced_version"),
    lastSyncedAt = getNullableString("last_synced_at"),
  )

private fun Cursor.toRawConflict() =
  RawConflict(
    id = getString("id"),
    entityType = getString("entity_type"),
    entityId = getString("entity_id"),
    status = getString("status"),
    createdAt = getString("created_at"),
    conflictJson = getString("conflict_json"),
  )

private fun parseStringArray(source: String): List<String> =
  runCatching {
      val array = JSONArray(source)
      List(array.length()) { array.getString(it) }
    }
    .getOrDefault(emptyList())

private fun Cursor.getString(column: String): String = getString(getColumnIndexOrThrow(column))

private fun Cursor.getInt(column: String): Int = getInt(getColumnIndexOrThrow(column))

private fun Cursor.getNullableString(column: String): String? {
  val index = getColumnIndexOrThrow(column)
  return if (isNull(index)) null else getString(index)
}

private fun <T> SQLiteDatabase.queryOne(
  table: String,
  selection: String,
  selectionArgs: Array<String>,
  map: (Cursor) -> T,
): T? =
  query(table, null, selection, selectionArgs, null, null, null).use { cursor ->
    if (cursor.moveToFirst()) map(cursor) else null
  }

private fun <T> SQLiteDatabase.queryAll(
  table: String,
  selection: String? = null,
  selectionArgs: Array<String>? = null,
  map: (Cursor) -> T,
): List<T> =
  query(table, null, selection, selectionArgs, null, null, null).use { cursor ->
    buildList { while (cursor.moveToNext()) add(map(cursor)) }
  }

private fun SQLiteDatabase.countRows(
  table: String,
  selection: String? = null,
  selectionArgs: Array<String>? = null,
): Int =
  query(table, arrayOf("COUNT(*)"), selection, selectionArgs, null, null, null).use { cursor ->
    if (cursor.moveToFirst()) cursor.getInt(0) else 0
  }

private inline fun SQLiteDatabase.transaction(block: SQLiteDatabase.() -> Unit) {
  beginTransaction()
  try {
    block()
    setTransactionSuccessful()
  } finally {
    endTransaction()
  }
}
