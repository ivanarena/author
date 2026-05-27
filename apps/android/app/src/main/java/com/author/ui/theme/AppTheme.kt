package com.author.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.author.R

internal object AppMotion {
  const val Fast = 360
  const val Medium = 560
  const val Slow = 760
  val Smooth = CubicBezierEasing(0.2f, 0f, 0f, 1f)
}

internal fun <T> appTween(durationMillis: Int): TweenSpec<T> =
  tween(durationMillis = durationMillis, easing = AppMotion.Smooth)

internal val AppFontFamily =
  FontFamily(
    Font(R.font.kedebideri_regular, FontWeight.Normal),
    Font(R.font.kedebideri_medium, FontWeight.Medium),
    Font(R.font.kedebideri_semibold, FontWeight.SemiBold),
    Font(R.font.kedebideri_bold, FontWeight.Bold),
  )

internal val LocalAppFontFamily = staticCompositionLocalOf { AppFontFamily }

internal data class FontChoice(val value: String, val label: String)

internal val FontChoices =
  listOf(
    FontChoice("kedebideri", "Kedebideri"),
    FontChoice("system-sans", "System Sans"),
    FontChoice("system-serif", "System Serif"),
    FontChoice("mono", "Mono"),
  )

internal data class ThemeChoice(val value: String, val label: String)

internal val ThemeChoices =
  listOf(
    ThemeChoice("system", "Auto"),
    ThemeChoice("light", "Light"),
    ThemeChoice("light-mint", "Light mint"),
    ThemeChoice("light-rose", "Light rose"),
    ThemeChoice("light-lavender", "Light lavender"),
    ThemeChoice("dark", "Dark"),
    ThemeChoice("dark-mint", "Dark mint"),
    ThemeChoice("dark-rose", "Dark rose"),
    ThemeChoice("dark-lavender", "Dark lavender"),
  )

private val BaseTypography = Typography()

private fun typography(fontFamily: FontFamily) =
  Typography(
    displayLarge = BaseTypography.displayLarge.copy(fontFamily = fontFamily),
    displayMedium = BaseTypography.displayMedium.copy(fontFamily = fontFamily),
    displaySmall = BaseTypography.displaySmall.copy(fontFamily = fontFamily),
    headlineLarge = BaseTypography.headlineLarge.copy(fontFamily = fontFamily),
    headlineMedium = BaseTypography.headlineMedium.copy(fontFamily = fontFamily),
    headlineSmall = BaseTypography.headlineSmall.copy(fontFamily = fontFamily),
    titleLarge =
      BaseTypography.titleLarge.copy(
        fontFamily = fontFamily,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        fontWeight = FontWeight.SemiBold,
      ),
    titleMedium =
      BaseTypography.titleMedium.copy(
        fontFamily = fontFamily,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
      ),
    titleSmall =
      BaseTypography.titleSmall.copy(
        fontFamily = fontFamily,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.SemiBold,
      ),
    bodyLarge = BaseTypography.bodyLarge.copy(fontFamily = fontFamily, fontSize = 16.sp),
    bodyMedium = BaseTypography.bodyMedium.copy(fontFamily = fontFamily, fontSize = 14.sp),
    bodySmall = BaseTypography.bodySmall.copy(fontFamily = fontFamily, fontSize = 12.sp),
    labelLarge =
      BaseTypography.labelLarge.copy(
        fontFamily = fontFamily,
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
      ),
    labelMedium =
      BaseTypography.labelMedium.copy(
        fontFamily = fontFamily,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
      ),
    labelSmall = BaseTypography.labelSmall.copy(fontFamily = fontFamily, fontSize = 11.sp),
  )

private fun fontFamily(font: String): FontFamily =
  when (font) {
    "system-sans" -> FontFamily.SansSerif
    "system-serif" -> FontFamily.Serif
    "mono" -> FontFamily.Monospace
    else -> AppFontFamily
  }

