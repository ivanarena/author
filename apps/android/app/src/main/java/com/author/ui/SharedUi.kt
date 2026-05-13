package com.author.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun PageHeader(
  leading: @Composable RowScope.() -> Unit = {},
  actions: @Composable RowScope.() -> Unit = {},
) {
  val compactScreen = isCompactWindow()
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
}

@Composable
internal fun isCompactWindow(): Boolean {
  val width = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
  return width < 720.dp
}

@Composable internal fun pageHorizontalPadding(): Dp = if (isCompactWindow()) 20.dp else 32.dp

@Composable
internal fun NavRow(
  icon: ImageVector,
  label: String,
  count: String,
  active: Boolean,
  trailing: @Composable (() -> Unit)? = null,
  onClick: () -> Unit,
) {
  val contentColor =
    if (active) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f)
  Surface(
    modifier =
      Modifier.fillMaxWidth()
        .clip(RoundedCornerShape(8.dp))
        .animateContentSize(tween(AppMotion.Medium))
        .clickable(onClick = onClick),
    color = Color.Transparent,
    shape = RoundedCornerShape(8.dp),
  ) {
    Row(
      Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(icon, null, modifier = Modifier.size(16.dp), tint = contentColor)
      Spacer(Modifier.width(8.dp))
      Text(
        label,
        modifier = Modifier.weight(1f),
        color = contentColor,
        fontSize = 14.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Text(count, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp)
      if (trailing != null) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { trailing() }
    }
  }
}

@Composable
internal fun DropdownSectionLabel(label: String) {
  Text(
    label,
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
    fontSize = 12.sp,
    fontWeight = FontWeight.Bold,
    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp),
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
    modifier = modifier.clip(RoundedCornerShape(16.dp)),
    shape = RoundedCornerShape(16.dp),
    containerColor = menuColor(),
    tonalElevation = 0.dp,
    shadowElevation = 8.dp,
    content = content,
  )
}

@Composable
internal fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
  Surface(
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)),
    color = Color.Transparent,
    shape = RoundedCornerShape(8.dp),
  ) {
    Row(
      Modifier.fillMaxWidth()
        .heightIn(min = 42.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(
        icon,
        null,
        modifier = Modifier.size(16.dp),
        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
      )
      Spacer(Modifier.width(8.dp))
      Text(label, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}

@Composable
internal fun InfoTile(label: String, value: String, detail: String) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp)) {
      Text(
        label,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        value.ifBlank { " " },
        fontWeight = FontWeight.SemiBold,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      if (detail.isNotBlank()) {
        Text(
          detail,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
          fontSize = 12.sp,
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
    textStyle = TextStyle(fontSize = 14.sp, fontFamily = LocalAppFontFamily.current),
    shape = RoundedCornerShape(14.dp),
    colors = textFieldColors(),
  )
}

@Composable
internal fun PasswordField(value: String, placeholder: String, onChange: (String) -> Unit) {
  TextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    visualTransformation = PasswordVisualTransformation(),
    modifier = Modifier.fillMaxWidth(),
    textStyle = TextStyle(fontSize = 14.sp, fontFamily = LocalAppFontFamily.current),
    shape = RoundedCornerShape(14.dp),
    colors = textFieldColors(),
  )
}

@Composable
internal fun textFieldColors() =
  TextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    disabledContainerColor = Color.Transparent,
    focusedTextColor = MaterialTheme.colorScheme.onSurface,
    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
    cursorColor = MaterialTheme.colorScheme.onSurface,
    focusedIndicatorColor = MaterialTheme.colorScheme.primary,
    unfocusedIndicatorColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.72f),
    disabledIndicatorColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.42f),
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
internal fun SmallTextButton(label: String, active: Boolean = false, onClick: () -> Unit) {
  TextButton(onClick = onClick, modifier = Modifier.clip(RoundedCornerShape(8.dp))) {
    Text(
      label,
      color =
        if (active) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
      fontSize = 12.sp,
      fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
    )
  }
}

@Composable
internal fun GlassIcon(
  icon: ImageVector,
  label: String,
  active: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  IconButton(onClick = onClick, enabled = enabled) {
    Icon(
      icon,
      label,
      modifier = Modifier.size(18.dp),
      tint =
        if (active && enabled) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 0.72f else 0.32f),
    )
  }
}

@Composable
internal fun GlassPanel(
  modifier: Modifier = Modifier,
  active: Boolean = false,
  content: @Composable () -> Unit,
) {
  Surface(
    modifier = modifier.animateContentSize(tween(AppMotion.Medium)),
    color = Color.Transparent,
    shape = RoundedCornerShape(8.dp),
    border = null,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    content = content,
  )
}

@Composable internal fun menuColor(): Color = MaterialTheme.colorScheme.background

@Composable internal fun toolbarColor(): Color = MaterialTheme.colorScheme.background

@Composable
internal fun messageColor(): Color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.78f)

@Composable
internal fun statusColor(label: String): Color =
  MaterialTheme.colorScheme.onSurface.copy(
    alpha = if (label.contains("Local only", true)) 0.52f else 0.72f
  )

@Composable
internal fun SyncActivityIndicator(active: Boolean, modifier: Modifier = Modifier) {
  if (!active) return
  CircularProgressIndicator(
    modifier = modifier.size(12.dp),
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
    trackColor = Color.Transparent,
    strokeWidth = 1.5.dp,
  )
}
