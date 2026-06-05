package com.author.core

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.BufferedReader
import java.io.Closeable
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesRepositorySyncInstrumentedTest {
  private lateinit var context: Context
  private lateinit var prefs: SharedPreferences
  private lateinit var repository: NotesRepository
  private lateinit var crypto: NoteCrypto
  private lateinit var keyMaterial: String

  @Before
  fun setUp() = runBlocking {
    context = ApplicationProvider.getApplicationContext()
    context.deleteDatabase("author.db")
    prefs = context.getSharedPreferences("author", Context.MODE_PRIVATE)
    prefs.edit().clear().commit()
    repository = NotesRepository(context)
    repository.rememberPasswordAndAdopt(TEST_USERNAME, TEST_PASSWORD, previousUsername = null)
    crypto = NoteCrypto(prefs, SecurePreferenceStore(prefs))
    keyMaterial = crypto.getEncryptionKeyMaterial()
  }

  @After
  fun tearDown() {
    if (::repository.isInitialized) repository.close()
    context.deleteDatabase("author.db")
    prefs.edit().clear().commit()
  }

  @Test
  fun closingRepositoryReleasesEncryptedDatabaseForReopen() = runBlocking {
    val firstDevice = repository.getOrCreateDevice()

    repository.close()
    repository = NotesRepository(context)

    assertEquals(firstDevice, repository.getOrCreateDevice())
  }

  @Test
  fun passwordLoginAdoptsAccountEncryptedRowsWhenLocalKeyMaterialWasLost() = runBlocking {
    val note = repository.createBlankNote("Synced title", "Synced body")

    crypto.clearStoredEncryptionKeyMaterial()

    repository.rememberPasswordAndAdopt(
      TEST_USERNAME,
      TEST_PASSWORD,
      previousUsername = TEST_USERNAME,
      nextMaterialOverride = keyMaterial,
    )

    assertEquals(true, repository.hasStoredEncryptionKeyMaterial())
    val restored = repository.loadWorkspaceSnapshot().notes.single { it.id == note.id }
    assertEquals("Synced title", restored.title)
    assertEquals("Synced body", restored.body)
  }

  @Test
  fun runSyncStoresEncryptedRemoteEditConflictAndResolvesLocalWinner() = runBlocking {
    FakeSyncServer().use { server ->
      server.start()
      repository.setApiBaseUrl(server.baseUrl)

      val note = repository.createBlankNote("Base title", "Base body")
      assertEquals(SyncRunResult(pushed = 1, pulled = 0, conflicts = 0), repository.runSync(TOKEN))

      val localEdit =
        requireNotNull(repository.updateNoteContent(note.id, "Local title", "Local body"))
      val remoteEdit =
        crypto.encryptNoteFields(
          localEdit.copy(
            title = "Remote title",
            body = "Remote body",
            titleHash = null,
            bodyHash = null,
            updatedAt = "2026-05-21T10:10:00Z",
            deviceId = "web-device",
            version = 2,
            syncStatus = "synced",
            lastSyncedVersion = 2,
            lastSyncedAt = "2026-05-21T10:10:01Z",
          ),
          keyMaterial,
        )
      server.queueRemoteConflict(remoteEdit)

      val conflictedRun = repository.runSync(TOKEN)

      assertEquals(1, conflictedRun.conflicts)
      val conflict = requireNotNull(repository.loadWorkspace().conflicts.single().noteConflict)
      assertEquals("Local body", conflict.local.record.body)
      assertEquals("Remote body", conflict.remote.record.body)
      assertStoredConflictDoesNotLeakPlaintext(
        conflict.id,
        "Local title",
        "Local body",
        "Remote title",
        "Remote body",
      )

      repository.resolveConflict(conflict.id, "keep-local")

      val resolvedNote = repository.loadWorkspace().notes.single { it.id == note.id }
      assertEquals("Local body", resolvedNote.body)
      assertEquals("pending", resolvedNote.syncStatus)

      assertEquals(SyncRunResult(pushed = 1, pulled = 0, conflicts = 0), repository.runSync(TOKEN))
      val remoteAfterResolution = requireNotNull(server.remoteNote)
      assertEquals("Local body", crypto.decryptNoteFields(remoteAfterResolution, keyMaterial).body)
      assertEquals(3, remoteAfterResolution.version)
    }
  }

  @Test
  fun runSyncResolvesRemoteDeleteConflictWithLocalWinner() = runBlocking {
    FakeSyncServer().use { server ->
      server.start()
      repository.setApiBaseUrl(server.baseUrl)

      val note = repository.createBlankNote("Base title", "Base body")
      assertEquals(SyncRunResult(pushed = 1, pulled = 0, conflicts = 0), repository.runSync(TOKEN))

      val localEdit =
        requireNotNull(repository.updateNoteContent(note.id, "Local title", "Local after delete"))
      val deletedRemote =
        crypto.encryptNoteFields(
          localEdit.copy(
            deletedAt = "2026-05-21T10:11:00Z",
            updatedAt = "2026-05-21T10:11:00Z",
            deviceId = "web-device",
            version = 2,
            syncStatus = "synced",
            lastSyncedVersion = 2,
            lastSyncedAt = "2026-05-21T10:11:01Z",
          ),
          keyMaterial,
        )
      server.queueRemoteDeletedConflict(deletedRemote)

      val conflictedRun = repository.runSync(TOKEN)

      assertEquals(1, conflictedRun.conflicts)
      val conflict = requireNotNull(repository.loadWorkspace().conflicts.single().noteConflict)
      assertEquals("deleted_remotely", conflict.reason)
      assertEquals(2, conflict.remote.version)
      assertStoredConflictDoesNotLeakPlaintext(conflict.id, "Local title", "Local after delete")

      repository.resolveConflict(conflict.id, "keep-local")

      val resolvedNote = repository.loadWorkspace().notes.single { it.id == note.id }
      assertEquals("Local after delete", resolvedNote.body)
      assertNull(resolvedNote.deletedAt)
      assertEquals("pending", resolvedNote.syncStatus)
      assertEquals(2, resolvedNote.lastSyncedVersion)
      assertEquals(3, resolvedNote.version)

      assertEquals(SyncRunResult(pushed = 1, pulled = 0, conflicts = 0), repository.runSync(TOKEN))
      val remoteAfterResolution = requireNotNull(server.remoteNote)
      val remotePlain = crypto.decryptNoteFields(remoteAfterResolution, keyMaterial)
      assertEquals("Local after delete", remotePlain.body)
      assertNull(remoteAfterResolution.deletedAt)
      assertEquals(3, remoteAfterResolution.version)
    }
  }

  private fun rawConflict(id: String): RawConflict? {
    val db = NotesDatabase(context)
    try {
      return db.rawConflict(id)
    } finally {
      db.close()
    }
  }

  private fun assertStoredConflictDoesNotLeakPlaintext(id: String, vararg plaintexts: String) {
    val rawJson = requireNotNull(rawConflict(id)).conflictJson
    plaintexts.forEach { plaintext ->
      assertFalse("Stored conflict leaked plaintext: $plaintext", rawJson.contains(plaintext))
    }
  }

  private fun note(
    id: String,
    title: String,
    body: String,
    deviceId: String,
    version: Int,
    lastSyncedVersion: Int,
    syncStatus: String,
  ) =
    LocalNote(
      id = id,
      title = title,
      body = body,
      titleHash = null,
      bodyHash = null,
      notebookIds = emptyList(),
      notebookId = null,
      createdAt = "2026-05-21T10:00:00Z",
      updatedAt = "2026-05-21T10:05:00Z",
      deletedAt = null,
      trashedAt = null,
      deviceId = deviceId,
      version = version,
      syncStatus = syncStatus,
      lastSyncedVersion = lastSyncedVersion,
      lastSyncedAt = "2026-05-21T10:00:01Z",
    )
}

