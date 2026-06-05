package com.author.core

import android.content.SharedPreferences
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONArray
import org.json.JSONObject

private const val ENCRYPTION_PREFIX = "enc:v4:"
private const val HASH_V3_PREFIX = "hash:v3:"
private const val KEY_MATERIAL_KEY = "author-encryption-key-material-v1"
private const val KEYRING_MATERIAL_PREFIX = "keyring:v1:"
private const val RECOVERY_CODE_PREFIX = "author-recovery-v1-"
private const val PASSWORD_ARGON2_MEMORY_KIB = 19_456
private const val PASSWORD_ARGON2_ITERATIONS = 2
private const val PASSWORD_ARGON2_PARALLELISM = 1
private const val PASSWORD_ARGON2_SALT_PREFIX = "author:password-key:v3"
private const val CURRENT_ENCRYPTION_VERSION = "v4"
private const val LEGACY_ENCRYPTION_VERSION = "v3"
private const val CURRENT_PASSWORD_MATERIAL_VERSION = "v4"
private const val DIRECT_KEY_ID = "direct"
private const val NOTEBOOK_NAME_HASH_CONTEXT = "notebook:name"
private const val AUTH_PROOF_ALGORITHM = "argon2id-scram-sha256"
private const val AUTH_MESSAGE_VERSION = "author-auth-proof-v1"
private const val AUTH_CLIENT_KEY_LABEL = "Client Key"
private const val AUTH_SERVER_KEY_LABEL = "Server Key"
const val ENCRYPTION_UPGRADE_REQUIRED_MESSAGE =
  "This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version."
const val ENCRYPTION_DECRYPT_FAILED_MESSAGE =
  "Encrypted note data cannot be decrypted with the active key material. Sign in again before syncing or changing this workspace."

data class AuthKdfParams(
  val algorithm: String = "argon2id",
  val memoryKiB: Int = PASSWORD_ARGON2_MEMORY_KIB,
  val iterations: Int = PASSWORD_ARGON2_ITERATIONS,
  val parallelism: Int = PASSWORD_ARGON2_PARALLELISM,
  val keyLength: Int = 32,
)

data class PasswordVerifier(
  val algorithm: String,
  val salt: String,
  val params: AuthKdfParams,
  val storedKey: String,
  val serverKey: String,
)

data class AuthChallenge(
  val mode: String,
  val challengeId: String,
  val username: String,
  val purpose: String,
  val clientNonce: String,
  val serverNonce: String,
  val expiresAt: String,
  val salt: String,
  val params: AuthKdfParams,
)

data class AuthProof(val challengeId: String, val clientNonce: String, val proof: String)

data class AuthProofResult(val proof: AuthProof, val expectedServerProof: String)

data class PreparedAccountKeyring(
  val keyMaterial: String,
  val e2eeKeyring: String,
  val recoveryCode: String,
  val recoveryKitJson: String,
)

