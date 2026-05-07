plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
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

    buildConfigField("String", "DEFAULT_API_BASE_URL", "\"http://10.0.2.2:5173\"")
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

  debugImplementation("androidx.compose.ui:ui-tooling")
}
