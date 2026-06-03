package com.author.ui.common

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.author.ui.theme.*

internal object AppTextSize {
  val Debug = 11.sp
  val Label = 12.sp
  val Body = 14.sp
  val Title = 18.sp
}

@Composable
internal fun PageHeader(
  leading: @Composable RowScope.() -> Unit = {},
  actions: @Composable RowScope.() -> Unit = {},
) {
  val compactScreen = isCompactWindow()
  Column {
    Surface(color = toolbarColor()) {
      Row(
        Modifier.fillMaxWidth()
          .heightIn(min = if (compactScreen) 56.dp else 64.dp)
          .padding(horizontal = pageHorizontalPadding(), vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        leading()
        Spacer(Modifier.weight(1f))
        actions()
      }
    }
    AppHorizontalDivider()
  }
}

@Composable
internal fun isCompactWindow(): Boolean {
  val width = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
  return width < 720.dp
}

@Composable internal fun pageHorizontalPadding(): Dp = if (isCompactWindow()) 20.dp else 32.dp

@Composable
internal fun panelColor(active: Boolean = false): Color {
  return when {
    active -> MaterialTheme.colorScheme.primaryContainer
    else -> MaterialTheme.colorScheme.surface
  }
}

@Composable
internal fun rowColor(active: Boolean = false): Color =
  if (active) panelColor(active = true) else MaterialTheme.colorScheme.surfaceVariant

@Composable
internal fun contrastControlColor(active: Boolean = false, enabled: Boolean = true): Color =
  if (!enabled) rowColor()
  else if (active) MaterialTheme.colorScheme.primaryContainer
  else MaterialTheme.colorScheme.surfaceVariant

@Composable
internal fun contrastControlContentColor(active: Boolean = false, enabled: Boolean = true): Color =
  if (!enabled) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.34f)
  else if (active) MaterialTheme.colorScheme.onPrimaryContainer
  else MaterialTheme.colorScheme.onSurface

@Composable internal fun appDividerColor(): Color = MaterialTheme.colorScheme.outlineVariant

@Composable
internal fun AppHorizontalDivider(
  modifier: Modifier = Modifier,
  startIndent: Dp = 0.dp,
  endIndent: Dp = 0.dp,
) {
  HorizontalDivider(
    modifier = modifier.padding(start = startIndent, end = endIndent),
    color = appDividerColor(),
    thickness = 1.dp,
  )
}

@Composable internal fun dialogContainerColor(): Color = MaterialTheme.colorScheme.surfaceVariant

internal fun appDialogShape(): RoundedCornerShape = RoundedCornerShape(32.dp)

@Composable
internal fun AppModal(
  onDismissRequest: () -> Unit,
  modifier: Modifier = Modifier,
  maxWidth: Dp = 430.dp,
  contentPadding: PaddingValues = PaddingValues(horizontal = 28.dp, vertical = 26.dp),
  dismissOnBackPress: Boolean = true,
  dismissOnClickOutside: Boolean = true,
  content: @Composable ColumnScope.() -> Unit,
) {
  val compactWindow = isCompactWindow()
  Dialog(
    onDismissRequest = onDismissRequest,
    properties =
      DialogProperties(
        dismissOnBackPress = dismissOnBackPress,
        dismissOnClickOutside = dismissOnClickOutside,
        usePlatformDefaultWidth = false,
      ),
  ) {
    Surface(
      modifier =
        modifier
          .padding(horizontal = if (compactWindow) 24.dp else 32.dp)
          .widthIn(max = maxWidth)
          .fillMaxWidth()
          .offset(y = if (compactWindow) (-16).dp else 0.dp),
      shape = appDialogShape(),
      color = dialogContainerColor(),
      tonalElevation = 0.dp,
      shadowElevation = 24.dp,
    ) {
      Column(
        Modifier.fillMaxWidth().padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
      )
    }
  }
}

