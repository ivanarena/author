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
      "unfiled" -> ids.isEmpty()
      else -> ids.contains(filterId)
    }
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
  if (sort != "date-desc") return listOf((if (sort == "az") "A-Z" else "Z-A") to items)
  return items.groupBy { dateRangeLabel(it.updatedAt, now) }.map { it.key to it.value }
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
    a.trashedAt != b.trashedAt
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
