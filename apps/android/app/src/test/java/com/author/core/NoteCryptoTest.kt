package com.author.core

import android.content.SharedPreferences
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NoteCryptoTest {
  private val crypto =
    NoteCrypto(FakeSharedPreferences(), SecurePreferenceStore(FakeSharedPreferences()))

  private val crossDeviceKeyMaterial =
    "keyring:v1:eyJ2ZXJzaW9uIjoxLCJzY29wZSI6ImFjY291bnQiLCJhY2NvdW50VXNlcm5hbWUiOiJpdmFua25vd3N3aGF0IiwiYWN0aXZlS2V5SWQiOiJka19jcm9zc19kZXZpY2VfdGVzdCIsImtleXMiOlt7ImlkIjoiZGtfY3Jvc3NfZGV2aWNlX3Rlc3QiLCJtYXRlcmlhbCI6IkFRSURCQVVHQndnSkNnc01EUTRQRUJFU0V4UVZGaGNZR1JvYkhCMGVIeUEiLCJjcmVhdGVkQXQiOiIyMDI2LTA2LTA2VDAwOjAwOjAwLjAwMFoiLCJzdGF0dXMiOiJhY3RpdmUifV0sImNyZWF0ZWRBdCI6IjIwMjYtMDYtMDZUMDA6MDA6MDAuMDAwWiIsInVwZGF0ZWRBdCI6IjIwMjYtMDYtMDZUMDA6MDA6MDAuMDAwWiJ9"
  private val crossDeviceE2eeKeyring =
    "{\"version\":1,\"activeKeyId\":\"dk_cross_device_test\",\"wrappedAt\":\"2026-06-06T00:00:00.000Z\",\"passwordWrap\":{\"alg\":\"AES-256-GCM\",\"kdf\":\"sha256\",\"context\":\"password\",\"iv\":\"EBESExQVFhcYGRob\",\"ciphertext\":\"y7APgNIh9IA6rt6GuOe7pTGfT09DNii7F9Fi5eB8-GewVRoZKmYvcKmmS-mJsqSfx2Ho6ZzGr2HH6-J3xIj40UakTLjxksoG2O_pb4utD0dNh-Ls7rtvyE4SvNMPgEYmjAsHo7K9ChBYMLLblaOvBvEAPENlqBbURKvefwAAKYGrzdSOGpm728cV5_IBnx4RAuPZzYprhwKHlPSKhmSkaxOBPSr9aHLIGWwv9DAklpMfDmJReUibWbsY6DLI1-9RGC3taBrD08dvPk4uEr2866ansAl3_mqSKHMszDM4LIMKKljWc09n-ZGFN-KsCkbiGMX0cbaAXLH6e40Nri0oqKtzZKAgGAh6IKcHO8iTTs3lbucdI6BS9BGph8BcpcntjwV4EUuDJVg4EWOTcMJyRUwTV-wb1TI7ixzCKqLbywU3GTfECAp_6Zc6qMZMYY2Idolmnw2ZOqnEUskZnZpAMzAN33x3Q1PBj62xa6Eo0S4MWrl-o5Wdm4USBu6JAdLylzcaGPtwm2ohmefC_WyGpf26S6qa7qSoSH9vzDS3nXLjlDrnBeLBLp-nQMa1PJjmRQYADDuohUdON5h0LMniZpdYYIxf_dUiEPEfnxL_xG3-yPgxzhLY\"}}"
  private val crossDeviceTitle =
    "enc:v4:dk_cross_device_test:ICEiIyQlJicoKSor:NIHVEIZ2taJuy2T8Z22wyD3wFxOWxToCV1ChoQPZkEEEFQ"
  private val crossDeviceBody =
    "enc:v4:dk_cross_device_test:MDEyMzQ1Njc4OTo7:Ogt4VSKzR-umq82mqNrCHbF661Qoz4GMjc30m1di5H1q"

  @Test
  fun encryptsLiteralTextThatOnlyImitatesEncryptedPrefix() {
    val prefixedPlaintext = "enc:v3:ZmFrZS1pdg:bm90LWFlcy1nY20"
    val encrypted = crypto.encryptText(prefixedPlaintext, "test-key")

    assertNotEquals(prefixedPlaintext, encrypted)
    assertTrue(crypto.isEncryptedText(encrypted))
    assertTrue(crypto.isCurrentEncryptedText(encrypted))
    assertFalse(crypto.canDecryptEncryptedText(prefixedPlaintext, "test-key"))
    assertEquals(prefixedPlaintext, crypto.decryptText(encrypted, "test-key"))
  }

  @Test
  fun rejectsCurrentEncryptedTextThatCannotBeDecrypted() {
    val encrypted = crypto.encryptText("private text", "test-key", "note:note-1:title")

    assertThrowsEncryptionDecryptFailure {
      crypto.decryptText(encrypted, "test-key", "note:note-2:title")
    }
    assertThrowsEncryptionDecryptFailure {
      crypto.decryptText(encrypted, "other-key", "note:note-1:title")
    }
  }

  @Test
  fun encryptsPrefixedNoteFieldsInsteadOfPreservingSpoofedEnvelopes() {
    val prefixed =
      note("note-1", title = "enc:v3:dGl0bGU:ZmFrZQ", body = "enc:v3:Ym9keQ:ZmFrZQ")
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
  fun refusesToRepublishCurrentNoteCiphertextWithWrongKey() {
    val encrypted =
      crypto.encryptNoteFields(note("note-1", "Launch notes", "Private body"), "old-key")

    assertThrowsEncryptionDecryptFailure { crypto.encryptNoteFields(encrypted, "new-key") }
  }

  @Test
  fun bindsNotebookNameEnvelopesToNotebookId() {
    val notebook = notebook("notebook-1", "Ideas")
    val encrypted = crypto.encryptNotebookFields(notebook, "sync-key")
    val moved = notebook("notebook-2", encrypted.name)

    assertEquals(notebook.name, crypto.decryptNotebookFields(encrypted, "sync-key").name)
    assertThrowsEncryptionDecryptFailure { crypto.decryptNotebookFields(moved, "sync-key") }
  }

  @Test
  fun refusesToRepublishCurrentNotebookCiphertextWithWrongKey() {
    val encrypted = crypto.encryptNotebookFields(notebook("notebook-1", "Ideas"), "old-key")

    assertThrowsEncryptionDecryptFailure { crypto.encryptNotebookFields(encrypted, "new-key") }
  }

  @Test
  fun derivesArgon2idOnlyPasswordMaterial() {
    val material = crypto.keyMaterialFromPassword("Owner", "test-password")

    assertEquals(
      "password:v4:argon2id:m=19456,t=2,p=1:MQMKSVOHRnCVVNRMaRVstcAMv4f8UHAA15dnnNaLIrc",
      material,
    )
    assertFalse(material.contains("pbkdf2"))
  }

  @Test
  fun unwrapsAccountKeyringsAndRewrapsThemWithoutChangingNoteKeys() {
    val prepared = crypto.prepareNewAccountKeyring("Owner", "test-password")
    val material = crypto.keyringMaterialFromWrapped(prepared.e2eeKeyring, "owner", "test-password")
    val encrypted = crypto.encryptNoteFields(note("note-1", "Title", "Body"), material)

    assertEquals(prepared.keyMaterial, material)
    assertEquals("Body", crypto.decryptNoteFields(encrypted, prepared.keyMaterial).body)

    val rewrapped =
      crypto.rewrapKeyringForPassword(
        prepared.keyMaterial,
        "owner",
        "new-password",
        prepared.e2eeKeyring,
      )
    assertEquals(
      prepared.keyMaterial,
      crypto.keyringMaterialFromWrapped(rewrapped, "owner", "new-password"),
    )
    assertThrowsEncryptionDecryptFailure {
      crypto.keyringMaterialFromWrapped(rewrapped, "owner", "test-password")
    }
  }

  @Test
  fun matchesWebKeyringAndEncryptedFieldFixture() {
    assertEquals(
      crossDeviceKeyMaterial,
      crypto.keyringMaterialFromWrapped(
        crossDeviceE2eeKeyring,
        "ivanknowswhat",
        "cross-device-password-2026",
      ),
    )
    assertEquals(
      "Cross-device title",
      crypto.decryptText(crossDeviceTitle, crossDeviceKeyMaterial, "note:fixture-note:title"),
    )
    assertEquals(
      "Cross-device body",
      crypto.decryptText(crossDeviceBody, crossDeviceKeyMaterial, "note:fixture-note:body"),
    )
    assertThrowsEncryptionDecryptFailure {
      crypto.keyringMaterialFromWrapped(
        crossDeviceE2eeKeyring,
        "ivanknowswhat",
        "wrong-password-2026",
      )
    }
  }

  @Test
  fun recoveryKitRestoresAccountKeyringOnlyWithRecoveryCode() {
    val prepared = crypto.prepareNewAccountKeyring("Owner", "test-password")

    assertEquals(
      prepared.keyMaterial,
      crypto.restoreKeyringFromRecoveryKit(prepared.recoveryKitJson, prepared.recoveryCode),
    )

    assertThrowsEncryptionDecryptFailure {
      crypto.restoreKeyringFromRecoveryKit(prepared.recoveryKitJson, "author-recovery-v1-wrong")
    }
  }

  @Test
  fun migratesLegacyPasswordEncryptedV3EnvelopesIntoAccountKeyrings() {
    val passwordMaterial = crypto.keyMaterialFromPassword("Owner", "test-password")
    val legacy = legacyV3EncryptText("Legacy body", passwordMaterial, "note:note-1:body")
    val migrated = crypto.migratePasswordMaterialToAccountKeyring("Owner", passwordMaterial)

    assertEquals(
      "Legacy body",
      crypto.decryptText(legacy, migrated.keyMaterial, "note:note-1:body"),
    )
    val upgraded = crypto.encryptNoteFields(note("note-1", "Title", legacy), migrated.keyMaterial)
    assertTrue(upgraded.body.startsWith("enc:v4:"))
    assertEquals(
      "Legacy body",
      crypto.decryptText(upgraded.body, migrated.keyMaterial, "note:note-1:body"),
    )
  }

  @Test
  fun derivesArgon2idScramPasswordProofs() {
    val verifier = crypto.passwordVerifierFromPassword("test-password")
    val challenge =
      AuthChallenge(
        mode = "proof",
        challengeId = crypto.randomAuthNonce(24),
        username = "owner",
        purpose = "login",
        clientNonce = crypto.randomAuthNonce(),
        serverNonce = crypto.randomAuthNonce(),
        expiresAt = "2026-05-22T12:00:00.000Z",
        salt = verifier.salt,
        params = verifier.params,
      )

    val proof = crypto.authProofFromPassword("test-password", challenge)
    val changedPurpose =
      crypto.authProofFromPassword("test-password", challenge.copy(purpose = "totp"))

    assertEquals("argon2id-scram-sha256", verifier.algorithm)
    assertTrue(Regex("^[A-Za-z0-9_-]+$").matches(proof.proof.proof))
    assertTrue(crypto.verifyAuthServerProof(proof.expectedServerProof, proof.expectedServerProof))
    assertFalse(crypto.verifyAuthServerProof(proof.expectedServerProof, verifier.storedKey))
    assertNotEquals(proof.proof.proof, changedPurpose.proof.proof)
  }

  @Test
  fun matchesWebAuthProofVector() {
    val params = AuthKdfParams()
    val salt = "MDEyMzQ1Njc4OWFiY2RlZg"
    val verifier = crypto.passwordVerifierFromPassword("correct horse battery", salt, params)
    val challenge =
      AuthChallenge(
        mode = "proof",
        challengeId = "Y2hhbGxlbmdlLWlkLTEyMzQ1Njc4",
        username = "owner",
        purpose = "login",
        clientNonce = "Y2xpZW50LW5vbmNlLTEyMzQ1Njc4OTAxMjM0NTY",
        serverNonce = "c2VydmVyLW5vbmNlLTEyMzQ1Njc4OTAxMjM0NTY",
        expiresAt = "2026-05-22T12:00:00.000Z",
        salt = salt,
        params = params,
      )

    val proof = crypto.authProofFromPassword("correct horse battery", challenge)

    assertEquals("b4rFnproYC5Yhg9YxI38-tR60QyQPz2QesC5QUAH8YY", verifier.storedKey)
    assertEquals("jdWnq-SDU19qQ_Ug1I3KzQwUUulj9ZwHB0mJB1l1pTE", verifier.serverKey)
    assertEquals("nAp3wJ9baO77rMYbJEYaG1ImJECtXfhD1_NILcLC7So", proof.proof.proof)
    assertEquals("cAFcBTzTFv5IyvK68pROagJLvMkTbGDOuWFlzZjIFzk", proof.expectedServerProof)
  }

  @Test
  fun identifiesOldEncryptionFormatsAsRequiringMigrationRelease() {
    assertTrue(crypto.isUnsupportedEncryptedText("enc:v1:old"))
    assertTrue(crypto.isUnsupportedEncryptedText("enc:v2:old"))
    assertFalse(crypto.isUnsupportedEncryptedText("enc:v3:spoof"))
    assertTrue(crypto.isUnsupportedEncryptionKeyMaterial("password:v3:argon2id:m=1,t=1,p=1:key"))
    assertTrue(crypto.isUnsupportedEncryptionKeyMaterial("password:old-sha-key"))
    assertFalse(
      crypto.isUnsupportedEncryptionKeyMaterial("password:v4:argon2id:m=19456,t=2,p=1:key")
    )
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

private fun legacyV3EncryptText(value: String, keyMaterial: String, context: String): String {
  val iv = ByteArray(12)
  java.security.SecureRandom().nextBytes(iv)
  val digest =
    MessageDigest.getInstance("SHA-256")
      .digest("author:encryption:v3:$keyMaterial".toByteArray(UTF_8))
  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
  cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(digest, "AES"), GCMParameterSpec(128, iv))
  cipher.updateAAD("author:encrypted-field:v3:$context".toByteArray(UTF_8))
  return "enc:v3:${base64UrlEncode(iv)}:${base64UrlEncode(cipher.doFinal(value.toByteArray(UTF_8)))}"
}

private fun assertThrowsEncryptionDecryptFailure(block: () -> Unit) {
  try {
    block()
    fail("Expected encryption decrypt failure")
  } catch (error: IllegalStateException) {
    assertEquals(ENCRYPTION_DECRYPT_FAILED_MESSAGE, error.message)
  }
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
