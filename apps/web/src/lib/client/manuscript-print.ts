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
const FONT_FAMILY = 'Newsreader';
const FONT_SAMPLE = 'Manuscript àèéìòù';

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

const LAYOUT_CHUNK = 24;
const PAGES_PER_YIELD = 12;

/** Bottom edge of a page's text area, in viewport coordinates. */
function contentBottom(content: HTMLElement): number {
  return content.getBoundingClientRect().bottom + 0.5;
}

function fitsOnPage(content: HTMLElement, node: HTMLElement): boolean {
  return node.getBoundingClientRect().bottom <= contentBottom(content);
}

/** Index of the first child that does not fit, or -1 if all fit. */
function firstOverflowingChild(content: HTMLElement): number {
  const children = content.children;
  const bottom = contentBottom(content);
  let low = 0;
  let high = children.length - 1;
  let found = -1;
  // Children stack vertically, so their bottoms only grow.
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (children[middle].getBoundingClientRect().bottom > bottom) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
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

  newPage(): HTMLElement {
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
    return content;
  }
}

/**
 * Keeps the longest prefix of `node`'s text that fits on the page and
 * returns the rest, or null if not even one unit fits (text unchanged).
 */
function splitToFit(
  content: HTMLElement,
  node: HTMLElement,
  text: string,
  unit: 'word' | 'character'
): string | null {
  const separator = unit === 'word' ? ' ' : '';
  const parts = unit === 'word' ? text.split(' ') : Array.from(text);
  let low = 0;
  let high = parts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    node.textContent = parts.slice(0, middle).join(separator);
    if (fitsOnPage(content, node)) low = middle;
    else high = middle - 1;
  }
  if (low === 0) {
    node.textContent = text;
    return null;
  }
  node.textContent = parts.slice(0, low).join(separator);
  return parts.slice(low).join(separator);
}

/**
 * Places as much of `node` as fits at the end of the page. Returns what is
 * left for the next page, or null when nothing is left.
 */
function placePartially(
  content: HTMLElement,
  node: HTMLElement
): HTMLElement | null {
  if (node.classList.contains('ms-stanza-break')) return null;
  const alone = content.childElementCount === 0;
  const isParagraph = node.classList.contains('ms-paragraph');
  const isLine = node.classList.contains('ms-line');
  // Prose paragraphs break between words; a verse line moves whole unless it
  // is taller than a page by itself.
  if (!isParagraph && !(isLine && alone)) {
    if (!alone) return node;
    content.append(node); // Never leave a page empty: accept the overflow.
    return null;
  }

  const text = node.textContent ?? '';
  content.append(node);
  let rest = splitToFit(content, node, text, 'word');
  if (rest === null && alone)
    rest = splitToFit(content, node, text, 'character');
  if (rest === null) {
    if (alone) return null;
    node.remove();
    return node;
  }
  const continued = element('p', node.className, rest);
  continued.classList.add('ms-continued');
  return continued;
}

async function layoutSection(
  builder: PageBuilder,
  section: Manuscript['sections'][number],
  preset: Manuscript['options']['preset']
): Promise<void> {
  // A stack of blocks still to place, next block last.
  const pending = section.blocks.map(blockElement).reverse();
  let content = builder.newPage();
  if (section.title) {
    content.append(
      element('h2', `ms-section-title ms-${preset}-title`, section.title)
    );
  }

  while (pending.length) {
    for (let added = 0; added < LAYOUT_CHUNK && pending.length; ) {
      const node = pending.pop()!;
      // A stanza gap never opens a page.
      if (
        node.classList.contains('ms-stanza-break') &&
        !content.childElementCount
      ) {
        continue;
      }
      content.append(node);
      added += 1;
    }

    const overflowIndex = firstOverflowingChild(content);
    if (overflowIndex < 0) continue;

    const overflow = Array.from(content.children).slice(
      overflowIndex
    ) as HTMLElement[];
    for (const node of overflow) node.remove();
    for (let index = overflow.length - 1; index > 0; index -= 1) {
      pending.push(overflow[index]);
    }
    const rest = placePartially(content, overflow[0]);
    if (rest) pending.push(rest);
    if (!pending.length) break;

    content = builder.newPage();
    if (builder.pages.length % PAGES_PER_YIELD === 0) {
      // Keep the app responsive while long manuscripts are laid out.
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
}

/** Loads every Newsreader subset the manuscript uses before measuring. */
async function loadManuscriptFont(manuscript: Manuscript): Promise<void> {
  if (!('fonts' in document)) return;
  const characters = new Set<string>(FONT_SAMPLE);
  const add = (text: string) => {
    for (const character of text) characters.add(character);
  };
  add(manuscript.title);
  add(manuscript.options.header);
  for (const section of manuscript.sections) {
    add(section.title);
    for (const block of section.blocks) {
      if ('text' in block) add(block.text);
    }
  }
  const sample = Array.from(characters).join('');
  try {
    await Promise.all([
      document.fonts.load(`400 12pt ${FONT_FAMILY}`, sample),
      document.fonts.load(`700 12pt ${FONT_FAMILY}`, sample)
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
  await loadManuscriptFont(manuscript);

  const { preset, pageSize, titlePage } = manuscript.options;
  const root = element('div', `${ROOT_CLASS} ms-${preset} ms-${pageSize}`);
  root.setAttribute('aria-hidden', 'true');
  root.dataset.pageSize = MANUSCRIPT_PAGE_SIZES[pageSize].label;
  document.body.append(root);

  const builder = new PageBuilder(root, manuscript);
  if (titlePage) builder.titlePage();
  for (const section of manuscript.sections) {
    await layoutSection(builder, section, preset);
  }
  root.dataset.pages = String(builder.pages.length);
  return root;
}

/**
 * Opens the system print dialog for pages from `renderManuscriptPages`,
 * where the user can save a PDF. Everything is removed after printing.
 */
export function printManuscriptPages(title: string): void {
  const previousTitle = document.title;
  // Browsers suggest the document title as the PDF file name.
  document.title = title;
  document.documentElement.classList.add(PRINTING_CLASS);

  // `afterprint` is not fired everywhere (some mobile browsers), so leaving
  // print media also ends print mode; otherwise a later Ctrl+P of the app
  // would print the manuscript again.
  const printMedia =
    typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  const onPrintMediaChange = (event: MediaQueryListEvent) => {
    if (!event.matches) cleanup();
  };
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    printMedia?.removeEventListener('change', onPrintMediaChange);
    document.title = previousTitle;
    removeManuscriptPrint();
  };
  window.addEventListener('afterprint', cleanup);
  printMedia?.addEventListener('change', onPrintMediaChange);
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
