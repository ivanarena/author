import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedTheme } from '$lib/client/local-state';
import type { NoteGroupBy, NoteSort } from '$lib/client/view-model';
import type { SettingsSection, Theme } from '../models';
import type { EditorFont } from '../page-preferences';
import type { NotesUiActionController } from './ui';

const mocks = vi.hoisted(() => ({
  nextEditorZoom: vi.fn(),
  setStoredCompactView: vi.fn(),
  setStoredEditorFont: vi.fn(),
  setStoredEditorLineHeight: vi.fn(),
  setStoredEditorTextSize: vi.fn(),
  setStoredEditorZoom: vi.fn(),
  setStoredGroup: vi.fn(),
  setStoredSort: vi.fn(),
  setTheme: vi.fn()
}));

vi.mock('$lib/client/store', () => ({
  setTheme: mocks.setTheme
}));

vi.mock('../page-preferences', () => ({
  nextEditorZoom: mocks.nextEditorZoom,
  setStoredCompactView: mocks.setStoredCompactView,
  setStoredEditorFont: mocks.setStoredEditorFont,
  setStoredEditorLineHeight: mocks.setStoredEditorLineHeight,
  setStoredEditorTextSize: mocks.setStoredEditorTextSize,
  setStoredEditorZoom: mocks.setStoredEditorZoom,
  setStoredGroup: mocks.setStoredGroup,
  setStoredSort: mocks.setStoredSort
}));

import {
  changeSort,
  closeAccountMenu,
  closeAccountMenuOnBlur,
  closeMenusOnBlur,
  closeSettings,
  openAccountMenu,
  openMenus,
  openSettingsModal,
  scheduleAccountMenuClose,
  scheduleMenusClose,
  setEditorFont,
  setEditorLineHeight,
  setEditorTextSize,
  setNoteGroup,
  setNoteSort,
  setSettingsSection,
  setThemeChoice,
  toggleCompactView,
  toggleMenus,
  toggleTheme,
  zoomEditor
} from './ui';

function controller(
  overrides: Partial<NotesUiActionController> = {}
): NotesUiActionController {
  return {
    accountMenuCloseTimer: null,
    accountMenuOpen: false,
    compactView: false,
    editorFont: 'system-sans' as EditorFont,
    editorLineHeight: 1.7,
    editorTextSize: 18,
    editorZoom: 1,
    loginOpen: false,
    menuCloseTimer: null,
    menusOpen: false,
    noteGroup: 'none' as NoteGroupBy,
    noteSort: 'date-desc' as NoteSort,
    resolvedTheme: 'light' as ResolvedTheme,
    settingsOpen: false,
    settingsSection: 'account' as SettingsSection,
    theme: 'system' as Theme,
    closeAccountMenu: vi.fn(),
    closeContextMenu: vi.fn(),
    refreshAccount: vi.fn(),
    ...overrides
  };
}

function blurEvent(
  containsRelatedTarget: boolean,
  pointerStillInside = false
): FocusEvent {
  const relatedTarget = {} as Node;
  return {
    currentTarget: {
      contains: vi.fn(() => containsRelatedTarget),
      matches: vi.fn(() => pointerStillInside)
    },
    relatedTarget
  } as unknown as FocusEvent;
}

