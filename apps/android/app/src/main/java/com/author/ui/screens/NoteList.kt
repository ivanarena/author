package com.author.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.author.core.LocalNote
import com.author.core.NOTE_DATE_FILTER_OLDER
import com.author.core.NOTE_DATE_FILTER_PREVIOUS_30
import com.author.core.NOTE_DATE_FILTER_PREVIOUS_7
import com.author.core.NOTE_DATE_FILTER_TODAY
import com.author.core.NOTE_DATE_FILTER_YESTERDAY
import com.author.core.formatListDate
import com.author.core.noteDisplayTitle
import com.author.core.noteNotebookIds
import com.author.core.notePreview
import com.author.core.relativeAge
import com.author.ui.common.*
import com.author.ui.state.*
import com.author.ui.theme.*
import kotlinx.coroutines.delay

private val noteDateFilterOptions =
  listOf(
    NOTE_DATE_FILTER_TODAY to "Today",
    NOTE_DATE_FILTER_YESTERDAY to "Yesterday",
    NOTE_DATE_FILTER_PREVIOUS_7 to "Previous 7 days",
    NOTE_DATE_FILTER_PREVIOUS_30 to "Previous 30 days",
    NOTE_DATE_FILTER_OLDER to "Older",
  )

private val NoteListTitleTextSize = 15.sp
private val NoteListPreviewTextSize = 11.sp
private val NoteListMetaTextSize = 10.5.sp

@Composable
internal fun NoteListPanel(controller: NotesController, modifier: Modifier = Modifier) {
  Column(
    modifier.padding(horizontal = pageHorizontalPadding(), vertical = 4.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    AnimatedVisibility(
      visible = controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty(),
      enter = expandVertically(appTween(AppMotion.Medium)),
      exit = shrinkVertically(appTween(AppMotion.Medium)),
    ) {
      SelectionToolbar(controller)
    }
    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      controller.visibleGroups.forEachIndexed { groupIndex, (label, groupNotes) ->
        if (groupNotes.isNotEmpty()) {
          if (groupIndex > 0) {
            item(key = "range-separator-$groupIndex") {
              HorizontalDivider(
                modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
                color = appDividerColor().copy(alpha = 0.58f),
              )
            }
          }
          if (label.isNotBlank()) {
            item {
              Text(
                label.uppercase(),
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.46f),
                fontSize = AppTextSize.Debug,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 6.dp, bottom = 2.dp, start = 8.dp),
              )
            }
          }
          items(groupNotes, key = { it.id }) { note -> NoteRow(controller, note) }
        }
      }
      if (controller.visibleNotes.isEmpty()) {
        item {
          Text(
            if (controller.searchValue.isBlank() && !controller.noteFiltersActive) "No notes"
            else "No matching notes",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
            fontSize = AppTextSize.Label,
            modifier = Modifier.padding(14.dp),
          )
        }
      }
    }
  }
}

@Composable
private fun SelectionToolbar(controller: NotesController) {
  val selectedCount = controller.selectedNoteIds.size
  val allVisibleSelected =
    controller.visibleNotes.isNotEmpty() &&
      controller.visibleNotes.all { controller.selectedNoteIds.contains(it.id) }

  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = AppShape.ControlLarge,
    color =
      if (selectedCount > 0) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else rowColor(),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = 0.68f)),
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      Modifier.heightIn(min = 44.dp).padding(start = 12.dp, end = 6.dp, top = 5.dp, bottom = 5.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        if (selectedCount == 0) "Select notes" else "$selectedCount selected",
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
        fontSize = AppTextSize.Label,
        fontWeight = FontWeight.SemiBold,
      )
      Spacer(Modifier.weight(1f))
      SelectionActionButton(
        icon = Icons.Outlined.Check,
        contentDescription =
          if (allVisibleSelected) "Clear visible selection" else "Select all visible notes",
        active = allVisibleSelected,
        enabled = controller.visibleNotes.isNotEmpty(),
      ) {
        controller.toggleAllVisible(!allVisibleSelected)
      }
      SelectionActionButton(
        icon = Icons.Outlined.Close,
        contentDescription = "Clear selection",
        onClick = { controller.clearSelection() },
      )
    }
  }
}