private class FakeSyncServer : Closeable {
  private val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  private val executor = Executors.newSingleThreadExecutor()
  private var revision = 0L

  @Volatile
  var remoteNote: LocalNote? = null
    private set

  @Volatile private var conflictNextPush = false
  @Volatile private var pullRemoteOnce = false
  @Volatile private var queuedConflictReason = "remote_changed"

  val baseUrl: String = "http://127.0.0.1:${server.localPort}"

  fun start() {
    executor.execute {
      while (!server.isClosed) {
        try {
          handle(server.accept())
        } catch (_: Exception) {
          if (!server.isClosed) throw IllegalStateException("Fake sync server failed")
        }
      }
    }
  }

  fun queueRemoteConflict(note: LocalNote) {
    remoteNote = note
    conflictNextPush = true
    queuedConflictReason = "remote_changed"
    pullRemoteOnce = true
    revision += 1
  }

  fun queueRemoteDeletedConflict(note: LocalNote) {
    remoteNote = note
    conflictNextPush = true
    queuedConflictReason = "deleted_remotely"
    pullRemoteOnce = true
    revision += 1
  }

  private fun handle(socket: Socket) {
    socket.use {
      val reader = BufferedReader(InputStreamReader(it.getInputStream(), UTF_8))
      val requestLine = reader.readLine() ?: return
      val path = requestLine.split(" ").getOrNull(1).orEmpty()
      var contentLength = 0
      while (true) {
        val header = reader.readLine() ?: return
        if (header.isEmpty()) break
        val separator = header.indexOf(':')
        if (separator > 0 && header.substring(0, separator).equals("content-length", true)) {
          contentLength = header.substring(separator + 1).trim().toInt()
        }
      }
      val body = CharArray(contentLength)
      var read = 0
      while (read < contentLength) {
        val count = reader.read(body, read, contentLength - read)
        if (count < 0) break
        read += count
      }
      val response =
        when (path) {
          "/api/sync/push" -> handlePush(JSONObject(String(body, 0, read)))
          "/api/sync/pull" -> handlePull()
          else -> JSONObject().put("error", "Unexpected path: $path")
        }
      writeJson(it.getOutputStream(), response)
    }
  }

