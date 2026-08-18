package com.author.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DebugLogStoreTest {
  @Test
  fun redactsAllAccountAndEncryptionSecretFieldNames() {
    val redacted =
      redactDebugSecrets(
        """{"token":"session-value","e2eeKeyring":"wrapped-value","recoveryCode":"code-value","keyMaterial":"material-value","deviceTrustSecret":"trust-value"}"""
      )

    listOf("session-value", "wrapped-value", "code-value", "material-value", "trust-value")
      .forEach { assertFalse(redacted.contains(it)) }
    assertTrue(redacted.contains("[redacted]"))
  }
}