@Composable
private fun SelectionActionButton(
  icon: ImageVector,
  contentDescription: String,
  active: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  Surface(
    modifier =
      Modifier.size(36.dp).clip(AppShape.Control).clickable(enabled = enabled, onClick = onClick),
    shape = AppShape.Control,
    color = contrastControlColor(active = active, enabled = enabled),
    border =
      if (active && enabled) {
        BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.75f))
      } else null,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Box(contentAlignment = Alignment.Center) {
      Icon(
        icon,
        contentDescription,
        modifier = Modifier.size(18.dp),
        tint = contrastControlContentColor(active = active, enabled = enabled),
      )
    }
  }
}

@Composable
internal fun SearchNotesField(
  controller: NotesController,
  modifier: Modifier = Modifier,
  autoFocus: Boolean = false,
  autoFocusDelayMillis: Long = 0,
  floating: Boolean = false,
  showFilterButton: Boolean = false,
  onDismiss: (() -> Unit)? = null,
) {
  val textColor = MaterialTheme.colorScheme.onSurface
  val focusRequester = remember { FocusRequester() }
  val keyboard = LocalSoftwareKeyboardController.current

  LaunchedEffect(autoFocus) {
    if (autoFocus) {
      if (autoFocusDelayMillis > 0) delay(autoFocusDelayMillis)
      focusRequester.requestFocus()
      keyboard?.show()
    }
  }

  Surface(
    modifier = modifier,
    color = rowColor(),
    shape = AppShape.Search,
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = 0.72f)),
    tonalElevation = 0.dp,
    shadowElevation = if (floating) 18.dp else 0.dp,
  ) {
    Row(
      Modifier.heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 7.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(
        Icons.Outlined.Search,
        null,
        tint = textColor.copy(alpha = 0.52f),
        modifier = Modifier.size(18.dp),
      )
      BasicTextField(
        value = controller.searchValue,
        onValueChange = { controller.searchValue = it },
        singleLine = true,
        cursorBrush = SolidColor(textColor),
        textStyle =
          TextStyle(
            color = textColor,
            fontSize = AppTextSize.Body,
            fontFamily = LocalAppFontFamily.current,
          ),
        modifier = Modifier.weight(1f).focusRequester(focusRequester),
        decorationBox = { inner ->
          Box {
            if (controller.searchValue.isBlank()) {
              Text(
                "Search notes",
                color = textColor.copy(alpha = 0.42f),
                fontSize = AppTextSize.Body,
              )
            }
            inner()
          }
        },
      )
      if (showFilterButton) {
        NotesSortButton(controller)
      }
      AnimatedVisibility(
        visible = controller.searchValue.isNotBlank() || onDismiss != null,
        enter = fadeIn(appTween(AppMotion.Fast)),
        exit = fadeOut(appTween(AppMotion.Fast)),
      ) {
        val hasQuery = controller.searchValue.isNotBlank()
        Surface(
          modifier =
            Modifier.size(38.dp).clip(AppShape.Control).clickable {
              if (hasQuery) controller.searchValue = "" else onDismiss?.invoke()
            },
          shape = AppShape.Control,
          color = contrastControlColor(),
          tonalElevation = 0.dp,
          shadowElevation = 0.dp,
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(
              Icons.Outlined.Close,
              if (hasQuery) "Clear search" else "Close search",
              modifier = Modifier.size(18.dp),
              tint = contrastControlContentColor(),
            )
          }
        }
      }
    }
  }
}

@Composable
internal fun NotesSortButton(controller: NotesController) {
  var open by remember { mutableStateOf(false) }
  val active =
    controller.noteSort != "date-desc" ||
      controller.noteGroup != "smart" ||
      controller.noteFilterDateRanges.isNotEmpty()
  Box {
    SearchControlButton(
      icon = Icons.AutoMirrored.Outlined.Sort,
      contentDescription = "Sort notes",
      active = active,
      onClick = { open = true },
    )
    if (open) NoteSortModal(controller) { open = false }
  }
}

