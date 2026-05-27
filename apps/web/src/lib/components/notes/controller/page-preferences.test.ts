import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDITOR_FONT_OPTIONS,
  MAX_EDITOR_LINE_HEIGHT,
  MAX_EDITOR_TEXT_SIZE,
  MAX_EDITOR_ZOOM,
  MIN_EDITOR_LINE_HEIGHT,
  MIN_EDITOR_TEXT_SIZE,
  MIN_EDITOR_ZOOM,
  applyAppFont,
  clampEditorLineHeight,
  clampEditorTextSize,
  clampEditorZoom,
  getEditorFontCss,
  getStoredCompactView,
  getStoredEditorFont,
  getStoredEditorLineHeight,
  getStoredEditorTextSize,
  getStoredEditorZoom,
  getStoredGroup,
  getStoredSort,
  nextEditorZoom,
  setStoredCompactView,
  setStoredEditorFont,
  setStoredEditorLineHeight,
  setStoredEditorTextSize,
  setStoredEditorZoom,
  setStoredGroup,
  setStoredSort,
  zoomPercent
} from './page-preferences';

function installBrowserGlobals() {
  const storedValues = new Map<string, string>();
  const cssValues = new Map<string, string>();

  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storedValues.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storedValues.delete(key);
    }),
    clear: vi.fn(() => {
      storedValues.clear();
    })
  });

  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: vi.fn((key: string, value: string) => {
          cssValues.set(key, value);
        })
      }
    }
  });

  return { cssValues, storedValues };
}

describe('page preference helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back from invalid stored list preferences and persists valid ones', () => {
    const { storedValues } = installBrowserGlobals();

    expect(getStoredSort()).toBe('date-desc');
    expect(getStoredGroup()).toBe('smart');

    storedValues.set('author-sort', 'created-asc');
    storedValues.set('author-note-group', 'week');
    expect(getStoredSort()).toBe('date-desc');
    expect(getStoredGroup()).toBe('smart');

    setStoredSort('az');
    setStoredGroup('month');
    expect(getStoredSort()).toBe('az');
    expect(getStoredGroup()).toBe('month');
  });

  it('persists compact view with explicit string values', () => {
    const { storedValues } = installBrowserGlobals();

    expect(getStoredCompactView()).toBe(false);

    setStoredCompactView(true);
    expect(storedValues.get('author-compact-view')).toBe('1');
    expect(getStoredCompactView()).toBe(true);

    setStoredCompactView(false);
    expect(storedValues.get('author-compact-view')).toBe('0');
    expect(getStoredCompactView()).toBe(false);
  });

  it('clamps editor zoom, text size, and line height preferences', () => {
    const { storedValues } = installBrowserGlobals();

    expect(getStoredEditorZoom()).toBe(1);
    expect(getStoredEditorTextSize()).toBe(16);
    expect(getStoredEditorLineHeight()).toBe(1.75);

    storedValues.set('author-editor-zoom', '2');
    storedValues.set('author-editor-text-size', '9');
    storedValues.set('author-editor-line-height', '3.333');
    expect(getStoredEditorZoom()).toBe(MAX_EDITOR_ZOOM);
    expect(getStoredEditorTextSize()).toBe(MIN_EDITOR_TEXT_SIZE);
    expect(getStoredEditorLineHeight()).toBe(MAX_EDITOR_LINE_HEIGHT);

    setStoredEditorZoom(0.7);
    setStoredEditorTextSize(18.6);
    setStoredEditorLineHeight(1.234);
    expect(storedValues.get('author-editor-zoom')).toBe('0.8');
    expect(storedValues.get('author-editor-text-size')).toBe('19');
    expect(storedValues.get('author-editor-line-height')).toBe('1.35');
  });

  it('selects and applies editor font CSS safely', () => {
    const { cssValues, storedValues } = installBrowserGlobals();

    expect(getStoredEditorFont()).toBe('kedebideri');

    storedValues.set('author-editor-font', 'fantasy');
    expect(getStoredEditorFont()).toBe('kedebideri');

    setStoredEditorFont('system-serif');
    expect(getStoredEditorFont()).toBe('system-serif');
    expect(cssValues.get('--app-font')).toBe(getEditorFontCss('system-serif'));

    applyAppFont('mono');
    expect(cssValues.get('--app-font')).toBe(getEditorFontCss('mono'));
    expect(getEditorFontCss('system-sans')).toBe(
      EDITOR_FONT_OPTIONS.find((option) => option.value === 'system-sans')?.css
    );
  });

  it('normalizes editor control display helpers', () => {
    expect(clampEditorZoom(0)).toBe(MIN_EDITOR_ZOOM);
    expect(clampEditorZoom(10)).toBe(MAX_EDITOR_ZOOM);
    expect(nextEditorZoom(1, 1)).toBe(1.1);
    expect(nextEditorZoom(0.81, -1)).toBe(MIN_EDITOR_ZOOM);

    expect(clampEditorTextSize(99)).toBe(MAX_EDITOR_TEXT_SIZE);
    expect(clampEditorTextSize(13.2)).toBe(MIN_EDITOR_TEXT_SIZE);
    expect(clampEditorLineHeight(0.5)).toBe(MIN_EDITOR_LINE_HEIGHT);
    expect(clampEditorLineHeight(1.777)).toBe(1.78);
    expect(zoomPercent(1.234)).toBe('123%');
  });
});
