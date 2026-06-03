package com.author.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID
import kotlin.math.max

fun newId(): String = UUID.randomUUID().toString()

fun nowIso(): String = Instant.now().toString()

fun normalizedNotebookName(name: String): String = name.trim().lowercase(Locale.ROOT)

fun noteNotebookIds(note: LocalNote): List<String> {
  val ids =
    if (note.notebookIds.isNotEmpty()) {
      note.notebookIds
    } else {
      note.notebookId?.let { listOf(it) } ?: emptyList()
    }
  return ids.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
}

fun primaryNotebookId(ids: List<String>): String? = ids.firstOrNull()

fun nextVersionAfter(remoteVersion: Int): Int = remoteVersion + 1

data class SyncPushBatch<N, B>(val notes: List<N>, val notebooks: List<B>)

fun <N, B> syncPushBatches(
  notes: List<N>,
  notebooks: List<B>,
  maxChanges: Int,
): List<SyncPushBatch<N, B>> {
  require(maxChanges > 0) { "maxChanges must be positive" }

  val batches = mutableListOf<SyncPushBatch<N, B>>()
  var noteIndex = 0
  var notebookIndex = 0
  while (noteIndex < notes.size || notebookIndex < notebooks.size) {
    val notebookEnd = minOf(notebookIndex + maxChanges, notebooks.size)
    val notebookBatch = notebooks.subList(notebookIndex, notebookEnd)
    notebookIndex = notebookEnd

    val noteSlots = maxChanges - notebookBatch.size
    val noteEnd = minOf(noteIndex + noteSlots, notes.size)
    val noteBatch = notes.subList(noteIndex, noteEnd)
    noteIndex = noteEnd

    batches.add(SyncPushBatch(noteBatch, notebookBatch))
  }

  return batches
}

fun safeBaseVersion(lastSyncedVersion: Int): Int =
  if (lastSyncedVersion >= 0) lastSyncedVersion else 0

fun safePendingVersion(version: Int, lastSyncedVersion: Int): Int {
  val baseVersion = safeBaseVersion(lastSyncedVersion)
  return if (version > baseVersion && version > 0) version else nextVersionAfter(baseVersion)
}

fun safePendingVersion(record: LocalNote): Int =
  safePendingVersion(record.version, record.lastSyncedVersion)

fun safePendingVersion(record: LocalNotebook): Int =
  safePendingVersion(record.version, record.lastSyncedVersion)

fun preparePendingNoteForPush(record: LocalNote, device: Device): LocalNote {
  val notebookIds = noteNotebookIds(record)
  val baseVersion = safeBaseVersion(record.lastSyncedVersion)
  return record.copy(
    notebookIds = notebookIds,
    notebookId = primaryNotebookId(notebookIds),
    deletedAt = record.deletedAt,
    trashedAt = record.trashedAt,
    deviceId = device.id,
    version = safePendingVersion(record.version, baseVersion),
    syncStatus = "pending",
    lastSyncedVersion = baseVersion,
    lastSyncedAt = record.lastSyncedAt,
  )
}

fun preparePendingNotebookForPush(record: LocalNotebook, device: Device): LocalNotebook {
  val baseVersion = safeBaseVersion(record.lastSyncedVersion)
  return record.copy(
    deletedAt = record.deletedAt,
    deviceId = device.id,
    version = safePendingVersion(record.version, baseVersion),
    syncStatus = "pending",
    lastSyncedVersion = baseVersion,
    lastSyncedAt = record.lastSyncedAt,
  )
}

fun remapNotebookIds(
  ids: List<String>,
  fromNotebookId: String,
  toNotebookId: String,
): List<String> =
  ids
    .map { if (it == fromNotebookId) toNotebookId else it }
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .distinct()

fun uniqueNotebookCopyName(
  baseName: String,
  notebooks: List<LocalNotebook>,
  excludedIds: Set<String>,
): String {
  val base = baseName.trim().ifBlank { "Notebook" }
  val taken =
    notebooks
      .filter { it.deletedAt == null && it.id !in excludedIds }
      .map { normalizedNotebookName(it.name) }
      .toSet()
  var candidate = "$base copy"
  var suffix = 2
  while (normalizedNotebookName(candidate) in taken) {
    candidate = "$base copy $suffix"
    suffix += 1
  }
  return candidate
}

fun deriveTitle(body: String): String =
  body.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }?.take(120) ?: ""

fun noteDisplayTitle(note: LocalNote): String =
  note.title
    .ifBlank { deriveTitle(note.body) }
    .ifBlank { if (note.trashedAt != null) "Trashed note" else "Untitled" }

fun notePreview(note: LocalNote): String = note.body.replace(Regex("\\s+"), " ").trim().take(96)

