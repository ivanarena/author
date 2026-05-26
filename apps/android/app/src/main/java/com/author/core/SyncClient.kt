package com.author.core

import com.author.BuildConfig
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import org.json.JSONArray
import org.json.JSONObject

class AuthException(message: String = "Sign-in expired") : Exception(message)

class SyncHttpException(val status: Int, message: String) : Exception(message)

class SyncClient(private val baseUrlProvider: () -> String) {
  private val random = SecureRandom()

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

  fun authChallenge(username: String?, purpose: String, token: String? = null): AuthChallenge {
    val body =
      JSONObject()
        .putNullable("username", username)
        .put("purpose", purpose)
        .put("clientNonce", randomAuthNonce())
    return parseAuthChallenge(
      requestJson("/api/auth/challenge", "POST", token = token, body = body)
    )
  }

  fun loginWithProof(
    username: String,
    proof: AuthProof,
    totpCode: String?,
    device: Device,
    deviceTrustSecret: String,
  ): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .put("proof", authProofToJson(proof))
        .putNullable("totpCode", totpCode)
        .put("device", deviceToJson(device))
        .put("deviceTrustSecret", deviceTrustSecret)
    return parseLoginResponse(requestJson("/api/auth/login", "POST", body = body))
  }

  fun loginTrustedDevice(
    username: String,
    totpCode: String?,
    device: Device,
    deviceTrustSecret: String,
  ): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .putNullable("totpCode", totpCode)
        .put("device", deviceToJson(device))
        .put("deviceTrustSecret", deviceTrustSecret)
    return parseLoginResponse(requestJson("/api/auth/login", "POST", body = body))
  }

  fun loginBootstrap(
    username: String,
    bootstrapPassword: String,
    verifier: PasswordVerifier,
    totpCode: String?,
    device: Device,
    deviceTrustSecret: String,
  ): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .put("bootstrapPassword", bootstrapPassword)
        .put("passwordVerifier", passwordVerifierToJson(verifier))
        .putNullable("totpCode", totpCode)
        .put("device", deviceToJson(device))
        .put("deviceTrustSecret", deviceTrustSecret)
    return parseLoginResponse(requestJson("/api/auth/login", "POST", body = body))
  }

  fun signup(
    username: String,
    email: String,
    verifier: PasswordVerifier,
    device: Device,
    deviceTrustSecret: String,
  ): LoginResponse {
    val body =
      JSONObject()
        .put("username", username)
        .put("email", email)
        .put("passwordVerifier", passwordVerifierToJson(verifier))
        .put("device", deviceToJson(device))
        .put("deviceTrustSecret", deviceTrustSecret)
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

  fun changePassword(
    token: String,
    proof: AuthProof,
    newVerifier: PasswordVerifier,
  ): AccountResponse {
    val body =
      JSONObject()
        .put("proof", authProofToJson(proof))
        .put("newPasswordVerifier", passwordVerifierToJson(newVerifier))
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
    proof: AuthProof,
    secret: String,
    totpCode: String,
  ): AccountResponse {
    val body =
      JSONObject()
        .put("proof", authProofToJson(proof))
        .put("secret", secret)
        .put("totpCode", totpCode)
    return parseAccountResponse(
      requestJson("/api/account/totp", "POST", token = token, body = body)
    )
  }

  fun disableTotp(token: String, proof: AuthProof, totpCode: String?): AccountResponse {
    val body = JSONObject().put("proof", authProofToJson(proof)).putNullable("totpCode", totpCode)
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

  fun deleteAccount(token: String, proof: AuthProof) {
    requestJson(
      "/api/account",
      "DELETE",
      token = token,
      body = JSONObject().put("proof", authProofToJson(proof)),
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

  private fun randomAuthNonce(): String {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    return base64UrlEncode(bytes)
  }
}

data class LoginResponse(
  val token: String,
  val user: AuthUser,
  val device: Device,
  val expiresAt: String?,
  val serverProof: String?,
)

private fun parseLoginResponse(json: JSONObject): LoginResponse {
  val user = json.getJSONObject("user")
  return LoginResponse(
    token = json.getString("token"),
    user = parseAuthUser(user),
    device = deviceFromJson(json.getJSONObject("device")),
    expiresAt = json.optNullableString("expiresAt"),
    serverProof = json.optNullableString("serverProof"),
  )
}

private fun parseAuthChallenge(json: JSONObject): AuthChallenge =
  AuthChallenge(
    mode = json.getString("mode"),
    challengeId = json.getString("challengeId"),
    username = json.getString("username"),
    purpose = json.getString("purpose"),
    clientNonce = json.getString("clientNonce"),
    serverNonce = json.getString("serverNonce"),
    expiresAt = json.getString("expiresAt"),
    salt = json.getString("salt"),
    params = parseAuthKdfParams(json.getJSONObject("params")),
  )

private fun parseAuthKdfParams(json: JSONObject): AuthKdfParams =
  AuthKdfParams(
    algorithm = json.getString("algorithm"),
    memoryKiB = json.getInt("memoryKiB"),
    iterations = json.getInt("iterations"),
    parallelism = json.getInt("parallelism"),
    keyLength = json.getInt("keyLength"),
  )

private fun passwordVerifierToJson(verifier: PasswordVerifier): JSONObject =
  JSONObject()
    .put("algorithm", verifier.algorithm)
    .put("salt", verifier.salt)
    .put("params", authKdfParamsToJson(verifier.params))
    .put("storedKey", verifier.storedKey)
    .put("serverKey", verifier.serverKey)

private fun authKdfParamsToJson(params: AuthKdfParams): JSONObject =
  JSONObject()
    .put("algorithm", params.algorithm)
    .put("memoryKiB", params.memoryKiB)
    .put("iterations", params.iterations)
    .put("parallelism", params.parallelism)
    .put("keyLength", params.keyLength)

private fun authProofToJson(proof: AuthProof): JSONObject =
  JSONObject()
    .put("challengeId", proof.challengeId)
    .put("clientNonce", proof.clientNonce)
    .put("proof", proof.proof)

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
