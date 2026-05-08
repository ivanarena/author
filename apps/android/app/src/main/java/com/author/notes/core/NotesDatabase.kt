package com.author.notes.core

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray

class NotesDatabase(context: Context) : SQLiteOpenHelper(context, "author-notes.db", null, 2) {
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
        device_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        sync_status TEXT NOT NULL,
        last_synced_version INTEGER NOT NULL,
        last_synced_at TEXT
      )
      """.trimIndent()
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
      """.trimIndent()
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
      """.trimIndent()
    )
    db.execSQL("CREATE INDEX notes_sync_status ON notes(sync_status)")
    db.execSQL("CREATE INDEX notebooks_sync_status ON notebooks(sync_status)")
    db.execSQL("CREATE INDEX conflicts_status ON conflicts(status)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      db.execSQL("ALTER TABLE notebooks ADD COLUMN name_hash TEXT")
    }
  }

  fun putNote(note: LocalNote) = writableDatabase.insertWithOnConflict(
    "notes",
    null,
    noteValues(note),
    SQLiteDatabase.CONFLICT_REPLACE
  )

  fun putNotes(notes: List<LocalNote>) {
    writableDatabase.transaction {
      notes.forEach { putNote(it) }
    }
  }

  fun getNote(id: String): LocalNote? = readableDatabase.queryOne(
    "notes",
    "id = ?",
    arrayOf(id)
  ) { it.toNote() }

  fun allNotes(): List<LocalNote> = readableDatabase.queryAll("notes") { it.toNote() }

  fun deleteNote(id: String) {
    writableDatabase.delete("notes", "id = ?", arrayOf(id))
  }

  fun pendingNotes(): List<LocalNote> = readableDatabase.queryAll("notes", "sync_status = ?", arrayOf("pending")) { it.toNote() }

  fun putNotebook(notebook: LocalNotebook) = writableDatabase.insertWithOnConflict(
    "notebooks",
    null,
    notebookValues(notebook),
    SQLiteDatabase.CONFLICT_REPLACE
  )

  fun putNotebooks(notebooks: List<LocalNotebook>) {
    writableDatabase.transaction {
      notebooks.forEach { putNotebook(it) }
    }
  }

  fun getNotebook(id: String): LocalNotebook? = readableDatabase.queryOne(
    "notebooks",
    "id = ?",
    arrayOf(id)
  ) { it.toNotebook() }

  fun allNotebooks(): List<LocalNotebook> = readableDatabase.queryAll("notebooks") { it.toNotebook() }

  fun deleteNotebookRow(id: String) {
    writableDatabase.delete("notebooks", "id = ?", arrayOf(id))
  }

  fun pendingNotebooks(): List<LocalNotebook> = readableDatabase.queryAll("notebooks", "sync_status = ?", arrayOf("pending")) { it.toNotebook() }

  fun putDevice(device: Device) = writableDatabase.insertWithOnConflict(
    "devices",
    null,
    ContentValues().apply {
      put("id", device.id)
      put("name", device.name)
    },
    SQLiteDatabase.CONFLICT_REPLACE
  )

  fun putDevices(devices: List<Device>) {
    writableDatabase.transaction {
      devices.forEach { putDevice(it) }
    }
  }

  fun getDevice(id: String): Device? = readableDatabase.queryOne(
    "devices",
    "id = ?",
    arrayOf(id)
  ) { Device(it.getString("id"), it.getString("name")) }

  fun allDevices(): List<Device> = readableDatabase.queryAll("devices") { Device(it.getString("id"), it.getString("name")) }

  fun deleteDevice(id: String) {
    writableDatabase.delete("devices", "id = ?", arrayOf(id))
  }

  fun getMeta(key: String): String? = readableDatabase.queryOne(
    "sync_meta",
    "key = ?",
    arrayOf(key)
  ) { it.getString("value") }

  fun putMeta(key: String, value: String) = writableDatabase.insertWithOnConflict(
    "sync_meta",
    null,
    ContentValues().apply {
      put("key", key)
      put("value", value)
    },
    SQLiteDatabase.CONFLICT_REPLACE
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
    conflictJson: String
  ) = writableDatabase.insertWithOnConflict(
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
    SQLiteDatabase.CONFLICT_REPLACE
  )

  fun rawConflicts(status: String? = null): List<RawConflict> = if (status == null) {
    readableDatabase.queryAll("conflicts") { it.toRawConflict() }
  } else {
    readableDatabase.queryAll("conflicts", "status = ?", arrayOf(status)) { it.toRawConflict() }
  }.sortedBy { it.createdAt }

  fun rawConflict(id: String): RawConflict? = readableDatabase.queryOne(
    "conflicts",
    "id = ?",
    arrayOf(id)
  ) { it.toRawConflict() }

  fun pendingSyncCount(): Int = pendingNotes().size + pendingNotebooks().size
}

data class RawConflict(
  val id: String,
  val entityType: String,
  val entityId: String,
  val status: String,
  val createdAt: String,
  val conflictJson: String
)

private fun noteValues(note: LocalNote) = ContentValues().apply {
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
  put("device_id", note.deviceId)
  put("version", note.version)
  put("sync_status", note.syncStatus)
  put("last_synced_version", note.lastSyncedVersion)
  put("last_synced_at", note.lastSyncedAt)
}

private fun notebookValues(notebook: LocalNotebook) = ContentValues().apply {
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

private fun Cursor.toNote() = LocalNote(
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
  deviceId = getString("device_id"),
  version = getInt("version"),
  syncStatus = getString("sync_status"),
  lastSyncedVersion = getInt("last_synced_version"),
  lastSyncedAt = getNullableString("last_synced_at")
)

private fun Cursor.toNotebook() = LocalNotebook(
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
  lastSyncedAt = getNullableString("last_synced_at")
)

private fun Cursor.toRawConflict() = RawConflict(
  id = getString("id"),
  entityType = getString("entity_type"),
  entityId = getString("entity_id"),
  status = getString("status"),
  createdAt = getString("created_at"),
  conflictJson = getString("conflict_json")
)

private fun parseStringArray(source: String): List<String> = runCatching {
  val array = JSONArray(source)
  List(array.length()) { array.getString(it) }
}.getOrDefault(emptyList())

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
  map: (Cursor) -> T
): T? = query(table, null, selection, selectionArgs, null, null, null).use { cursor ->
  if (cursor.moveToFirst()) map(cursor) else null
}

private fun <T> SQLiteDatabase.queryAll(
  table: String,
  selection: String? = null,
  selectionArgs: Array<String>? = null,
  map: (Cursor) -> T
): List<T> = query(table, null, selection, selectionArgs, null, null, null).use { cursor ->
  buildList {
    while (cursor.moveToNext()) add(map(cursor))
  }
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
