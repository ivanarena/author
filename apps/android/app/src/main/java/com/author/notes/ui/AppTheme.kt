package com.author.notes.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.author.notes.R

internal val AppFontFamily = FontFamily(
  Font(R.font.kedebideri_regular, FontWeight.Normal),
  Font(R.font.kedebideri_medium, FontWeight.Medium),
  Font(R.font.kedebideri_semibold, FontWeight.SemiBold),
  Font(R.font.kedebideri_bold, FontWeight.Bold)
)

private val BaseTypography = Typography()

private val AppTypography = Typography(
  displayLarge = BaseTypography.displayLarge.copy(fontFamily = AppFontFamily),
  displayMedium = BaseTypography.displayMedium.copy(fontFamily = AppFontFamily),
  displaySmall = BaseTypography.displaySmall.copy(fontFamily = AppFontFamily),
  headlineLarge = BaseTypography.headlineLarge.copy(fontFamily = AppFontFamily),
  headlineMedium = BaseTypography.headlineMedium.copy(fontFamily = AppFontFamily),
  headlineSmall = BaseTypography.headlineSmall.copy(fontFamily = AppFontFamily),
  titleLarge = BaseTypography.titleLarge.copy(fontFamily = AppFontFamily),
  titleMedium = BaseTypography.titleMedium.copy(fontFamily = AppFontFamily),
  titleSmall = BaseTypography.titleSmall.copy(fontFamily = AppFontFamily),
  bodyLarge = BaseTypography.bodyLarge.copy(fontFamily = AppFontFamily),
  bodyMedium = BaseTypography.bodyMedium.copy(fontFamily = AppFontFamily),
  bodySmall = BaseTypography.bodySmall.copy(fontFamily = AppFontFamily),
  labelLarge = BaseTypography.labelLarge.copy(fontFamily = AppFontFamily),
  labelMedium = BaseTypography.labelMedium.copy(fontFamily = AppFontFamily),
  labelSmall = BaseTypography.labelSmall.copy(fontFamily = AppFontFamily)
)

@Composable
internal fun AuthorTheme(
  dark: Boolean,
  content: @Composable () -> Unit
) {
  val colors = if (dark) {
    darkColorScheme(
      primary = Color(0xFFF4F4F2),
      onPrimary = Color(0xFF121212),
      primaryContainer = Color(0xFF303030),
      onPrimaryContainer = Color(0xFFF4F4F2),
      secondary = Color(0xFFBDBDB8),
      tertiary = Color(0xFFD0D0CB),
      outline = Color(0xFF4A4A4A),
      outlineVariant = Color(0xFF33363A),
      background = Color(0xFF111111),
      surface = Color(0xFF151515),
      surfaceVariant = Color(0xFF202124),
      onSurface = Color(0xFFF2F2F2),
      onSurfaceVariant = Color(0xFFC7C7C2)
    )
  } else {
    lightColorScheme(
      primary = Color(0xFF202020),
      onPrimary = Color.White,
      primaryContainer = Color(0xFFE9E9E6),
      onPrimaryContainer = Color(0xFF202020),
      secondary = Color(0xFF5F625E),
      tertiary = Color(0xFF4F4F4C),
      outline = Color(0xFFD9DAD7),
      outlineVariant = Color(0xFFE7E8E4),
      background = Color(0xFFFCFCFA),
      surface = Color.White,
      surfaceVariant = Color(0xFFF1F2EE),
      onSurface = Color(0xFF202020),
      onSurfaceVariant = Color(0xFF5E625C)
    )
  }

  MaterialTheme(colorScheme = colors, typography = AppTypography, content = content)
}
