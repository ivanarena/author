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
  private val databaseFile = context.applicationContext.getDatabasePath(DATABASE_NAME)

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

  override fun onOpen(db: SQLiteDatabase) {
    super.onOpen(db)
    validateCurrentDatabaseSchema(db)
    finalizePlaintextMigration(databaseFile)
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

  fun putConflictIfEntityUnchanged(
    table: String,
    entityId: String,
    expectedVersion: Int?,
    expectedUpdatedAt: String?,
    conflictId: String,
    entityType: String,
    createdAt: String,
    conflictJson: String,
  ): Boolean {
    require(table == "notes" || table == "notebooks")
    return writableDatabase.transaction {
      val current =
        queryOne(table, "id = ?", arrayOf(entityId)) {
          it.getInt("version") to it.getString("updated_at")
        }
      val unchanged =
        if (expectedVersion == null || expectedUpdatedAt == null) current == null
        else current?.first == expectedVersion && current.second == expectedUpdatedAt
      if (!unchanged) return@transaction false

      insertWithOnConflict(
        "conflicts",
        null,
        ContentValues().apply {
          put("id", conflictId)
          put("entity_type", entityType)
          put("entity_id", entityId)
          put("status", "pending")
          put("created_at", createdAt)
          put("conflict_json", conflictJson)
        },
        SQLiteDatabase.CONFLICT_REPLACE,
      )
      if (current != null) {
        update(
          table,
          ContentValues().apply { put("sync_status", "conflict") },
          "id = ?",
          arrayOf(entityId),
        )
      }
      true
    }
  }

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
  recoverInterruptedPlaintextMigration(dbFile, password.value)
  if (!dbFile.exists()) return
  if (canOpenEncryptedDatabase(dbFile, password.value)) return
  if (!canOpenPlaintextDatabase(dbFile)) {
    val detail =
      if (password.generated) "the stored SQLCipher key was unavailable"
      else "the database is neither valid SQLCipher nor plaintext"
    throw IllegalStateException("Could not open Android database: $detail")
  }
  migratePlaintextDatabase(dbFile, password.value)
}

private fun recoverInterruptedPlaintextMigration(dbFile: File, password: String) {
  val tempFile = migrationTempFile(dbFile)
  val backupFile = plaintextBackupFile(dbFile)
  if (dbFile.exists() && canOpenEncryptedDatabase(dbFile, password)) {
    if (tempFile.exists()) tempFile.delete()
    deleteDatabaseSidecars(tempFile)
    return
  }

  if (!dbFile.exists() && tempFile.exists() && canOpenEncryptedDatabase(tempFile, password)) {
    if (!tempFile.renameTo(dbFile)) {
      throw IllegalStateException("Could not recover encrypted Android database candidate")
    }
    return
  }

  if (backupFile.exists() && canOpenPlaintextDatabase(backupFile)) {
    if (dbFile.exists()) {
      val failedFile =
        File(dbFile.parentFile, "${dbFile.name}.failed-${System.currentTimeMillis()}")
      if (!dbFile.renameTo(failedFile)) {
        throw IllegalStateException("Could not preserve failed Android database migration")
      }
      deleteDatabaseSidecars(dbFile)
    }
    if (!backupFile.renameTo(dbFile)) {
      throw IllegalStateException("Could not restore plaintext Android database backup")
    }
    if (tempFile.exists()) tempFile.delete()
    deleteDatabaseSidecars(tempFile)
  }
}

