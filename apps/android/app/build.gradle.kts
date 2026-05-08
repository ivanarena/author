plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

fun repoRootFrom(start: java.io.File): java.io.File {
  var current: java.io.File? = start
  while (current != null) {
    if (current.resolve("aube-workspace.yaml").isFile) return current
    current = current.parentFile
  }
  return start
}

fun loadEnvFile(file: java.io.File): Map<String, String> {
  if (!file.isFile) return emptyMap()
  return file.readLines().mapNotNull { line ->
    val trimmed = line.trim()
    if (trimmed.isEmpty() || trimmed.startsWith("#")) return@mapNotNull null
    val normalized = trimmed.removePrefix("export ").trim()
    val separator = normalized.indexOf('=')
    if (separator <= 0) return@mapNotNull null
    val key = normalized.substring(0, separator).trim()
    val rawValue = normalized.substring(separator + 1).trim()
    val value = rawValue
      .removeSurrounding("\"")
      .removeSurrounding("'")
    key to value
  }.toMap()
}

val repoRoot = repoRootFrom(rootProject.projectDir)
val rootEnv = loadEnvFile(repoRoot.resolve(".env"))

fun configValue(name: String): String? =
  (findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() }
    ?: System.getenv(name)?.trim()?.takeIf { it.isNotEmpty() }
    ?: rootEnv[name]?.trim()?.takeIf { it.isNotEmpty() }

fun firstConfigValue(vararg names: String): String? =
  names.firstNotNullOfOrNull { configValue(it) }

fun buildConfigString(value: String): String =
  "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredApiBaseUrl = firstConfigValue(
  "AUTHOR_NOTES_API_URL",
  "AUTHOR_NOTES_SYNC_API_URL",
  "ANDROID_SYNC_API_URL",
  "ANDROID_SYNC_SERVER_URL",
  "NOTES_SYNC_SERVER_URL",
  "authorNotesApiUrl",
  "authorNotesSyncApiUrl",
  "androidSyncApiUrl",
  "androidSyncServerUrl",
  "notesSyncServerUrl"
)
val defaultApiBaseUrl = configuredApiBaseUrl
  ?: "http://10.0.2.2:${configValue("PORT") ?: "5173"}"
val defaultApiBaseUrlSource = if (configuredApiBaseUrl != null) "build-time" else "local-emulator-default"
val remoteDatabaseConfigured = configValue("TURSO_DATABASE_URL") != null && configValue("TURSO_AUTH_TOKEN") != null

if (configuredApiBaseUrl == null && remoteDatabaseConfigured) {
  logger.warn("Turso is configured, but Android sync API URL is not. Using the local emulator URL; set AUTHOR_NOTES_API_URL or ANDROID_SYNC_API_URL for device/release builds.")
}

require(!defaultApiBaseUrl.startsWith("libsql://")) {
  "The Android sync API URL must be the Author HTTP API URL, not TURSO_DATABASE_URL. Use AUTHOR_NOTES_API_URL or ANDROID_SYNC_API_URL. Keep Turso credentials server-side."
}

require(defaultApiBaseUrl.startsWith("http://") || defaultApiBaseUrl.startsWith("https://")) {
  "The Android sync API URL must start with http:// or https://."
}

val requestedTasks = gradle.startParameter.taskNames.map { it.substringAfterLast(':') }
val releaseBuildRequested = requestedTasks.any {
  it.equals("assemble", ignoreCase = true) ||
    it.equals("bundle", ignoreCase = true) ||
    it.contains("Release", ignoreCase = true)
}
if (releaseBuildRequested) {
  require(configuredApiBaseUrl != null) {
    "Release Android builds require AUTHOR_NOTES_API_URL or ANDROID_SYNC_API_URL."
  }
  require(defaultApiBaseUrl.startsWith("https://")) {
    "Release Android builds require an https:// Author API URL. Use debug builds for local http:// emulator sync."
  }
}

android {
  namespace = "com.author.notes"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.author.notes"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "1.0"

    buildConfigField("String", "DEFAULT_API_BASE_URL", buildConfigString(defaultApiBaseUrl))
    buildConfigField("String", "DEFAULT_API_BASE_URL_SOURCE", buildConfigString(defaultApiBaseUrlSource))
    buildConfigField("boolean", "DEFAULT_API_BASE_URL_CONFIGURED", (configuredApiBaseUrl != null).toString())
    manifestPlaceholders["usesCleartextTraffic"] = "false"
  }

  buildTypes {
    debug {
      manifestPlaceholders["usesCleartextTraffic"] = "true"
    }
    release {
      manifestPlaceholders["usesCleartextTraffic"] = "false"
    }
  }

  buildFeatures {
    buildConfig = true
  }

  compileOptions {
    isCoreLibraryDesugaringEnabled = true
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2026.04.01")
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.activity:activity-compose:1.13.0")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.work:work-runtime-ktx:2.11.2")

  coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")

  testImplementation("junit:junit:4.13.2")

  debugImplementation("androidx.compose.ui:ui-tooling")
}
