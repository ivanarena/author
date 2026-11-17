import { createStoredZipBytes } from './markdown-archive';
import { countWords } from './view-model';

// A manuscript is one notebook compiled into a submission-ready document.
// Notes stay plain text; layout is applied only here, at export time.

export type ManuscriptPreset = 'poetry' | 'prose';
export type ManuscriptOrder = 'title' | 'created';
export type ManuscriptPageSize = 'a4' | 'a5' | 'letter';

export interface ManuscriptOptions {
  preset: ManuscriptPreset;
  order: ManuscriptOrder;
  pageSize: ManuscriptPageSize;
  /** Running header text; empty means no header. */
  header: string;
  pageNumbers: boolean;
  titlePage: boolean;
}

export const DEFAULT_MANUSCRIPT_OPTIONS: Omit<ManuscriptOptions, 'header'> = {
  preset: 'poetry',
  order: 'title',
  pageSize: 'a4',
  pageNumbers: true,
  titlePage: false
};

export interface ManuscriptPageGeometry {
  label: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

export const MANUSCRIPT_PAGE_SIZES: Record<
  ManuscriptPageSize,
  ManuscriptPageGeometry
> = {
  a4: { label: 'A4', widthMm: 210, heightMm: 297, marginMm: 25 },
  a5: { label: 'A5', widthMm: 148, heightMm: 210, marginMm: 20 },
  letter: { label: 'Letter', widthMm: 215.9, heightMm: 279.4, marginMm: 25.4 }
};

/** The font every manuscript is set in (PDF embeds it; DOCX names it). */
export const MANUSCRIPT_FONT = 'Newsreader';
export const MANUSCRIPT_FONT_SIZE_PT = 12;
export const MANUSCRIPT_HEADER_SIZE_PT = 10;
/** Prose first-line indent: half an inch. */
export const MANUSCRIPT_PROSE_INDENT_MM = 12.7;

export interface ManuscriptSourceNote {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export type ManuscriptBlock =
  /** A poetry line; leading whitespace is significant. */
  | { kind: 'line'; text: string }
  /** The gap between two stanzas. */
  | { kind: 'stanza-break' }
  /** A prose paragraph (one source line). */
  | { kind: 'paragraph'; text: string }
  /** A prose scene break, written as `* * *`, `***`, `#` or similar. */
  | { kind: 'scene-break' };

export interface ManuscriptSection {
  id: string;
  title: string;
  blocks: ManuscriptBlock[];
}

export interface Manuscript {
  title: string;
  options: ManuscriptOptions;
  sections: ManuscriptSection[];
  wordCount: number;
}

const titleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

const SCENE_BREAK = /^[*#~](?:\s*[*#~])*$/;

/**
 * Title order is number-aware ("Chapter 2" before "Chapter 10"); untitled
 * notes go last. Created order is oldest first. Each falls back to the other.
 */
export function orderManuscriptNotes<T extends ManuscriptSourceNote>(
  notes: readonly T[],
  order: ManuscriptOrder
): T[] {
  const byCreated = (a: T, b: T) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const byTitle = (a: T, b: T) => {
    const aTitle = a.title.trim();
    const bTitle = b.title.trim();
    if (!aTitle !== !bTitle) return aTitle ? -1 : 1;
    return titleCollator.compare(aTitle, bTitle);
  };
  return [...notes].sort((a, b) =>
    order === 'title'
      ? byTitle(a, b) || byCreated(a, b)
      : byCreated(a, b) || byTitle(a, b)
  );
}

export function parseManuscriptBody(
  body: string,
  preset: ManuscriptPreset
): ManuscriptBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ManuscriptBlock[] = [];

  if (preset === 'poetry') {
    for (const rawLine of lines) {
      const text = rawLine.replace(/\s+$/, '');
      if (!text) {
        if (blocks.length && blocks.at(-1)?.kind !== 'stanza-break') {
          blocks.push({ kind: 'stanza-break' });
        }
        continue;
      }
      blocks.push({ kind: 'line', text });
    }
    if (blocks.at(-1)?.kind === 'stanza-break') blocks.pop();
    return blocks;
  }

  for (const rawLine of lines) {
    const text = rawLine.trim();
    if (!text) continue;
    if (SCENE_BREAK.test(text)) {
      if (blocks.length && blocks.at(-1)?.kind !== 'scene-break') {
        blocks.push({ kind: 'scene-break' });
      }
      continue;
    }
    blocks.push({ kind: 'paragraph', text: text.replace(/\s+/g, ' ') });
  }
  if (blocks.at(-1)?.kind === 'scene-break') blocks.pop();
  return blocks;
}

export function buildManuscript(
  title: string,
  notes: readonly ManuscriptSourceNote[],
  options: ManuscriptOptions
): Manuscript {
  const sections: ManuscriptSection[] = [];
  let wordCount = 0;
  for (const note of orderManuscriptNotes(notes, options.order)) {
    const sectionTitle = note.title.trim().replace(/\s+/g, ' ');
    const blocks = parseManuscriptBody(note.body, options.preset);
    if (!sectionTitle && !blocks.length) continue;
    wordCount += countWords(`${note.title} ${note.body}`);
    sections.push({ id: note.id, title: sectionTitle, blocks });
  }
  return {
    title: title.trim() || 'Untitled manuscript',
    options: { ...options, header: options.header.trim() },
    sections,
    wordCount
  };
}

/** Manuscript-style rounded count, e.g. "about 6,200 words". */
export function approximateWordCount(words: number): string {
  if (words <= 0) return '0 words';
  const step = words < 1_000 ? 10 : words < 10_000 ? 100 : 1_000;
  const rounded = Math.max(step, Math.round(words / step) * step);
  return `about ${rounded.toLocaleString('en-US')} words`;
}

export function manuscriptFileName(title: string, extension: string): string {
  const base =
    title
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/^\.+/, '') || 'manuscript';
  return `${base}.${extension}`;
}

/** Distance from the top of the text area to a prose chapter heading. */
export function chapterDropMm(geometry: ManuscriptPageGeometry): number {
  return (geometry.heightMm - geometry.marginMm * 2) / 3;
}

// ---------------------------------------------------------------------------
// DOCX (WordprocessingML). Written by hand to avoid a dependency; the package
// is a stored ZIP built with the same writer as the Markdown export.

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function twips(mm: number): number {
  return Math.round((mm / 25.4) * 1440);
}

// Characters that are not allowed in XML 1.0 documents.
const INVALID_XML_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function docxRun(text: string, runProperties = ''): string {
  const pieces = text.split('\t');
  const content = pieces
    .map(
      (piece, index) =>
        `${index ? '<w:tab/>' : ''}${
          piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : ''
        }`
    )
    .join('');
  return `<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}${content}</w:r>`;
}

function docxParagraph(
  style: string,
  text: string,
  { pageBreakBefore = false, runProperties = '' } = {}
): string {
  const properties = `<w:pPr><w:pStyle w:val="${style}"/>${
    pageBreakBefore ? '<w:pageBreakBefore/>' : ''
  }</w:pPr>`;
  return `<w:p>${properties}${text ? docxRun(text, runProperties) : ''}</w:p>`;
}

function docxStyles(manuscript: Manuscript): string {
  const { preset, pageSize } = manuscript.options;
  const geometry = MANUSCRIPT_PAGE_SIZES[pageSize];
  const font = escapeXml(MANUSCRIPT_FONT);
  const size = MANUSCRIPT_FONT_SIZE_PT * 2;
  const headerSize = MANUSCRIPT_HEADER_SIZE_PT * 2;
  const prose = preset === 'prose';
  // Single line at 1.15 for poetry, double spacing for prose (240 = single).
  const line = prose ? 480 : 276;
  const bodyIndent = prose
    ? `<w:ind w:firstLine="${twips(MANUSCRIPT_PROSE_INDENT_MM)}"/>`
    : // Wrapped poetry lines hang-indent so the line break stays visible.
      '<w:ind w:left="360" w:hanging="360"/>';
  const headingAfter = prose ? line : size * 10;
  const headingRun = prose ? '' : '<w:b/><w:bCs/>';
  // Word processors drop "space before" at the top of a page, so the chapter
  // drop is an empty paragraph with an exact line height instead.
  const drop = twips(chapterDropMm(geometry));

  return `${XML_DECLARATION}<w:styles xmlns:w="${W_NS}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Manuscript Body"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${bodyIndent}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Body"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="${headingAfter}"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${headingRun}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="${line}"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="PageDrop"><w:name w:val="Page Drop"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="${drop}" w:lineRule="exact"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="WordCount"><w:name w:val="Word Count"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Body"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="${headerSize}"/><w:szCs w:val="${headerSize}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="${headerSize}"/><w:szCs w:val="${headerSize}"/></w:rPr></w:style>
</w:styles>`;
}

function docxDocument(manuscript: Manuscript): string {
  const { options } = manuscript;
  const geometry = MANUSCRIPT_PAGE_SIZES[options.pageSize];
  const paragraphs: string[] = [];

  if (options.titlePage) {
    if (options.preset === 'prose') {
      paragraphs.push(
        docxParagraph('WordCount', approximateWordCount(manuscript.wordCount))
      );
    }
    paragraphs.push(docxParagraph('PageDrop', ''));
    paragraphs.push(docxParagraph('Title', manuscript.title));
  }

  manuscript.sections.forEach((section, sectionIndex) => {
    // Every section starts a new page, except the first one in the file.
    let needsBreak = sectionIndex > 0 || options.titlePage;
    if (section.title) {
      if (options.preset === 'prose') {
        paragraphs.push(
          docxParagraph('PageDrop', '', { pageBreakBefore: needsBreak })
        );
        needsBreak = false;
      }
      paragraphs.push(
        docxParagraph('Heading1', section.title, {
          pageBreakBefore: needsBreak
        })
      );
      needsBreak = false;
    }
    for (const block of section.blocks) {
      if (block.kind === 'line' || block.kind === 'paragraph') {
        paragraphs.push(
          docxParagraph('Body', block.text, { pageBreakBefore: needsBreak })
        );
      } else if (block.kind === 'scene-break') {
        paragraphs.push(
          docxParagraph('SceneBreak', '#', { pageBreakBefore: needsBreak })
        );
      } else {
        paragraphs.push(
          docxParagraph('Normal', '', { pageBreakBefore: needsBreak })
        );
      }
      needsBreak = false;
    }
  });

  const margin = twips(geometry.marginMm);
  const headerDistance = twips(geometry.marginMm / 2);
  const sectionProperties = [
    options.header ? '<w:headerReference w:type="default" r:id="rId4"/>' : '',
    options.pageNumbers
      ? '<w:footerReference w:type="default" r:id="rId5"/>'
      : '',
    `<w:pgSz w:w="${twips(geometry.widthMm)}" w:h="${twips(geometry.heightMm)}"/>`,
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="${headerDistance}" w:footer="${headerDistance}" w:gutter="0"/>`,
    // The title page is page 0 and carries no header or number.
    options.titlePage ? '<w:pgNumType w:start="0"/>' : '',
    options.titlePage ? '<w:titlePg/>' : ''
  ].join('');

  return `${XML_DECLARATION}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${paragraphs.join(
    ''
  )}<w:sectPr>${sectionProperties}</w:sectPr></w:body></w:document>`;
}

function docxHeader(text: string): string {
  return `${XML_DECLARATION}<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${docxParagraph(
    'Header',
    text
  )}</w:hdr>`;
}

function docxFooter(): string {
  return `${XML_DECLARATION}<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
}

function docxCoreProperties(title: string, createdAt: string): string {
  const created = escapeXml(createdAt.replace(/\.\d+Z$/, 'Z'));
  return `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(
    title
  )}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
}

export function buildManuscriptDocxFiles(
  manuscript: Manuscript,
  createdAt: string
): Array<{ path: string; content: string }> {
  const { header, pageNumbers } = manuscript.options;
  const contentTypes = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>',
    header
      ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
      : '',
    pageNumbers
      ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      : '',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  ].join('');
  const documentRelationships = [
    `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${R_NS}/settings" Target="settings.xml"/>`,
    `<Relationship Id="rId3" Type="${R_NS}/fontTable" Target="fontTable.xml"/>`,
    header
      ? `<Relationship Id="rId4" Type="${R_NS}/header" Target="header1.xml"/>`
      : '',
    pageNumbers
      ? `<Relationship Id="rId5" Type="${R_NS}/footer" Target="footer1.xml"/>`
      : ''
  ].join('');
  const font = escapeXml(MANUSCRIPT_FONT);

  const files = [
    {
      path: '[Content_Types].xml',
      content: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes}</Types>`
    },
    {
      path: '_rels/.rels',
      content: `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
    },
    {
      path: 'docProps/core.xml',
      content: docxCoreProperties(manuscript.title, createdAt)
    },
    {
      path: 'word/_rels/document.xml.rels',
      content: `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRelationships}</Relationships>`
    },
    { path: 'word/document.xml', content: docxDocument(manuscript) },
    { path: 'word/styles.xml', content: docxStyles(manuscript) },
    {
      path: 'word/settings.xml',
      content: `${XML_DECLARATION}<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    },
    {
      // Recipients without Newsreader get a serif substitute, not a sans.
      path: 'word/fontTable.xml',
      content: `${XML_DECLARATION}<w:fonts xmlns:w="${W_NS}"><w:font w:name="${font}"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`
    }
  ];
  if (header)
    files.push({ path: 'word/header1.xml', content: docxHeader(header) });
  if (pageNumbers)
    files.push({ path: 'word/footer1.xml', content: docxFooter() });
  return files;
}

export function buildManuscriptDocx(
  manuscript: Manuscript,
  createdAt: string
): Blob {
  const bytes = createStoredZipBytes(
    buildManuscriptDocxFiles(manuscript, createdAt),
    createdAt
  );
  return new Blob([bytes as BlobPart], { type: DOCX_MIME_TYPE });
}
