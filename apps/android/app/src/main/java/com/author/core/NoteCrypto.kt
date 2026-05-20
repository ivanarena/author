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

private const val ENCRYPTION_PREFIX = "enc:v2:"
private const val HASH_V2_PREFIX = "hash:v2:"
private const val KEY_MATERIAL_KEY = "author-encryption-key-material-v1"
private const val USERNAME_KEY = "author-username"
private const val LOCAL_KEY_PREFIX = "local:v2:"
private const val FALLBACK_KEY_MATERIAL = "author:local:v1"
private const val PASSWORD_KDF_ITERATIONS = 210_000
private const val PASSWORD_KDF_SALT_PREFIX = "author:password-key:v2"
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
    val envelope = encryptedEnvelope(value) ?: return false
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
            cipher.doFinal(envelope.ciphertext)
          }
          .getOrNull()
      if (decrypted != null) return true
    }
    return false
  }

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
    val legacyDigest = sha256("$normalized\u0000$password".toByteArray(UTF_8))
    val passwordKey =
      PBEKeySpec(
        password.toCharArray(),
        "$PASSWORD_KDF_SALT_PREFIX:$normalized".toByteArray(UTF_8),
        PASSWORD_KDF_ITERATIONS,
        256,
      )
    val derived =
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(passwordKey).encoded
    return "password:v2:$PASSWORD_KDF_ITERATIONS:${base64UrlEncode(derived)}:legacy:${base64UrlEncode(legacyDigest)}"
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
    val titleAlreadyEncrypted = canDecryptEncryptedText(note.title, keyMaterial, titleContext)
    val bodyAlreadyEncrypted = canDecryptEncryptedText(note.body, keyMaterial, bodyContext)
    val titleHash =
      if (titleAlreadyEncrypted) note.titleHash
      else fieldHash(note.title, keyMaterial, titleContext)
    val bodyHash =
      if (bodyAlreadyEncrypted) note.bodyHash else fieldHash(note.body, keyMaterial, bodyContext)
    return note.copy(
      titleHash = titleHash,
      bodyHash = bodyHash,
      title =
        if (titleAlreadyEncrypted) note.title
        else encryptText(note.title, keyMaterial, titleContext),
      body =
        if (bodyAlreadyEncrypted) note.body else encryptText(note.body, keyMaterial, bodyContext),
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
    val nameAlreadyEncrypted = canDecryptEncryptedText(notebook.name, keyMaterial, nameContext)
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
    val domain = if (version == "v2") "author:encryption:v2:$keyMaterial" else "author:$keyMaterial"
    return SecretKeySpec(sha256(domain.toByteArray(UTF_8)), "AES")
  }

  private fun decryptionKeyMaterials(primary: String): List<String> {
    val candidates = mutableListOf(primary)
    legacyKeyMaterial(primary)?.let { candidates.add(it) }
    prefs
      .getString(USERNAME_KEY, null)
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
      ?.let { candidates.add("account:${it.lowercase()}:v1") }
    candidates.add(FALLBACK_KEY_MATERIAL)
    return candidates.distinct()
  }

  private fun legacyKeyMaterial(material: String): String? {
    if (!material.startsWith("password:v2:")) return null
    val legacy = material.substringAfter(":legacy:", "")
    return legacy.takeIf { it.isNotEmpty() }?.let { "password:$it" }
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
