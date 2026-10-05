plugins {
  id("com.android.application") version "9.4.1" apply false
  id("com.diffplug.spotless") version "8.10.3"
  id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
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