fun previewText(note: LocalNote): String =
  note.body.trim().replace(Regex("\\s+"), " ").take(160).ifBlank {
    note.title.ifBlank { "Empty note" }
  }

fun previewText(notebook: LocalNotebook): String = notebook.name.ifBlank { "Untitled notebook" }

fun countWords(text: String): Int = Regex("\\S+").findAll(text.trim()).count()

fun countNotesByNotebook(items: List<LocalNote>): Map<String, Int> {
  val counts = mutableMapOf<String, Int>()
  for (note in items) {
    val ids = noteNotebookIds(note)
    if (ids.isEmpty()) {
      counts[""] = (counts[""] ?: 0) + 1
    } else {
      ids.forEach { counts[it] = (counts[it] ?: 0) + 1 }
    }
  }
  return counts
}

const val NOTE_FILTER_UNFILED_ID = "__unfiled__"
const val NOTE_DATE_FILTER_TODAY = "today"
const val NOTE_DATE_FILTER_YESTERDAY = "yesterday"
const val NOTE_DATE_FILTER_PREVIOUS_7 = "previous-7"
const val NOTE_DATE_FILTER_PREVIOUS_30 = "previous-30"
const val NOTE_DATE_FILTER_OLDER = "older"

val NOTE_DATE_FILTERS =
  setOf(
    NOTE_DATE_FILTER_TODAY,
    NOTE_DATE_FILTER_YESTERDAY,
    NOTE_DATE_FILTER_PREVIOUS_7,
    NOTE_DATE_FILTER_PREVIOUS_30,
    NOTE_DATE_FILTER_OLDER,
  )

fun filterNotesForView(
  notes: List<LocalNote>,
  trash: List<LocalNote>,
  filterId: String,
): List<LocalNote> {
  if (filterId == "trash") return trash
  return notes.filter { note ->
    val ids = noteNotebookIds(note)
    when (filterId) {
      "all" -> true
      "favorites" -> note.isFavorite
      "unfiled" -> ids.isEmpty()
      else -> ids.contains(filterId)
    }
  }
}

fun filterNotesByAdvancedFilters(
  items: List<LocalNote>,
  notebookFilterIds: Set<String>,
  dateRangeFilters: Set<String>,
  now: Instant = Instant.now(),
): List<LocalNote> {
  val notebooks =
    notebookFilterIds
      .map { if (it.isBlank()) NOTE_FILTER_UNFILED_ID else it.trim() }
      .filter { it.isNotBlank() }
      .toSet()
  val dates = dateRangeFilters.filter { it in NOTE_DATE_FILTERS }.toSet()
  if (notebooks.isEmpty() && dates.isEmpty()) return items
  return items.filter { note ->
    (notebooks.isEmpty() || noteMatchesNotebookFilter(note, notebooks)) &&
      (dates.isEmpty() || noteDateFilterKey(note.updatedAt, now) in dates)
  }
}

private fun noteMatchesNotebookFilter(note: LocalNote, notebookFilterIds: Set<String>): Boolean {
  val ids = noteNotebookIds(note)
  return (NOTE_FILTER_UNFILED_ID in notebookFilterIds && ids.isEmpty()) ||
    ids.any { it in notebookFilterIds }
}

fun noteDateFilterKey(iso: String, now: Instant = Instant.now()): String {
  val zone = ZoneId.systemDefault()
  val today = LocalDate.ofInstant(now, zone)
  val target = runCatching { LocalDate.ofInstant(Instant.parse(iso), zone) }.getOrElse { today }
  val daysAgo = java.time.temporal.ChronoUnit.DAYS.between(target, today).toInt()
  return when {
    daysAgo <= 0 -> NOTE_DATE_FILTER_TODAY
    daysAgo == 1 -> NOTE_DATE_FILTER_YESTERDAY
    daysAgo < 7 -> NOTE_DATE_FILTER_PREVIOUS_7
    daysAgo < 30 -> NOTE_DATE_FILTER_PREVIOUS_30
    else -> NOTE_DATE_FILTER_OLDER
  }
}

fun filterNotesBySearch(items: List<LocalNote>, query: String): List<LocalNote> {
  val normalized = query.trim().lowercase(Locale.getDefault())
  if (normalized.isEmpty()) return items
  return items.filter {
    "${it.title}\n${it.body}".lowercase(Locale.getDefault()).contains(normalized)
  }
}

fun sortNotes(items: List<LocalNote>, sort: String): List<LocalNote> =
  when (sort) {
    "az" -> items.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { noteDisplayTitle(it) })
    "za" ->
      items.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { noteDisplayTitle(it) }).reversed()
    else -> items.sortedByDescending { it.updatedAt }
  }