class NoteCrypto(
  @Suppress("UNUSED_PARAMETER") prefs: SharedPreferences,
  private val securePrefs: SecurePreferenceStore,
) {
  private val random = SecureRandom()

  fun isEncryptedText(value: String): Boolean = encryptedEnvelope(value) != null

  fun isCurrentEncryptedText(value: String): Boolean =
    encryptedEnvelope(value)?.version == CURRENT_ENCRYPTION_VERSION

  fun isUnsupportedEncryptedText(value: String): Boolean =
    value.startsWith("enc:v1:") || value.startsWith("enc:v2:")

  fun isCurrentFieldHash(value: String?): Boolean = value?.startsWith(HASH_V3_PREFIX) == true

  fun notebookNameContext(notebook: LocalNotebook): String = "notebook:${notebook.id}:name"

  fun canDecryptEncryptedText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): Boolean {
    val envelope = encryptedEnvelope(value) ?: return false
    return canDecryptEnvelopeWithMaterial(envelope, keyMaterial, context)
  }

  fun canDecryptEncryptedTextWithPrimaryMaterial(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): Boolean {
    val envelope = encryptedEnvelope(value) ?: return false
    if (envelope.version != CURRENT_ENCRYPTION_VERSION) return false
    val descriptor = activeEncryptionDescriptor(keyMaterial)
    if (envelope.keyId != descriptor.keyId) return false
    return canDecryptEnvelopeWithDescriptor(envelope, descriptor, context)
  }

  private fun canDecryptEnvelopeWithMaterial(
    envelope: EncryptionEnvelope,
    keyMaterial: String,
    context: String,
  ): Boolean =
    decryptionDescriptors(keyMaterial, envelope).any { descriptor ->
      canDecryptEnvelopeWithDescriptor(envelope, descriptor, context)
    }

  private fun canDecryptEnvelopeWithDescriptor(
    envelope: EncryptionEnvelope,
    descriptor: EncryptionDescriptor,
    context: String,
  ): Boolean =
    runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.DECRYPT_MODE,
          encryptionKey(descriptor),
          GCMParameterSpec(128, envelope.iv),
        )
        cipher.updateAAD(aad(envelope.version, descriptor.keyId, context))
        cipher.doFinal(envelope.ciphertext)
      }
      .isSuccess

  fun getEncryptionKeyMaterial(): String {
    securePrefs.getString(KEY_MATERIAL_KEY)?.let {
      return it
    }
    val generated = generateLocalKeyMaterial()
    securePrefs.putString(KEY_MATERIAL_KEY, generated)
    return generated
  }

  fun getStoredEncryptionKeyMaterial(): String? = securePrefs.getString(KEY_MATERIAL_KEY)

  fun hasStoredEncryptionKeyMaterial(): Boolean =
    securePrefs.getString(KEY_MATERIAL_KEY)?.let(::isSyncKeyMaterial) == true

  fun isUnsupportedEncryptionKeyMaterial(material: String): Boolean =
    parseKeyringMaterial(material) == null &&
      ((material.startsWith("password:") && !isCurrentPasswordKeyMaterial(material)) ||
        material.startsWith("account:") ||
        material == "author:local:v1")

  fun assertSupportedEncryptionKeyMaterial() {
    val material = securePrefs.getString(KEY_MATERIAL_KEY) ?: return
    if (isUnsupportedEncryptionKeyMaterial(material)) {
      throw IllegalStateException(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE)
    }
  }

  fun assertSupportedEncryptedText(value: String) {
    if (isUnsupportedEncryptedText(value)) {
      throw IllegalStateException(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE)
    }
  }

  fun clearStoredEncryptionKeyMaterial() {
    securePrefs.remove(KEY_MATERIAL_KEY)
  }

  fun prepareEncryptionPassword(
    username: String,
    password: String,
    e2eeKeyring: String? = null,
  ): Pair<String, String> {
    val previous = getEncryptionKeyMaterial()
    val passwordMaterial = keyMaterialFromPassword(username, password)
    if (!e2eeKeyring.isNullOrBlank()) {
      return previous to unwrapKeyringMaterial(e2eeKeyring, passwordMaterial)
    }
    val existing = parseKeyringMaterial(previous)
    if (existing?.optString("scope") == "account") return previous to previous
    return previous to
      encodeKeyringMaterial(
        createKeyringMaterial("account", username.trim().lowercase(), listOf(passwordMaterial))
      )
  }

  fun prepareNewAccountKeyring(username: String, password: String): PreparedAccountKeyring {
    val keyMaterial =
      encodeKeyringMaterial(createKeyringMaterial("account", username.trim().lowercase()))
    val passwordMaterial = keyMaterialFromPassword(username, password)
    val recoveryCode = generateRecoveryCode()
    return PreparedAccountKeyring(
      keyMaterial = keyMaterial,
      e2eeKeyring = wrapKeyringMaterial(keyMaterial, passwordMaterial, recoveryCode),
      recoveryCode = recoveryCode,
      recoveryKitJson = recoveryKitText(createRecoveryKit(keyMaterial, recoveryCode)),
    )
  }

  fun keyringMaterialFromWrapped(e2eeKeyring: String, username: String, password: String): String =
    unwrapKeyringMaterial(e2eeKeyring, keyMaterialFromPassword(username, password))

  fun migratePasswordMaterialToAccountKeyring(
    username: String,
    passwordMaterial: String,
  ): PreparedAccountKeyring {
    val keyMaterial =
      encodeKeyringMaterial(
        createKeyringMaterial("account", username.trim().lowercase(), listOf(passwordMaterial))
      )
    val recoveryCode = generateRecoveryCode()
    return PreparedAccountKeyring(
      keyMaterial = keyMaterial,
      e2eeKeyring = wrapKeyringMaterial(keyMaterial, passwordMaterial, recoveryCode),
      recoveryCode = recoveryCode,
      recoveryKitJson = recoveryKitText(createRecoveryKit(keyMaterial, recoveryCode)),
    )
  }

  fun restoreKeyringFromRecoveryKit(recoveryKitJson: String, recoveryCode: String): String {
    val kit =
      runCatching { JSONObject(recoveryKitJson) }
        .getOrElse { throw IllegalStateException("Invalid recovery kit") }
    if (
      kit.optString("type") != "author-recovery-kit" ||
        kit.optInt("version") != 1 ||
        !validWrappedKeyringBox(kit.optJSONObject("recoveryWrap"), "recovery")
    ) {
      throw IllegalStateException("Invalid recovery kit")
    }
    return unwrapKeyringBox(kit.getJSONObject("recoveryWrap"), recoveryWrappingSecret(recoveryCode))
  }

  fun rewrapKeyringForPassword(
    keyMaterial: String,
    username: String,
    password: String,
    existingE2eeKeyring: String? = null,
  ): String {
    val recoveryWrap =
      existingE2eeKeyring?.let(::parseWrappedKeyring)?.optJSONObject("recoveryWrap")
    return wrapKeyringMaterial(
      keyMaterial,
      keyMaterialFromPassword(username, password),
      existingRecoveryWrap = recoveryWrap,
    )
  }

  fun commitEncryptionKeyMaterial(keyMaterial: String) {
    securePrefs.putString(KEY_MATERIAL_KEY, keyMaterial)
  }

  fun keyMaterialFromPassword(username: String, password: String): String {
    val normalized = username.trim().lowercase()
    val argon2 = argon2PasswordMaterial(normalized, password)
    return listOf(
        "password",
        CURRENT_PASSWORD_MATERIAL_VERSION,
        "argon2id",
        "m=$PASSWORD_ARGON2_MEMORY_KIB,t=$PASSWORD_ARGON2_ITERATIONS,p=$PASSWORD_ARGON2_PARALLELISM",
        base64UrlEncode(argon2),
      )
      .joinToString(":")
  }

  fun randomAuthNonce(bytes: Int = 32): String {
    val output = ByteArray(bytes)
    random.nextBytes(output)
    return base64UrlEncode(output)
  }

  fun passwordVerifierFromPassword(
    password: String,
    salt: String = randomAuthNonce(16),
    params: AuthKdfParams = AuthKdfParams(),
  ): PasswordVerifier {
    require(authParamsAreCurrent(params)) { "Unsupported password proof parameters" }
    val saltedPassword = argon2AuthMaterial(password, base64UrlDecode(salt), params)
    val clientKey = hmacSha256(saltedPassword, AUTH_CLIENT_KEY_LABEL.toByteArray(UTF_8))
    val storedKey = sha256(clientKey)
    val serverKey = hmacSha256(saltedPassword, AUTH_SERVER_KEY_LABEL.toByteArray(UTF_8))
    return PasswordVerifier(
      algorithm = AUTH_PROOF_ALGORITHM,
      salt = salt,
      params = params,
      storedKey = base64UrlEncode(storedKey),
      serverKey = base64UrlEncode(serverKey),
    )
  }

  fun authProofFromPassword(password: String, challenge: AuthChallenge): AuthProofResult {
    require(challenge.mode == "proof") { "Password proof challenge is not available" }
    require(authParamsAreCurrent(challenge.params)) { "Unsupported password proof parameters" }
    val saltedPassword =
      argon2AuthMaterial(password, base64UrlDecode(challenge.salt), challenge.params)
    val clientKey = hmacSha256(saltedPassword, AUTH_CLIENT_KEY_LABEL.toByteArray(UTF_8))
    val storedKey = sha256(clientKey)
    val message = authProofMessage(challenge).toByteArray(UTF_8)
    val clientSignature = hmacSha256(storedKey, message)
    val proof = xorBytes(clientKey, clientSignature)
    val serverKey = hmacSha256(saltedPassword, AUTH_SERVER_KEY_LABEL.toByteArray(UTF_8))
    return AuthProofResult(
      proof = AuthProof(challenge.challengeId, challenge.clientNonce, base64UrlEncode(proof)),
      expectedServerProof = base64UrlEncode(hmacSha256(serverKey, message)),
    )
  }

  fun verifyAuthServerProof(expectedServerProof: String, serverProof: String?): Boolean {
    if (serverProof.isNullOrBlank()) return false
    return runCatching {
        constantTimeEqual(base64UrlDecode(expectedServerProof), base64UrlDecode(serverProof))
      }
      .getOrDefault(false)
  }

  private fun argon2PasswordMaterial(normalizedUsername: String, password: String): ByteArray {
    val parameters =
      Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withVersion(Argon2Parameters.ARGON2_VERSION_13)
        .withSalt("$PASSWORD_ARGON2_SALT_PREFIX:$normalizedUsername".toByteArray(UTF_8))
        .withMemoryAsKB(PASSWORD_ARGON2_MEMORY_KIB)
        .withIterations(PASSWORD_ARGON2_ITERATIONS)
        .withParallelism(PASSWORD_ARGON2_PARALLELISM)
        .build()
    val generator = Argon2BytesGenerator()
    val output = ByteArray(32)
    generator.init(parameters)
    generator.generateBytes(password.toByteArray(UTF_8), output)
    return output
  }

  private fun argon2AuthMaterial(
    password: String,
    salt: ByteArray,
    params: AuthKdfParams,
  ): ByteArray {
    require(salt.size >= 16) { "Invalid password proof salt" }
    val parameters =
      Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withVersion(Argon2Parameters.ARGON2_VERSION_13)
        .withSalt(salt)
        .withMemoryAsKB(params.memoryKiB)
        .withIterations(params.iterations)
        .withParallelism(params.parallelism)
        .build()
    val generator = Argon2BytesGenerator()
    val output = ByteArray(params.keyLength)
    generator.init(parameters)
    generator.generateBytes(password.toByteArray(UTF_8), output)
    return output
  }

  private fun generateLocalKeyMaterial(): String {
    return encodeKeyringMaterial(createKeyringMaterial("local"))
  }

  private fun isSyncKeyMaterial(material: String): Boolean =
    parseKeyringMaterial(material)?.optString("scope") == "account" ||
      isCurrentPasswordKeyMaterial(material)

  private fun isCurrentPasswordKeyMaterial(material: String): Boolean {
    val parts = material.split(":")
    return (parts.getOrNull(0) == "password" &&
      parts.getOrNull(1) == CURRENT_PASSWORD_MATERIAL_VERSION &&
      parts.getOrNull(2) == "argon2id" &&
      !parts.getOrNull(3).isNullOrBlank() &&
      !parts.getOrNull(4).isNullOrBlank() &&
      parts.size == 5)
  }

  private data class EncryptionEnvelope(
    val version: String,
    val keyId: String?,
    val iv: ByteArray,
    val ciphertext: ByteArray,
  )

  private data class EncryptionDescriptor(
    val version: String,
    val keyId: String,
    val rawKey: ByteArray? = null,
    val directMaterial: String? = null,
  )

  private fun encryptedEnvelope(value: String): EncryptionEnvelope? {
    val parts = value.split(":")
    if (parts.getOrNull(0) != "enc") return null
    if (
      parts.size == 5 &&
        parts[1] == CURRENT_ENCRYPTION_VERSION &&
        parts[2].isNotBlank() &&
        parts[3].isNotBlank() &&
        parts[4].isNotBlank()
    ) {
      val iv = runCatching { base64UrlDecode(parts[3]) }.getOrNull() ?: return null
      val ciphertext = runCatching { base64UrlDecode(parts[4]) }.getOrNull() ?: return null
      if (iv.size != 12 || ciphertext.size < 16) return null
      return EncryptionEnvelope(parts[1], parts[2], iv, ciphertext)
    }
    if (
      parts.size == 4 &&
        parts[1] == LEGACY_ENCRYPTION_VERSION &&
        parts[2].isNotBlank() &&
        parts[3].isNotBlank()
    ) {
      val iv = runCatching { base64UrlDecode(parts[2]) }.getOrNull() ?: return null
      val ciphertext = runCatching { base64UrlDecode(parts[3]) }.getOrNull() ?: return null
      if (iv.size != 12 || ciphertext.size < 16) return null
      return EncryptionEnvelope(parts[1], null, iv, ciphertext)
    }
    return null
  }

  fun encryptText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): String {
    if (canDecryptEncryptedTextWithPrimaryMaterial(value, keyMaterial, context)) return value
    val descriptor = activeEncryptionDescriptor(keyMaterial)
    val iv = ByteArray(12)
    random.nextBytes(iv)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey(descriptor), GCMParameterSpec(128, iv))
    cipher.updateAAD(aad(CURRENT_ENCRYPTION_VERSION, descriptor.keyId, context))
    val encrypted = cipher.doFinal(value.toByteArray(UTF_8))
    return "$ENCRYPTION_PREFIX${descriptor.keyId}:${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}"
  }

  fun decryptText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): String {
    val envelope = encryptedEnvelope(value) ?: return value

    for (descriptor in decryptionDescriptors(keyMaterial, envelope)) {
      val decrypted =
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
              Cipher.DECRYPT_MODE,
              encryptionKey(descriptor),
              GCMParameterSpec(128, envelope.iv),
            )
            cipher.updateAAD(aad(envelope.version, descriptor.keyId, context))
            String(cipher.doFinal(envelope.ciphertext), UTF_8)
          }
          .getOrNull()
      if (decrypted != null) return decrypted
    }
    throw IllegalStateException(ENCRYPTION_DECRYPT_FAILED_MESSAGE)
  }

  fun encryptNoteFields(
    note: LocalNote,
    keyMaterial: String = getEncryptionKeyMaterial(),
  ): LocalNote {
    val titleContext = "note:${note.id}:title"
    val bodyContext = "note:${note.id}:body"
    val titleAlreadyEncrypted =
      canDecryptEncryptedTextWithPrimaryMaterial(note.title, keyMaterial, titleContext)
    val bodyAlreadyEncrypted =
      canDecryptEncryptedTextWithPrimaryMaterial(note.body, keyMaterial, bodyContext)
    val plainTitle =
      if (titleAlreadyEncrypted) null else decryptText(note.title, keyMaterial, titleContext)
    val plainBody =
      if (bodyAlreadyEncrypted) null else decryptText(note.body, keyMaterial, bodyContext)
    val titleHash =
      if (titleAlreadyEncrypted && isCurrentFieldHash(note.titleHash)) note.titleHash
      else fieldHash(plainTitle ?: note.title, keyMaterial, titleContext)
    val bodyHash =
      if (bodyAlreadyEncrypted && isCurrentFieldHash(note.bodyHash)) note.bodyHash
      else fieldHash(plainBody ?: note.body, keyMaterial, bodyContext)
    return note.copy(
      titleHash = titleHash,
      bodyHash = bodyHash,
      title =
        if (titleAlreadyEncrypted) note.title
        else encryptText(plainTitle ?: note.title, keyMaterial, titleContext),
      body =
        if (bodyAlreadyEncrypted) note.body
        else encryptText(plainBody ?: note.body, keyMaterial, bodyContext),
    )
  }

  fun decryptNoteFields(
    note: LocalNote,
    keyMaterial: String = getEncryptionKeyMaterial(),
  ): LocalNote =
    note.copy(
      title = decryptText(note.title, keyMaterial, "note:${note.id}:title"),
      body = decryptText(note.body, keyMaterial, "note:${note.id}:body"),
    )

  fun reencryptNoteFields(
    note: LocalNote,
    previousMaterial: String,
    nextMaterial: String,
  ): LocalNote = encryptNoteFields(decryptNoteFields(note, previousMaterial), nextMaterial)

  fun encryptNotebookFields(
    notebook: LocalNotebook,
    keyMaterial: String = getEncryptionKeyMaterial(),
  ): LocalNotebook {
    val nameContext = notebookNameContext(notebook)
    val nameAlreadyEncrypted =
      canDecryptEncryptedTextWithPrimaryMaterial(notebook.name, keyMaterial, nameContext)
    val plainName = if (nameAlreadyEncrypted) null else decryptNotebookName(notebook, keyMaterial)
    val nameHash =
      if (nameAlreadyEncrypted && isCurrentFieldHash(notebook.nameHash)) notebook.nameHash
      else
        fieldHash(
          normalizedNotebookName(plainName ?: notebook.name),
          keyMaterial,
          NOTEBOOK_NAME_HASH_CONTEXT,
        )
    return notebook.copy(
      nameHash = nameHash,
      name =
        if (nameAlreadyEncrypted) notebook.name
        else encryptText(plainName ?: notebook.name, keyMaterial, nameContext),
    )
  }

  private fun decryptNotebookName(notebook: LocalNotebook, keyMaterial: String): String {
    val currentContext = notebookNameContext(notebook)
    return decryptText(notebook.name, keyMaterial, currentContext)
  }

  fun decryptNotebookFields(
    notebook: LocalNotebook,
    keyMaterial: String = getEncryptionKeyMaterial(),
  ): LocalNotebook = notebook.copy(name = decryptNotebookName(notebook, keyMaterial))

  fun reencryptNotebookFields(
    notebook: LocalNotebook,
    previousMaterial: String,
    nextMaterial: String,
  ): LocalNotebook =
    encryptNotebookFields(decryptNotebookFields(notebook, previousMaterial), nextMaterial)

  private fun encryptionKey(descriptor: EncryptionDescriptor): SecretKeySpec {
    descriptor.rawKey?.let {
      require(it.size == 32) { ENCRYPTION_UPGRADE_REQUIRED_MESSAGE }
      return SecretKeySpec(it, "AES")
    }
    val material = descriptor.directMaterial ?: ""
    val domain =
      if (descriptor.version == LEGACY_ENCRYPTION_VERSION) {
        "author:encryption:v3:$material"
      } else {
        "author:encryption:${descriptor.version}:${descriptor.keyId}:$material"
      }
    return SecretKeySpec(sha256(domain.toByteArray(UTF_8)), "AES")
  }

  private fun activeEncryptionDescriptor(keyMaterial: String): EncryptionDescriptor {
    val keyring = parseKeyringMaterial(keyMaterial)
    if (keyring != null) {
      val activeKeyId = keyring.getString("activeKeyId")
      val keys = keyring.getJSONArray("keys")
      for (index in 0 until keys.length()) {
        val key = keys.getJSONObject(index)
        if (key.optString("id") == activeKeyId && key.optString("status") == "active") {
          val raw = base64UrlDecode(key.getString("material"))
          require(raw.size == 32) { ENCRYPTION_UPGRADE_REQUIRED_MESSAGE }
          return EncryptionDescriptor(CURRENT_ENCRYPTION_VERSION, activeKeyId, rawKey = raw)
        }
      }
      throw IllegalStateException(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE)
    }
    return EncryptionDescriptor(
      CURRENT_ENCRYPTION_VERSION,
      DIRECT_KEY_ID,
      directMaterial = keyMaterial,
    )
  }

  private fun decryptionDescriptors(
    keyMaterial: String,
    envelope: EncryptionEnvelope,
  ): List<EncryptionDescriptor> {
    val keyring = parseKeyringMaterial(keyMaterial)
    if (keyring == null) {
      return listOf(
        EncryptionDescriptor(
          envelope.version,
          envelope.keyId ?: DIRECT_KEY_ID,
          directMaterial = keyMaterial,
        )
      )
    }
    if (envelope.version == CURRENT_ENCRYPTION_VERSION) {
      val keys = keyring.getJSONArray("keys")
      for (index in 0 until keys.length()) {
        val key = keys.getJSONObject(index)
        if (key.optString("id") == envelope.keyId) {
          val raw = runCatching { base64UrlDecode(key.getString("material")) }.getOrNull()
          if (raw?.size != 32) return emptyList()
          return listOf(
            EncryptionDescriptor(CURRENT_ENCRYPTION_VERSION, key.getString("id"), rawKey = raw)
          )
        }
      }
      return emptyList()
    }
    val legacy = keyring.optJSONArray("legacyMaterials") ?: return emptyList()
    return (0 until legacy.length()).mapNotNull { index ->
      legacy
        .optString(index)
        .takeIf { it.isNotBlank() }
        ?.let {
          EncryptionDescriptor(LEGACY_ENCRYPTION_VERSION, DIRECT_KEY_ID, directMaterial = it)
        }
    }
  }

  private fun fieldHash(value: String, keyMaterial: String, context: String): String {
    val descriptor = activeEncryptionDescriptor(keyMaterial)
    val secret = descriptor.rawKey?.let(::base64UrlEncode) ?: (descriptor.directMaterial ?: "")
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(
      SecretKeySpec(
        "author:field-hash-key:v3:${descriptor.keyId}:$secret".toByteArray(UTF_8),
        "HmacSHA256",
      )
    )
    return "$HASH_V3_PREFIX${base64UrlEncode(mac.doFinal("$context\u0000$value".toByteArray(UTF_8)))}"
  }

  private fun aad(version: String, keyId: String, context: String): ByteArray {
    val keySegment = if (version == CURRENT_ENCRYPTION_VERSION) ":$keyId" else ""
    return "author:encrypted-field:$version$keySegment:$context".toByteArray(UTF_8)
  }

  private fun createKeyringMaterial(
    scope: String,
    accountUsername: String? = null,
    legacyMaterials: List<String> = emptyList(),
  ): JSONObject {
    val now = isoNow()
    val key = randomDataKey()
    return JSONObject()
      .put("version", 1)
      .put("scope", scope)
      .apply { if (!accountUsername.isNullOrBlank()) put("accountUsername", accountUsername) }
      .put("activeKeyId", key.getString("id"))
      .put("keys", JSONArray().put(key))
      .apply {
        if (legacyMaterials.isNotEmpty()) {
          put("legacyMaterials", JSONArray(legacyMaterials))
        }
      }
      .put("createdAt", now)
      .put("updatedAt", now)
  }

  private fun randomDataKey(): JSONObject {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    return JSONObject()
      .put("id", "dk_${randomBase64(12)}")
      .put("material", base64UrlEncode(bytes))
      .put("createdAt", isoNow())
      .put("status", "active")
  }

  private fun encodeKeyringMaterial(keyring: JSONObject): String =
    "$KEYRING_MATERIAL_PREFIX${base64UrlEncode(keyring.toString().toByteArray(UTF_8))}"

  private fun parseKeyringMaterial(material: String): JSONObject? {
    if (!material.startsWith(KEYRING_MATERIAL_PREFIX)) return null
    return runCatching {
        val json =
          JSONObject(String(base64UrlDecode(material.removePrefix(KEYRING_MATERIAL_PREFIX)), UTF_8))
        if (validKeyring(json)) json else null
      }
      .getOrNull()
  }

  private fun requireKeyringMaterial(material: String): JSONObject =
    parseKeyringMaterial(material)
      ?: throw IllegalStateException("Recovery kit requires keyring material")

  private fun createRecoveryKit(keyMaterial: String, recoveryCode: String): JSONObject {
    val keyring = requireKeyringMaterial(keyMaterial)
    return JSONObject()
      .put("type", "author-recovery-kit")
      .put("version", 1)
      .put("createdAt", isoNow())
      .put(
        "recoveryWrap",
        wrapKeyringBox(keyMaterial, recoveryWrappingSecret(recoveryCode), "recovery"),
      )
      .put("keyHint", keyring.getString("activeKeyId"))
  }

  private fun recoveryKitText(kit: JSONObject): String = "${kit.toString(2)}\n"

  private fun validKeyring(json: JSONObject): Boolean =
    runCatching {
        val scope = json.getString("scope")
        val activeKeyId = json.getString("activeKeyId")
        val keys = json.getJSONArray("keys")
        json.getInt("version") == 1 &&
          (scope == "local" || scope == "account") &&
          activeKeyId.isNotBlank() &&
          (0 until keys.length()).any { index ->
            val key = keys.getJSONObject(index)
            key.optString("id") == activeKeyId &&
              key.optString("status") == "active" &&
              base64UrlDecode(key.getString("material")).size == 32
          }
      }
      .getOrDefault(false)

  private fun wrapKeyringMaterial(
    keyMaterial: String,
    passwordMaterial: String,
    recoveryCode: String? = null,
    existingRecoveryWrap: JSONObject? = null,
  ): String {
    val keyring = requireKeyringMaterial(keyMaterial)
    val recoveryWrap =
      recoveryCode?.let { wrapKeyringBox(keyMaterial, recoveryWrappingSecret(it), "recovery") }
        ?: existingRecoveryWrap
    return JSONObject()
      .put("version", 1)
      .put("activeKeyId", keyring.getString("activeKeyId"))
      .put("wrappedAt", isoNow())
      .put("passwordWrap", wrapKeyringBox(keyMaterial, passwordMaterial, "password"))
      .apply { if (recoveryWrap != null) put("recoveryWrap", recoveryWrap) }
      .toString()
  }

  private fun unwrapKeyringMaterial(e2eeKeyring: String, passwordMaterial: String): String {
    val parsed =
      parseWrappedKeyring(e2eeKeyring) ?: throw IllegalStateException("Invalid encrypted keyring")
    return unwrapKeyringBox(parsed.getJSONObject("passwordWrap"), passwordMaterial)
  }

  private fun parseWrappedKeyring(value: String): JSONObject? =
    runCatching {
        val json = JSONObject(value)
        val recoveryWrap = json.optJSONObject("recoveryWrap")
        if (
          json.optInt("version") != 1 ||
            json.optString("activeKeyId").isBlank() ||
            !validWrappedKeyringBox(json.optJSONObject("passwordWrap"), "password") ||
            (recoveryWrap != null && !validWrappedKeyringBox(recoveryWrap, "recovery"))
        ) {
          null
        } else {
          json
        }
      }
      .getOrNull()

  private fun wrapKeyringBox(
    keyMaterial: String,
    wrappingSecret: String,
    context: String,
  ): JSONObject {
    requireKeyringMaterial(keyMaterial)
    val iv = ByteArray(12)
    random.nextBytes(iv)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.ENCRYPT_MODE,
      keyringWrappingKey(wrappingSecret, context),
      GCMParameterSpec(128, iv),
    )
    cipher.updateAAD(keyringWrapAad(context))
    val encrypted = cipher.doFinal(keyMaterial.toByteArray(UTF_8))
    return JSONObject()
      .put("alg", "AES-256-GCM")
      .put("kdf", "sha256")
      .put("context", context)
      .put("iv", base64UrlEncode(iv))
      .put("ciphertext", base64UrlEncode(encrypted))
  }

  private fun unwrapKeyringBox(box: JSONObject, wrappingSecret: String): String {
    if (!validWrappedKeyringBox(box)) throw IllegalStateException("Invalid encrypted keyring")
    return runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.DECRYPT_MODE,
          keyringWrappingKey(wrappingSecret, box.getString("context")),
          GCMParameterSpec(128, base64UrlDecode(box.getString("iv"))),
        )
        cipher.updateAAD(keyringWrapAad(box.getString("context")))
        val keyMaterial =
          String(cipher.doFinal(base64UrlDecode(box.getString("ciphertext"))), UTF_8)
        requireKeyringMaterial(keyMaterial)
        keyMaterial
      }
      .getOrElse { throw IllegalStateException(ENCRYPTION_DECRYPT_FAILED_MESSAGE) }
  }

  private fun validWrappedKeyringBox(box: JSONObject?, context: String? = null): Boolean =
    box != null &&
      box.optString("alg") == "AES-256-GCM" &&
      box.optString("kdf") == "sha256" &&
      (box.optString("context") == "password" || box.optString("context") == "recovery") &&
      (context == null || box.optString("context") == context) &&
      box.optString("iv").isNotBlank() &&
      box.optString("ciphertext").isNotBlank()

  private fun keyringWrappingKey(secret: String, context: String): SecretKeySpec =
    SecretKeySpec(sha256("author:e2ee-keyring-wrap:v1:$context:$secret".toByteArray(UTF_8)), "AES")

  private fun keyringWrapAad(context: String): ByteArray =
    "author:e2ee-keyring:v1:$context".toByteArray(UTF_8)

  private fun recoveryWrappingSecret(recoveryCode: String): String {
    val trimmed = recoveryCode.trim()
    require(trimmed.startsWith(RECOVERY_CODE_PREFIX)) { "Invalid recovery code" }
    return trimmed
  }

  private fun generateRecoveryCode(): String = "$RECOVERY_CODE_PREFIX${randomBase64(32)}"

  private fun randomBase64(length: Int): String {
    val bytes = ByteArray(length)
    random.nextBytes(bytes)
    return base64UrlEncode(bytes)
  }

  private fun isoNow(): String = java.time.Instant.now().toString()

  private fun sha256(bytes: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(bytes)

  private fun hmacSha256(key: ByteArray, message: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(message)
  }

  private fun authParamsAreCurrent(params: AuthKdfParams): Boolean =
    params.algorithm == "argon2id" &&
      params.memoryKiB == PASSWORD_ARGON2_MEMORY_KIB &&
      params.iterations == PASSWORD_ARGON2_ITERATIONS &&
      params.parallelism == PASSWORD_ARGON2_PARALLELISM &&
      params.keyLength == 32

  private fun authProofMessage(challenge: AuthChallenge): String =
    listOf(
        AUTH_MESSAGE_VERSION,
        "username=${challenge.username}",
        "purpose=${challenge.purpose}",
        "challenge=${challenge.challengeId}",
        "clientNonce=${challenge.clientNonce}",
        "serverNonce=${challenge.serverNonce}",
        "salt=${challenge.salt}",
        "params=${authKdfParamsString(challenge.params)}",
      )
      .joinToString("\n")

  private fun authKdfParamsString(params: AuthKdfParams): String =
    "m=${params.memoryKiB},t=${params.iterations},p=${params.parallelism}"

  private fun xorBytes(left: ByteArray, right: ByteArray): ByteArray {
    require(left.size == right.size) { "Cannot XOR byte arrays with different lengths" }
    return ByteArray(left.size) { index -> (left[index].toInt() xor right[index].toInt()).toByte() }
  }

  private fun constantTimeEqual(left: ByteArray, right: ByteArray): Boolean {
    if (left.size != right.size) return false
    var difference = 0
    for (index in left.indices) {
      difference = difference or (left[index].toInt() xor right[index].toInt())
    }
    return difference == 0
  }
}

fun base64UrlEncode(bytes: ByteArray): String =
  Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

fun base64UrlDecode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