internal fun resolveThemeChoice(theme: String, systemDark: Boolean): String =
  if (theme == "system") {
    if (systemDark) "dark" else "light"
  } else {
    theme
  }

internal fun themeChoiceLabel(theme: String): String =
  ThemeChoices.find { it.value == theme }?.label ?: theme

@Composable
internal fun AuthorTheme(theme: String, font: String, content: @Composable () -> Unit) {
  val resolvedTheme = resolveThemeChoice(theme, isSystemInDarkTheme())
  val colors =
    if (resolvedTheme.startsWith("dark")) {
      darkColorScheme(
        primary =
          when (resolvedTheme) {
            "dark-mint" -> Color(0xFFA7D7B4)
            "dark-rose" -> Color(0xFFE7B1BC)
            "dark-lavender" -> Color(0xFFC8BEEF)
            else -> Color(0xFFF4F4F2)
          },
        onPrimary = Color(0xFF121212),
        primaryContainer = Color(0xFF303030),
        onPrimaryContainer = Color(0xFFF4F4F2),
        secondary = Color(0xFFBDBDB8),
        tertiary = Color(0xFFD0D0CB),
        outline = Color(0xFF4A4A4A),
        outlineVariant = Color(0xFF33363A),
        background =
          when (resolvedTheme) {
            "dark-mint" -> Color(0xFF111512)
            "dark-rose" -> Color(0xFF171213)
            "dark-lavender" -> Color(0xFF14131A)
            else -> Color(0xFF111111)
          },
        surface =
          when (resolvedTheme) {
            "dark-mint" -> Color(0xFF121814)
            "dark-rose" -> Color(0xFF1A1415)
            "dark-lavender" -> Color(0xFF171620)
            else -> Color(0xFF151515)
          },
        surfaceVariant =
          when (resolvedTheme) {
            "dark-mint" -> Color(0xFF141D17)
            "dark-rose" -> Color(0xFF211719)
            "dark-lavender" -> Color(0xFF1C1A28)
            else -> Color(0xFF202124)
          },
        onSurface = Color(0xFFF2F2F2),
        onSurfaceVariant = Color(0xFFC7C7C2),
      )
    } else {
      lightColorScheme(
        primary =
          when (resolvedTheme) {
            "light-mint" -> Color(0xFF527E5F)
            "light-rose" -> Color(0xFF985966)
            "light-lavender" -> Color(0xFF655B91)
            else -> Color(0xFF202020)
          },
        onPrimary = Color.White,
        primaryContainer =
          when (resolvedTheme) {
            "light-mint" -> Color(0xFFE3F0E6)
            "light-rose" -> Color(0xFFF6E4E8)
            "light-lavender" -> Color(0xFFECE8FA)
            else -> Color(0xFFE9E9E6)
          },
        onPrimaryContainer = Color(0xFF202020),
        secondary = Color(0xFF5F625E),
        tertiary = Color(0xFF4F4F4C),
        outline = Color(0xFFD9DAD7),
        outlineVariant = Color(0xFFE7E8E4),
        background =
          when (resolvedTheme) {
            "light-mint" -> Color(0xFFFBFDFB)
            "light-rose" -> Color(0xFFFFFAFA)
            "light-lavender" -> Color(0xFFFCFBFF)
            else -> Color(0xFFFCFCFA)
          },
        surface = Color.White,
        surfaceVariant =
          when (resolvedTheme) {
            "light-mint" -> Color(0xFFF6FBF7)
            "light-rose" -> Color(0xFFFFF6F7)
            "light-lavender" -> Color(0xFFF8F6FF)
            else -> Color(0xFFF1F2EE)
          },
        onSurface = Color(0xFF202020),
        onSurfaceVariant = Color(0xFF5E625C),
      )
    }

  val family = fontFamily(font)
  CompositionLocalProvider(LocalAppFontFamily provides family) {
    MaterialTheme(colorScheme = colors, typography = typography(family), content = content)
  }
}