fun groupNotesByDateRange(
  items: List<LocalNote>,
  sort: String,
  now: Instant = Instant.now(),
): List<Pair<String, List<LocalNote>>> {
  if (items.isEmpty()) return emptyList()
  if (sort != "date-desc") return listOf((if (sort == "az") "A-Z" else "Z-A") to items)
  return groupNotesByLabel(items) { dateRangeLabel(it.updatedAt, now) }
}

fun groupNotes(
  items: List<LocalNote>,
  sort: String,
  groupBy: String,
  now: Instant = Instant.now(),
): List<Pair<String, List<LocalNote>>> {
  if (items.isEmpty()) return emptyList()
  return when (groupBy) {
    "none" -> listOf("" to items)
    "month" -> groupNotesByLabel(items) { monthLabel(it.updatedAt) }
    "year" -> groupNotesByLabel(items) { yearLabel(it.updatedAt) }
    else -> groupNotesByDateRange(items, sort, now)
  }
}

private fun groupNotesByLabel(
  items: List<LocalNote>,
  labelFor: (LocalNote) -> String,
): List<Pair<String, List<LocalNote>>> {
  return items.groupBy(labelFor).map { it.key to it.value }
}

fun dateRangeLabel(iso: String, now: Instant = Instant.now()): String {
  val zone = ZoneId.systemDefault()
  val today = LocalDate.ofInstant(now, zone)
  val target = runCatching { LocalDate.ofInstant(Instant.parse(iso), zone) }.getOrElse { today }
  val daysAgo = java.time.temporal.ChronoUnit.DAYS.between(target, today).toInt()
  return when {
    daysAgo < 0 -> "Future"
    daysAgo == 0 -> "Today"
    daysAgo == 1 -> "Yesterday"
    daysAgo < 7 -> "Previous 7 days"
    daysAgo < 30 -> "Previous 30 days"
    daysAgo < 365 ->
      target.month.getDisplayName(java.time.format.TextStyle.FULL, Locale.getDefault())
    else -> target.year.toString()
  }
}

private fun monthLabel(iso: String): String {
  val target = runCatching { Instant.parse(iso) }.getOrNull() ?: return "Unknown"
  return DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())
    .withZone(ZoneId.systemDefault())
    .format(target)
}

private fun yearLabel(iso: String): String {
  val target = runCatching { Instant.parse(iso) }.getOrNull() ?: return "Unknown"
  return DateTimeFormatter.ofPattern("yyyy", Locale.getDefault())
    .withZone(ZoneId.systemDefault())
    .format(target)
}

fun formatListDate(iso: String): String =
  formatInstant(iso, DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))

fun formatDateTime(iso: String?): String {
  if (iso == null) return "Not synced yet"
  return formatInstant(
    iso,
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT),
  )
}

fun relativeAge(iso: String, now: Instant = Instant.now()): String {
  val zone = ZoneId.systemDefault()
  val today = LocalDate.ofInstant(now, zone)
  val target = runCatching { LocalDate.ofInstant(Instant.parse(iso), zone) }.getOrElse { today }
  val daysAgo = max(0, java.time.temporal.ChronoUnit.DAYS.between(target, today).toInt())
  return when {
    daysAgo == 0 -> "today"
    daysAgo == 1 -> "1d ago"
    daysAgo < 30 -> "${daysAgo}d ago"
    daysAgo < 365 -> "${daysAgo / 30}mo ago"
    else -> "${daysAgo / 365}y ago"
  }
}

private fun formatInstant(iso: String, formatter: DateTimeFormatter): String =
  runCatching { formatter.withZone(ZoneId.systemDefault()).format(Instant.parse(iso)) }
    .getOrDefault(iso)

fun recordsDiffer(a: LocalNote, b: LocalNote): Boolean {
  val titleDiffers =
    if (a.titleHash != null || b.titleHash != null) {
      a.titleHash != b.titleHash
    } else {
      a.title != b.title
    }
  val bodyDiffers =
    if (a.bodyHash != null || b.bodyHash != null) {
      a.bodyHash != b.bodyHash
    } else {
      a.body != b.body
    }
  return titleDiffers ||
    bodyDiffers ||
    noteNotebookIds(a).sorted() != noteNotebookIds(b).sorted() ||
    (a.notebookId?.trim().takeUnless { it.isNullOrEmpty() }) !=
      (b.notebookId?.trim().takeUnless { it.isNullOrEmpty() }) ||
    a.deletedAt != b.deletedAt ||
    a.trashedAt != b.trashedAt ||
    a.isFavorite != b.isFavorite
}

fun recordsDiffer(a: LocalNotebook, b: LocalNotebook): Boolean {
  val nameDiffers =
    if (a.nameHash != null || b.nameHash != null) {
      a.nameHash != b.nameHash
    } else {
      a.name != b.name
    }
  return nameDiffers || a.deletedAt != b.deletedAt
}