describe('ui actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nextEditorZoom.mockReturnValue(1.1);
    mocks.setTheme.mockImplementation((theme: Theme) =>
      theme === 'dark' || theme === 'dark-mint' ? 'dark' : 'light'
    );
  });

  it('opens and toggles menus without colliding with account or settings panels', () => {
    const model = controller({
      accountMenuOpen: true,
      closeAccountMenu: vi.fn(() => {
        model.accountMenuOpen = false;
      })
    });

    openMenus(model);
    expect(model.menusOpen).toBe(true);
    expect(model.closeAccountMenu).toHaveBeenCalled();

    toggleMenus(model);
    expect(model.menusOpen).toBe(false);

    const blocked = controller({ settingsOpen: true, menusOpen: true });
    toggleMenus(blocked);
    expect(blocked.menusOpen).toBe(false);
  });

  it('opens account and settings panels with the right cleanup and refresh behavior', () => {
    const model = controller({ menusOpen: true });

    openAccountMenu(model);
    expect(model.accountMenuOpen).toBe(true);
    expect(model.menusOpen).toBe(false);
    expect(model.closeContextMenu).toHaveBeenCalled();

    openSettingsModal(model, 'account');
    expect(model.settingsOpen).toBe(true);
    expect(model.settingsSection).toBe('account');
    expect(model.closeAccountMenu).toHaveBeenCalled();
    expect(model.closeContextMenu).toHaveBeenCalled();
    expect(model.refreshAccount).toHaveBeenCalled();

    setSettingsSection(model, 'sync');
    expect(model.settingsSection).toBe('sync');

    closeSettings(model);
    expect(model.settingsOpen).toBe(false);
    expect(model.loginOpen).toBe(false);
  });

  it('closes delayed menus and account menus through timers and blur', () => {
    vi.useFakeTimers();
    try {
      const model = controller({ menusOpen: true, accountMenuOpen: true });

      scheduleMenusClose(model);
      expect(model.menuCloseTimer).not.toBeNull();
      vi.advanceTimersByTime(180);
      expect(model.menusOpen).toBe(false);
      expect(model.menuCloseTimer).toBeNull();

      scheduleAccountMenuClose(model);
      expect(model.accountMenuCloseTimer).not.toBeNull();
      vi.advanceTimersByTime(260);
      expect(model.accountMenuOpen).toBe(false);
      expect(model.accountMenuCloseTimer).toBeNull();

      model.menusOpen = true;
      closeMenusOnBlur(model, blurEvent(false, true));
      expect(model.menusOpen).toBe(true);

      closeMenusOnBlur(model, blurEvent(false));
      expect(model.menusOpen).toBe(false);

      const closeAccount = vi.fn();
      closeAccountMenuOnBlur(
        controller({ closeAccountMenu: closeAccount }),
        blurEvent(false)
      );
      expect(closeAccount).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists sort, group, density, and editor appearance preferences', () => {
    const model = controller();

    changeSort(model, {
      currentTarget: { value: 'az' }
    } as unknown as Event);
    expect(model.noteSort).toBe('az');
    expect(mocks.setStoredSort).toHaveBeenCalledWith('az');

    setNoteSort(model, 'za');
    expect(model.noteSort).toBe('za');
    expect(mocks.setStoredSort).toHaveBeenCalledWith('za');

    setNoteGroup(model, 'month');
    expect(model.noteGroup).toBe('month');
    expect(mocks.setStoredGroup).toHaveBeenCalledWith('month');

    toggleCompactView(model);
    expect(model.compactView).toBe(true);
    expect(mocks.setStoredCompactView).toHaveBeenCalledWith(true);

    zoomEditor(model, 1);
    expect(model.editorZoom).toBe(1.1);
    expect(mocks.setStoredEditorZoom).toHaveBeenCalledWith(1.1);

    setEditorFont(model, 'system-serif' as EditorFont);
    expect(model.editorFont).toBe('system-serif');
    expect(mocks.setStoredEditorFont).toHaveBeenCalledWith('system-serif');

    setEditorTextSize(model, 20);
    expect(model.editorTextSize).toBe(20);
    expect(mocks.setStoredEditorTextSize).toHaveBeenCalledWith(20);

    setEditorLineHeight(model, 1.8);
    expect(model.editorLineHeight).toBe(1.8);
    expect(mocks.setStoredEditorLineHeight).toHaveBeenCalledWith(1.8);
  });

  it('switches theme choices through the shared theme helper', () => {
    const model = controller({ resolvedTheme: 'light', theme: 'system' });

    toggleTheme(model);
    expect(model.theme).toBe('dark');
    expect(model.resolvedTheme).toBe('dark');
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');

    setThemeChoice(model, 'light-mint');
    expect(model.theme).toBe('light-mint');
    expect(model.resolvedTheme).toBe('light');
    expect(mocks.setTheme).toHaveBeenCalledWith('light-mint');

    closeAccountMenu(model);
    expect(model.accountMenuOpen).toBe(false);
  });
});
