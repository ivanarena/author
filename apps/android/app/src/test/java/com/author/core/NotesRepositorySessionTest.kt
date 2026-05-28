package com.author.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NotesRepositorySessionTest {
  @Test
  fun sensitiveOperationsRequireStoredSessionUsername() {
    val session =
      StoredSession(
        token = "session-token",
        user =
          AuthUser(
            username = "  owner  ",
            email = null,
            displayName = null,
            twoFactorEnabled = false,
          ),
        expiresAt = null,
      )

    assertEquals(
      "owner",
      requireStoredSessionUsernameForSensitiveOperation(session, "changing password"),
    )
  }

  @Test
  fun sensitiveOperationsFailClosedWithoutStoredSessionUsername() {
    val session =
      StoredSession(
        token = "session-token",
        user =
          AuthUser(username = "  ", email = null, displayName = null, twoFactorEnabled = false),
        expiresAt = null,
      )

    val error =
      org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
        requireStoredSessionUsernameForSensitiveOperation(session, "changing password")
      }

    assertEquals("Sign in again before changing password", error.message)
  }
}
