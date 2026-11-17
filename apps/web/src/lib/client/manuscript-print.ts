import {
  approximateWordCount,
  MANUSCRIPT_PAGE_SIZES,
  type Manuscript,
  type ManuscriptBlock
} from './manuscript';

// Print/PDF output. Pages are laid out here instead of relying on CSS paged
// media, because Firefox cannot print running headers or page numbers
// (`@page` margin boxes) and the app's CSP forbids iframes and inline <style>.
// Every page is a fixed-size box; the system print dialog then saves the PDF.

const ROOT_CLASS = 'manuscript-print';
const PRINTING_CLASS = 'printing-manuscript';
const FONT_FAMILY = '"Newsreader Variable"';
const FONT_SAMPLE = 'Manuscript àèéìòù';

interface PageParts {
  page: HTMLElement;
  content: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function overflows(content: HTMLElement): boolean {
  return content.scrollHeight > content.clientHeight + 0.5;
}

function blockElement(block: ManuscriptBlock): HTMLElement {
  switch (block.kind) {
    case 'line':
      return element('p', 'ms-line', block.text);
    case 'paragraph':
      return element('p', 'ms-paragraph', block.text);
    case 'scene-break':
      return element('p', 'ms-scene-break', '#');
    case 'stanza-break':
      return element('div', 'ms-stanza-break');
  }
}

class PageBuilder {
  readonly pages: HTMLElement[] = [];
  private pageNumber = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly manuscript: Manuscript
  ) {}

  titlePage(): void {
    const page = element('section', 'ms-page ms-title-page');
    if (this.manuscript.options.preset === 'prose') {
      page.append(
        element(
          'p',
          'ms-word-count',
          approximateWordCount(this.manuscript.wordCount)
        )
      );
    }
    page.append(element('h1', 'ms-title', this.manuscript.title));
    this.root.append(page);
    this.pages.push(page);
  }

  newPage(): PageParts {
    const { header, pageNumbers } = this.manuscript.options;
    this.pageNumber += 1;
    const page = element('section', 'ms-page');
    if (header) page.append(element('header', 'ms-running-header', header));
    const content = element('div', 'ms-content');
    page.append(content);
    if (pageNumbers) {
      page.append(element('footer', 'ms-page-number', String(this.pageNumber)));
    }
    this.root.append(page);
    this.pages.push(page);
    return { page, content };
  }
}

/** Splits a paragraph so its first part fills the page; returns the rest. */
function splitParagraph(
  content: HTMLElement,
  paragraph: HTMLElement,
  text: string
): string | null {
  const words = text.split(' ');
  let low = 0;
  let high = words.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    paragraph.textContent = words.slice(0, middle).join(' ');
    if (overflows(content)) high = middle - 1;
    else low = middle;
  }
  if (low === 0) {
    paragraph.remove();
    return text;
  }
  paragraph.textContent = words.slice(0, low).join(' ');
  return words.slice(low).join(' ');
}

function layoutSection(
  builder: PageBuilder,
  section: Manuscript['sections'][number],
  preset: Manuscript['options']['preset']
): void {
  let { content } = builder.newPage();
  if (section.title) {
    content.append(
      element('h2', `ms-section-title ms-${preset}-title`, section.title)
    );
  }

  for (const block of section.blocks) {
    // A stanza gap never opens a page.
    if (block.kind === 'stanza-break' && !content.childElementCount) continue;

    let node = blockElement(block);
    content.append(node);
    if (!overflows(content)) continue;

    if (block.kind === 'paragraph') {
      let rest = splitParagraph(content, node, block.text);
      while (rest !== null) {
        ({ content } = builder.newPage());
        node = element('p', 'ms-paragraph ms-continued', rest);
        content.append(node);
        rest = overflows(content) ? splitParagraph(content, node, rest) : null;
      }
      continue;
    }

    node.remove();
    if (block.kind === 'stanza-break') continue;
    ({ content } = builder.newPage());
    content.append(node);
  }
}

async function loadManuscriptFont(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`400 12pt ${FONT_FAMILY}`, FONT_SAMPLE),
      document.fonts.load(`700 12pt ${FONT_FAMILY}`, FONT_SAMPLE)
    ]);
  } catch {
    // Fall back to the serif stack; layout is still measured consistently.
  }
}

export function removeManuscriptPrint(): void {
  document.documentElement.classList.remove(PRINTING_CLASS);
  for (const node of document.querySelectorAll(`.${ROOT_CLASS}`)) {
    node.remove();
  }
}

/**
 * Lays the manuscript out into fixed-size pages. The pages stay hidden on
 * screen and become the only visible content when printing.
 */
export async function renderManuscriptPages(
  manuscript: Manuscript
): Promise<HTMLElement> {
  removeManuscriptPrint();
  await loadManuscriptFont();

  const { preset, pageSize, titlePage } = manuscript.options;
  const root = element('div', `${ROOT_CLASS} ms-${preset} ms-${pageSize}`);
  root.setAttribute('aria-hidden', 'true');
  root.dataset.pageSize = MANUSCRIPT_PAGE_SIZES[pageSize].label;
  document.body.append(root);

  const builder = new PageBuilder(root, manuscript);
  if (titlePage) builder.titlePage();
  for (const section of manuscript.sections) {
    layoutSection(builder, section, preset);
  }
  root.dataset.pages = String(builder.pages.length);
  return root;
}

/** Opens the system print dialog, where the user can save a PDF. */
export async function printManuscript(manuscript: Manuscript): Promise<number> {
  const root = await renderManuscriptPages(manuscript);
  const pageCount = Number(root.dataset.pages);
  const previousTitle = document.title;
  // Browsers suggest the document title as the PDF file name.
  document.title = manuscript.title;
  document.documentElement.classList.add(PRINTING_CLASS);

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    document.title = previousTitle;
    removeManuscriptPrint();
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  return pageCount;
}