@Composable
internal fun AppModalTitle(
  title: String,
  onDismiss: (() -> Unit)? = null,
  dismissEnabled: Boolean = true,
) {
  Row(
    Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Text(
      title,
      modifier = Modifier.weight(1f),
      color = MaterialTheme.colorScheme.onSurface,
      fontSize = AppTextSize.Title,
      fontWeight = FontWeight.ExtraBold,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    if (onDismiss != null) {
      IconButton(onClick = onDismiss, enabled = dismissEnabled, modifier = Modifier.size(42.dp)) {
        Icon(
          Icons.Outlined.Close,
          "Close",
          modifier = Modifier.size(22.dp),
          tint =
            MaterialTheme.colorScheme.onSurface.copy(alpha = if (dismissEnabled) 0.76f else 0.32f),
        )
      }
    }
  }
}

@Composable
internal fun MaterialIconTile(
  icon: ImageVector,
  contentDescription: String?,
  modifier: Modifier = Modifier,
  tint: Color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
  active: Boolean = false,
  destructive: Boolean = false,
  size: Dp = 36.dp,
  iconSize: Dp = 19.dp,
) {
  val background =
    when {
      destructive -> MaterialTheme.colorScheme.errorContainer
      active -> MaterialTheme.colorScheme.primaryContainer
      else -> MaterialTheme.colorScheme.surfaceVariant
    }
  Surface(modifier = modifier.size(size), shape = RoundedCornerShape(16.dp), color = background) {
    Box(contentAlignment = Alignment.Center) {
      Icon(icon, contentDescription, modifier = Modifier.size(iconSize), tint = tint)
    }
  }
}

@Composable
internal fun NavRow(
  icon: ImageVector,
  label: String,
  count: String,
  active: Boolean,
  trailing: @Composable (() -> Unit)? = null,
  onLongClick: (() -> Unit)? = null,
  onClick: () -> Unit,
) {
  val contentColor =
    if (active) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f)
  Surface(
    modifier =
      Modifier.fillMaxWidth()
        .clip(RoundedCornerShape(12.dp))
        .animateContentSize(appTween(AppMotion.Medium))
        .navRowClick(onClick, onLongClick),
    color = if (active) rowColor(active = true) else Color.Transparent,
    shape = RoundedCornerShape(12.dp),
  ) {
    Row(
      Modifier.heightIn(min = 50.dp).padding(horizontal = 8.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      MaterialIconTile(
        icon,
        null,
        tint = contentColor,
        active = active,
        size = 32.dp,
        iconSize = 17.dp,
      )
      Spacer(Modifier.width(10.dp))
      Text(
        label,
        modifier = Modifier.weight(1f),
        color = contentColor,
        fontSize = AppTextSize.Body,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Box(Modifier.width(36.dp), contentAlignment = Alignment.CenterEnd) {
        Text(
          count,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
          maxLines = 1,
        )
      }
      if (trailing != null) {
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { trailing() }
      }
    }
  }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.navRowClick(onClick: () -> Unit, onLongClick: (() -> Unit)?): Modifier =
  if (onLongClick == null) clickable(onClick = onClick)
  else combinedClickable(onClick = onClick, onLongClick = onLongClick)

@Composable
internal fun DropdownSectionLabel(label: String) {
  Text(
    label,
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
    fontSize = AppTextSize.Label,
    fontWeight = FontWeight.Bold,
    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp),
  )
}

@Composable
internal fun AppDropdownMenuItem(
  label: String,
  onClick: () -> Unit,
  enabled: Boolean = true,
  leadingIcon: @Composable (() -> Unit)? = null,
) {
  DropdownMenuItem(
    text = {
      Text(
        label,
        fontSize = AppTextSize.Body,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    },
    leadingIcon = leadingIcon,
    enabled = enabled,
    onClick = onClick,
  )
}

@Composable
internal fun MenuCheck(visible: Boolean) {
  Icon(
    Icons.Outlined.Check,
    null,
    modifier = Modifier.size(18.dp),
    tint =
      if (visible) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.76f) else Color.Transparent,
  )
}

@Composable
internal fun AppDropdownMenu(
  expanded: Boolean,
  onDismissRequest: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable ColumnScope.() -> Unit,
) {
  DropdownMenu(
    expanded = expanded,
    onDismissRequest = onDismissRequest,
    modifier = modifier.clip(RoundedCornerShape(20.dp)),
    shape = RoundedCornerShape(20.dp),
    containerColor = menuColor(),
    tonalElevation = 0.dp,
    shadowElevation = 12.dp,
    content = content,
  )
}

@Composable
internal fun ActionRow(
  icon: ImageVector,
  label: String,
  enabled: Boolean = true,
  active: Boolean = false,
  destructive: Boolean = false,
  detail: String = "",
  onClick: () -> Unit,
) {
  val rowActive = active && enabled
  val contentAlpha = if (enabled) 0.78f else 0.34f
  val contentColor =
    if (destructive && enabled) MaterialTheme.colorScheme.error
    else MaterialTheme.colorScheme.onSurface.copy(alpha = contentAlpha)
  Surface(
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)),
    color = rowColor(rowActive),
    shape = RoundedCornerShape(22.dp),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = if (rowActive) 0.9f else 0.72f)),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = 56.dp)
        .clickable(enabled = enabled, onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      MaterialIconTile(
        icon,
        null,
        tint = contentColor,
        active = rowActive,
        destructive = destructive,
        size = 36.dp,
        iconSize = 18.dp,
      )
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
          label,
          color =
            if (destructive && enabled) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.38f),
          fontSize = AppTextSize.Body,
          fontWeight = if (rowActive || destructive) FontWeight.SemiBold else FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        if (detail.isNotBlank()) {
          Text(
            detail,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 0.52f else 0.32f),
            fontSize = AppTextSize.Label,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
    }
  }
}

