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

val androidEnvKeys =
  setOf(
    "AUTHOR_API_URL",
    "AUTHOR_SYNC_API_URL",
    "ANDROID_SYNC_API_URL",
    "ANDROID_SYNC_SERVER_URL",
    "NOTES_SYNC_SERVER_URL",
    "authorApiUrl",
    "authorSyncApiUrl",
    "androidSyncApiUrl",
    "androidSyncServerUrl",
    "notesSyncServerUrl",
    "PORT",
    "ANDROID_RELEASE_KEYSTORE_PATH",
    "ANDROID_RELEASE_KEYSTORE_PASSWORD",
    "ANDROID_RELEASE_KEY_ALIAS",
    "ANDROID_RELEASE_KEY_PASSWORD",
    "ANDROID_UPDATE_CHECK_URL",
    "ANDROID_UPDATE_DOWNLOAD_URL",
    "ANDROID_UPDATE_CHECK_INTERVAL_HOURS",
    "ANDROID_UPDATE_STARTUP_DELAY_MINUTES",
  )

fun loadEnvFile(file: java.io.File, allowedKeys: Set<String>): Map<String, String> {
  if (!file.isFile) return emptyMap()
  return file
    .readLines()
    .mapNotNull { line ->
      val trimmed = line.trim()
      if (trimmed.isEmpty() || trimmed.startsWith("#")) return@mapNotNull null
      val normalized = trimmed.removePrefix("export ").trim()
      val separator = normalized.indexOf('=')
      if (separator <= 0) return@mapNotNull null
      val key = normalized.substring(0, separator).trim()
      if (key !in allowedKeys) return@mapNotNull null
      val rawValue = normalized.substring(separator + 1).trim()
      val value = rawValue.removeSurrounding("\"").removeSurrounding("'")
      key to value
    }
    .toMap()
}

val repoRoot = repoRootFrom(rootProject.projectDir)
val rootEnv = loadEnvFile(repoRoot.resolve(".env"), androidEnvKeys)

fun configValue(name: String): String? =
  (findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() }
    ?: System.getenv(name)?.trim()?.takeIf { it.isNotEmpty() }
    ?: rootEnv[name]?.trim()?.takeIf { it.isNotEmpty() }

fun firstConfigValue(vararg names: String): String? = names.firstNotNullOfOrNull { configValue(it) }

fun buildConfigString(value: String): String =
  "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredApiBaseUrl =
  firstConfigValue(
    "AUTHOR_API_URL",
    "AUTHOR_SYNC_API_URL",
    "ANDROID_SYNC_API_URL",
    "ANDROID_SYNC_SERVER_URL",
    "NOTES_SYNC_SERVER_URL",
    "authorApiUrl",
    "authorSyncApiUrl",
    "androidSyncApiUrl",
    "androidSyncServerUrl",
    "notesSyncServerUrl",
  )
val defaultApiBaseUrl = configuredApiBaseUrl ?: "http://10.0.2.2:${configValue("PORT") ?: "5173"}"
val defaultApiBaseUrlSource =
  if (configuredApiBaseUrl != null) "build-time" else "local-emulator-default"
val releaseKeystorePath = configValue("ANDROID_RELEASE_KEYSTORE_PATH")
val releaseKeystorePassword = configValue("ANDROID_RELEASE_KEYSTORE_PASSWORD")
val releaseKeyAlias = configValue("ANDROID_RELEASE_KEY_ALIAS")
val releaseKeyPassword = configValue("ANDROID_RELEASE_KEY_PASSWORD")
val androidUpdateCheckUrl =
  configValue("ANDROID_UPDATE_CHECK_URL")
    ?: "https://api.github.com/repos/ivanarena/author/releases/latest"
val androidUpdateDownloadUrl =
  configValue("ANDROID_UPDATE_DOWNLOAD_URL")
    ?: "https://github.com/ivanarena/author/releases/latest"