@Composable
private fun SearchControlButton(
  icon: ImageVector,
  contentDescription: String,
  active: Boolean,
  onClick: () -> Unit,
) {
  Surface(
    modifier = Modifier.size(44.dp).clip(AppShape.ControlLarge).clickable(onClick = onClick),
    shape = AppShape.ControlLarge,
    color = contrastControlColor(active = active),
    border = if (active) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Box(contentAlignment = Alignment.Center) {
      Icon(
        icon,
        contentDescription,
        modifier = Modifier.size(21.dp),
        tint = contrastControlContentColor(active = active),
      )
    }
  }
}

@Composable
private fun FilterOptionRow(
  label: String,
  active: Boolean,
  detail: String = "",
  onClick: () -> Unit,
) {
  Surface(
    modifier = Modifier.fillMaxWidth().clip(AppShape.Panel).clickable(onClick = onClick),
    shape = AppShape.Panel,
    color = rowColor(active),
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = if (active) 0.9f else 0.72f)),
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      Modifier.heightIn(min = 54.dp).padding(horizontal = 14.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        label,
        modifier = Modifier.weight(1f),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (active) 0.92f else 0.78f),
        fontSize = AppTextSize.Body,
        fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (detail.isNotBlank()) {
        Text(
          detail,
          color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
          fontSize = AppTextSize.Label,
          maxLines = 1,
        )
      }
      MenuCheck(active)
    }
  }
}

@Composable
private fun NoteSortModal(controller: NotesController, onDismiss: () -> Unit) {
  AppModal(
    onDismissRequest = onDismiss,
    maxWidth = 380.dp,
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp),
  ) {
    AppModalTitle("Organize notes", onDismiss = onDismiss)
    Column(
      Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      DropdownSectionLabel("Sort")
      SortOptionRow("date-desc", "Newest first", controller)
      SortOptionRow("az", "A-Z", controller)
      SortOptionRow("za", "Z-A", controller)

      AppHorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
      DropdownSectionLabel("Group")
      GroupOptionRow("smart", "Recent ranges", controller)
      GroupOptionRow("month", "Month", controller)
      GroupOptionRow("year", "Year", controller)
      GroupOptionRow("none", "None", controller)

      AppHorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
      DropdownSectionLabel("Updated")
      noteDateFilterOptions.forEach { (range, label) ->
        FilterOptionRow(
          label = label,
          active = range in controller.noteFilterDateRanges,
          onClick = { controller.toggleNoteFilterDateRange(range) },
        )
      }
    }
    if (controller.noteFilterDateRanges.isNotEmpty()) {
      ModalActionButton("Clear date filter", onClick = { controller.clearDateFilters() })
    }
  }
}

@Composable
private fun SortOptionRow(sort: String, label: String, controller: NotesController) {
  FilterOptionRow(
    label = label,
    active = controller.noteSort == sort,
    onClick = { controller.setSort(sort) },
  )
}

@Composable
private fun GroupOptionRow(group: String, label: String, controller: NotesController) {
  FilterOptionRow(
    label = label,
    active = controller.noteGroup == group,
    onClick = { controller.setGroup(group) },
  )
}

