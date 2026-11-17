import { describe, expect, it } from 'vitest';
import {
  approximateWordCount,
  buildManuscript,
  buildManuscriptDocx,
  buildManuscriptDocxFiles,
  DEFAULT_MANUSCRIPT_OPTIONS,
  manuscriptFileName,
  orderManuscriptNotes,
  parseManuscriptBody,
  titleSortKey,
  type ManuscriptOptions,
  type ManuscriptSourceNote
} from './manuscript';

function source(
  id: string,
  title: string,
  body: string,
  createdAt = '2026-01-01T00:00:00.000Z'
): ManuscriptSourceNote {
  return { id, title, body, createdAt };
}

function options(
  overrides: Partial<ManuscriptOptions> = {}
): ManuscriptOptions {
  return {
    ...DEFAULT_MANUSCRIPT_OPTIONS,
    header: 'Beyond Rituals',
    ...overrides
  };
}

/** Reads entry names and contents from an uncompressed (stored) ZIP. */
function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0); // stored
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(
      decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      decoder.decode(bytes.subarray(dataStart, dataStart + size))
    );
    offset = dataStart + size;
  }
  return entries;
}

describe('manuscript ordering', () => {
  const notes = [
    source('a', 'Chapter 10', '', '2026-01-03T00:00:00.000Z'),
    source('b', 'chapter 2', '', '2026-01-02T00:00:00.000Z'),
    source('c', '', 'untitled', '2026-01-01T00:00:00.000Z'),
    source('d', 'Chapter 1', '', '2026-01-04T00:00:00.000Z')
  ];

  it('orders titles by number and puts untitled notes last', () => {
    expect(orderManuscriptNotes(notes, 'title').map((n) => n.id)).toEqual([
      'd',
      'b',
      'a',
      'c'
    ]);
  });

  it('orders Roman numerals by value where they are numbers', () => {
    const titles = [
      'Maya IX',
      'Maya',
      'Maya II',
      'Maya X',
      'Maya V',
      'Maya IV'
    ].map((title, index) => source(String(index), title, ''));
    expect(
      orderManuscriptNotes(titles, 'title').map((note) => note.title)
    ).toEqual(['Maya', 'Maya II', 'Maya IV', 'Maya V', 'Maya IX', 'Maya X']);

    expect(titleSortKey('XII')).toBe('12');
    expect(titleSortKey('IV. Winter')).toBe('4. Winter');
    expect(titleSortKey('IX — River')).toBe('9 — River');
    // Words that only look like numerals stay words.
    expect(titleSortKey('I Remember')).toBe('I Remember');
    expect(titleSortKey('MIX Tape')).toBe('MIX Tape');
    expect(titleSortKey('Part IIII')).toBe('Part IIII');
    expect(titleSortKey('Civil war')).toBe('Civil war');
  });

  it('orders mixed timestamp formats by instant', () => {
    const mixed = [
      source('android', 'B', '', '2026-01-01T10:00:00Z'),
      source('web', 'A', '', '2026-01-01T10:00:00.500Z'),
      source('offset', 'C', '', '2026-01-01T11:30:00+02:00'),
      source('broken', 'D', '', 'not a date')
    ];
    expect(orderManuscriptNotes(mixed, 'created').map((n) => n.id)).toEqual([
      'offset',
      'android',
      'web',
      'broken'
    ]);
  });

  it('orders by creation date, oldest first', () => {
    expect(orderManuscriptNotes(notes, 'created').map((n) => n.id)).toEqual([
      'c',
      'b',
      'a',
      'd'
    ]);
  });
});

describe('manuscript parsing', () => {
  it('keeps poetry lines, indentation and single stanza breaks', () => {
    expect(
      parseManuscriptBody(
        '\n\nfirst line  \n   indented\n\n\n\nsecond stanza\n\n',
        'poetry'
      )
    ).toEqual([
      { kind: 'line', text: 'first line' },
      { kind: 'line', text: '   indented' },
      { kind: 'stanza-break' },
      { kind: 'line', text: 'second stanza' }
    ]);
  });

  it('turns prose lines into paragraphs and recognises scene breaks', () => {
    expect(
      parseManuscriptBody(
        '  One   paragraph.\n\nTwo.\r\n* * *\n***\n#\nThree.\n~\n',
        'prose'
      )
    ).toEqual([
      { kind: 'paragraph', text: 'One paragraph.' },
      { kind: 'paragraph', text: 'Two.' },
      { kind: 'scene-break' },
      { kind: 'paragraph', text: 'Three.' }
    ]);
  });

  it('builds sections, skips empty notes and counts words', () => {
    const manuscript = buildManuscript(
      '  Beyond Rituals ',
      [
        source('a', 'Breathing', 'among the dead trees\n\n* * *'),
        source('b', '', '   \n'),
        source('c', '', 'untitled poem')
      ],
      options({ header: '  Header  ' })
    );
    expect(manuscript.title).toBe('Beyond Rituals');
    expect(manuscript.options.header).toBe('Header');
    expect(manuscript.sections.map((section) => section.id)).toEqual([
      'a',
      'c'
    ]);
    expect(manuscript.wordCount).toBe(7);
  });
});

