package com.author.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class JsonCodecsTest {
  @Test
  fun parsePushResponseKeepsAcceptedChangesAndTypedConflicts() {
    val noteConflict = SyncConflict(
      id = "conflict-note",
      entityType = "note",
      entityId = "note-1",
      reason = "remote_changed",
      local = ConflictVersion("local", "phone", "Phone", "2026-05-10T10:00:00Z", 2, "Local", note("note-1", "Local")),
      remote = ConflictVersion("remote", "web", "Web", "2026-05-10T10:01:00Z", 3, "Remote", note("note-1", "Remote", version = 3))
    )
    val notebookConflict = SyncConflict(
      id = "conflict-notebook",
      entityType = "notebook",
      entityId = "book-1",
      reason = "duplicate_name",
      local = ConflictVersion("local", "phone", "Phone", "2026-05-10T10:00:00Z", 1, "Work", notebook("book-1", "Work")),
      remote = ConflictVersion("remote", "web", "Web", "2026-05-10T10:01:00Z", 2, "work", notebook("book-1", "work", version = 2))
    )
    val json = JSONObject()
      .put("serverTime", "2026-05-10T10:02:00Z")
      .put(
        "accepted",
        JSONArray().put(
          JSONObject()
            .put("entityType", "note")
            .put("id", "accepted-note")
            .put("version", 4)
            .put("updatedAt", "2026-05-10T10:02:00Z")
        )
      )
      .put(
        "conflicts",
        JSONArray()
          .put(noteConflictToJson(noteConflict))
          .put(notebookConflictToJson(notebookConflict))
      )

    val parsed = parsePushResponse(json)

    assertEquals("2026-05-10T10:02:00Z", parsed.serverTime)
    assertEquals("accepted-note", parsed.accepted.single().id)
    assertEquals("remote_changed", parsed.noteConflicts.single().reason)
    assertEquals("Remote", parsed.noteConflicts.single().remote.record.title)
    assertEquals("duplicate_name", parsed.notebookConflicts.single().reason)
    assertEquals("work", parsed.notebookConflicts.single().remote.record.name)
  }

  @Test
  fun parsePullResponseHandlesRevisionPagingAndDeletes() {
    val json = JSONObject()
      .put("serverTime", "2026-05-10T10:02:00Z")
      .put("serverRevision", 42)
      .put("notes", JSONArray().put(noteToJson(note("note-1", "Pulled"))))
      .put("notebooks", JSONArray().put(notebookToJson(notebook("book-1", "Work"))))
      .put("devices", JSONArray().put(deviceToJson(Device("web", "Web"))))
      .put("deletedNoteIds", JSONArray().put("deleted-note"))
      .put("deletedNotebookIds", JSONArray().put("deleted-book"))
      .put("deletedDeviceIds", JSONArray().put("deleted-device"))
      .put("hasMore", true)

    val parsed = parsePullResponse(json)

    assertEquals(42L, parsed.serverRevision)
    assertEquals(true, parsed.hasMore)
    assertEquals("note-1", parsed.notes.single().id)
    assertEquals("book-1", parsed.notebooks.single().id)
    assertEquals("web", parsed.devices.single().id)
    assertEquals(listOf("deleted-note"), parsed.deletedNoteIds)
    assertEquals(listOf("deleted-book"), parsed.deletedNotebookIds)
    assertEquals(listOf("deleted-device"), parsed.deletedDeviceIds)
  }

  private fun note(
    id: String,
    title: String,
    version: Int = 2
  ) = LocalNote(
    id = id,
    title = title,
    body = "$title body",
    titleHash = "hash:title:$title",
    bodyHash = "hash:body:$title",
    notebookIds = emptyList(),
    notebookId = null,
    createdAt = "2026-05-10T09:00:00Z",
    updatedAt = "2026-05-10T10:00:00Z",
    deletedAt = null,
    trashedAt = null,
    deviceId = "phone",
    version = version,
    syncStatus = "pending",
    lastSyncedVersion = version - 1,
    lastSyncedAt = null
  )

  private fun notebook(
    id: String,
    name: String,
    version: Int = 1
  ) = LocalNotebook(
    id = id,
    name = name,
    nameHash = "hash:name:$name",
    createdAt = "2026-05-10T09:00:00Z",
    updatedAt = "2026-05-10T10:00:00Z",
    deletedAt = null,
    deviceId = "phone",
    version = version,
    syncStatus = "pending",
    lastSyncedVersion = version - 1,
    lastSyncedAt = null
  )
}