private fun createCurrentMigrationSchema(db: SQLiteDatabase) {
  db.execSQL(
    """
    CREATE TABLE notes (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      title_hash TEXT, body_hash TEXT, notebook_ids TEXT NOT NULL, notebook_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, trashed_at TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL,
      version INTEGER NOT NULL, sync_status TEXT NOT NULL,
      last_synced_version INTEGER NOT NULL, last_synced_at TEXT
    )
    """
      .trimIndent()
  )
  db.execSQL(
    """
    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, name_hash TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      device_id TEXT NOT NULL, version INTEGER NOT NULL, sync_status TEXT NOT NULL,
      last_synced_version INTEGER NOT NULL, last_synced_at TEXT
    )
    """
      .trimIndent()
  )
  db.execSQL("CREATE TABLE devices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)")
  db.execSQL("CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
  db.execSQL(
    """
    CREATE TABLE conflicts (
      id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, conflict_json TEXT NOT NULL
    )
    """
      .trimIndent()
  )
  db.execSQL("CREATE INDEX notes_sync_status ON notes(sync_status)")
  db.execSQL("CREATE INDEX notebooks_sync_status ON notebooks(sync_status)")
  db.execSQL("CREATE INDEX conflicts_status ON conflicts(status)")
}

private fun copyDatabaseTable(source: SQLiteDatabase, target: SQLiteDatabase, table: String) {
  val targetColumns = databaseColumns(target, table)
  source.query(table, null, null, null, null, null, null).use { cursor ->
    while (cursor.moveToNext()) {
      val values = ContentValues()
      for (index in 0 until cursor.columnCount) {
        val name = cursor.getColumnName(index)
        if (name !in targetColumns) continue
        when (cursor.getType(index)) {
          Cursor.FIELD_TYPE_NULL -> values.putNull(name)
          Cursor.FIELD_TYPE_INTEGER -> values.put(name, cursor.getLong(index))
          Cursor.FIELD_TYPE_FLOAT -> values.put(name, cursor.getDouble(index))
          Cursor.FIELD_TYPE_BLOB -> values.put(name, cursor.getBlob(index))
          else -> values.put(name, cursor.getString(index))
        }
      }
      check(target.insert(table, null, values) != -1L) { "Could not migrate Android table $table" }
    }
  }
}

private fun migratePlaintextDatabase(dbFile: File, password: String) {
  val tempFile = migrationTempFile(dbFile)
  val backupFile = plaintextBackupFile(dbFile)
  if (backupFile.exists()) {
    throw IllegalStateException("A plaintext migration backup already exists")
  }
  if (tempFile.exists() && !tempFile.delete()) {
    throw IllegalStateException("Could not clear stale Android migration candidate")
  }
  deleteDatabaseSidecars(tempFile)

  var source: SQLiteDatabase? = null
  var expectedCounts: Map<String, Long> = emptyMap()
  try {
    source =
      SQLiteDatabase.openDatabase(
        dbFile.absolutePath,
        "",
        null,
        SQLiteDatabase.OPEN_READWRITE,
        null,
      )
    val sourceVersion =
      source.rawQuery("PRAGMA user_version", emptyArray<String>()).use { cursor ->
        if (cursor.moveToFirst()) cursor.getInt(0) else 0
      }
    require(sourceVersion in 1..DATABASE_VERSION) {
      "Unsupported plaintext Android database schema version $sourceVersion"
    }
    expectedCounts =
      listOf("notes", "notebooks", "devices", "sync_meta", "conflicts").associateWith {
        databaseRowCount(source, it)
      }
    source.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", emptyArray<String>()).use {}

    var target: SQLiteDatabase? = null
    try {
      target =
        SQLiteDatabase.openDatabase(
          tempFile.absolutePath,
          password,
          null,
          SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
          null,
        )
      target.beginTransaction()
      try {
        createCurrentMigrationSchema(target)
        for (table in listOf("notes", "notebooks", "devices", "sync_meta", "conflicts")) {
          copyDatabaseTable(source, target, table)
        }
        target.version = DATABASE_VERSION
        target.setTransactionSuccessful()
      } finally {
        target.endTransaction()
      }
    } finally {
      target?.close()
    }
  } finally {
    source?.close()
  }

  if (!validateMigratedDatabase(tempFile, password, expectedCounts)) {
    throw IllegalStateException("Encrypted Android database candidate failed validation")
  }
  if (!dbFile.renameTo(backupFile)) {
    throw IllegalStateException("Could not preserve plaintext Android database")
  }
  try {
    if (!tempFile.renameTo(dbFile)) {
      throw IllegalStateException("Could not atomically install encrypted Android database")
    }
    deleteDatabaseSidecars(dbFile)
    deleteDatabaseSidecars(tempFile)
  } catch (error: Throwable) {
    if (!dbFile.exists()) backupFile.renameTo(dbFile)
    throw IllegalStateException("Could not install encrypted Android database", error)
  }
}

private fun databaseRowCount(db: SQLiteDatabase, table: String): Long =
  db.rawQuery("SELECT count(*) FROM $table", emptyArray<String>()).use { cursor ->
    if (cursor.moveToFirst()) cursor.getLong(0) else -1
  }

private fun validateMigratedDatabase(
  file: File,
  password: String,
  expectedCounts: Map<String, Long>,
): Boolean {
  var db: SQLiteDatabase? = null
  return runCatching {
      val opened =
        SQLiteDatabase.openDatabase(
          file.absolutePath,
          password,
          null,
          SQLiteDatabase.OPEN_READONLY,
          null,
        )
      db = opened
      expectedCounts.all { (table, expected) -> databaseRowCount(opened, table) == expected } &&
        opened.rawQuery("PRAGMA quick_check", emptyArray<String>()).use { cursor ->
          cursor.moveToFirst() && cursor.getString(0).equals("ok", ignoreCase = true)
        }
    }
    .also { db?.close() }
    .getOrDefault(false)
}

private fun databaseColumns(db: SQLiteDatabase, table: String): Set<String> =
  db.rawQuery("PRAGMA table_info($table)", emptyArray<String>()).use { cursor ->
    buildSet {
      val nameIndex = cursor.getColumnIndexOrThrow("name")
      while (cursor.moveToNext()) add(cursor.getString(nameIndex))
    }
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

private fun migrationTempFile(dbFile: File): File =
  File(dbFile.parentFile, "${dbFile.name}.sqlcipher-migrating")

private fun plaintextBackupFile(dbFile: File): File =
  File(dbFile.parentFile, "${dbFile.name}.plaintext-backup")

private fun validateCurrentDatabaseSchema(db: SQLiteDatabase) {
  val requiredColumns =
    mapOf(
      "notes" to setOf("id", "body", "notebook_ids", "is_favorite", "last_synced_version"),
      "notebooks" to setOf("id", "name_hash", "last_synced_version"),
      "devices" to setOf("id", "name"),
      "sync_meta" to setOf("key", "value"),
      "conflicts" to setOf("id", "conflict_json"),
    )
  for ((table, required) in requiredColumns) {
    val actual =
      db.rawQuery("PRAGMA table_info($table)", emptyArray<String>()).use { cursor ->
        buildSet {
          val nameIndex = cursor.getColumnIndexOrThrow("name")
          while (cursor.moveToNext()) add(cursor.getString(nameIndex))
        }
      }
    check(actual.containsAll(required)) { "Android database schema is incomplete for $table" }
  }
  val integrity =
    db.rawQuery("PRAGMA quick_check", emptyArray<String>()).use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else ""
    }
  check(integrity.equals("ok", ignoreCase = true)) { "Android database integrity check failed" }
}

private fun finalizePlaintextMigration(dbFile: File) {
  val backupFile = plaintextBackupFile(dbFile)
  if (backupFile.exists() && !backupFile.delete()) {
    throw IllegalStateException("Could not remove validated plaintext Android database backup")
  }
  deleteDatabaseSidecars(backupFile)
  val tempFile = migrationTempFile(dbFile)
  if (tempFile.exists() && !tempFile.delete()) {
    throw IllegalStateException("Could not remove Android migration candidate")
  }
  deleteDatabaseSidecars(tempFile)
}

private fun deleteDatabaseSidecars(dbFile: File) {
  listOf("-journal", "-shm", "-wal").forEach { suffix ->
    File("${dbFile.absolutePath}$suffix").delete()
  }
}

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

private inline fun <T> SQLiteDatabase.transaction(block: SQLiteDatabase.() -> T): T {
  beginTransaction()
  try {
    val result = block()
    setTransactionSuccessful()
    return result
  } finally {
    endTransaction()
  }
}
