import { setTheme } from '$lib/client/store';
import type { NoteGroupBy, NoteSort } from '$lib/client/view-model';
import type { SettingsSection, Theme } from './notes-controller-models';
import {
  nextEditorZoom,
  setStoredCompactView,
  setStoredEditorFont,
  setStoredEditorLineHeight,
  setStoredEditorTextSize,
  setStoredEditorZoom,
  setStoredGroup,
  setStoredSort,
  type EditorFont
} from './page-preferences';

export interface NotesUiActionController {
  accountMenuCloseTimer: ReturnType<typeof setTimeout> | null;
  accountMenuOpen: boolean;
  compactView: boolean;
  editorFont: EditorFont;
  editorLineHeight: number;
  editorTextSize: number;
  editorZoom: number;
  loginOpen: boolean;
  menuCloseTimer: ReturnType<typeof setTimeout> | null;
  menusOpen: boolean;
  noteGroup: NoteGroupBy;
  noteSort: NoteSort;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  theme: Theme;

  closeAccountMenu: () => void;
  closeContextMenu: () => void;
  refreshAccount: () => Promise<void>;
}

export function openMenus(controller: NotesUiActionController): void {
  if (controller.settingsOpen || controller.loginOpen) return;
  if (controller.menuCloseTimer) {
    clearTimeout(controller.menuCloseTimer);
    controller.menuCloseTimer = null;
  }
  controller.closeAccountMenu();
  controller.menusOpen = true;
}

export function toggleMenus(controller: NotesUiActionController): void {
  if (controller.settingsOpen || controller.loginOpen) {
    closeMenus(controller);
    return;
  }
  if (controller.menuCloseTimer) {
    clearTimeout(controller.menuCloseTimer);
    controller.menuCloseTimer = null;
  }
  controller.closeAccountMenu();
  controller.menusOpen = !controller.menusOpen;
}

export function openAccountMenu(controller: NotesUiActionController): void {
  if (controller.accountMenuCloseTimer) {
    clearTimeout(controller.accountMenuCloseTimer);
    controller.accountMenuCloseTimer = null;
  }
  controller.accountMenuOpen = true;
  controller.menusOpen = false;
  controller.closeContextMenu();
}

export function closeAccountMenu(controller: NotesUiActionController): void {
  if (controller.accountMenuCloseTimer) {
    clearTimeout(controller.accountMenuCloseTimer);
    controller.accountMenuCloseTimer = null;
  }
  controller.accountMenuOpen = false;
}

export function scheduleAccountMenuClose(
  controller: NotesUiActionController
): void {
  if (controller.accountMenuCloseTimer) {
    clearTimeout(controller.accountMenuCloseTimer);
  }
  controller.accountMenuCloseTimer = setTimeout(() => {
    controller.accountMenuOpen = false;
    controller.accountMenuCloseTimer = null;
  }, 260);
}

export function scheduleMenusClose(controller: NotesUiActionController): void {
  if (controller.menuCloseTimer) clearTimeout(controller.menuCloseTimer);
  controller.menuCloseTimer = setTimeout(() => {
    controller.menusOpen = false;
    controller.menuCloseTimer = null;
  }, 180);
}

export function closeMenusOnBlur(
  controller: NotesUiActionController,
  event: FocusEvent
): void {
  const current = event.currentTarget as HTMLElement;
  const next = event.relatedTarget as Node | null;
  if (next && current.contains(next)) return;
  closeMenus(controller);
}

export function closeAccountMenuOnBlur(
  controller: NotesUiActionController,
  event: FocusEvent
): void {
  const current = event.currentTarget as HTMLElement;
  const next = event.relatedTarget as Node | null;
  if (next && current.contains(next)) return;
  controller.closeAccountMenu();
}

export function openSettingsModal(
  controller: NotesUiActionController,
  section: SettingsSection = 'account'
): void {
  closeMenus(controller);
  controller.settingsSection = section;
  controller.settingsOpen = true;
  controller.closeAccountMenu();
  controller.closeContextMenu();
  if (section === 'account') void controller.refreshAccount();
}

export function closeSettings(controller: NotesUiActionController): void {
  controller.settingsOpen = false;
  controller.loginOpen = false;
}

export function setSettingsSection(
  controller: NotesUiActionController,
  section: SettingsSection
): void {
  controller.settingsSection = section;
}

export function changeSort(
  controller: NotesUiActionController,
  event: Event
): void {
  controller.noteSort = (event.currentTarget as HTMLSelectElement)
    .value as NoteSort;
  setStoredSort(controller.noteSort);
}

export function setNoteSort(
  controller: NotesUiActionController,
  sort: NoteSort
): void {
  controller.noteSort = sort;
  setStoredSort(sort);
}

export function setNoteGroup(
  controller: NotesUiActionController,
  group: NoteGroupBy
): void {
  controller.noteGroup = group;
  setStoredGroup(group);
}

export function toggleCompactView(controller: NotesUiActionController): void {
  controller.compactView = !controller.compactView;
  setStoredCompactView(controller.compactView);
}

export function zoomEditor(
  controller: NotesUiActionController,
  direction: -1 | 1
): void {
  controller.editorZoom = nextEditorZoom(controller.editorZoom, direction);
  setStoredEditorZoom(controller.editorZoom);
}

export function setEditorFont(
  controller: NotesUiActionController,
  font: EditorFont
): void {
  controller.editorFont = font;
  setStoredEditorFont(font);
}

export function setEditorTextSize(
  controller: NotesUiActionController,
  size: number
): void {
  controller.editorTextSize = size;
  setStoredEditorTextSize(size);
}

export function setEditorLineHeight(
  controller: NotesUiActionController,
  lineHeight: number
): void {
  controller.editorLineHeight = lineHeight;
  setStoredEditorLineHeight(lineHeight);
}

export function toggleTheme(controller: NotesUiActionController): void {
  controller.theme = controller.theme.startsWith('dark') ? 'light' : 'dark';
  setTheme(controller.theme);
}

export function setThemeChoice(
  controller: NotesUiActionController,
  theme: Theme
): void {
  controller.theme = theme;
  setTheme(theme);
}

function closeMenus(controller: NotesUiActionController): void {
  if (controller.menuCloseTimer) {
    clearTimeout(controller.menuCloseTimer);
    controller.menuCloseTimer = null;
  }
  controller.menusOpen = false;
}