  private fun handlePush(body: JSONObject): JSONObject {
    val accepted = JSONArray()
    val conflicts = JSONArray()
    body.optJSONArray("notes")?.forEachObject { item ->
      val record = noteFromJson(item.getJSONObject("record"))
      val baseVersion = item.optInt("baseVersion", 0)
      val current = remoteNote
      if (conflictNextPush && current != null && baseVersion != current.version) {
        conflicts.put(
          noteConflictToJson(
            SyncConflict(
              id = "server-conflict-${record.id}",
              entityType = "note",
              entityId = record.id,
              reason = queuedConflictReason,
              local =
                ConflictVersion(
                  source = "local",
                  deviceId = record.deviceId,
                  deviceName = record.deviceId,
                  updatedAt = record.updatedAt,
                  version = record.version,
                  previewText = "",
                  record = record,
                ),
              remote =
                ConflictVersion(
                  source = "remote",
                  deviceId = current.deviceId,
                  deviceName = current.deviceId,
                  updatedAt = current.updatedAt,
                  version = current.version,
                  previewText = "",
                  record = current,
                ),
            )
          )
        )
        conflictNextPush = false
        return@forEachObject
      }

      val version = (current?.version ?: baseVersion) + 1
      remoteNote =
        record.copy(
          version = version,
          syncStatus = "synced",
          lastSyncedVersion = version,
          lastSyncedAt = SERVER_TIME,
        )
      revision += 1
      accepted.put(
        JSONObject()
          .put("entityType", "note")
          .put("id", record.id)
          .put("version", version)
          .put("updatedAt", record.updatedAt)
      )
    }
    return JSONObject()
      .put("serverTime", SERVER_TIME)
      .put("accepted", accepted)
      .put("conflicts", conflicts)
  }

  private fun handlePull(): JSONObject {
    val notes = JSONArray()
    if (pullRemoteOnce) {
      remoteNote?.let { notes.put(noteToJson(it)) }
      pullRemoteOnce = false
    }
    return JSONObject()
      .put("serverTime", SERVER_TIME)
      .put("serverRevision", revision)
      .put("notes", notes)
      .put("notebooks", JSONArray())
      .put("devices", JSONArray())
      .put("deletedNoteIds", JSONArray())
      .put("deletedNotebookIds", JSONArray())
      .put("deletedDeviceIds", JSONArray())
      .put("hasMore", false)
  }

  private fun writeJson(output: OutputStream, json: JSONObject) {
    val body = json.toString().toByteArray(UTF_8)
    output.write(
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.size}\r\nconnection: close\r\n\r\n"
        .toByteArray(UTF_8)
    )
    output.write(body)
    output.flush()
  }

  override fun close() {
    server.close()
    executor.shutdownNow()
    executor.awaitTermination(2, TimeUnit.SECONDS)
  }
}

private const val TEST_USERNAME = "alice"
private const val TEST_PASSWORD = "correct horse battery staple"
private const val TOKEN = "session-token"
private const val SERVER_TIME = "2026-05-21T10:30:00Z"
