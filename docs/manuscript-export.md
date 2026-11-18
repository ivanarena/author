# Manuscript Export

A notebook can be exported as a submission-ready manuscript. Notes stay plain
text: layout is applied only at export time, and nothing about notes, sync, or
the database schema changes.

On the web, open it from a notebook's context menu (**Export manuscript**):
right-click, Shift+F10 or the menu key, or a touch long-press (also on iOS,
which has no native context-menu gesture). On Android, long-press the notebook
in the notebooks list. Both menus show the notebook's note and word counts.

Web and Android share the rules below and produce byte-identical DOCX files for
the same notes and options; keep `manuscript.ts` and `ManuscriptExport.kt` (and
their test cases) in step.

## Content

- Every active note in the notebook becomes one section (a poem or a chapter).
  Trashed notes and notes with neither title nor text are skipped.
- **Order:** by title, number-aware (`Chapter 2` before `Chapter 10`, untitled
  notes last), or by creation date, oldest first. Title order also reads Roman
  numerals as numbers when they are the whole title, its last word
  (`Maya II`) or a punctuated first word (`IV. Winter`).
- The note title is the section heading; untitled notes get no heading.
- Word counts use the app-wide rule, shared by web and Android: a word is a
  whitespace-separated token with at least one letter or number, so `* * *`
  and dashes do not count.

## Freshness

Exports read the local database, so they first make sure it is current:

- Edits still being saved from the editor are waited for, including a save
  whose debounce already fired.
- When signed in and online, the export runs a normal sync first (push, then
  pull), waiting for a sync that is already running, so changes made on other
  devices are included. After 20 seconds, or if sync fails, it continues with
  this device's copy.
- Offline or after a failed sync, the dialog and the result notification say
  that this device's copy was exported. Unresolved sync conflicts in the
  notebook are shown as a warning; the export uses this device's version.

## Presets

|              | Poetry                                                               | Prose                                                                        |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Lines        | Kept as written, including leading spaces; wrapped lines hang-indent | Each non-empty line is a paragraph with a 12.7 mm (0.5 in) first-line indent |
| Blank lines  | One blank line = stanza break (runs collapse)                        | Ignored                                                                      |
| Spacing      | 1.15                                                                 | Double                                                                       |
| Sections     | New page, bold centred title                                         | New page, centred title a third of the way down the text area                |
| Scene breaks | —                                                                    | A line made only of `*`, `#` or `~` becomes a centred `#`                    |

## Options

- Page size: A4 (25 mm margins), A5 (20 mm) or Letter (1 in).
- Running header: defaults to the notebook name; empty means no header.
- Page numbers: centred in the footer.
- Title page: the notebook name a third of the way down; Prose adds the
  rounded word count ("about 6,200 words") top right. The title page has no
  header or number, and the first text page is page 1.

Header and footer sit at half the page margin. The layout options (not the
header text) are remembered per device in `localStorage`
(`author-manuscript-export`).

## Font

Manuscripts use Newsreader at 12 pt (header and page number 10 pt).

- **PDF** embeds the font, so it always looks as intended. Printing uses the
  static Newsreader instances (`@fontsource/newsreader`, 400 and 700), not the
  variable font used by the app UI: Firefox prints variable fonts as outlines,
  which leaves the PDF without selectable or searchable text.
- **DOCX** names Newsreader and marks it as a serif in the font table. Readers
  without Newsreader installed see their word processor's serif substitute
  (Times New Roman in Word, DejaVu Serif or similar in LibreOffice).

## Formats

**DOCX** is written by hand in `apps/web/src/lib/client/manuscript.ts`
(WordprocessingML in a stored ZIP built by the Markdown archive writer). Styles:
`Body`, `Heading1` (navigation pane), `Title`, `WordCount`, `SceneBreak`,
`Header`, `Footer`, and `PageDrop`. Word processors drop "space before" at the
top of a page, so title and chapter drops are empty `PageDrop` paragraphs with
an exact line height.

**PDF** goes through the system print dialog ("Save to PDF"). The pages are
laid out by `apps/web/src/lib/client/manuscript-print.ts` rather than CSS paged
media, because Firefox cannot print running headers or page numbers (`@page`
margin boxes) and the app's CSP forbids iframes and inline styles. It:

1. appends hidden fixed-size page boxes (`contain: strict`) to `<body>`,
   styled by `styles/manuscript-print.css`, after loading every Newsreader
   subset the text uses;
2. fills each page in chunks of blocks and finds the first block that does
   not fit with one measurement per chunk; prose paragraphs split at the last
   fitting word (the continuation has no indent), verse lines move whole, and
   anything taller than a page by itself splits by characters, so every page
   receives content and layout always terminates. A stanza break never opens
   a page. The dialog stays open ("Preparing pages…") while this runs, and
   closing it cancels printing;
3. marks `<html>` with `printing-manuscript`, so print media hides the app and
   shows only the pages, each on a named `@page` with zero margins;
4. calls `window.print()`, temporarily setting `document.title` so browsers
   suggest the manuscript name as the PDF file name, and removes everything on
   `afterprint` (or when print media ends, for browsers without it).

The DOCX and PDF use the same sizes, so they paginate similarly, but each word
processor still lays out the DOCX itself.

## Android

- `core/ManuscriptExport.kt` holds the shared rules and the DOCX writer (a port
  of `manuscript.ts`), saved through the system file picker.
- `core/ManuscriptPagination.kt` fills pages using only line breaks from a
  measurer, so it is unit-tested on the JVM with a fake measurer.
- `core/ManuscriptPdf.kt` measures with `StaticLayout`, draws each line on a
  `PdfDocument` page in the bundled Newsreader (weight and optical size set per
  style; the font is embedded with a text layer), and hands the PDF to the
  system print dialog, which can print or **Save as PDF**.
- Exports wait for the editor's in-flight save, sync first when signed in and
  online (20-second cap), and warn about conflicts or offline state, as on the
  web. Layout choices are remembered per device (`author-manuscript-export`).
