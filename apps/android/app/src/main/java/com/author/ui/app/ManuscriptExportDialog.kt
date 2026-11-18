package com.author.ui.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.author.core.LocalNotebook
import com.author.core.ManuscriptOrder
import com.author.core.ManuscriptPageSize
import com.author.core.ManuscriptPreset
import com.author.ui.common.AppCheckbox
import com.author.ui.common.AppModal
import com.author.ui.common.AppModalTitle
import com.author.ui.common.MiniField
import com.author.ui.common.ModalActionButton
import com.author.ui.common.appDividerColor
import com.author.ui.common.formatCount
import com.author.ui.common.rowColor
import com.author.ui.state.ManuscriptAction
import com.author.ui.state.ManuscriptStage
import com.author.ui.state.NotesController
import com.author.ui.theme.AppShape
import com.author.ui.theme.AppTextSize

@Composable
internal fun ManuscriptExportDialog(
  controller: NotesController,
  notebook: LocalNotebook,
  onSaveDocx: () -> Unit,
) {
  val context = LocalContext.current
  val options = controller.manuscriptOptions
  val busy = controller.manuscriptBusy || controller.isArchiveBusy
  val noteCount = controller.notebookNoteCount(notebook.id)
  val wordCount = controller.notebookWordCount(notebook.id)
  val conflicts = controller.manuscriptConflictCount
  val warning =
    when {
      conflicts > 0 ->
        "$conflicts unresolved sync ${if (conflicts == 1) "conflict" else "conflicts"} in this " +
          "notebook. Resolve ${if (conflicts == 1) "it" else "them"} first, or the export uses " +
          "this device's version."
      controller.manuscriptOffline ->
        "You're offline: the export uses this device's copy, without changes from your other " +
          "devices."
      else -> ""
    }
  val status =
    when (controller.manuscriptStage) {
      ManuscriptStage.SYNCING -> "Syncing with your other devices…"
      ManuscriptStage.PREPARING -> "Preparing the manuscript…"
      ManuscriptStage.IDLE -> "To get a PDF, choose “Save as PDF” in the print dialog."
    }

  AppModal(onDismissRequest = controller::closeManuscriptExport) {
    AppModalTitle("Export manuscript", onDismiss = controller::closeManuscriptExport)
    Text(
      "${notebook.name.ifBlank { "Untitled notebook" }} · $noteCount " +
        "${if (noteCount == 1) "note" else "notes"} · " +
        "${formatCount(wordCount)} " +
        if (wordCount == 1) "word" else "words",
      color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
      fontSize = AppTextSize.Label,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
    )

    Choice(
      label = "Layout",
      choices =
        ManuscriptPreset.entries.map {
          it to if (it == ManuscriptPreset.POETRY) "Poetry" else "Prose"
        },
      selected = options.preset,
      hint =
        if (options.preset == ManuscriptPreset.POETRY) "Line breaks kept, each poem on a new page."
        else "Double-spaced, indented paragraphs, each chapter on a new page.",
    ) {
      controller.updateManuscriptOptions(options.copy(preset = it))
    }
    Choice(
      label = "Order",
      choices =
        ManuscriptOrder.entries.map {
          it to if (it == ManuscriptOrder.TITLE) "Title" else "Created"
        },
      selected = options.order,
    ) {
      controller.updateManuscriptOptions(options.copy(order = it))
    }
    Choice(
      label = "Page",
      choices = ManuscriptPageSize.entries.map { it to it.label },
      selected = options.pageSize,
    ) {
      controller.updateManuscriptOptions(options.copy(pageSize = it))
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      FieldLabel("Running header")
      MiniField(
        options.header,
        "No header",
        Modifier.fillMaxWidth().semantics { contentDescription = "Running header" },
      ) {
        controller.updateManuscriptOptions(options.copy(header = it))
      }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Toggle("Page numbers", options.pageNumbers, Modifier.fillMaxWidth()) {
        controller.updateManuscriptOptions(options.copy(pageNumbers = it))
      }
      Toggle("Title page", options.titlePage, Modifier.fillMaxWidth()) {
        controller.updateManuscriptOptions(options.copy(titlePage = it))
      }
    }

    if (warning.isNotEmpty()) {
      Text(
        warning,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = AppTextSize.Label,
      )
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ModalActionButton(
        "Print or save PDF",
        modifier = Modifier.weight(1f),
        enabled = !busy,
        loading = controller.manuscriptAction == ManuscriptAction.PRINT,
      ) {
        controller.printManuscript(context)
      }
      ModalActionButton(
        "Save DOCX",
        modifier = Modifier.weight(1f),
        primary = true,
        enabled = !busy,
        loading = controller.manuscriptAction == ManuscriptAction.DOCX,
      ) {
        onSaveDocx()
      }
    }
    Text(
      status,
      modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
      color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f),
      fontSize = AppTextSize.Label,
    )
  }
}

@Composable
private fun FieldLabel(label: String) {
  Text(
    label,
    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
    fontSize = AppTextSize.Label,
    fontWeight = FontWeight.Bold,
  )
}

@Composable
private fun <T> Choice(
  label: String,
  choices: List<Pair<T, String>>,
  selected: T,
  hint: String = "",
  onSelect: (T) -> Unit,
) {
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    FieldLabel(label)
    Surface(modifier = Modifier.fillMaxWidth(), color = rowColor(), shape = AppShape.Control) {
      Row(
        Modifier.padding(2.dp).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
      ) {
        choices.forEach { (value, text) ->
          val isSelected = value == selected
          Surface(
            modifier =
              Modifier.weight(1f).heightIn(min = 40.dp).clip(AppShape.Control).selectable(
                selected = isSelected,
                role = Role.RadioButton,
              ) {
                onSelect(value)
              },
            color = if (isSelected) MaterialTheme.colorScheme.surface else Color.Transparent,
            shape = AppShape.Control,
            border = if (isSelected) BorderStroke(1.dp, appDividerColor()) else null,
          ) {
            Row(
              Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
              horizontalArrangement = Arrangement.Center,
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Text(
                text,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = AppTextSize.Body,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
          }
        }
      }
    }
    if (hint.isNotEmpty()) {
      Text(
        hint,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
        fontSize = AppTextSize.Label,
      )
    }
  }
}

@Composable
private fun Toggle(
  label: String,
  checked: Boolean,
  modifier: Modifier = Modifier,
  onChange: (Boolean) -> Unit,
) {
  Surface(
    modifier = modifier.clip(RectangleShape),
    color = rowColor(),
    shape = RectangleShape,
    border = BorderStroke(1.dp, appDividerColor().copy(alpha = 0.72f)),
  ) {
    // The row is the checkbox (one labelled control); the box inside only draws the state.
    Row(
      Modifier.fillMaxWidth()
        .toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange)
        .padding(end = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      AppCheckbox(checked = checked, onCheckedChange = null)
      Text(
        label,
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = AppTextSize.Body,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}
