package com.author.core

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

class SecurePreferenceUnavailableException(key: String, cause: Throwable) :
  IllegalStateException("Secure preference $key could not be decrypted", cause)

interface SecurePreferenceCodec {
  fun encrypt(value: String): String

  fun decrypt(payload: String): String
}

class SecurePreferenceStore(
  private val prefs: SharedPreferences,
  private val codec: SecurePreferenceCodec = AndroidKeystoreSecurePreferenceCodec(),
) {
  fun getString(key: String): String? {
    val stored = prefs.getString(key, null) ?: return null
    if (!stored.startsWith(SECURE_PREFIX)) {
      putString(key, stored)
      return stored
    }
    return try {
      codec.decrypt(stored.removePrefix(SECURE_PREFIX))
    } catch (error: Throwable) {
      throw SecurePreferenceUnavailableException(key, error)
    }
  }

  fun putString(key: String, value: String) {
    prefs.edit { putString(key, "$SECURE_PREFIX${codec.encrypt(value)}") }
  }

  fun remove(key: String) {
    prefs.edit { remove(key) }
  }

  fun contains(key: String): Boolean = prefs.contains(key)
}

private class AndroidKeystoreSecurePreferenceCodec : SecurePreferenceCodec {
  override fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = cipher.iv
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    return "${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}"
  }

  override fun decrypt(payload: String): String {
    val parts = payload.split(":")
    require(parts.size == 2) { "Invalid secure preference payload" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, base64UrlDecode(parts[0])))
    return String(cipher.doFinal(base64UrlDecode(parts[1])), Charsets.UTF_8)
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getEntry(SECURE_PREF_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let {
      return it
    }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec =
      KeyGenParameterSpec.Builder(
          SECURE_PREF_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
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
