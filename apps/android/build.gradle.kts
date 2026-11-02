plugins {
  id("com.android.application") version "9.5.0" apply false
  id("com.diffplug.spotless") version "8.10.4"
  id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}

spotless {
  kotlin {
    target("app/src/**/*.kt")
    ktfmt().googleStyle()
    trimTrailingWhitespace()
    endWithNewline()
  }

  kotlinGradle {
    target("*.gradle.kts", "app/*.gradle.kts")
    ktfmt().googleStyle()
    trimTrailingWhitespace()
    endWithNewline()
  }
}