val androidUpdateCheckIntervalHours =
  configValue("ANDROID_UPDATE_CHECK_INTERVAL_HOURS")?.toLongOrNull()?.coerceIn(1, 168) ?: 12
val androidUpdateStartupDelayMinutes =
  configValue("ANDROID_UPDATE_STARTUP_DELAY_MINUTES")?.toLongOrNull()?.coerceIn(1, 120) ?: 10
val releaseSigningConfigured =
  listOf(releaseKeystorePath, releaseKeystorePassword, releaseKeyAlias, releaseKeyPassword).all {
    it != null
  }

require(!defaultApiBaseUrl.startsWith("libsql://")) {
  "The Android sync API URL must be the Author HTTP API URL, not TURSO_DATABASE_URL. Use AUTHOR_API_URL or ANDROID_SYNC_API_URL. Keep Turso credentials server-side."
}

require(defaultApiBaseUrl.startsWith("http://") || defaultApiBaseUrl.startsWith("https://")) {
  "The Android sync API URL must start with http:// or https://."
}

val requestedTasks = gradle.startParameter.taskNames.map { it.substringAfterLast(':') }
val releaseBuildRequested =
  requestedTasks.any {
    it.equals("assemble", ignoreCase = true) ||
      it.equals("bundle", ignoreCase = true) ||
      it.contains("Release", ignoreCase = true)
  }

if (releaseBuildRequested) {
  require(configuredApiBaseUrl != null) {
    "Release Android builds require AUTHOR_API_URL or ANDROID_SYNC_API_URL."
  }
  require(defaultApiBaseUrl.startsWith("https://")) {
    "Release Android builds require an https:// Author API URL. Use debug builds for local http:// emulator sync."
  }
}

android {
  namespace = "com.author"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.author"
    minSdk = 26
    targetSdk = 37
    versionCode = 3
    versionName = "1.0.2"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    buildConfigField("String", "DEFAULT_API_BASE_URL", buildConfigString(defaultApiBaseUrl))
    buildConfigField(
      "String",
      "DEFAULT_API_BASE_URL_SOURCE",
      buildConfigString(defaultApiBaseUrlSource),
    )
    buildConfigField(
      "boolean",
      "DEFAULT_API_BASE_URL_CONFIGURED",
      (configuredApiBaseUrl != null).toString(),
    )
    buildConfigField("String", "UPDATE_CHECK_URL", buildConfigString(androidUpdateCheckUrl))
    buildConfigField("String", "UPDATE_DOWNLOAD_URL", buildConfigString(androidUpdateDownloadUrl))
    buildConfigField("long", "UPDATE_CHECK_INTERVAL_HOURS", "${androidUpdateCheckIntervalHours}L")
    buildConfigField("long", "UPDATE_STARTUP_DELAY_MINUTES", "${androidUpdateStartupDelayMinutes}L")
    manifestPlaceholders["usesCleartextTraffic"] = "false"
  }

  signingConfigs {
    if (releaseSigningConfigured) {
      create("release") {
        storeFile = file(releaseKeystorePath!!)
        storePassword = releaseKeystorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
      }
    }
  }

  buildTypes {
    debug { manifestPlaceholders["usesCleartextTraffic"] = "true" }
    release {
      manifestPlaceholders["usesCleartextTraffic"] = "false"
      if (releaseSigningConfigured) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  buildFeatures { buildConfig = true }

  compileOptions { isCoreLibraryDesugaringEnabled = true }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2026.04.01")
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.activity:activity-compose:1.13.0")
  implementation("androidx.core:core-ktx:1.18.0")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.work:work-runtime-ktx:2.11.2")
  implementation("com.google.zxing:core:3.5.3")

  coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.json:json:20251224")

  androidTestImplementation("androidx.test:core:1.7.0")
  androidTestImplementation("androidx.test:runner:1.7.0")
  androidTestImplementation("androidx.test.ext:junit:1.3.0")

  debugImplementation("androidx.compose.ui:ui-tooling")
}
