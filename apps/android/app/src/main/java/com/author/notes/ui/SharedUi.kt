package com.author.notes.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
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
  actions: @Composable RowScope.() -> Unit = {}
) {
  val compactScreen = LocalConfiguration.current.screenWidthDp < 720
  Surface(color = toolbarColor()) {
    Row(
      Modifier
        .fillMaxWidth()
        .heightIn(min = if (compactScreen) 56.dp else 64.dp)
        .padding(horizontal = pageHorizontalPadding(), vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      leading()
      Spacer(Modifier.weight(1f))
      actions()
    }
  }
}

@Composable
internal fun pageHorizontalPadding(): Dp = if (LocalConfiguration.current.screenWidthDp < 720) 20.dp else 32.dp

@Composable
internal fun NavRow(
  icon: ImageVector,
  label: String,
  count: String,
  active: Boolean,
  trailing: @Composable (() -> Unit)? = null,
  onClick: () -> Unit
) {
  val rowColor by animateColorAsState(
    targetValue = if (active) activeColor() else Color.Transparent,
    animationSpec = tween(durationMillis = 260),
    label = "nav-row-color"
  )
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .animateContentSize(tween(260))
      .clickable(onClick = onClick),
    color = rowColor,
    shape = RoundedCornerShape(8.dp)
  ) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(icon, null, modifier = Modifier.size(16.dp))
      Spacer(Modifier.width(8.dp))
      Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp)
  )
}

@Composable
internal fun MenuCheck(visible: Boolean) {
  Icon(
    Icons.Outlined.Check,
    null,
    modifier = Modifier.size(18.dp),
    tint = if (visible) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.76f) else Color.Transparent
  )
}

@Composable
internal fun AppDropdownMenu(
  expanded: Boolean,
  onDismissRequest: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable ColumnScope.() -> Unit
) {
  DropdownMenu(
    expanded = expanded,
    onDismissRequest = onDismissRequest,
    modifier = modifier
      .clip(RoundedCornerShape(16.dp))
      .background(menuColor()),
    shape = RoundedCornerShape(16.dp),
    containerColor = menuColor(),
    tonalElevation = 0.dp,
    shadowElevation = 8.dp,
    content = content
  )
}

@Composable
internal fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
  val rowColor by animateColorAsState(
    targetValue = fieldColor(),
    animationSpec = tween(durationMillis = 240),
    label = "action-row-color"
  )
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp)),
    color = rowColor,
    shape = RoundedCornerShape(8.dp)
  ) {
    Row(
      Modifier
        .fillMaxWidth()
        .heightIn(min = 42.dp)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Icon(icon, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f))
      Spacer(Modifier.width(8.dp))
      Text(label, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}

@Composable
internal fun InfoTile(label: String, value: String, detail: String) {
  GlassPanel(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(10.dp)) {
      Text(label, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
      Text(value.ifBlank { " " }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (detail.isNotBlank()) {
        Text(detail, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}

@Composable
internal fun MiniField(
  value: String,
  placeholder: String,
  modifier: Modifier = Modifier,
  onChange: (String) -> Unit
) {
  TextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    singleLine = true,
    modifier = modifier,
    textStyle = TextStyle(fontSize = 14.sp, fontFamily = AppFontFamily),
    shape = RoundedCornerShape(14.dp),
    colors = textFieldColors()
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
    textStyle = TextStyle(fontSize = 14.sp, fontFamily = AppFontFamily),
    shape = RoundedCornerShape(14.dp),
    colors = textFieldColors()
  )
}

@Composable
internal fun textFieldColors() = TextFieldDefaults.colors(
  focusedContainerColor = fieldColor(),
  unfocusedContainerColor = fieldColor(),
  disabledContainerColor = fieldColor(),
  focusedTextColor = MaterialTheme.colorScheme.onSurface,
  unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
  focusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
  unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
  cursorColor = MaterialTheme.colorScheme.onSurface,
  focusedIndicatorColor = Color.Transparent,
  unfocusedIndicatorColor = Color.Transparent,
  disabledIndicatorColor = Color.Transparent
)

@Composable
internal fun appCheckboxColors() = CheckboxDefaults.colors(
  checkedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.82f),
  uncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
  checkmarkColor = MaterialTheme.colorScheme.background,
  disabledCheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.28f),
  disabledUncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f)
)

@Composable
internal fun SmallTextButton(label: String, active: Boolean = false, onClick: () -> Unit) {
  val buttonColor by animateColorAsState(
    targetValue = if (active) activeColor() else Color.Transparent,
    animationSpec = tween(durationMillis = 220),
    label = "small-button-color"
  )
  TextButton(
    onClick = onClick,
    modifier = Modifier
      .clip(RoundedCornerShape(8.dp))
      .background(buttonColor)
  ) {
    Text(label, fontSize = 12.sp)
  }
}

@Composable
internal fun GlassIcon(
  icon: ImageVector,
  label: String,
  active: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit
) {
  val iconColor by animateColorAsState(
    targetValue = if (active) activeColor() else Color.Transparent,
    animationSpec = tween(durationMillis = 220),
    label = "icon-button-color"
  )
  IconButton(
    onClick = onClick,
    enabled = enabled,
    modifier = Modifier.background(iconColor, RoundedCornerShape(8.dp))
  ) {
    Icon(icon, label, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 0.72f else 0.32f))
  }
}

@Composable
internal fun GlassPanel(
  modifier: Modifier = Modifier,
  active: Boolean = false,
  content: @Composable () -> Unit
) {
  val panel by animateColorAsState(
    targetValue = if (active) activeColor() else panelColor(),
    animationSpec = tween(durationMillis = 260),
    label = "panel-color"
  )
  Surface(
    modifier = modifier.animateContentSize(tween(260)),
    color = panel,
    shape = RoundedCornerShape(8.dp),
    border = null,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    content = content
  )
}

@Composable
internal fun fieldColor(): Color = if (isLightTheme()) Color(0xFFF2F2EF) else Color(0xFF242424)

@Composable
internal fun panelColor(): Color = if (isLightTheme()) Color(0xFFF7F7F4) else Color(0xFF1D1D1D)

@Composable
internal fun activeColor(): Color = if (isLightTheme()) Color(0xFFE8E8E4) else Color(0xFF2D2D2D)

@Composable
internal fun menuColor(): Color = if (isLightTheme()) Color.White else Color(0xFF242424)

@Composable
internal fun toolbarColor(): Color = MaterialTheme.colorScheme.background

@Composable
internal fun isLightTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() > 0.5f

@Composable
internal fun messageColor(): Color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.78f)

@Composable
internal fun statusColor(label: String): Color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (label.contains("Local only", true)) 0.52f else 0.72f)

@Composable
internal fun SyncActivityIndicator(active: Boolean, modifier: Modifier = Modifier) {
  if (!active) return
  CircularProgressIndicator(
    modifier = modifier.size(12.dp),
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
    trackColor = Color.Transparent,
    strokeWidth = 1.5.dp
  )
}