@Composable
private fun BulkActionsMenuContent(controller: NotesController, onDismiss: () -> Unit) {
  val hasActiveNotes = controller.selectedNotes.any { it.trashedAt == null }
  val hasTrashedNotes = controller.selectedNotes.any { it.trashedAt != null }

  if (hasActiveNotes) {
    DropdownSectionLabel("Move selected")
    NotebookAssignmentMenuItems(controller, note = null, selectedMode = true) { onDismiss() }
    HorizontalDivider()
    AppDropdownMenuItem(
      label = "Move selected to Trash",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.trashSelected()
      },
    )
  }
  if (hasTrashedNotes) {
    if (hasActiveNotes) HorizontalDivider()
    AppDropdownMenuItem(
      label = "Restore selected",
      leadingIcon = {
        Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
      },
      onClick = {
        onDismiss()
        controller.restoreSelected()
      },
    )
    AppDropdownMenuItem(
      label = "Delete selected permanently",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.deleteSelectedPermanently()
      },
    )
  }
  HorizontalDivider()
  AppDropdownMenuItem(
    label = "Clear selection",
    leadingIcon = { Icon(Icons.Outlined.Close, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.clearSelection()
    },
  )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NoteRow(controller: NotesController, note: LocalNote) {
  val active = controller.selectedNote?.id == note.id
  val selected = controller.selectedNoteIds.contains(note.id)
  val selecting = controller.noteSelectionMode || controller.selectedNoteIds.isNotEmpty()
  var menuOpen by remember(note.id) { mutableStateOf(false) }
  var menuMode by remember(note.id) { mutableStateOf("note") }
  val highlighted = active || selected
  val titleColor by
    animateColorAsState(
      targetValue =
        if (highlighted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
      animationSpec = appTween(AppMotion.Medium),
      label = "note-title-selection",
    )
  val rowBackground by
    animateColorAsState(
      targetValue = if (highlighted) rowColor(active = true) else Color.Transparent,
      animationSpec = appTween(AppMotion.Medium),
      label = "note-row-selection",
    )
  val rowBorderColor by
    animateColorAsState(
      targetValue = if (highlighted) appDividerColor().copy(alpha = 0.9f) else Color.Transparent,
      animationSpec = appTween(AppMotion.Medium),
      label = "note-row-border-selection",
    )

  Box {
    Surface(
      modifier =
        Modifier.fillMaxWidth()
          .testTag("note-row-${note.id}")
          .clip(AppShape.NoteRow)
          .combinedClickable(
            onClick = {
              if (selecting) {
                controller.toggleSelection(note, !selected)
              } else {
                controller.selectNote(note)
              }
            },
            onLongClick = {
              controller.toggleSelection(note, true)
              menuMode = "bulk"
              menuOpen = true
            },
          ),
      color = rowBackground,
      shape = AppShape.NoteRow,
      border = BorderStroke(1.dp, rowBorderColor),
    ) {
      Row(
        Modifier.heightIn(min = if (controller.compactView) 48.dp else 68.dp)
          .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(
          Modifier.weight(1f).padding(horizontal = 4.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            SelectedTitleDot(selected)
            Text(
              noteDisplayTitle(note),
              color = titleColor,
              fontWeight = FontWeight.SemiBold,
              fontSize = NoteListTitleTextSize,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f),
            )
            if (note.isFavorite) {
              Icon(
                Icons.Outlined.Star,
                "Favorite",
                modifier = Modifier.padding(start = 8.dp).size(15.dp),
                tint = MaterialTheme.colorScheme.primary,
              )
            }
            if (controller.compactView) {
              Text(
                relativeAge(note.updatedAt),
                modifier = Modifier.padding(start = if (note.isFavorite) 8.dp else 0.dp),
                fontSize = NoteListMetaTextSize,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
              )
            }
          }
          if (!controller.compactView) {
            Text(
              notePreview(note).ifBlank { "No text" },
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
              fontWeight = FontWeight.Normal,
              fontSize = NoteListPreviewTextSize,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
            val notebookNames =
              noteNotebookIds(note).mapNotNull { id ->
                controller.notebooks.firstOrNull { it.id == id }?.name
              }
            if (notebookNames.isNotEmpty()) {
              NotebookBadge(
                notebookNames.joinToString(", "),
                modifier = Modifier.padding(top = 2.dp),
              )
            }
            Text(
              "Updated ${formatListDate(note.updatedAt)}   Created ${formatListDate(note.createdAt)}",
              color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
              fontSize = NoteListMetaTextSize,
              maxLines = 1,
            )
          }
        }
      }
    }
    AppDropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
      if (menuMode == "bulk") {
        BulkActionsMenuContent(controller) { menuOpen = false }
      } else {
        NoteActionsMenuContent(controller, note) { menuOpen = false }
      }
    }
  }
}

@Composable
private fun SelectedTitleDot(selected: Boolean) {
  val color by
    animateColorAsState(
      targetValue = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
      animationSpec = appTween(AppMotion.Medium),
      label = "selected-title-dot",
    )
  Box(Modifier.padding(end = 8.dp).size(7.dp).clip(CircleShape).background(color))
}

@Composable
private fun NotebookBadge(label: String, modifier: Modifier = Modifier) {
  Surface(
    modifier = modifier,
    shape = AppShape.Pill,
    color = contrastControlColor(),
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      Modifier.heightIn(min = 32.dp).padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Icon(
        Icons.Outlined.Book,
        null,
        tint = contrastControlContentColor(),
        modifier = Modifier.size(13.dp),
      )
      Text(
        label,
        modifier = Modifier.weight(1f, fill = false),
        color = contrastControlContentColor(),
        fontSize = NoteListMetaTextSize,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

@Composable
private fun NoteActionsMenuContent(
  controller: NotesController,
  note: LocalNote,
  onDismiss: () -> Unit,
) {
  AppDropdownMenuItem(
    label = "Select",
    leadingIcon = { Icon(Icons.Outlined.Check, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onDismiss()
      controller.toggleSelection(note, true)
    },
  )
  HorizontalDivider()
  if (note.trashedAt != null) {
    AppDropdownMenuItem(
      label = "Restore",
      leadingIcon = {
        Icon(Icons.Outlined.RestoreFromTrash, null, modifier = Modifier.size(18.dp))
      },
      onClick = {
        onDismiss()
        controller.restoreNote(note)
      },
    )
    AppDropdownMenuItem(
      label = "Delete permanently",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.deleteNotePermanently(note)
      },
    )
  } else {
    AppDropdownMenuItem(
      label = if (note.isFavorite) "Remove from Favorites" else "Add to Favorites",
      leadingIcon = {
        Icon(
          if (note.isFavorite) Icons.Outlined.Star else Icons.Outlined.StarBorder,
          null,
          modifier = Modifier.size(18.dp),
        )
      },
      onClick = {
        onDismiss()
        controller.toggleFavorite(note)
      },
    )
    HorizontalDivider()
    DropdownSectionLabel("Notebooks")
    NotebookAssignmentMenuItems(controller, note = note, selectedMode = false) { onDismiss() }
    HorizontalDivider()
    AppDropdownMenuItem(
      label = "Move to Trash",
      leadingIcon = { Icon(Icons.Outlined.Delete, null, modifier = Modifier.size(18.dp)) },
      onClick = {
        onDismiss()
        controller.trashNote(note)
      },
    )
  }
}

@Composable
internal fun NotebookAssignmentMenuItems(
  controller: NotesController,
  note: LocalNote?,
  selectedMode: Boolean,
  onPicked: () -> Unit,
) {
  val activeSelectedNotes =
    if (selectedMode) controller.selectedNotes.filter { it.trashedAt == null } else emptyList()
  val unfiledActive =
    if (selectedMode) {
      activeSelectedNotes.isNotEmpty() && activeSelectedNotes.all { noteNotebookIds(it).isEmpty() }
    } else {
      note?.let { noteNotebookIds(it).isEmpty() } == true
    }

  AppDropdownMenuItem(
    label = "Unfiled",
    leadingIcon = { MenuCheck(unfiledActive) },
    onClick = {
      onPicked()
      if (selectedMode) controller.assignNotebookForSelected(null)
      else note?.let { controller.assignNotebook(it, null) }
    },
  )
  controller.notebooks.forEach { notebook ->
    val active =
      if (selectedMode) {
        activeSelectedNotes.isNotEmpty() &&
          activeSelectedNotes.all { noteNotebookIds(it).contains(notebook.id) }
      } else {
        note?.let { noteNotebookIds(it).contains(notebook.id) } == true
      }
    AppDropdownMenuItem(
      label = notebook.name,
      leadingIcon = { MenuCheck(active) },
      onClick = {
        onPicked()
        if (selectedMode) controller.assignNotebookForSelected(notebook.id)
        else note?.let { controller.assignNotebook(it, notebook.id) }
      },
    )
  }
  HorizontalDivider()
  AppDropdownMenuItem(
    label = "New notebook",
    leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, null, modifier = Modifier.size(18.dp)) },
    onClick = {
      onPicked()
      val targetNoteIds =
        if (selectedMode) activeSelectedNotes.map { it.id }.toSet()
        else note?.takeIf { it.trashedAt == null }?.let { setOf(it.id) } ?: emptySet()
      controller.openNewNotebook(targetNoteIds)
    },
  )
}
