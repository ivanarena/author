package com.author.notes.core

import org.json.JSONArray
import org.json.JSONObject

data class AcceptedChange(
  val entityType: String,
  val id: String,
  val version: Int,
  val updatedAt: String
)

data class PushResponse(
  val serverTime: String,
  val accepted: List<AcceptedChange>,
  val noteConflicts: List<SyncConflict<LocalNote>>,
  val notebookConflicts: List<SyncConflict<LocalNotebook>>
)

data class PullResponse(
  val serverTime: String,
  val serverRevision: Long,
  val notes: List<LocalNote>,
  val notebooks: List<LocalNotebook>,
  val devices: List<Device>,
  val deletedNoteIds: List<String>,
  val deletedNotebookIds: List<String>,
  val deletedDeviceIds: List<String>,
  val hasMore: Boolean
)

fun noteToJson(note: LocalNote): JSONObject = JSONObject()
  .put("id", note.id)
  .put("title", note.title)
  .put("body", note.body)
  .putNullable("titleHash", note.titleHash)
  .putNullable("bodyHash", note.bodyHash)
  .put("notebookIds", JSONArray(note.notebookIds))
  .putNullable("notebookId", note.notebookId)
  .put("createdAt", note.createdAt)
  .put("updatedAt", note.updatedAt)
  .putNullable("deletedAt", note.deletedAt)
  .putNullable("trashedAt", note.trashedAt)
  .put("deviceId", note.deviceId)
  .put("version", note.version)
  .put("syncStatus", note.syncStatus)

fun noteFromJson(json: JSONObject): LocalNote {
  val notebookIds = json.optJSONArray("notebookIds")?.toStringList()
    ?: json.optNullableString("notebookId")?.let { listOf(it) }
    ?: emptyList()
  return LocalNote(
    id = json.getString("id"),
    title = json.optString("title", ""),
    body = json.optString("body", ""),
    titleHash = json.optNullableString("titleHash"),
    bodyHash = json.optNullableString("bodyHash"),
    notebookIds = notebookIds,
    notebookId = json.optNullableString("notebookId") ?: notebookIds.firstOrNull(),
    createdAt = json.getString("createdAt"),
    updatedAt = json.getString("updatedAt"),
    deletedAt = json.optNullableString("deletedAt"),
    trashedAt = json.optNullableString("trashedAt"),
    deviceId = json.getString("deviceId"),
    version = json.optInt("version", 1),
    syncStatus = json.optString("syncStatus", "synced"),
    lastSyncedVersion = json.optInt("lastSyncedVersion", json.optInt("version", 1)),
    lastSyncedAt = json.optNullableString("lastSyncedAt")
  )
}

fun notebookToJson(notebook: LocalNotebook): JSONObject = JSONObject()
  .put("id", notebook.id)
  .put("name", notebook.name)
  .put("createdAt", notebook.createdAt)
  .put("updatedAt", notebook.updatedAt)
  .putNullable("deletedAt", notebook.deletedAt)
  .put("deviceId", notebook.deviceId)
  .put("version", notebook.version)
  .put("syncStatus", notebook.syncStatus)

fun notebookFromJson(json: JSONObject): LocalNotebook = LocalNotebook(
  id = json.getString("id"),
  name = json.optString("name", ""),
  createdAt = json.getString("createdAt"),
  updatedAt = json.getString("updatedAt"),
  deletedAt = json.optNullableString("deletedAt"),
  deviceId = json.getString("deviceId"),
  version = json.optInt("version", 1),
  syncStatus = json.optString("syncStatus", "synced"),
  lastSyncedVersion = json.optInt("lastSyncedVersion", json.optInt("version", 1)),
  lastSyncedAt = json.optNullableString("lastSyncedAt")
)

fun deviceToJson(device: Device): JSONObject = JSONObject()
  .put("id", device.id)
  .put("name", device.name)

fun deviceFromJson(json: JSONObject): Device = Device(
  id = json.getString("id"),
  name = json.optString("name", json.getString("id"))
)

fun noteConflictToJson(conflict: SyncConflict<LocalNote>): JSONObject =
  conflictToJson(conflict, ::noteToJson)

fun notebookConflictToJson(conflict: SyncConflict<LocalNotebook>): JSONObject =
  conflictToJson(conflict, ::notebookToJson)

fun noteConflictFromJson(json: JSONObject): SyncConflict<LocalNote> =
  conflictFromJson(json, ::noteFromJson)

