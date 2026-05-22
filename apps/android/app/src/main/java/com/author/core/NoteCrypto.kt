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

private const val ENCRYPTION_PREFIX = "enc:v3:"
private const val HASH_V2_PREFIX = "hash:v2:"
private const val KEY_MATERIAL_KEY = "author-encryption-key-material-v1"
private const val LOCAL_KEY_PREFIX = "local:v2:"
private const val PASSWORD_ARGON2_MEMORY_KIB = 19_456
private const val PASSWORD_ARGON2_ITERATIONS = 2
private const val PASSWORD_ARGON2_PARALLELISM = 1
private const val PASSWORD_ARGON2_SALT_PREFIX = "author:password-key:v3"
private const val CURRENT_ENCRYPTION_VERSION = "v3"
private const val CURRENT_PASSWORD_MATERIAL_VERSION = "v4"
private const val NOTEBOOK_NAME_HASH_CONTEXT = "notebook:name"
private const val AUTH_PROOF_ALGORITHM = "argon2id-scram-sha256"
private const val AUTH_MESSAGE_VERSION = "author-auth-proof-v1"
private const val AUTH_CLIENT_KEY_LABEL = "Client Key"
private const val AUTH_SERVER_KEY_LABEL = "Server Key"
const val ENCRYPTION_UPGRADE_REQUIRED_MESSAGE =
  "This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version."

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

  fun isCurrentFieldHash(value: String?): Boolean = value?.startsWith(HASH_V2_PREFIX) == true

  fun notebookNameContext(notebook: LocalNotebook): String = "notebook:${notebook.id}:name"

  fun canDecryptEncryptedText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): Boolean = canDecryptEncryptedTextWithPrimaryMaterial(value, keyMaterial, context)

  fun canDecryptEncryptedTextWithPrimaryMaterial(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): Boolean {
    val envelope = encryptedEnvelope(value) ?: return false
    return canDecryptEnvelopeWithMaterial(envelope, keyMaterial, context)
  }

  private fun canDecryptEnvelopeWithMaterial(
    envelope: EncryptionEnvelope,
    keyMaterial: String,
    context: String,
  ): Boolean =
    runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.DECRYPT_MODE,
          encryptionKey(keyMaterial),
          GCMParameterSpec(128, envelope.iv),
        )
        cipher.updateAAD(aad(context))
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

  fun hasStoredEncryptionKeyMaterial(): Boolean =
    securePrefs.getString(KEY_MATERIAL_KEY)?.let(::isSyncKeyMaterial) == true

  fun isUnsupportedEncryptionKeyMaterial(material: String): Boolean =
    (material.startsWith("password:") && !isCurrentPasswordKeyMaterial(material)) ||
      material.startsWith("account:") ||
      material == "author:local:v1"

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

  fun rememberEncryptionPassword(username: String, password: String): Pair<String, String> {
    val rotation = prepareEncryptionPassword(username, password)
    commitEncryptionKeyMaterial(rotation.second)
    return rotation
  }

  fun prepareEncryptionPassword(username: String, password: String): Pair<String, String> =
    getEncryptionKeyMaterial() to keyMaterialFromPassword(username, password)

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
    val key = ByteArray(32)
    random.nextBytes(key)
    return "$LOCAL_KEY_PREFIX${base64UrlEncode(key)}"
  }

  private fun isSyncKeyMaterial(material: String): Boolean = isCurrentPasswordKeyMaterial(material)

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
    val iv: ByteArray,
    val ciphertext: ByteArray,
  )

  private fun encryptedEnvelope(value: String): EncryptionEnvelope? {
    val parts = value.split(":")
    if (
      parts.size != 4 ||
        parts[0] != "enc" ||
        parts[1] != CURRENT_ENCRYPTION_VERSION ||
        parts[2].isBlank() ||
        parts[3].isBlank()
    ) {
      return null
    }
    val iv = runCatching { base64UrlDecode(parts[2]) }.getOrNull() ?: return null
    val ciphertext = runCatching { base64UrlDecode(parts[3]) }.getOrNull() ?: return null
    if (iv.size != 12 || ciphertext.size < 16) return null
    return EncryptionEnvelope(parts[1], iv, ciphertext)
  }

  fun encryptText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): String {
    if (canDecryptEncryptedText(value, keyMaterial, context)) return value
    val iv = ByteArray(12)
    random.nextBytes(iv)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey(keyMaterial), GCMParameterSpec(128, iv))
    cipher.updateAAD(aad(context))
    val encrypted = cipher.doFinal(value.toByteArray(UTF_8))
    return "$ENCRYPTION_PREFIX${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}"
  }

  fun decryptText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): String {
    val envelope = encryptedEnvelope(value) ?: return value

    for (material in decryptionKeyMaterials(keyMaterial)) {
      val decrypted =
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
              Cipher.DECRYPT_MODE,
              encryptionKey(material),
              GCMParameterSpec(128, envelope.iv),
            )
            cipher.updateAAD(aad(context))
            String(cipher.doFinal(envelope.ciphertext), UTF_8)
          }
          .getOrNull()
      if (decrypted != null) return decrypted
    }
    return value
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
      if (titleAlreadyEncrypted) note.titleHash
      else fieldHash(plainTitle ?: note.title, keyMaterial, titleContext)
    val bodyHash =
      if (bodyAlreadyEncrypted) note.bodyHash
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
      if (nameAlreadyEncrypted) notebook.nameHash
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
    if (canDecryptEncryptedText(notebook.name, keyMaterial, currentContext)) {
      return decryptText(notebook.name, keyMaterial, currentContext)
    }
    return notebook.name
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

  private fun encryptionKey(keyMaterial: String): SecretKeySpec {
    val primaryMaterial = primaryEncryptionKeyMaterial(keyMaterial)
    val domain = "author:encryption:v3:$primaryMaterial"
    return SecretKeySpec(sha256(domain.toByteArray(UTF_8)), "AES")
  }

  private fun primaryEncryptionKeyMaterial(material: String): String {
    if (!material.startsWith("password:v4:")) return material

    val parts = material.split(":")
    if (
      parts.getOrNull(0) == "password" &&
        parts.getOrNull(1) == CURRENT_PASSWORD_MATERIAL_VERSION &&
        parts.getOrNull(2) == "argon2id" &&
        !parts.getOrNull(3).isNullOrBlank() &&
        !parts.getOrNull(4).isNullOrBlank() &&
        parts.size == 5
    ) {
      return material
    }

    return material
  }

  private fun decryptionKeyMaterials(primary: String): List<String> = listOf(primary)

  private fun fieldHash(value: String, keyMaterial: String, context: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(
      SecretKeySpec("author:field-hash-key:v2:$keyMaterial".toByteArray(UTF_8), "HmacSHA256")
    )
    return "$HASH_V2_PREFIX${base64UrlEncode(mac.doFinal("$context\u0000$value".toByteArray(UTF_8)))}"
  }

  private fun aad(context: String): ByteArray =
    "author:encrypted-field:$CURRENT_ENCRYPTION_VERSION:$context".toByteArray(UTF_8)

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
