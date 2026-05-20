package com.author.core

import com.author.BuildConfig
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
    val signup = json.optJSONObject("signup") ?: JSONObject()
    return ServerConfig(
      apiBaseUrl = (json.optNullableString("apiBaseUrl") ?: apiUrl("/")).trimEnd('/'),
      remoteSyncEnabled = remote.optBoolean("enabled", false),
      remoteDatabaseConfigured = remote.optBoolean("configured", false),
      signupEnabled = signup.optBoolean("enabled", false),
      signupEmailRequired = signup.optBoolean("emailRequired", true),
    )
  }

  fun validateSession(token: String): Pair<AuthUser, String?> {
    val json = requestJson("/api/auth/validate", "GET", token = token)
    val user = json.getJSONObject("user")
    return parseAuthUser(user) to json.optNullableString("expiresAt")
  }

  fun login(username: String, password: String, totpCode: String?, device: Device): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .put("password", password)
        .putNullable("totpCode", totpCode)
        .put("device", deviceToJson(device))
    return parseLoginResponse(requestJson("/api/auth/login", "POST", body = body))
  }

  fun signup(username: String, email: String, password: String, device: Device): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .put("email", email)
        .put("password", password)
        .put("device", deviceToJson(device))
    return parseLoginResponse(requestJson("/api/auth/signup", "POST", body = body))
  }

  fun loadSyncStatus(token: String): RemoteSyncInfo {
    val remote = requestJson("/api/sync/status", "GET", token = token).getJSONObject("remote")
    return RemoteSyncInfo(
      enabled = remote.optBoolean("enabled", false),
      state = remote.optString("state", "unknown"),
      lastError = remote.optNullableString("lastError"),
    )
  }

  fun loadAccount(token: String): AccountResponse =
    parseAccountResponse(requestJson("/api/account", "GET", token = token))

  fun pushSyncChanges(
    token: String,
    device: Device,
    notes: List<Pair<LocalNote, Int>>,
    notebooks: List<Pair<LocalNotebook, Int>>,
  ): PushResponse {
    val body =
      JSONObject()
        .put("device", deviceToJson(device))
        .put(
          "notes",
          JSONArray(
            notes.map { (note, baseVersion) ->
              JSONObject().put("record", noteToJson(note)).put("baseVersion", baseVersion)
            }
          ),
        )
        .put(
          "notebooks",
          JSONArray(
            notebooks.map { (notebook, baseVersion) ->
              JSONObject().put("record", notebookToJson(notebook)).put("baseVersion", baseVersion)
            }
          ),
        )
    return parsePushResponse(requestJson("/api/sync/push", "POST", token = token, body = body))
  }

  fun pullSyncChanges(
    token: String,
    since: String?,
    sinceRevision: Long,
    limit: Int,
  ): PullResponse {
    val body =
      JSONObject()
        .putNullable("since", since)
        .put("sinceRevision", sinceRevision)
        .put("limit", limit)
    return parsePullResponse(requestJson("/api/sync/pull", "POST", token = token, body = body))
  }

  fun updateAccount(token: String, email: String?): AccountResponse {
    val body = JSONObject().putNullable("email", email)
    return parseAccountResponse(requestJson("/api/account", "PATCH", token = token, body = body))
  }

  fun changePassword(token: String, currentPassword: String, newPassword: String): AccountResponse {
    val body = JSONObject().put("currentPassword", currentPassword).put("newPassword", newPassword)
    return parseAccountResponse(
      requestJson("/api/account/password", "POST", token = token, body = body)
    )
  }

  fun setupTotp(token: String): TotpSetup {
    val json = requestJson("/api/account/totp/setup", "POST", token = token, body = JSONObject())
    return TotpSetup(json.getString("secret"), json.getString("otpauthUrl"))
  }

  fun enableTotp(
    token: String,
    currentPassword: String,
    secret: String,
    totpCode: String,
  ): AccountResponse {
    val body =
      JSONObject()
        .put("currentPassword", currentPassword)
        .put("secret", secret)
        .put("totpCode", totpCode)
    return parseAccountResponse(
      requestJson("/api/account/totp", "POST", token = token, body = body)
    )
  }

  fun disableTotp(token: String, currentPassword: String, totpCode: String?): AccountResponse {
    val body =
      JSONObject().put("currentPassword", currentPassword).putNullable("totpCode", totpCode)
    return parseAccountResponse(
      requestJson("/api/account/totp", "DELETE", token = token, body = body)
    )
  }

  fun revokeTrustedDevice(token: String, deviceId: String): AccountResponse {
    val safeDeviceId = java.net.URLEncoder.encode(deviceId, Charsets.UTF_8.name())
    return parseAccountResponse(
      requestJson("/api/account/trusted-devices/$safeDeviceId", "DELETE", token = token)
    )
  }

  fun logout(token: String) {
    requestJson("/api/auth/logout", "POST", token = token, body = JSONObject())
  }

  fun deleteAccount(token: String, password: String) {
    requestJson(
      "/api/account",
      "DELETE",
      token = token,
      body = JSONObject().put("password", password),
    )
  }

  private fun requestJson(
    path: String,
    method: String,
    token: String? = null,
    body: JSONObject? = null,
  ): JSONObject {
    val connection =
      (URL(apiUrl(path)).openConnection() as HttpURLConnection).apply {
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
        OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use {
          it.write(body.toString())
        }
      }

      val status = connection.responseCode
      val text = readResponse(connection, status)
      if (status !in 200..299) {
        val message =
          runCatching { JSONObject(text).optString("error") }
            .getOrNull()
            ?.takeIf { it.isNotBlank() } ?: "Sync failed: $status"
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
  val expiresAt: String?,
)

private fun parseLoginResponse(json: JSONObject): LoginResponse {
  val user = json.getJSONObject("user")
  return LoginResponse(
    token = json.getString("token"),
    user = parseAuthUser(user),
    device = deviceFromJson(json.getJSONObject("device")),
    expiresAt = json.optNullableString("expiresAt"),
  )
}

private fun parseAuthUser(user: JSONObject): AuthUser =
  AuthUser(
    username = user.getString("username"),
    email = user.optNullableString("email"),
    displayName = user.optNullableString("displayName"),
    twoFactorEnabled = user.optBoolean("twoFactorEnabled", false),
  )

private fun parseAccountResponse(json: JSONObject): AccountResponse =
  AccountResponse(
    user = parseAuthUser(json.getJSONObject("user")),
    trustedDevices =
      json.optJSONArray("trustedDevices")?.let { devices ->
        (0 until devices.length()).map { index ->
          val device = devices.getJSONObject(index)
          TrustedAuthDevice(
            deviceId = device.getString("deviceId"),
            deviceName = device.optString("deviceName", device.getString("deviceId")),
            createdAt = device.optString("createdAt", ""),
            lastUsedAt = device.optString("lastUsedAt", ""),
            current = device.optBoolean("current", false),
          )
        }
      } ?: emptyList(),
    session =
      json.optJSONObject("session")?.let { session ->
        AccountSession(
          token = session.getString("token"),
          expiresAt = session.optNullableString("expiresAt"),
        )
      },
  )
