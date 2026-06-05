package com.author.core

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SyncClientTest {
  @Test
  fun loginWithProofPostsEmailIdentifierAndProofPayload() {
    OneShotJsonServer(
        """
        {
          "token": "session-token",
          "user": {
            "username": "owner",
            "email": "owner@example.com",
            "displayName": null,
            "twoFactorEnabled": false
          },
          "device": { "id": "phone", "name": "Phone" },
          "expiresAt": "2026-05-26T12:00:00.000Z",
          "serverProof": "server-proof",
          "e2eeKeyring": "wrapped-keyring"
        }
        """
          .trimIndent()
      )
      .use { server ->
        val client = SyncClient { server.baseUrl }
        val response =
          client.loginWithProof(
            "owner@example.com",
            AuthProof("challenge-id", "client-nonce", "proof-value"),
            null,
            Device("phone", "Phone"),
            "trusted-secret-01234567890123456789",
          )

        assertEquals("session-token", response.token)
        assertEquals("owner", response.user.username)
        assertEquals("server-proof", response.serverProof)
        assertEquals("wrapped-keyring", response.e2eeKeyring)

        val request = server.awaitRequest()
        assertEquals("POST /api/auth/login HTTP/1.1", request.requestLine)
        val body = JSONObject(request.body)
        assertEquals("owner@example.com", body.getString("username"))
        assertEquals("challenge-id", body.getJSONObject("proof").getString("challengeId"))
        assertEquals("client-nonce", body.getJSONObject("proof").getString("clientNonce"))
        assertEquals("proof-value", body.getJSONObject("proof").getString("proof"))
        assertEquals("trusted-secret-01234567890123456789", body.getString("deviceTrustSecret"))
        assertEquals("phone", body.getJSONObject("device").getString("id"))
        assertFalse(body.has("bootstrapPassword"))
        assertFalse(body.has("passwordVerifier"))
        assertFalse(body.has("password"))
      }
  }

  @Test
  fun loginTrustedDevicePostsOtpOnlyPayload() {
    OneShotJsonServer(
        """
        {
          "token": "session-token",
          "user": {
            "username": "owner",
            "email": null,
            "displayName": null,
            "twoFactorEnabled": true
          },
          "device": { "id": "phone", "name": "Phone" },
          "expiresAt": "2026-05-26T12:00:00.000Z"
        }
        """
          .trimIndent()
      )
      .use { server ->
        val client = SyncClient { server.baseUrl }
        val response =
          client.loginTrustedDevice(
            "owner",
            "123456",
            Device("phone", "Phone"),
            "trusted-secret-01234567890123456789",
          )

        assertEquals("session-token", response.token)
        assertEquals("owner", response.user.username)

        val request = server.awaitRequest()
        assertEquals("POST /api/auth/login HTTP/1.1", request.requestLine)
        val body = JSONObject(request.body)
        assertEquals("owner", body.getString("username"))
        assertEquals("123456", body.getString("totpCode"))
        assertEquals("trusted-secret-01234567890123456789", body.getString("deviceTrustSecret"))
        assertEquals("phone", body.getJSONObject("device").getString("id"))
        assertFalse(body.has("proof"))
        assertFalse(body.has("bootstrapPassword"))
        assertFalse(body.has("passwordVerifier"))
        assertFalse(body.has("password"))
      }
  }
}

private data class CapturedRequest(val requestLine: String, val body: String)

private class OneShotJsonServer(private val responseBody: String) : AutoCloseable {
  private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
  private val captured = CompletableFuture<CapturedRequest>()
  private val worker =
    thread(start = true) {
      try {
        server.use {
          val socket = it.accept()
          socket.use { accepted ->
            val reader =
              BufferedReader(InputStreamReader(accepted.getInputStream(), Charsets.UTF_8))
            val requestLine = reader.readLine()
            var contentLength = 0
            while (true) {
              val line = reader.readLine()
              if (line.isNullOrEmpty()) break
              val separator = line.indexOf(':')
              if (
                separator > 0 &&
                  line.substring(0, separator).equals("content-length", ignoreCase = true)
              ) {
                contentLength = line.substring(separator + 1).trim().toInt()
              }
            }

            val bodyChars = CharArray(contentLength)
            var read = 0
            while (read < contentLength) {
              val count = reader.read(bodyChars, read, contentLength - read)
              if (count == -1) break
              read += count
            }

            val bytes = responseBody.toByteArray(Charsets.UTF_8)
            val headers =
              "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "Connection: close\r\n\r\n"
            val output = accepted.getOutputStream()
            output.write(headers.toByteArray(Charsets.UTF_8))
            output.write(bytes)
            output.flush()
            captured.complete(CapturedRequest(requestLine, String(bodyChars, 0, read)))
          }
        }
      } catch (error: Throwable) {
        captured.completeExceptionally(error)
      }
    }

  val baseUrl: String = "http://127.0.0.1:${server.localPort}"

  fun awaitRequest(): CapturedRequest = captured.get(5, TimeUnit.SECONDS)

  override fun close() {
    server.close()
    worker.join(5_000)
  }
}