@Composable
internal fun InfoTile(label: String, value: String, detail: String, valueColor: Color? = null) {
  val resolvedValueColor = valueColor ?: MaterialTheme.colorScheme.onSurface
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(
        label,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        value.ifBlank { " " },
        color = resolvedValueColor,
        fontSize = AppTextSize.Body,
        fontWeight = FontWeight.SemiBold,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      if (detail.isNotBlank()) {
        Text(
          detail,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = AppTextSize.Label,
          maxLines = 3,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

@Composable
internal fun MiniField(
  value: String,
  placeholder: String,
  modifier: Modifier = Modifier,
  onChange: (String) -> Unit,
) {
  TextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    modifier = modifier,
    textStyle = TextStyle(fontSize = AppTextSize.Body, fontFamily = LocalAppFontFamily.current),
    shape = RoundedCornerShape(16.dp),
    colors = textFieldColors(),
  )
}

@Composable
internal fun PasswordField(value: String, placeholder: String, onChange: (String) -> Unit) {
  var visible by remember { mutableStateOf(false) }
  TextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    visualTransformation =
      if (visible) VisualTransformation.None else PasswordVisualTransformation(),
    trailingIcon = {
      IconButton(onClick = { visible = !visible }) {
        Icon(
          if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
          if (visible) "Hide password" else "Show password",
          modifier = Modifier.size(18.dp),
          tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.62f),
        )
      }
    },
    modifier = Modifier.fillMaxWidth(),
    textStyle = TextStyle(fontSize = AppTextSize.Body, fontFamily = LocalAppFontFamily.current),
    shape = RoundedCornerShape(16.dp),
    colors = textFieldColors(),
  )
}

@Composable
internal fun textFieldColors() =
  TextFieldDefaults.colors(
    focusedContainerColor = rowColor(),
    unfocusedContainerColor = rowColor(),
    disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
    focusedTextColor = MaterialTheme.colorScheme.onSurface,
    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
    cursorColor = MaterialTheme.colorScheme.onSurface,
    focusedIndicatorColor = MaterialTheme.colorScheme.primary,
    unfocusedIndicatorColor = Color.Transparent,
    disabledIndicatorColor = Color.Transparent,
  )

@Composable
internal fun appCheckboxColors() =
  CheckboxDefaults.colors(
    checkedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.82f),
    uncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
    checkmarkColor = MaterialTheme.colorScheme.background,
    disabledCheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.28f),
    disabledUncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f),
  )

@Composable
internal fun SmallTextButton(
  label: String,
  active: Boolean = false,
  modifier: Modifier = Modifier,
  onClick: () -> Unit,
) {
  TextButton(onClick = onClick, modifier = modifier.clip(RoundedCornerShape(12.dp))) {
    Text(
      label,
      color =
        if (active) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
      fontSize = AppTextSize.Label,
      fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
    )
  }
}

