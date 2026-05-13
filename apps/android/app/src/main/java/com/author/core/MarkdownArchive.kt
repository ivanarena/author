package com.author.core

import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

data class MarkdownInputFile(
  val name: String,
  val path: String,
  val text: String
)

data class ParsedImportNotebook(
  val name: String,
  val createdAt: String?,
  val updatedAt: String?
)

data class ParsedImportNote(
  val title: String,
  val body: String,
  val sourceNotebookNames: List<String>,
  val createdAt: String?,
  val updatedAt: String?,
  val trashedAt: String?
)

data class ParsedImportPayload(
  val notebooks: List<ParsedImportNotebook>,
  val notes: List<ParsedImportNote>
)

data class ImportNotesResult(
  val importedNotes: Int,
  val importedNotebooks: Int,
  val reusedNotebooks: Int,
  val skippedNotes: Int,
  val noteIds: List<String>
) {
  fun summary(): String {
    val noteText = "$importedNotes ${if (importedNotes == 1) "note" else "notes"}"
    val notebookText = if (importedNotebooks > 0) {
      ", $importedNotebooks new ${if (importedNotebooks == 1) "notebook" else "notebooks"}"
    } else {
      ""
    }
    val skippedText = if (skippedNotes > 0) ", $skippedNotes blank skipped" else ""
    return "Imported $noteText$notebookText$skippedText"
  }
}

private val markdownExtension = Regex("\\.md$", RegexOption.IGNORE_CASE)
private const val delimiter = "---"

fun parseNotesMarkdownImportFiles(files: List<MarkdownInputFile>): ParsedImportPayload {
  val markdownFiles = files.filter { markdownExtension.containsMatchIn(it.name) }
  val strippedPaths = stripCommonLeadingDirectories(
    markdownFiles.map { (it.path.ifBlank { it.name }).replace('\\', '/') }
  )
  val notebookNames = strippedPaths.flatMap { parentSegments(it) }.distinct()
  val notes = markdownFiles.mapIndexed { index, file ->
    val path = strippedPaths.getOrElse(index) { file.name }
    val parsed = parseMarkdownNote(file.text, file.name)
    parsed.copy(sourceNotebookNames = parentSegments(path))
  }
  return ParsedImportPayload(
    notebooks = notebookNames.map { ParsedImportNotebook(it, null, null) },
    notes = notes
  )
}

fun parseMarkdownNote(content: String, fallbackFileName: String): ParsedImportNote {
  val (frontmatter, body) = splitFrontmatter(content)
  val title = frontmatter["title"]?.takeIf { it.isNotBlank() }
    ?: deriveTitle(body).ifBlank { titleFromFileName(fallbackFileName) }
  return ParsedImportNote(
    title = title,
    body = stripGeneratedHeading(body, title),
    sourceNotebookNames = emptyList(),
    createdAt = parseMarkdownDate(frontmatter["created_at"]),
    updatedAt = parseMarkdownDate(frontmatter["updated_at"]),
    trashedAt = null
  )
}

fun buildMarkdownZip(
  notes: List<LocalNote>,
  notebooks: List<LocalNotebook>
): Pair<String, ByteArray> {
  val exportedAt = nowIso()
  val rootName = "author-${exportedAt.take(10)}-md-frontmatter"
  val activeNotebooks = notebooks.filter { it.deletedAt == null }.associateBy { it.id }
  val usedPaths = mutableSetOf<String>()
  val output = ByteArrayOutputStream()
  ZipOutputStream(output, Charsets.UTF_8).use { zip ->
    notes.filter { it.deletedAt == null }
      .sortedByDescending { it.updatedAt }
      .forEach { note ->
        val title = noteDisplayTitle(note)
        val notebookName = noteNotebookIds(note).firstNotNullOfOrNull { activeNotebooks[it]?.name }
        val relativePath = uniquePath(
          listOfNotNull(notebookName?.let { safePathSegment(it) }, "${safePathSegment(title)}.md").joinToString("/"),
          usedPaths
        )
        zip.putNextEntry(ZipEntry("$rootName/$relativePath"))
        zip.write(markdownNoteContent(note, title).toByteArray(Charsets.UTF_8))
        zip.closeEntry()
      }
  }
  return "$rootName.zip" to output.toByteArray()
}

fun markdownNoteContent(note: LocalNote, title: String): String {
  val body = bodyWithHeading(note.body, title)
  return listOf(
    delimiter,
    "title: \"${escapeYamlString(title)}\"",
    "created_at: ${formatMarkdownDate(note.createdAt)}",
    "updated_at: ${formatMarkdownDate(note.updatedAt)}",
    "tags: ",
    delimiter,
    "",
    body.trimEnd(),
    ""
  ).joinToString("\n")
}

fun formatMarkdownDate(value: String): String = runCatching {
  val instant = Instant.parse(value)
  val date = java.time.LocalDateTime.ofInstant(instant, ZoneId.systemDefault())
  val suffix = if (date.hour >= 12) "PM" else "AM"
  val hour12 = date.hour % 12
  "%02d-%02d-%04d %02d:%02d %s".format(
    Locale.US,
    date.dayOfMonth,
    date.monthValue,
    date.year,
    if (hour12 == 0) 12 else hour12,
    date.minute,
    suffix
  )
}.getOrDefault("")

