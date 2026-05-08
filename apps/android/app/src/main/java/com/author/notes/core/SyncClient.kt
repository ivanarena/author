package com.author.notes.core

import com.author.notes.BuildConfig
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

class AuthException(message: String = "Login expired") : Exception(message)

class SyncHttpException(val status: Int, message: String) : Exception(message)

class SyncClient(private val baseUrlProvider: () -> String) {
  fun loadServerConfig(): ServerConfig {
    val json = requestJson("/api/config", "GET")
    val remote = json.optJSONObject("remote") ?: JSONObject()
    return ServerConfig(
      apiBaseUrl = (json.optNullableString("apiBaseUrl") ?: apiUrl("/")).trimEnd('/'),
      remoteSyncEnabled = remote.optBoolean("enabled", false),
      remoteDatabaseConfigured = remote.optBoolean("configured", false)
    )
  }

  fun validateSession(token: String): Pair<AuthUser, String?> {
    val json = requestJson("/api/auth/validate", "GET", token = token)
    val user = json.getJSONObject("user")
    return AuthUser(user.getString("username"), user.optNullableString("displayName")) to
      json.optNullableString("expiresAt")
  }

  fun login(username: String, password: String, device: Device): LoginResponse {
    val body = JSONObject()
      .put("username", username)
      .put("password", password)
      .put("device", deviceToJson(device))
    return parseLoginResponse(requestJson("/api/auth/login", "POST", body = body))
  }

  fun signup(username: String, password: String, displayName: String?, device: Device): LoginResponse {
    val body = JSONObject()
      .put("username", username)
      .put("password", password)
      .putNullable("displayName", displayName)
      .put("device", deviceToJson(device))
    return parseLoginResponse(requestJson("/api/auth/signup", "POST", body = body))
  }

  fun loadSyncStatus(token: String): RemoteSyncInfo {
    val remote = requestJson("/api/sync/status", "GET", token = token).getJSONObject("remote")
    return RemoteSyncInfo(
      enabled = remote.optBoolean("enabled", false),
      state = remote.optString("state", "unknown"),
      lastError = remote.optNullableString("lastError")
    )
  }

  fun pushSyncChanges(
    token: String,
    device: Device,
    notes: List<Pair<LocalNote, Int>>,
    notebooks: List<Pair<LocalNotebook, Int>>
  ): PushResponse {
    val body = JSONObject()
      .put("device", deviceToJson(device))
      .put(
        "notes",
        JSONArray(
          notes.map { (note, baseVersion) ->
            JSONObject().put("record", noteToJson(note)).put("baseVersion", baseVersion)
          }
        )
      )
      .put(
        "notebooks",
        JSONArray(
          notebooks.map { (notebook, baseVersion) ->
            JSONObject().put("record", notebookToJson(notebook)).put("baseVersion", baseVersion)
          }
        )
      )
    return parsePushResponse(requestJson("/api/sync/push", "POST", token = token, body = body))
  }

  fun pullSyncChanges(
    token: String,
    since: String?,
    sinceRevision: Long,
    limit: Int
  ): PullResponse {
    val body = JSONObject()
      .putNullable("since", since)
      .put("sinceRevision", sinceRevision)
      .put("limit", limit)
    return parsePullResponse(requestJson("/api/sync/pull", "POST", token = token, body = body))
  }

  fun updateAccount(token: String, displayName: String?): AuthUser {
    val body = JSONObject().putNullable("displayName", displayName)
    val user = requestJson("/api/account", "PATCH", token = token, body = body).getJSONObject("user")
    return AuthUser(user.getString("username"), user.optNullableString("displayName"))
  }

  fun changePassword(token: String, currentPassword: String, newPassword: String): AuthUser {
    val body = JSONObject()
      .put("currentPassword", currentPassword)
      .put("newPassword", newPassword)
    val user = requestJson("/api/account/password", "POST", token = token, body = body).getJSONObject("user")
    return AuthUser(user.getString("username"), user.optNullableString("displayName"))
  }

  fun logout(token: String) {
    requestJson("/api/auth/logout", "POST", token = token, body = JSONObject())
  }

  fun deleteAccount(token: String, password: String) {
    requestJson("/api/account", "DELETE", token = token, body = JSONObject().put("password", password))
  }

  private fun requestJson(
    path: String,
    method: String,
    token: String? = null,
    body: JSONObject? = null
  ): JSONObject {
    val connection = (URL(apiUrl(path)).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 15_000
      readTimeout = 30_000
      setRequestProperty("accept", "application/json")
      if (token != null) setRequestProperty("authorization", "Bearer $token")
      if (body != null) {
        doOutput = true
        setRequestProperty("content-type", "application/json")
      }
    }
    try {
      if (body != null) {
        OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
      }

      val status = connection.responseCode
      val text = readResponse(connection, status)
      if (status !in 200..299) {
        val message = runCatching { JSONObject(text).optString("error") }.getOrNull()
          ?.takeIf { it.isNotBlank() }
          ?: "Sync failed: $status"
        if (status == 401) throw AuthException(message)
        throw SyncHttpException(status, message)
      }
      return if (text.isBlank()) JSONObject() else JSONObject(text)
    } finally {
      connection.disconnect()
    }
  }

  private fun readResponse(connection: HttpURLConnection, status: Int): String {
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    if (stream == null) return ""
    return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
  }

  private fun apiUrl(path: String): String {
    val base = baseUrlProvider().trim().ifBlank { BuildConfig.DEFAULT_API_BASE_URL }
    return URL(URL(base.trimEnd('/') + "/"), path.trimStart('/')).toString()
  }
}

data class LoginResponse(
  val token: String,
  val user: AuthUser,
  val device: Device,
  val expiresAt: String?
)

private fun parseLoginResponse(json: JSONObject): LoginResponse {
  val user = json.getJSONObject("user")
  return LoginResponse(
    token = json.getString("token"),
    user = AuthUser(user.getString("username"), user.optNullableString("displayName")),
    device = deviceFromJson(json.getJSONObject("device")),
    expiresAt = json.optNullableString("expiresAt")
  )
}