fun notebookConflictFromJson(json: JSONObject): SyncConflict<LocalNotebook> =
  conflictFromJson(json, ::notebookFromJson)

private fun <T> conflictToJson(
  conflict: SyncConflict<T>,
  recordToJson: (T) -> JSONObject
): JSONObject = JSONObject()
  .put("id", conflict.id)
  .put("entityType", conflict.entityType)
  .put("entityId", conflict.entityId)
  .put("reason", conflict.reason)
  .put("local", conflictVersionToJson(conflict.local, recordToJson))
  .put("remote", conflictVersionToJson(conflict.remote, recordToJson))

private fun <T> conflictVersionToJson(
  version: ConflictVersion<T>,
  recordToJson: (T) -> JSONObject
): JSONObject = JSONObject()
  .put("source", version.source)
  .put("deviceId", version.deviceId)
  .put("deviceName", version.deviceName)
  .put("updatedAt", version.updatedAt)
  .put("version", version.version)
  .put("previewText", version.previewText)
  .put("record", recordToJson(version.record))

private fun <T> conflictFromJson(
  json: JSONObject,
  recordFromJson: (JSONObject) -> T
): SyncConflict<T> = SyncConflict(
  id = json.getString("id"),
  entityType = json.getString("entityType"),
  entityId = json.getString("entityId"),
  reason = json.optString("reason", "remote_changed"),
  local = conflictVersionFromJson(json.getJSONObject("local"), recordFromJson),
  remote = conflictVersionFromJson(json.getJSONObject("remote"), recordFromJson)
)

private fun <T> conflictVersionFromJson(
  json: JSONObject,
  recordFromJson: (JSONObject) -> T
): ConflictVersion<T> = ConflictVersion(
  source = json.getString("source"),
  deviceId = json.getString("deviceId"),
  deviceName = json.optString("deviceName", json.getString("deviceId")),
  updatedAt = json.getString("updatedAt"),
  version = json.optInt("version", 1),
  previewText = json.optString("previewText", ""),
  record = recordFromJson(json.getJSONObject("record"))
)

fun parsePushResponse(json: JSONObject): PushResponse {
  val noteConflicts = mutableListOf<SyncConflict<LocalNote>>()
  val notebookConflicts = mutableListOf<SyncConflict<LocalNotebook>>()
  json.optJSONArray("conflicts")?.forEachObject { conflict ->
    when (conflict.optString("entityType")) {
      "note" -> noteConflicts.add(noteConflictFromJson(conflict))
      "notebook" -> notebookConflicts.add(notebookConflictFromJson(conflict))
    }
  }
  return PushResponse(
    serverTime = json.getString("serverTime"),
    accepted = json.optJSONArray("accepted").toAcceptedChanges(),
    noteConflicts = noteConflicts,
    notebookConflicts = notebookConflicts
  )
}

fun parsePullResponse(json: JSONObject): PullResponse = PullResponse(
  serverTime = json.getString("serverTime"),
  serverRevision = json.optLong("serverRevision", 0L),
  notes = json.optJSONArray("notes").toObjects(::noteFromJson),
  notebooks = json.optJSONArray("notebooks").toObjects(::notebookFromJson),
  devices = json.optJSONArray("devices").toObjects(::deviceFromJson),
  deletedNoteIds = json.optJSONArray("deletedNoteIds").toStringList(),
  deletedNotebookIds = json.optJSONArray("deletedNotebookIds").toStringList(),
  deletedDeviceIds = json.optJSONArray("deletedDeviceIds").toStringList(),
  hasMore = json.optBoolean("hasMore", false)
)

fun JSONObject.putNullable(key: String, value: String?): JSONObject =
  put(key, value ?: JSONObject.NULL)

fun JSONObject.optNullableString(key: String): String? =
  if (!has(key) || isNull(key)) null else optString(key)

fun JSONArray?.toStringList(): List<String> {
  if (this == null) return emptyList()
  return List(length()) { getString(it) }
}

fun <T> JSONArray?.toObjects(map: (JSONObject) -> T): List<T> {
  if (this == null) return emptyList()
  return List(length()) { index -> map(getJSONObject(index)) }
}

fun JSONArray?.toAcceptedChanges(): List<AcceptedChange> =
  toObjects {
    AcceptedChange(
      entityType = it.getString("entityType"),
      id = it.getString("id"),
      version = it.optInt("version", 1),
      updatedAt = it.getString("updatedAt")
    )
  }

fun JSONArray.forEachObject(block: (JSONObject) -> Unit) {
  for (index in 0 until length()) block(getJSONObject(index))
}