private fun splitFrontmatter(content: String): Pair<Map<String, String>, String> {
  val normalized = content.replace("\r\n", "\n")
  if (!normalized.startsWith("$delimiter\n")) return emptyMap<String, String>() to normalized
  val closing = normalized.indexOf("\n$delimiter\n", delimiter.length + 1)
  if (closing == -1) return emptyMap<String, String>() to normalized
  val raw = normalized.substring(delimiter.length + 1, closing)
  val body = normalized.substring(closing + delimiter.length + 2)
  return parseSimpleYaml(raw) to body
}

private fun parseSimpleYaml(source: String): Map<String, String> = source.lineSequence().mapNotNull { line ->
  val match = Regex("^([A-Za-z0-9_-]+):\\s*(.*)$").find(line) ?: return@mapNotNull null
  match.groupValues[1] to unquoteYamlString(match.groupValues[2].trim())
}.toMap()

private fun unquoteYamlString(value: String): String {
  if (value.length < 2) return value
  val quote = value.first()
  if ((quote != '"' && quote != '\'') || value.last() != quote) return value
  val inner = value.substring(1, value.length - 1)
  return if (quote == '"') inner.replace("\\\"", "\"").replace("\\\\", "\\") else inner.replace("''", "'")
}

private fun parseMarkdownDate(value: String?): String? {
  if (value.isNullOrBlank()) return null
  val match = Regex("^(\\d{1,2})-(\\d{1,2})-(\\d{4})\\s+(\\d{1,2}):(\\d{2})\\s*(AM|PM)$", RegexOption.IGNORE_CASE)
    .find(value.trim())
  if (match != null) {
    val day = match.groupValues[1]
    val month = match.groupValues[2]
    val year = match.groupValues[3]
    val hour = match.groupValues[4]
    val minute = match.groupValues[5]
    val suffix = match.groupValues[6]
    var hour24 = hour.toInt() % 12
    if (suffix.uppercase(Locale.US) == "PM") hour24 += 12
    return runCatching {
      java.time.LocalDateTime.of(year.toInt(), month.toInt(), day.toInt(), hour24, minute.toInt())
        .atZone(ZoneId.systemDefault())
        .toInstant()
        .toString()
    }.getOrNull()
  }
  return runCatching { Instant.parse(value.trim()).toString() }.getOrNull()
    ?: runCatching {
      Instant.from(DateTimeFormatter.ISO_DATE_TIME.parse(value.trim())).toString()
    }.getOrNull()
}

private fun stripGeneratedHeading(body: String, title: String): String {
  val escaped = Regex.escape(title.trim())
  if (escaped.isEmpty()) return body.trim()
  return body.replace(Regex("^\\s*#\\s+$escaped\\s*\\n+", RegexOption.IGNORE_CASE), "").trim()
}

private fun bodyWithHeading(body: String, title: String): String {
  val trimmed = body.trim()
  if (title.isBlank()) return trimmed
  if (Regex("^#\\s+${Regex.escape(title.trim())}\\s*(?:\\n|$)", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
    return trimmed
  }
  return if (trimmed.isBlank()) "# $title" else "# $title\n\n$trimmed"
}

private fun stripCommonLeadingDirectories(paths: List<String>): List<String> {
  if (paths.isEmpty()) return emptyList()
  val splitPaths = paths.map { it.split('/').filter(String::isNotBlank) }
  val maxCommon = (splitPaths.minOf { it.size } - 1).coerceAtLeast(0)
  var common = 0
  while (common < maxCommon && splitPaths.all { it[common] == splitPaths[0][common] }) common += 1
  val commonDirs = splitPaths[0].take(common)
  val archiveRootIndex = commonDirs.indexOfLast { isArchiveRootName(it) }
  val stripCount = if (archiveRootIndex >= 0) archiveRootIndex + 1 else minOf(common, 1)
  return if (stripCount == 0) paths else splitPaths.map { it.drop(stripCount).joinToString("/") }
}

private fun parentSegments(path: String): List<String> = path.split('/').filter(String::isNotBlank).dropLast(1)

private fun titleFromFileName(fileName: String): String = fileName.replace(markdownExtension, "").replace('-', ' ').trim().ifBlank { "Untitled" }

private fun safePathSegment(value: String): String = value.trim().ifBlank { "Untitled" }
  .replace(Regex("""[\\/:*?"<>|]"""), "-")
  .replace(Regex("\\s+"), "-")
  .replace(Regex("^\\.+|\\.+$"), "")
  .replace(Regex("^-+|-+$"), "")
  .ifBlank { "Untitled" }

private fun isArchiveRootName(value: String): Boolean = value.startsWith("nn-export") ||
  Regex("^author-\\d{4}-\\d{2}-\\d{2}-md-frontmatter$").matches(value)

private fun uniquePath(path: String, usedPaths: MutableSet<String>): String {
  if (usedPaths.add(path)) return path
  val extensionIndex = path.lastIndexOf('.')
  val stem = if (extensionIndex == -1) path else path.substring(0, extensionIndex)
  val extension = if (extensionIndex == -1) "" else path.substring(extensionIndex)
  var counter = 2
  var candidate = "$stem-$counter$extension"
  while (!usedPaths.add(candidate)) {
    counter += 1
    candidate = "$stem-$counter$extension"
  }
  return candidate
}

private fun escapeYamlString(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"")
