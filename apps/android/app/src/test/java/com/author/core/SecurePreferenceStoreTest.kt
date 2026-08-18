package com.author.core

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurePreferenceStoreTest {
  @Test
  fun preservesUndecryptableSecureValuesAndFailsClosed() {
    val prefs = SecurePrefsFakeSharedPreferences()
    prefs.edit().putString("secret", "secure:v1:not-decryptable").commit()
    val store = SecurePreferenceStore(prefs, TestSecurePreferenceCodec())

    val error = runCatching { store.getString("secret") }.exceptionOrNull()
    assertTrue(error is SecurePreferenceUnavailableException)
    assertEquals("secure:v1:not-decryptable", prefs.getString("secret", null))
  }

  @Test
  fun migratesPlaintextValuesAfterReading() {
    val prefs = SecurePrefsFakeSharedPreferences()
    prefs.edit().putString("secret", "plain-value").commit()
    val store = SecurePreferenceStore(prefs, TestSecurePreferenceCodec())

    assertEquals("plain-value", store.getString("secret"))
    assertEquals("plain-value", store.getString("secret"))
    assertTrue(prefs.getString("secret", null)?.startsWith("secure:v1:") == true)
  }
}

private class TestSecurePreferenceCodec : SecurePreferenceCodec {
  override fun encrypt(value: String): String = "test:${value.reversed()}"

  override fun decrypt(payload: String): String {
    require(payload.startsWith("test:")) { "Invalid test payload" }
    return payload.removePrefix("test:").reversed()
  }
}

private class SecurePrefsFakeSharedPreferences : SharedPreferences {
  private val values = mutableMapOf<String, Any?>()

  override fun getAll(): MutableMap<String, *> = values.toMutableMap()

  override fun getString(key: String?, defValue: String?): String? =
    values[key] as? String ?: defValue

  override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
    @Suppress("UNCHECKED_CAST") (values[key] as? MutableSet<String>) ?: defValues

  override fun getInt(key: String?, defValue: Int): Int = values[key] as? Int ?: defValue

  override fun getLong(key: String?, defValue: Long): Long = values[key] as? Long ?: defValue

  override fun getFloat(key: String?, defValue: Float): Float = values[key] as? Float ?: defValue

  override fun getBoolean(key: String?, defValue: Boolean): Boolean =
    values[key] as? Boolean ?: defValue

  override fun contains(key: String?): Boolean = values.containsKey(key)

  override fun edit(): SharedPreferences.Editor = SecurePrefsFakeEditor(values)

  override fun registerOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener?
  ) {}

  override fun unregisterOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener?
  ) {}
}

private class SecurePrefsFakeEditor(private val values: MutableMap<String, Any?>) :
  SharedPreferences.Editor {
  override fun putString(key: String?, value: String?): SharedPreferences.Editor = apply {
    if (key != null) values[key] = value
  }

  override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor =
    apply {
      if (key != null) this.values[key] = values
    }

  override fun putInt(key: String?, value: Int): SharedPreferences.Editor = apply {
    if (key != null) values[key] = value
  }

  override fun putLong(key: String?, value: Long): SharedPreferences.Editor = apply {
    if (key != null) values[key] = value
  }

  override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = apply {
    if (key != null) values[key] = value
  }

  override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = apply {
    if (key != null) values[key] = value
  }

  override fun remove(key: String?): SharedPreferences.Editor = apply {
    if (key != null) values.remove(key)
  }

  override fun clear(): SharedPreferences.Editor = apply { values.clear() }

  override fun commit(): Boolean = true

  override fun apply() {}
}
