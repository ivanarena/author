package com.author.notes.core

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val ANDROID_KEYSTORE = "AndroidKeyStore"
private const val SECURE_PREF_ALIAS = "author_secure_preferences_v1"
private const val SECURE_PREFIX = "secure:v1:"

class SecurePreferenceStore(private val prefs: SharedPreferences) {
  fun getString(key: String): String? {
    val stored = prefs.getString(key, null) ?: return null
    if (!stored.startsWith(SECURE_PREFIX)) {
      putString(key, stored)
      return stored
    }
    return decrypt(stored).getOrNull()
  }

  fun putString(key: String, value: String) {
    prefs.edit { putString(key, encrypt(value)) }
  }

  fun remove(key: String) {
    prefs.edit { remove(key) }
  }

  fun contains(key: String): Boolean = prefs.contains(key)

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = cipher.iv
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    return "$SECURE_PREFIX${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}"
  }

  private fun decrypt(value: String): Result<String> = runCatching {
    val payload = value.removePrefix(SECURE_PREFIX)
    val parts = payload.split(":")
    require(parts.size == 2) { "Invalid secure preference payload" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, base64UrlDecode(parts[0])))
    String(cipher.doFinal(base64UrlDecode(parts[1])), Charsets.UTF_8)
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getEntry(SECURE_PREF_ALIAS, null) as? KeyStore.SecretKeyEntry)
      ?.secretKey
      ?.let { return it }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      SECURE_PREF_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true)
      .build()
    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }
}
