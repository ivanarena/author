plugins {
  id("com.android.application") version "9.2.1" apply false
  id("com.diffplug.spotless") version "8.4.0"
  id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
}

spotless {
  val ktlintEditorConfig = mapOf(
    "indent_size" to "2",
    "continuation_indent_size" to "2",
    "ktlint_code_style" to "android_studio",
    "ktlint_standard_max-line-length" to "disabled",
    "ktlint_standard_function-naming" to "disabled",
    "ktlint_standard_property-naming" to "disabled"
  )

  kotlin {
    target("app/src/**/*.kt")
    ktlint("1.7.1").editorConfigOverride(ktlintEditorConfig)
    trimTrailingWhitespace()
    endWithNewline()
  }

  kotlinGradle {
    target("*.gradle.kts", "app/*.gradle.kts")
    ktlint("1.7.1").editorConfigOverride(ktlintEditorConfig)
    trimTrailingWhitespace()
    endWithNewline()
  }
}
