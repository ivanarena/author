package com.author.core

import android.content.SharedPreferences
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters

private const val ENCRYPTION_PREFIX = "enc:v2:"
private const val HASH_V2_PREFIX = "hash:v2:"
private const val KEY_MATERIAL_KEY = "author-encryption-key-material-v1"
private const val USERNAME_KEY = "author-username"
private const val LOCAL_KEY_PREFIX = "local:v2:"
private const val FALLBACK_KEY_MATERIAL = "author:local:v1"
private const val PASSWORD_PBKDF2_ITERATIONS = 210_000
private const val PASSWORD_PBKDF2_SALT_PREFIX = "author:password-key:v2"
private const val PASSWORD_ARGON2_MEMORY_KIB = 19_456
private const val PASSWORD_ARGON2_ITERATIONS = 2
private const val PASSWORD_ARGON2_PARALLELISM = 1
private const val PASSWORD_ARGON2_SALT_PREFIX = "author:password-key:v3"
private const val LEGACY_NOTEBOOK_NAME_CONTEXT = "notebook:name"

class NoteCrypto(
  private val prefs: SharedPreferences,
  private val securePrefs: SecurePreferenceStore,
) {
  private val random = SecureRandom()

  fun isEncryptedText(value: String): Boolean = encryptedEnvelope(value) != null

  fun isCurrentEncryptedText(value: String): Boolean = encryptedEnvelope(value)?.version == "v2"

  fun isCurrentFieldHash(value: String?): Boolean = value?.startsWith(HASH_V2_PREFIX) == true

  fun notebookNameContext(notebook: LocalNotebook): String = "notebook:${notebook.id}:name"

  fun canDecryptEncryptedText(
    value: String,
    keyMaterial: String = getEncryptionKeyMaterial(),
    context: String = "text",
  ): Boolean {
    if (canDecryptEncryptedTextWithPrimaryMaterial(value, keyMaterial, context)) return true
    val envelope = encryptedEnvelope(value) ?: return false
    return fallbackKeyMaterials(keyMaterial).any { material ->
      canDecryptEnvelopeWithMaterial(envelope, material, context)
    }
  }

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
          encryptionKey(keyMaterial, envelope.version),
          GCMParameterSpec(128, envelope.iv),
        )
        if (envelope.version == "v2") cipher.updateAAD(aad(context))
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
    val legacy = legacyPasswordMaterial(normalized, password)
    val pbkdf2 = pbkdf2PasswordMaterial(normalized, password)
    val argon2 = argon2PasswordMaterial(normalized, password)
    return listOf(
        "password",
        "v3",
        "argon2id",
        "m=$PASSWORD_ARGON2_MEMORY_KIB,t=$PASSWORD_ARGON2_ITERATIONS,p=$PASSWORD_ARGON2_PARALLELISM",
        base64UrlEncode(argon2),
        "pbkdf2",
        "v2",
        PASSWORD_PBKDF2_ITERATIONS.toString(),
        pbkdf2,
        "legacy",
        legacy,
      )
      .joinToString(":")
  }

  private fun legacyPasswordMaterial(normalizedUsername: String, password: String): String =
    base64UrlEncode(sha256("$normalizedUsername\u0000$password".toByteArray(UTF_8)))

  private fun pbkdf2PasswordMaterial(normalizedUsername: String, password: String): String {
    val passwordKey =
      PBEKeySpec(
        password.toCharArray(),
        "$PASSWORD_PBKDF2_SALT_PREFIX:$normalizedUsername".toByteArray(UTF_8),
        PASSWORD_PBKDF2_ITERATIONS,
        256,
      )
    val derived =
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(passwordKey).encoded
    return base64UrlEncode(derived)
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

  private fun generateLocalKeyMaterial(): String {
    val key = ByteArray(32)
    random.nextBytes(key)
    return "$LOCAL_KEY_PREFIX${base64UrlEncode(key)}"
  }

  private fun isSyncKeyMaterial(material: String): Boolean =
    material.startsWith("password:") || material.startsWith("account:")

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
        parts[1] !in setOf("v1", "v2") ||
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
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey(keyMaterial, "v2"), GCMParameterSpec(128, iv))
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
              encryptionKey(material, envelope.version),
              GCMParameterSpec(128, envelope.iv),
            )
            if (envelope.version == "v2") cipher.updateAAD(aad(context))
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
          LEGACY_NOTEBOOK_NAME_CONTEXT,
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
    if (canDecryptEncryptedText(notebook.name, keyMaterial, LEGACY_NOTEBOOK_NAME_CONTEXT)) {
      return decryptText(notebook.name, keyMaterial, LEGACY_NOTEBOOK_NAME_CONTEXT)
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

  private fun encryptionKey(keyMaterial: String, version: String): SecretKeySpec {
    val primaryMaterial = primaryEncryptionKeyMaterial(keyMaterial)
    val domain =
      if (version == "v2") "author:encryption:v2:$primaryMaterial" else "author:$primaryMaterial"
    return SecretKeySpec(sha256(domain.toByteArray(UTF_8)), "AES")
  }

  private fun primaryEncryptionKeyMaterial(material: String): String {
    if (!material.startsWith("password:v3:")) return material

    val parts = material.split(":")
    if (
      parts.getOrNull(0) == "password" &&
        parts.getOrNull(1) == "v3" &&
        parts.getOrNull(2) == "argon2id" &&
        !parts.getOrNull(3).isNullOrBlank() &&
        !parts.getOrNull(4).isNullOrBlank()
    ) {
      return parts.take(5).joinToString(":")
    }

    return material
  }

  private fun decryptionKeyMaterials(primary: String): List<String> {
    val candidates = mutableListOf(primary)
    candidates.addAll(fallbackKeyMaterials(primary))
    prefs
      .getString(USERNAME_KEY, null)
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
      ?.let { candidates.add("account:${it.lowercase()}:v1") }
    candidates.add(FALLBACK_KEY_MATERIAL)
    return candidates.distinct()
  }

  private fun fallbackKeyMaterials(material: String): List<String> {
    if (material.startsWith("password:v2:")) {
      val legacy = material.substringAfter(":legacy:", "")
      return legacy.takeIf { it.isNotEmpty() }?.let { listOf("password:$it") } ?: emptyList()
    }

    if (material.startsWith("password:v3:")) {
      val parts = material.split(":")
      val pbkdf2Index = parts.indexOf("pbkdf2")
      val legacyIndex = parts.indexOf("legacy")
      val fallbacks = mutableListOf<String>()
      if (
        pbkdf2Index >= 0 && legacyIndex > pbkdf2Index && parts.getOrNull(pbkdf2Index + 1) == "v2"
      ) {
        val iterations = parts.getOrNull(pbkdf2Index + 2)
        val pbkdf2 = parts.getOrNull(pbkdf2Index + 3)
        val legacy = parts.getOrNull(legacyIndex + 1)
        if (!iterations.isNullOrBlank() && !pbkdf2.isNullOrBlank() && !legacy.isNullOrBlank()) {
          fallbacks.add("password:v2:$iterations:$pbkdf2:legacy:$legacy")
        }
      }
      if (legacyIndex >= 0) {
        parts
          .getOrNull(legacyIndex + 1)
          ?.takeIf { it.isNotBlank() }
          ?.let { fallbacks.add("password:$it") }
      }
      return fallbacks
    }

    return emptyList()
  }

  private fun fieldHash(value: String, keyMaterial: String, context: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(
      SecretKeySpec("author:field-hash-key:v2:$keyMaterial".toByteArray(UTF_8), "HmacSHA256")
    )
    return "$HASH_V2_PREFIX${base64UrlEncode(mac.doFinal("$context\u0000$value".toByteArray(UTF_8)))}"
  }

  private fun aad(context: String): ByteArray =
    "author:encrypted-field:v2:$context".toByteArray(UTF_8)

  private fun sha256(bytes: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(bytes)
}

fun base64UrlEncode(bytes: ByteArray): String =
  Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

fun base64UrlDecode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
