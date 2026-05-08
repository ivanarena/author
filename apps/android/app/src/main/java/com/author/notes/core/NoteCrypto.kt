package com.author.notes.core

import android.content.SharedPreferences
import android.util.Base64
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

private const val ENCRYPTION_PREFIX = "enc:v1:"
private const val KEY_MATERIAL_KEY = "author-notes-encryption-key-material-v1"
private const val USERNAME_KEY = "author-notes-username"
private const val LOCAL_KEY_PREFIX = "local:v2:"
private const val FALLBACK_KEY_MATERIAL = "author-notes:local:v1"
private const val PASSWORD_KDF_ITERATIONS = 210_000
private const val PASSWORD_KDF_SALT_PREFIX = "author-notes:password-key:v2"

class NoteCrypto(
  private val prefs: SharedPreferences,
  private val securePrefs: SecurePreferenceStore
) {
  private val random = SecureRandom()

  fun isEncryptedText(value: String): Boolean = value.startsWith(ENCRYPTION_PREFIX)

  fun getEncryptionKeyMaterial(): String {
    securePrefs.getString(KEY_MATERIAL_KEY)?.let { return it }
    val generated = generateLocalKeyMaterial()
    securePrefs.putString(KEY_MATERIAL_KEY, generated)
    return generated
  }

  fun hasStoredEncryptionKeyMaterial(): Boolean = securePrefs.contains(KEY_MATERIAL_KEY)

  fun clearStoredEncryptionKeyMaterial() {
    securePrefs.remove(KEY_MATERIAL_KEY)
  }

  fun rememberEncryptionPassword(username: String, password: String): Pair<String, String> {
    val previous = getEncryptionKeyMaterial()
    val next = keyMaterialFromPassword(username, password)
    securePrefs.putString(KEY_MATERIAL_KEY, next)
    return previous to next
  }

  fun keyMaterialFromPassword(username: String, password: String): String {
    val normalized = username.trim().lowercase()
    val legacyDigest = sha256("$normalized\u0000$password".toByteArray(UTF_8))
    val passwordKey = PBEKeySpec(
      password.toCharArray(),
      "$PASSWORD_KDF_SALT_PREFIX:$normalized".toByteArray(UTF_8),
      PASSWORD_KDF_ITERATIONS,
      256
    )
    val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
      .generateSecret(passwordKey)
      .encoded
    return "password:v2:$PASSWORD_KDF_ITERATIONS:${base64UrlEncode(derived)}:legacy:${base64UrlEncode(legacyDigest)}"
  }

  private fun generateLocalKeyMaterial(): String {
    val key = ByteArray(32)
    random.nextBytes(key)
    return "$LOCAL_KEY_PREFIX${base64UrlEncode(key)}"
  }

  fun encryptText(value: String, keyMaterial: String = getEncryptionKeyMaterial()): String {
    if (isEncryptedText(value)) return value
    val iv = ByteArray(12)
    random.nextBytes(iv)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey(keyMaterial), GCMParameterSpec(128, iv))
    val encrypted = cipher.doFinal(value.toByteArray(UTF_8))
    return "$ENCRYPTION_PREFIX${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}"
  }

  fun decryptText(value: String, keyMaterial: String = getEncryptionKeyMaterial()): String {
    if (!isEncryptedText(value)) return value
    val parts = value.split(":")
    if (parts.size != 4 || parts[0] != "enc" || parts[1] != "v1") return value
    val iv = runCatching { base64UrlDecode(parts[2]) }.getOrNull() ?: return value
    val encrypted = runCatching { base64UrlDecode(parts[3]) }.getOrNull() ?: return value

    for (material in decryptionKeyMaterials(keyMaterial)) {
      val decrypted = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(material), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), UTF_8)
      }.getOrNull()
      if (decrypted != null) return decrypted
    }
    return value
  }

  fun encryptNoteFields(note: LocalNote, keyMaterial: String = getEncryptionKeyMaterial()): LocalNote {
    val titleHash = if (isEncryptedText(note.title)) note.titleHash else fieldHash(note.title, keyMaterial, "note:${note.id}:title")
    val bodyHash = if (isEncryptedText(note.body)) note.bodyHash else fieldHash(note.body, keyMaterial, "note:${note.id}:body")
    return note.copy(
      titleHash = titleHash,
      bodyHash = bodyHash,
      title = encryptText(note.title, keyMaterial),
      body = encryptText(note.body, keyMaterial)
    )
  }

  fun decryptNoteFields(note: LocalNote, keyMaterial: String = getEncryptionKeyMaterial()): LocalNote = note.copy(
    title = decryptText(note.title, keyMaterial),
    body = decryptText(note.body, keyMaterial)
  )

  fun reencryptNoteFields(note: LocalNote, previousMaterial: String, nextMaterial: String): LocalNote = encryptNoteFields(decryptNoteFields(note, previousMaterial), nextMaterial)

  private fun encryptionKey(keyMaterial: String): SecretKeySpec = SecretKeySpec(sha256("author-notes:$keyMaterial".toByteArray(UTF_8)), "AES")

  private fun decryptionKeyMaterials(primary: String): List<String> {
    val candidates = mutableListOf(primary)
    legacyKeyMaterial(primary)?.let { candidates.add(it) }
    prefs.getString(USERNAME_KEY, null)?.trim()?.takeIf { it.isNotEmpty() }?.let {
      candidates.add("account:${it.lowercase()}:v1")
    }
    candidates.add(FALLBACK_KEY_MATERIAL)
    return candidates.distinct()
  }

  private fun legacyKeyMaterial(material: String): String? {
    if (!material.startsWith("password:v2:")) return null
    val legacy = material.substringAfter(":legacy:", "")
    return legacy.takeIf { it.isNotEmpty() }?.let { "password:$it" }
  }

  private fun fieldHash(value: String, keyMaterial: String, context: String): String = "hash:v1:${base64UrlEncode(sha256("author-notes-field-hash:$keyMaterial:$context\u0000$value".toByteArray(UTF_8)))}"

  private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
}

fun base64UrlEncode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

fun base64UrlDecode(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP)
