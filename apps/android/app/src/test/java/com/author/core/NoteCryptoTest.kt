package com.author.core

import android.content.SharedPreferences
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteCryptoTest {
  private val crypto =
    NoteCrypto(FakeSharedPreferences(), SecurePreferenceStore(FakeSharedPreferences()))

  @Test
  fun encryptsLiteralTextThatOnlyImitatesEncryptedPrefix() {
    val prefixedPlaintext = "enc:v2:ZmFrZS1pdg:bm90LWFlcy1nY20"
    val encrypted = crypto.encryptText(prefixedPlaintext, "test-key")

    assertNotEquals(prefixedPlaintext, encrypted)
    assertTrue(crypto.isEncryptedText(encrypted))
    assertFalse(crypto.canDecryptEncryptedText(prefixedPlaintext, "test-key"))
    assertEquals(prefixedPlaintext, crypto.decryptText(encrypted, "test-key"))
  }

  @Test
  fun encryptsPrefixedNoteFieldsInsteadOfPreservingSpoofedEnvelopes() {
    val prefixed =
      note("note-1", title = "enc:v2:dGl0bGU:ZmFrZQ", body = "enc:v2:Ym9keQ:ZmFrZQ")
        .copy(titleHash = "hash:v2:stale-title", bodyHash = "hash:v2:stale-body")

    val encrypted = crypto.encryptNoteFields(prefixed, "sync-key")

    assertNotEquals(prefixed.title, encrypted.title)
    assertNotEquals(prefixed.body, encrypted.body)
    assertNotEquals(prefixed.titleHash, encrypted.titleHash)
    assertNotEquals(prefixed.bodyHash, encrypted.bodyHash)
    assertEquals(prefixed.title, crypto.decryptNoteFields(encrypted, "sync-key").title)
    assertEquals(prefixed.body, crypto.decryptNoteFields(encrypted, "sync-key").body)
  }

  @Test
  fun bindsNotebookNameEnvelopesToNotebookId() {
    val notebook = notebook("notebook-1", "Ideas")
    val encrypted = crypto.encryptNotebookFields(notebook, "sync-key")
    val moved = notebook("notebook-2", encrypted.name)

    assertEquals(notebook.name, crypto.decryptNotebookFields(encrypted, "sync-key").name)
    assertEquals(encrypted.name, crypto.decryptNotebookFields(moved, "sync-key").name)
  }

  @Test
  fun readsLegacyNotebookNamesAndMigratesThemToIdBoundContext() {
    val notebook = notebook("notebook-1", "Ideas")
    val legacyEncrypted =
      notebook.copy(
        name = crypto.encryptText(notebook.name, "sync-key", "notebook:name"),
        nameHash = null,
      )

    assertEquals(notebook.name, crypto.decryptNotebookFields(legacyEncrypted, "sync-key").name)

    val migrated = crypto.encryptNotebookFields(legacyEncrypted, "sync-key")

    assertNotEquals(legacyEncrypted.name, migrated.name)
    assertTrue(crypto.isCurrentFieldHash(migrated.nameHash))
    assertEquals(notebook.name, crypto.decryptNotebookFields(migrated, "sync-key").name)
  }

  @Test
  fun derivesArgon2idPasswordMaterialWithLegacyFallbacks() {
    val material = crypto.keyMaterialFromPassword("Owner", "test-password")

    assertTrue(
      Regex(
          "^password:v3:argon2id:m=19456,t=2,p=1:[A-Za-z0-9_-]+:pbkdf2:v2:210000:[A-Za-z0-9_-]+:legacy:[A-Za-z0-9_-]+$"
        )
        .matches(material)
    )
  }

  @Test
  fun usesOnlyActiveArgon2idSegmentForV3PrimaryEncryption() {
    val material = crypto.keyMaterialFromPassword("Owner", "test-password")
    val encrypted = crypto.encryptText("argon secret", material)
    val tamperedFallbacks =
      (material.split(":").take(5) +
          listOf("pbkdf2", "v2", "210000", "unused-fallback", "legacy", "unused-legacy"))
        .joinToString(":")

    assertEquals("argon secret", crypto.decryptText(encrypted, tamperedFallbacks))
  }

  @Test
  fun migratesPbkdf2PasswordNotesToActiveArgon2idMaterial() {
    val oldMaterial = passwordV2MaterialFromPassword("Owner", "password")
    val oldEncrypted = crypto.encryptNoteFields(note("note-1", "Title", "Body"), oldMaterial)
    val nextMaterial = crypto.keyMaterialFromPassword("Owner", "password")

    assertEquals("Body", crypto.decryptNoteFields(oldEncrypted, nextMaterial).body)

    val migrated = crypto.encryptNoteFields(oldEncrypted, nextMaterial)

    assertNotEquals(oldEncrypted.title, migrated.title)
    assertNotEquals(oldEncrypted.body, migrated.body)
    assertEquals(migrated.body, crypto.decryptText(migrated.body, oldMaterial, "note:note-1:body"))
    assertEquals("Body", crypto.decryptNoteFields(migrated, nextMaterial).body)
  }

  private fun note(id: String, title: String, body: String) =
    LocalNote(
      id = id,
      title = title,
      body = body,
      titleHash = null,
      bodyHash = null,
      notebookIds = emptyList(),
      notebookId = null,
      createdAt = "2026-05-01T12:00:00Z",
      updatedAt = "2026-05-01T12:00:00Z",
      deletedAt = null,
      trashedAt = null,
      deviceId = "test-device",
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null,
    )

  private fun passwordV2MaterialFromPassword(username: String, password: String): String {
    val normalized = username.trim().lowercase()
    val passwordKey =
      PBEKeySpec(
        password.toCharArray(),
        "author:password-key:v2:$normalized".toByteArray(UTF_8),
        210_000,
        256,
      )
    val derived =
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(passwordKey).encoded
    val legacy =
      MessageDigest.getInstance("SHA-256").digest("$normalized\u0000$password".toByteArray(UTF_8))
    return "password:v2:210000:${base64UrlEncode(derived)}:legacy:${base64UrlEncode(legacy)}"
  }

  private fun notebook(id: String, name: String) =
    LocalNotebook(
      id = id,
      name = name,
      nameHash = null,
      createdAt = "2026-05-01T12:00:00Z",
      updatedAt = "2026-05-01T12:00:00Z",
      deletedAt = null,
      deviceId = "test-device",
      version = 1,
      syncStatus = "pending",
      lastSyncedVersion = 0,
      lastSyncedAt = null,
    )
}

private class FakeSharedPreferences : SharedPreferences {
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

  override fun edit(): SharedPreferences.Editor = FakeEditor(values)

  override fun registerOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener?
  ) {}

  override fun unregisterOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener?
  ) {}
}

private class FakeEditor(private val values: MutableMap<String, Any?>) : SharedPreferences.Editor {
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