describe('manuscript helpers', () => {
  it('rounds word counts like a manuscript title page', () => {
    expect(approximateWordCount(0)).toBe('0 words');
    expect(approximateWordCount(3)).toBe('about 10 words');
    expect(approximateWordCount(984)).toBe('about 980 words');
    expect(approximateWordCount(6_249)).toBe('about 6,200 words');
    expect(approximateWordCount(81_634)).toBe('about 82,000 words');
  });

  it('creates safe file names', () => {
    expect(manuscriptFileName('Beyond: Rituals / 2026', 'docx')).toBe(
      'Beyond Rituals 2026.docx'
    );
    expect(manuscriptFileName('  ', 'docx')).toBe('manuscript.docx');
    expect(manuscriptFileName('..hidden', 'docx')).toBe('hidden.docx');
  });
});

describe('manuscript DOCX', () => {
  const createdAt = '2026-11-17T09:30:00.123Z';
  const poetry = buildManuscript(
    'Beyond Rituals',
    [
      source(
        'a',
        'Breathing',
        'breathing\n\tamong <the> dead & trees\n\nI feel'
      ),
      source('b', '', 'untitled')
    ],
    options()
  );

  it('writes a complete package with header, footer and the manuscript font', () => {
    const files = new Map(
      buildManuscriptDocxFiles(poetry, createdAt).map((file) => [
        file.path,
        file.content
      ])
    );
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/settings.xml',
      'word/fontTable.xml',
      'word/header1.xml',
      'word/footer1.xml'
    ]);

    const document = files.get('word/document.xml')!;
    expect(document).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Breathing</w:t></w:r></w:p>'
    );
    expect(document).toContain(
      '<w:tab/><w:t xml:space="preserve">among &lt;the&gt; dead &amp; trees</w:t>'
    );
    // Stanza break, then the untitled poem starting on its own page.
    expect(document).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>'
    );
    expect(document).toContain(
      '<w:pStyle w:val="Body"/><w:pageBreakBefore/></w:pPr><w:r><w:t xml:space="preserve">untitled</w:t>'
    );
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(document).not.toContain('<w:titlePg/>');

    expect(files.get('word/header1.xml')).toContain('Beyond Rituals');
    expect(files.get('word/footer1.xml')).toContain('w:instr=" PAGE "');
    expect(files.get('word/styles.xml')).toContain('w:ascii="Newsreader"');
    expect(files.get('word/styles.xml')).toContain('w:line="276"');
    expect(files.get('word/fontTable.xml')).toContain(
      '<w:family w:val="roman"/>'
    );
    expect(files.get('docProps/core.xml')).toContain('2026-11-17T09:30:00Z');
  });

  it('omits header and footer parts when they are switched off', () => {
    const plain = buildManuscript(
      'Plain',
      [source('a', 'One', 'text')],
      options({ header: '', pageNumbers: false })
    );
    const files = buildManuscriptDocxFiles(plain, createdAt);
    const paths = files.map((file) => file.path);
    expect(paths).not.toContain('word/header1.xml');
    expect(paths).not.toContain('word/footer1.xml');
    const text = files.map((file) => file.content).join('\n');
    expect(text).not.toContain('header1.xml');
    expect(text).not.toContain('footer1.xml');
    expect(text).not.toContain('headerReference');
    expect(text).not.toContain('footerReference');
  });

  it('lays out prose with a title page, word count and chapter drop', () => {
    const prose = buildManuscript(
      'Novel',
      [source('a', 'Chapter 1', 'It began.\n* * *\nIt ended.')],
      options({ preset: 'prose', pageSize: 'letter', titlePage: true })
    );
    const files = new Map(
      buildManuscriptDocxFiles(prose, createdAt).map((file) => [
        file.path,
        file.content
      ])
    );
    const document = files.get('word/document.xml')!;
    expect(document).toContain('about 10 words');
    expect(document).toContain('<w:pStyle w:val="Title"/>');
    expect(document).toContain(
      '<w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t xml:space="preserve">#</w:t>'
    );
    expect(document).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(document).toContain('<w:pgNumType w:start="0"/><w:titlePg/>');
    // Title page drop, then the chapter drop on a new page above its heading.
    expect(document).toContain(
      '<w:p><w:pPr><w:pStyle w:val="PageDrop"/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val="Title"/>'
    );
    expect(document).toContain(
      '<w:p><w:pPr><w:pStyle w:val="PageDrop"/><w:pageBreakBefore/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
    );
    const styles = files.get('word/styles.xml')!;
    expect(styles).toContain('w:line="480"');
    expect(styles).toContain('<w:ind w:firstLine="720"/>');
    // A third of Letter's text height (279.4 - 2 * 25.4 mm) as an exact line.
    expect(styles).toContain('w:line="4320" w:lineRule="exact"');
  });

  it('packs the parts into a stored ZIP at the archive root', async () => {
    const blob = buildManuscriptDocx(poetry, createdAt);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const entries = readStoredZip(new Uint8Array(await blob.arrayBuffer()));
    expect([...entries.keys()][0]).toBe('[Content_Types].xml');
    expect(entries.get('word/document.xml')).toContain('Breathing');
  });

  it('strips characters that are invalid in XML', () => {
    const manuscript = buildManuscript(
      'Bad\u0001Title',
      [source('a', 'One', 'a\u0000b\u000bc')],
      options()
    );
    const text = buildManuscriptDocxFiles(manuscript, createdAt)
      .map((file) => file.content)
      .join('');
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(text).toContain('abc');
  });
});