@Composable
internal fun ModalActionButton(
  label: String,
  modifier: Modifier = Modifier,
  primary: Boolean = false,
  destructive: Boolean = false,
  loading: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  val active = (primary || destructive) && enabled
  val contentColor =
    when {
      destructive && enabled -> MaterialTheme.colorScheme.error
      enabled || loading -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.88f)
      else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.36f)
    }
  val background =
    when {
      destructive -> MaterialTheme.colorScheme.errorContainer
      primary -> MaterialTheme.colorScheme.primaryContainer
      else -> Color.Transparent
    }
  Surface(
    modifier =
      modifier
        .fillMaxWidth()
        .heightIn(min = 48.dp)
        .clip(RoundedCornerShape(22.dp))
        .clickable(enabled = enabled, onClick = onClick),
    shape = RoundedCornerShape(22.dp),
    color = background,
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = if (active) 0.9f else 0.72f)),
  ) {
    Row(
      Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.Center,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (loading) {
        CircularProgressIndicator(
          modifier = Modifier.size(14.dp),
          strokeWidth = 2.dp,
          color = contentColor,
        )
        Spacer(Modifier.width(8.dp))
      }
      Text(
        label,
        color = contentColor,
        fontSize = AppTextSize.Body,
        fontWeight = if (primary || destructive) FontWeight.SemiBold else FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

@Composable
internal fun GlassIcon(
  icon: ImageVector,
  label: String,
  active: Boolean = false,
  accent: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  val useAccent = active && accent
  IconButton(onClick = onClick, enabled = enabled) {
    Surface(
      modifier = Modifier.size(48.dp),
      shape = RoundedCornerShape(24.dp),
      color = contrastControlColor(active = useAccent, enabled = enabled),
      border =
        if (useAccent && enabled) {
          BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        } else null,
      tonalElevation = 0.dp,
      shadowElevation = 0.dp,
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(
          icon,
          label,
          modifier = Modifier.size(21.dp),
          tint = contrastControlContentColor(active = useAccent, enabled = enabled),
        )
      }
    }
  }
}

@Composable
internal fun GlassPanel(
  modifier: Modifier = Modifier,
  active: Boolean = false,
  content: @Composable () -> Unit,
) {
  Surface(
    modifier = modifier.animateContentSize(appTween(AppMotion.Medium)),
    color = panelColor(active),
    shape = RoundedCornerShape(24.dp),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = if (active) 0.9f else 0.72f)),
    tonalElevation = if (active) 1.dp else 0.dp,
    shadowElevation = 0.dp,
    content = content,
  )
}

@Composable internal fun menuColor(): Color = MaterialTheme.colorScheme.surface

@Composable internal fun toolbarColor(): Color = MaterialTheme.colorScheme.background

@Composable
internal fun syncStatusColor(label: String): Color {
  val normalized = label.lowercase()
  val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
  return when {
    normalized.contains("conflict") ||
      normalized.contains("failed") ||
      normalized.contains("error") -> MaterialTheme.colorScheme.error
    normalized.contains("waiting") ||
      normalized.contains("pending") ||
      normalized.contains("queued") -> if (dark) Color(0xFFE8C46A) else Color(0xFF8B5E00)
    normalized.contains("syncing") ||
      normalized.contains("preparing") ||
      normalized.contains("pushing") ||
      normalized.contains("pulling") ||
      normalized.contains("loading") -> MaterialTheme.colorScheme.primary
    normalized.contains("synced") || normalized.contains("saved") ->
      if (dark) Color(0xFF9AD7AA) else Color(0xFF2F7D52)
    normalized.contains("local only") -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f)
    else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f)
  }
}

@Composable
internal fun SyncStatusText(label: String, modifier: Modifier = Modifier, maxLines: Int = 1) {
  Text(
    label.ifBlank { " " },
    modifier = modifier,
    color = syncStatusColor(label),
    fontSize = AppTextSize.Label,
    fontWeight = FontWeight.SemiBold,
    maxLines = maxLines,
    overflow = TextOverflow.Ellipsis,
  )
}

@Composable
internal fun SyncActivityIndicator(active: Boolean, modifier: Modifier = Modifier) {
  if (!active) return
  CircularProgressIndicator(
    modifier = modifier.size(12.dp),
    color = syncStatusColor("Syncing"),
    trackColor = Color.Transparent,
    strokeWidth = 1.5.dp,
  )
}
