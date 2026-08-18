package com.author.core

import android.content.Context
import androidx.core.content.edit
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

private const val DEBUG_LOG_KEY = "author-debug-log-v1"
private const val MAX_DEBUG_LOG_ENTRIES = 200
private const val MAX_DEBUG_LOG_FIELD_LENGTH = 4000
private const val REDACTED_DEBUG_VALUE = "[redacted]"
private val DEBUG_LOG_LOCK = Any()
private val BEARER_TOKEN_PATTERN =
  Regex("""\b(Bearer)\s+[A-Za-z0-9._~+/=-]+""", RegexOption.IGNORE_CASE)
private val JSON_SECRET_PATTERN =
  Regex(
    """(["'](?:authorization|token|authToken|password|secret|e2eeKeyring|recoveryCode|keyMaterial|deviceTrustSecret)["']\s*:\s*)["'][^"']*["']""",
    RegexOption.IGNORE_CASE,
  )
private val ASSIGNMENT_SECRET_PATTERN =
  Regex(
    """\b((?:authorization|token|authToken|password|secret|e2eeKeyring|recoveryCode|keyMaterial|deviceTrustSecret)\s*=\s*)[^\s,"'}]+""",
    RegexOption.IGNORE_CASE,
  )

object DebugLogStore {
  fun record(
    context: Context,
    level: String = "info",
    source: String,
    message: String,
    detail: String = "",
  ) {
    synchronized(DEBUG_LOG_LOCK) {
      val prefs = context.applicationContext.getSharedPreferences("author", Context.MODE_PRIVATE)
      val entries =
        (loadEntries(prefs.getString(DEBUG_LOG_KEY, null)) +
            DebugLogEntry(
              id = UUID.randomUUID().toString(),
              at = nowIso(),
              level = safeLevel(level),
              source = sanitize(source.ifBlank { "App" }),
              message = sanitize(message.ifBlank { "Log entry" }),
              detail = sanitize(detail),
            ))
          .takeLast(MAX_DEBUG_LOG_ENTRIES)
      prefs.edit { putString(DEBUG_LOG_KEY, encodeEntries(entries)) }
    }
  }

  fun load(context: Context): List<DebugLogEntry> {
    val prefs = context.applicationContext.getSharedPreferences("author", Context.MODE_PRIVATE)
    return loadEntries(prefs.getString(DEBUG_LOG_KEY, null))
  }

  fun clear(context: Context) {
    val prefs = context.applicationContext.getSharedPreferences("author", Context.MODE_PRIVATE)
    prefs.edit { remove(DEBUG_LOG_KEY) }
  }

  fun format(entries: List<DebugLogEntry>): String {
    if (entries.isEmpty()) return "No diagnostic logs recorded on this device."
    return entries.joinToString("\n\n") { entry ->
      val heading =
        listOf(formatDateTime(entry.at), entry.level.uppercase(), entry.source, entry.message)
          .joinToString(" | ")
      if (entry.detail.isBlank()) heading else "$heading\n${entry.detail}"
    }
  }

  private fun loadEntries(raw: String?): List<DebugLogEntry> =
    runCatching {
        if (raw.isNullOrBlank()) return@runCatching emptyList()
        val array = JSONArray(raw)
        buildList {
            for (index in 0 until array.length()) {
              val entry = array.optJSONObject(index) ?: continue
              add(
                DebugLogEntry(
                  id = entry.optString("id"),
                  at = entry.optString("at"),
                  level = safeLevel(entry.optString("level")),
                  source = sanitize(entry.optString("source")),
                  message = sanitize(entry.optString("message")),
                  detail = sanitize(entry.optString("detail")),
                )
              )
            }
          }
          .filter { it.id.isNotBlank() && it.at.isNotBlank() && it.message.isNotBlank() }
          .takeLast(MAX_DEBUG_LOG_ENTRIES)
      }
      .getOrDefault(emptyList())

  private fun encodeEntries(entries: List<DebugLogEntry>): String {
    val array = JSONArray()
    entries.forEach { entry ->
      array.put(
        JSONObject()
          .put("id", entry.id)
          .put("at", entry.at)
          .put("level", entry.level)
          .put("source", entry.source)
          .put("message", entry.message)
          .put("detail", entry.detail)
      )
    }
    return array.toString()
  }

  private fun safeLevel(level: String): String =
    when (level.lowercase()) {
      "debug",
      "info",
      "warn",
      "error" -> level.lowercase()
      else -> "info"
    }

  private fun sanitize(value: String): String =
    redactDebugSecrets(value).replace("\u0000", "").take(MAX_DEBUG_LOG_FIELD_LENGTH)
}

internal fun redactDebugSecrets(value: String): String =
  value
    .replace(BEARER_TOKEN_PATTERN) { match -> "${match.groupValues[1]} $REDACTED_DEBUG_VALUE" }
    .replace(JSON_SECRET_PATTERN) { match -> "${match.groupValues[1]}\"$REDACTED_DEBUG_VALUE\"" }
    .replace(ASSIGNMENT_SECRET_PATTERN) { match -> "${match.groupValues[1]}$REDACTED_DEBUG_VALUE" }
